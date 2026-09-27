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
 * -----------------------------------------------------------------------------
 * DOS CAMINOS, Y NO SON INTERCAMBIABLES
 * -----------------------------------------------------------------------------
 * CAMINO 1 — dinero real (`transfer.inbound.*`): llega de un **Webhook Endpoint
 * REGISTRADO** en Fintoc, que sí va firmado. Exige `Fintoc-Signature` válida
 * contra el `secreto_webhook_ref` del tenant ANTES de parsear el cuerpo. Es el
 * flujo original y no cambia: aquí se mueve plata.
 *
 * CAMINO 2 — creación del Link (`link.created`): llega del `webhookUrl` que se le
 * pasa al widget, que es un canal ad-hoc **que Fintoc NO FIRMA** (verificado en
 * producción: POST con User-Agent Ruby y sin el header; y contra
 * docs.fintoc.com/docs/webhooks-validating, donde la firma existe solo para los
 * endpoints registrados). No hay forma de pedirle que lo firme.
 *
 * Y es el único canal por el que el `link_token` llega jamás
 * (docs.fintoc.com/reference/link-object: «This attribute will only be returned
 * when creating a Link. After that, this field will always be null» / «the Link
 * Token is not saved by Fintoc, and can never be retrieved again»).
 *
 * ⚠️ La autorización del camino 2 NO es una firma: es un NONCE de un solo uso y
 * vida corta (`identidad.cobranza_conexiones_pendientes`) que nuestro servidor
 * emitió para ese tenant antes de abrir el widget, y que viaja en la URL
 * (`?flow=`). Sin un nonce que calce —pendiente, no vencido y de ESE tenant— el
 * cuerpo no se cree y no hay ningún efecto. Las dos mitades de la validación van
 * juntas; solo por estado, un ticket olvidado sería una llave eterna.
 *
 * ⚠️ Por eso el camino 2 NO puede exigir firma y el camino 1 NO puede aceptar el
 * nonce: mezclarlos le daría a cualquiera que vea una URL en un log la capacidad
 * de inyectar un movimiento de dinero.
 *
 * Al aterrizar el camino 2 se REGISTRA programáticamente el Webhook Endpoint real
 * del tenant (`POST /v1/webhook_endpoints`) y se guarda su `secret` cifrado: es lo
 * que hace que el camino 1 pueda validar firma de ahí en adelante. Antes, ese
 * `secreto_webhook_ref` no lo escribía nadie y todo `transfer.inbound` moría en
 * 404 `tenant_sin_cobranza`.
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
import { cifrarSecreto } from '@/modules/integraciones/secretos';
import { resolverUrlBaseApp } from '@/modules/identidad/enlace-invitacion';
import {
  crearPuertoConciliacionPagos,
  resolverSecretoWebhookTenant,
  ErrorConfigCobranzaAusente,
  consumirConexionPendienteCobranza,
  devolverConexionPendienteCobranza,
  esPayloadLinkCreado,
  leerLinkCreado,
  rutaWebhookCobranza,
  PARAM_NONCE_CONEXION,
  leerSecretKeyOrg,
  registrarWebhookEndpointCobranza,
  borrarWebhookEndpointsDeUrl,
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

  // 2. Header de firma. Su AUSENCIA no es un error: es la marca del canal ad-hoc
  //    del widget (camino 2), que Fintoc no firma. Sin firma, la única puerta es
  //    el nonce de la URL — y nada de dinero pasa por ahí.
  const firmaHeader = request.headers.get('Fintoc-Signature') ?? '';
  if (!firmaHeader) {
    return await procesarLinkCreado(request, tenantId, cuerpoCrudo);
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

// ---------------------------------------------------------------------------
// CAMINO 2 — `link.created` del canal ad-hoc del widget (SIN firma).
// ---------------------------------------------------------------------------
/**
 * Aterriza la creación del Link: valida el nonce, cifra el `link_token`, registra
 * el Webhook Endpoint firmado del tenant y deja la conexión guardada.
 *
 * ORDEN DE LOS PASOS, QUE NO ES ARBITRARIO:
 *  1. Reclamar el nonce (un solo `UPDATE … RETURNING`, así dos entregas
 *     simultáneas no ganan las dos).
 *  2. Cifrar el `link_token` — el paso IRRECUPERABLE. Si falla, se devuelve el
 *     ticket a `pendiente` y se responde 500 para que Fintoc reintente; de otro
 *     modo el token se perdería para siempre.
 *  3. Registrar el Webhook Endpoint (recuperable a mano) — si falla, la conexión
 *     se guarda igual: leer movimientos solo necesita el `link_token`.
 *  4. Guardar config + bitácora, y responder 200.
 */
async function procesarLinkCreado(
  request: NextRequest,
  tenantId: string,
  cuerpoCrudo: string,
): Promise<NextResponse> {
  // 1. El nonce de la URL es la única autorización de este camino.
  const nonce = request.nextUrl.searchParams.get(PARAM_NONCE_CONEXION) ?? '';
  if (!esUuid(nonce)) {
    // Sin nonce (o con basura) no se mira el cuerpo. El 401 es el mismo que el de
    // un nonce ajeno, para no revelar cuál de las dos cosas pasó.
    return NextResponse.json({ error: 'no_autorizado' }, { status: 401 });
  }

  // Parsear ANTES de consumir el ticket: un cuerpo malformado no debe quemar el
  // nonce del courier (Fintoc podría reintentar con el bueno).
  let payload: unknown;
  try {
    payload = JSON.parse(cuerpoCrudo);
  } catch {
    return NextResponse.json({ error: 'body_malformado' }, { status: 400 });
  }

  if (!esPayloadLinkCreado(payload)) {
    // Otro evento del canal ad-hoc (Fintoc manda también los movimientos por
    // aquí). 200 para que no reintente; el ticket queda intacto.
    return NextResponse.json({ ok: true, ignorado: true }, { status: 200 });
  }

  const link = leerLinkCreado(payload);
  if (!link) {
    // Notificación sin `link_token`: NO es la que trae el secreto, así que el
    // ticket NO se consume (podría venir la buena después). 200 para no provocar
    // reintentos en bucle de un cuerpo que nunca va a servir.
    console.warn(
      `[webhook fintoc] link.created sin link_token para tenant=${tenantId}; ticket intacto.`,
    );
    return NextResponse.json({ ok: true, sin_link_token: true }, { status: 200 });
  }

  // Reclamar el ticket. Cuatro fallos posibles (inexistente, ajeno, usado,
  // vencido) y una sola respuesta, a propósito.
  const ticket = await consumirConexionPendienteCobranza({ tenantId, nonce });
  if (!ticket) {
    return NextResponse.json({ error: 'no_autorizado' }, { status: 401 });
  }

  // 2. Cifrar el `link_token` — paso irrecuperable.
  let referenciaLinkToken: string;
  try {
    const cifrado = await cifrarSecreto({
      tenantId,
      tipoSecreto: 'token_link_fintoc',
      valor: link.linkToken,
      venceEn: null,
      metadata: { proposito: 'link_token_cobranza_fintoc' },
    });
    referenciaLinkToken = cifrado.referenciaExternaId;
  } catch {
    await devolverConexionPendienteCobranza({ tenantId, nonce });
    console.error(
      `[webhook fintoc] no se pudo cifrar el link_token de tenant=${tenantId}; ` +
        'ticket devuelto a pendiente para que Fintoc reintente.',
    );
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }

  // 3. Registrar el Webhook Endpoint firmado del tenant. Best effort: si falla, la
  //    conexión se guarda sin `secreto_webhook_ref` y los `transfer.inbound`
  //    seguirán rebotando hasta que alguien lo registre — pero el `link_token`,
  //    que es lo irrecuperable, ya está a salvo.
  let referenciaSecretoWebhook: string | null = null;
  let detalleFalloWebhook: string | null = null;
  try {
    const urlBase = resolverUrlBaseApp();
    if (!urlBase) throw new Error('falta la URL pública de la app');
    // La URL registrada va SIN el `?flow=` — el nonce es de este único flujo.
    const urlEndpoint = `${urlBase}${rutaWebhookCobranza(tenantId)}`;
    const secretKey = leerSecretKeyOrg();

    // Reconexión: borrar el endpoint anterior de la misma URL. Si quedara, Fintoc
    // mandaría cada evento dos veces y la copia firmada con el secreto viejo
    // respondería 401 para siempre.
    await borrarWebhookEndpointsDeUrl({ secretKey, url: urlEndpoint });

    const endpoint = await registrarWebhookEndpointCobranza({
      secretKey,
      url: urlEndpoint,
      descripcion: `Rutax cobranza — courier ${tenantId}`,
    });
    const cifrado = await cifrarSecreto({
      tenantId,
      tipoSecreto: 'secreto_webhook_fintoc',
      valor: endpoint.secret,
      venceEn: null,
      metadata: {
        proposito: 'secreto_webhook_cobranza_fintoc',
        webhook_endpoint_id: endpoint.id,
      },
    });
    referenciaSecretoWebhook = cifrado.referenciaExternaId;
  } catch (error) {
    // El mensaje NUNCA lleva el secreto ni la secret key de la org.
    detalleFalloWebhook = error instanceof Error ? error.message : 'error desconocido';
    console.error(
      `[webhook fintoc] no se pudo registrar el webhook endpoint de tenant=${tenantId}: ` +
        `${detalleFalloWebhook}. La conexión se guarda igual; los transfer.inbound no ` +
        'llegarán firmados hasta que se registre.',
    );
  }

  // 4. Guardar la conexión. `estado_conexion = 'conectado'` incluso si el paso 3
  //    falló: el banco SÍ quedó conectado para leer movimientos, y marcar `error`
  //    le diría al courier que reconecte — lo que quemaría un `link_token` bueno
  //    para volver a fallar en lo mismo. El aviso va a la bitácora, no a la UI.
  const supabase = crearClienteServiceRole();
  const fila: Record<string, unknown> = {
    tenant_id: tenantId,
    link_token_ref: referenciaLinkToken,
    cuenta_banco_alias: link.cuentaBancoAlias,
    estado_conexion: 'conectado',
    actualizado_en: new Date().toISOString(),
  };
  // El secreto solo se escribe si se obtuvo: en un upsert de PostgREST toda
  // columna del payload se escribe TAMBIÉN en el UPDATE, y un `null` borraría el
  // secreto válido de una conexión anterior.
  if (referenciaSecretoWebhook) {
    fila.secreto_webhook_ref = referenciaSecretoWebhook;
  }

  const { error: errorConfig } = await supabase
    .schema('identidad')
    .from('courier_config_cobranza')
    .upsert(fila, { onConflict: 'tenant_id' });

  if (errorConfig) {
    await devolverConexionPendienteCobranza({ tenantId, nonce });
    console.error(
      `[webhook fintoc] no se pudo guardar la config de cobranza de tenant=${tenantId}: ` +
        errorConfig.message,
    );
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }

  // BITÁCORA — conectar la cuenta bancaria del courier es una acción de acceso a
  // datos financieros: lleva autor (el usuario que abrió el widget, guardado en el
  // ticket). Sin token ni secreto en el detalle.
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId: ticket.actorUsuarioId,
    actorTipo: ticket.actorUsuarioId ? 'usuario' : 'sistema',
    accion: 'cobranza.banco_conectado',
    entidadTipo: 'courier_config_cobranza',
    entidadId: tenantId,
    detalle: {
      cuenta_banco_alias: link.cuentaBancoAlias,
      webhook_endpoint_registrado: referenciaSecretoWebhook !== null,
      ...(detalleFalloWebhook ? { webhook_endpoint_fallo: detalleFalloWebhook } : {}),
    },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
