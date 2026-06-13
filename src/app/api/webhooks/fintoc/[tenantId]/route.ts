/**
 * Webhook handler de Fintoc — cobranza courier→seller (capa "pagado")
 * =====================================================================
 * POST /api/webhooks/fintoc/:tenantId
 *
 * RESOLUCIÓN DE TENANT — DECISIÓN (documentada aquí):
 * El secreto del Webhook Endpoint de Fintoc es POR-TENANT (cada courier conecta
 * SU banco y tiene su propio Webhook Endpoint). La firma `Fintoc-Signature` se
 * valida CON ese secreto, así que hay que conocer el tenant ANTES de validar.
 * El payload de Fintoc no trae un identificador de tenant estable y no-secreto
 * (el `link_token` SÍ identifica la cuenta pero es un secreto, no viaja en el
 * webhook; mapear por contenido sería frágil). Por eso se usa una URL de webhook
 * POR-TENANT: cada courier registra en Fintoc la URL
 * `…/api/webhooks/fintoc/{tenantId}`. El `tenantId` del path resuelve el tenant
 * de forma determinista; el secreto de ESE tenant valida la firma. Un tenantId
 * inexistente o sin config de cobranza → 404 (sin filtrar si existe o no).
 *
 * FLUJO (patrón webhook del proyecto, ver `webhooks/ml/shipments`):
 * 1. Leer el RAW body (string) — la firma de Fintoc se calcula sobre los bytes
 *    crudos, no sobre el JSON re-serializado.
 * 2. Tomar el header `Fintoc-Signature`.
 * 3. Resolver el secreto de webhook del tenant (descifrado vía el helper del
 *    adaptador) y VALIDAR la firma. Inválida → 401, sin efectos. (Fintoc SÍ
 *    firma — a diferencia de ML marketplace; aquí la validación es obligatoria.)
 * 4. `normalizarEventoTransferencia` → `MovimientoPago` (solo transferencias
 *    entrantes; otros eventos se ignoran con 200).
 * 5. BITÁCORA ANTES del efecto: registrar la recepción del pago.
 * 6. Emitir `dinero/pago.recibido`. Responder 200 rápido. El matching va al job.
 *
 * SEGURIDAD:
 * - El secreto de webhook y el `link_token` NUNCA se loguean ni viajan al
 *   evento. `linkTokenRef` es la referencia opaca (uuid), no el token.
 * - El RUT/nombre de la contraparte no se loguean (dato personal); van al evento
 *   solo para que el job concilie, y a `pagos_recibidos` (RLS los protege).
 */

import { NextRequest, NextResponse } from 'next/server';
import { inngest } from '@/lib/inngest/cliente';
import { consumirRateLimit } from '@/lib/rate-limit';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import {
  crearPuertoConciliacionPagos,
  resolverSecretoWebhookTenant,
  ErrorConfigCobranzaAusente,
} from '@/modules/integraciones/pagos';

interface Params {
  params: Promise<{ tenantId: string }>;
}

/**
 * Límite por tenant (ítem #7): los movimientos bancarios reales de un courier
 * son decenas por DÍA; 30/min cubre con holgura las reentregas en ráfaga de
 * Fintoc. El rate limit corre ANTES de resolver/descifrar el secreto del
 * webhook, para que un flood no pague crypto ni acceso a secretos.
 */
const LIMITE_POR_TENANT = 30;
const VENTANA_SEGUNDOS = 60;

/** UUID v4-ish: defensa para no pegarle a la BD con basura del path. */
function esUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { tenantId } = await params;

  if (!tenantId || !esUuid(tenantId)) {
    return NextResponse.json({ error: 'tenant_invalido' }, { status: 404 });
  }

  // RATE LIMIT por tenant — inmediatamente tras el check de UUID y ANTES de
  // resolver/descifrar el secreto del webhook (el flood no paga crypto).
  const limite = await consumirRateLimit(
    `fintoc:${tenantId}`,
    LIMITE_POR_TENANT,
    VENTANA_SEGUNDOS,
  );
  if (!limite.permitido) {
    console.warn(
      `[webhook fintoc] rate limit excedido para llave=fintoc:${tenantId} ` +
        `(límite ${LIMITE_POR_TENANT}/${VENTANA_SEGUNDOS}s).`,
    );
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limite.reintentarEnSegundos) } },
    );
  }

  // 1. RAW body — necesario para validar la firma sobre los bytes exactos.
  const cuerpoCrudo = await request.text();

  // 2. Header de firma (obligatorio en Fintoc).
  const firmaHeader = request.headers.get('Fintoc-Signature') ?? '';
  if (!firmaHeader) {
    return NextResponse.json({ error: 'firma_ausente' }, { status: 401 });
  }

  // 3. Resolver el secreto del tenant y validar la firma.
  //    Config ausente / secreto ausente → 404 (no revelar el detalle).
  let secretoWebhook: string;
  try {
    secretoWebhook = await resolverSecretoWebhookTenant(tenantId);
  } catch (error) {
    if (error instanceof ErrorConfigCobranzaAusente) {
      return NextResponse.json({ error: 'tenant_sin_cobranza' }, { status: 404 });
    }
    // Falla de descifrado u otra → 500 sin detalle (no exponer internos).
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }

  const puerto = crearPuertoConciliacionPagos(tenantId);

  const firmaValida = puerto.validarFirmaWebhook({
    cuerpoCrudo,
    firmaHeader,
    secretoWebhook,
  });
  if (!firmaValida) {
    // Firma inválida o fuera de tolerancia anti-replay → 401, sin efectos.
    return NextResponse.json({ error: 'firma_invalida' }, { status: 401 });
  }

  // Parsear el payload SOLO después de validar la firma.
  let payload: unknown;
  try {
    payload = JSON.parse(cuerpoCrudo);
  } catch {
    return NextResponse.json({ error: 'body_malformado' }, { status: 400 });
  }

  // Solo nos interesa la transferencia entrante. Otros eventos (refresh, etc.)
  // se aceptan con 200 para que Fintoc no reintente, pero no disparan matching.
  const tipoEvento =
    payload && typeof payload === 'object' ? (payload as { type?: unknown }).type : undefined;
  if (typeof tipoEvento === 'string' && tipoEvento !== 'transfer.inbound.succeeded') {
    return NextResponse.json({ ok: true, ignorado: tipoEvento }, { status: 200 });
  }

  // 4. Normalizar a MovimientoPago (firma ya validada arriba).
  let movimiento;
  try {
    movimiento = puerto.normalizarEventoTransferencia(payload);
  } catch {
    // Payload firmado pero sin movimiento reconocible → 200 (no reintentar).
    return NextResponse.json({ ok: true, sin_movimiento: true }, { status: 200 });
  }

  // Solo transferencias entrantes (dinero que ENTRA a la cuenta del courier).
  if (!movimiento.esEntrante) {
    return NextResponse.json({ ok: true, no_entrante: true }, { status: 200 });
  }

  // Resolver la referencia opaca del link del tenant (para trazar la cuenta en
  // pagos_recibidos.link_token_ref). NO es el token — es el uuid de la referencia.
  const supabase = crearClienteServiceRole();
  const { data: config } = await supabase
    .schema('identidad')
    .from('courier_config_cobranza')
    .select('link_token_ref')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const linkTokenRef = (config?.link_token_ref as string | null) ?? '';

  // 5. BITÁCORA ANTES del efecto — la recepción del pago queda auditada aunque
  //    el `inngest.send` siguiente falle. Sin RUT/nombre ni montos cruzados de
  //    otros: solo el id externo del movimiento y el monto de ESTE pago.
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId: null,
    actorTipo: 'sistema',
    accion: 'dinero.pago_recibido',
    entidadTipo: 'pago_recibido',
    entidadId: movimiento.movimientoExternoId,
    detalle: {
      monto_clp: movimiento.montoClp,
      fecha_movimiento: movimiento.fechaMovimiento,
      tiene_rut_contraparte: movimiento.contraparteRutNormalizado !== null,
    },
  });

  // 6. Emitir el evento. El `id` (idempotencia de Inngest) usa tenant + movimiento
  //    para que reentregas del webhook no dupliquen el procesamiento.
  await inngest.send({
    name: 'dinero/pago.recibido',
    id: `pago-recibido-${tenantId}-${movimiento.movimientoExternoId}`,
    data: {
      tenantId,
      movimientoExternoId: movimiento.movimientoExternoId,
      montoClp: movimiento.montoClp,
      fechaMovimiento: movimiento.fechaMovimiento,
      contraparteRutNormalizado: movimiento.contraparteRutNormalizado,
      contraparteNombre: movimiento.contraparteNombre,
      linkTokenRef,
    },
  });

  // Responder 200 lo antes posible — el matching es asíncrono (job).
  return NextResponse.json({ ok: true }, { status: 200 });
}
