/**
 * Webhook handler de Fintoc — confirmación instantánea de PAYOUTS a
 * conductores (capa "dinero saliente" del motor entrega→dinero, F19/Fase 3)
 * =====================================================================
 * POST /api/webhooks/fintoc-payout
 *
 * DIFERENCIA CLAVE con `api/webhooks/fintoc/:tenantId` (cobranza entrante):
 * ese webhook resuelve el tenant DESDE la URL porque el secreto es POR-TENANT
 * (cada courier conecta su propio banco). Este webhook, en cambio, NO lleva
 * `tenantId` en la ruta: el secreto del Webhook Endpoint de PAYOUTS SALIENTES
 * es de ORGANIZACIÓN (`FINTOC_PAYOUT_WEBHOOK_SECRET` — una sola cuenta Fintoc
 * de la plataforma origina TODAS las transferencias salientes, ver
 * `src/modules/integraciones/pagos/payout/fabrica-payout.ts`). El tenant se
 * resuelve DESPUÉS de validar la firma, buscando el payout por
 * `payout_externo_id = transferExternoId` (índice único parcial
 * `payouts_conductor_payout_externo_uk`, migración 20260708000002).
 *
 * FLUJO (mismo patrón que `webhooks/fintoc/:tenantId`, adaptado):
 * 1. Rate limit con clave FIJA (no per-tenant: el tenant aún no se conoce).
 * 2. Leer el RAW body — la firma se calcula sobre los bytes crudos.
 * 3. Header `Fintoc-Signature` ausente → 401.
 * 4. Validar la firma con el secreto de ORGANIZACIÓN
 *    (`validarFirmaWebhookPayout`, HMAC-SHA256 + anti-replay 300s,
 *    fail-closed). Inválida/expirada → 401 + alerta a observabilidad.
 * 5. Parsear el JSON SOLO después de validar la firma.
 * 6. Normalizar con `normalizarEventoWebhookPayoutFintoc`. `null` → 200
 *    (no es un evento `transfer.outbound.*` reconocible; no reintentar).
 * 7. Resolver `payout_id`/`tenant_id`/`liquidacion_id` buscando
 *    `dinero.payouts_conductor` por `payout_externo_id` (service_role). Sin
 *    fila → 200 + alerta ("transfer sin payout" — no debería ocurrir salvo
 *    una carrera con `jobEjecutarPayout` aún no comprometida en BD).
 * 8. Insertar en `dinero.eventos_payout_externos` (barrera de idempotencia
 *    DURA por `evento_externo_id` — 23505 → ya procesado → 200, NO re-emitir
 *    el evento Inngest).
 * 9. BITÁCORA ANTES del evento — la recepción del webhook queda auditada
 *    aunque el `inngest.send` siguiente falle (RNF-04, actor = sistema).
 * 10. Emitir `dinero/payout.actualizacion-externa` (id determinístico
 *     `payout-webhook-${eventoExternoId}` — idempotencia ADICIONAL de
 *     Inngest). Responder 200 rápido — la transición de estado es asíncrona
 *     (`jobAplicarActualizacionPayout`).
 *
 * SEGURIDAD:
 * - El secreto de organización NUNCA se loguea ni viaja al evento.
 * - `payload_sanitizado` (armado por el adaptador en la Fase 2) NUNCA incluye
 *   `counterparty` (datos bancarios del conductor) ni tokens/secretos.
 */

import { NextRequest, NextResponse } from 'next/server';
import { inngest } from '@/lib/inngest/cliente';
import { consumirRateLimit } from '@/lib/rate-limit';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { capturarMensaje } from '@/lib/observabilidad';
import {
  validarFirmaWebhookPayout,
  normalizarEventoWebhookPayoutFintoc,
} from '@/modules/integraciones/pagos';

/**
 * Clave de rate limit FIJA (no per-tenant): a diferencia de la cobranza
 * entrante, aquí el tenant no se conoce hasta después de resolver el payout,
 * y todos los couriers comparten la MISMA cuenta Fintoc de organización. Los
 * payouts reales son decenas por día en todo el sistema; 60/min da holgura
 * de sobra a reintentos/ráfagas de Fintoc sin abrir la puerta a un flood.
 */
const LLAVE_RATE_LIMIT = 'fintoc-payout:global';
const LIMITE = 60;
const VENTANA_SEGUNDOS = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Rate limit — ANTES de leer el body/validar la firma (el flood no paga
  //    ni el parseo del body ni el cómputo HMAC).
  const limite = await consumirRateLimit(LLAVE_RATE_LIMIT, LIMITE, VENTANA_SEGUNDOS);
  if (!limite.permitido) {
    console.warn(
      `[webhook fintoc-payout] rate limit excedido (límite ${LIMITE}/${VENTANA_SEGUNDOS}s).`,
    );
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limite.reintentarEnSegundos) } },
    );
  }

  // 2. RAW body — necesario para validar la firma sobre los bytes exactos.
  const cuerpoCrudo = await request.text();

  // 3. Header de firma (obligatorio en Fintoc).
  const firma = request.headers.get('Fintoc-Signature') ?? '';
  if (!firma) {
    return NextResponse.json({ error: 'firma_ausente' }, { status: 401 });
  }

  // 4. Validar la firma con el secreto de ORGANIZACIÓN (nunca por-tenant aquí).
  const secreto = process.env.FINTOC_PAYOUT_WEBHOOK_SECRET ?? '';
  if (!secreto) {
    // Fail-closed: sin secreto configurado, NUNCA se acepta un webhook —
    // nunca se procesa un evento que no se puede autenticar.
    await capturarMensaje(
      'Webhook de payout recibido pero FINTOC_PAYOUT_WEBHOOK_SECRET no está configurado.',
      'error',
      { origen: 'webhook:fintoc-payout' },
    );
    return NextResponse.json({ error: 'webhook_no_configurado' }, { status: 401 });
  }

  const firmaValida = validarFirmaWebhookPayout({ cuerpoCrudo, firma, secreto });
  if (!firmaValida) {
    await capturarMensaje(
      'Webhook de payout con firma inválida o fuera de tolerancia anti-replay.',
      'warning',
      { origen: 'webhook:fintoc-payout' },
    );
    return NextResponse.json({ error: 'firma_invalida' }, { status: 401 });
  }

  // 5. Parsear el payload SOLO después de validar la firma.
  let payload: unknown;
  try {
    payload = JSON.parse(cuerpoCrudo);
  } catch {
    return NextResponse.json({ error: 'body_malformado' }, { status: 400 });
  }

  // 6. Normalizar. `null` = no es un evento `transfer.outbound.*` reconocible.
  const evento = normalizarEventoWebhookPayoutFintoc(payload);
  if (!evento) {
    return NextResponse.json({ ok: true, ignorado: true }, { status: 200 });
  }

  // 7. Resolver el payout/tenant/liquidación por el transfer id.
  const supabase = crearClienteServiceRole();
  const { data: payoutFila, error: errBuscarPayout } = await supabase
    .schema('dinero')
    .from('payouts_conductor')
    .select('id, tenant_id, liquidacion_id')
    .eq('payout_externo_id', evento.transferExternoId)
    .maybeSingle();

  if (errBuscarPayout) {
    console.error(`[webhook fintoc-payout] error al buscar payout: ${errBuscarPayout.message}`);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }

  if (!payoutFila) {
    await capturarMensaje(
      `Webhook de payout: el transfer ${evento.transferExternoId} no corresponde a ningún payout conocido.`,
      'warning',
      {
        origen: 'webhook:fintoc-payout',
        etiquetas: { transfer_externo_id: evento.transferExternoId, evento_externo_id: evento.eventoExternoId },
      },
    );
    return NextResponse.json({ ok: true, sin_payout: true }, { status: 200 });
  }

  const tenantId = payoutFila.tenant_id as string;
  const payoutId = payoutFila.id as string;
  const liquidacionId = payoutFila.liquidacion_id as string;

  // 8. Insertar en el ledger — barrera de idempotencia DURA.
  const { error: errInsert } = await supabase
    .schema('dinero')
    .from('eventos_payout_externos')
    .insert({
      tenant_id: tenantId,
      payout_id: payoutId,
      liquidacion_id: liquidacionId,
      evento_externo_id: evento.eventoExternoId,
      transfer_externo_id: evento.transferExternoId,
      estado_externo: evento.estadoExterno,
      motivo: evento.motivo,
      payload_sanitizado: evento.payloadSanitizado,
    });

  if (errInsert) {
    // 23505 = unique_violation sobre evento_externo_id → ya procesado.
    if ((errInsert as { code?: string }).code === '23505') {
      return NextResponse.json({ ok: true, ya_procesado: true }, { status: 200 });
    }
    console.error(`[webhook fintoc-payout] error al insertar evento: ${errInsert.message}`);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }

  // 9. BITÁCORA ANTES de emitir el evento Inngest — actor sistema (RNF-04).
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId: null,
    actorTipo: 'sistema',
    accion: 'dinero.payout_webhook_recibido',
    entidadTipo: 'liquidacion',
    entidadId: liquidacionId,
    detalle: {
      payout_id: payoutId,
      estado_externo: evento.estadoExterno,
      transfer_externo_id: evento.transferExternoId,
    },
  });

  // 10. Emitir el evento — id determinístico por evento externo (idempotencia
  //     adicional de Inngest sobre la barrera dura de BD).
  await inngest.send({
    name: 'dinero/payout.actualizacion-externa',
    id: `payout-webhook-${evento.eventoExternoId}`,
    data: {
      tenantId,
      payoutId,
      liquidacionId,
      transferExternoId: evento.transferExternoId,
      eventoExternoId: evento.eventoExternoId,
      estadoExterno: evento.estadoExterno,
      motivo: evento.motivo,
      comprobanteRef: evento.comprobanteRef,
    },
  });

  // Responder 200 lo antes posible — la transición de estado es asíncrona (job).
  return NextResponse.json({ ok: true }, { status: 200 });
}
