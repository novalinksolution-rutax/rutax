/**
 * Webhook de WhatsApp Cloud API
 * =============================================================================
 * GET  /api/webhooks/whatsapp  — handshake de verificación de Meta.
 * POST /api/webhooks/whatsapp  — acuses de entrega, mensajes entrantes y
 *                                cambios de estado de plantillas.
 *
 * POR QUÉ EXISTE: Meta ACEPTA el mensaje y devuelve un `wamid`; que llegue —o
 * que rebote porque el número no tiene WhatsApp— se sabe después. Sin este
 * endpoint, un aviso mandado a un número mal escrito se ve exactamente igual
 * que uno que llegó. Esto convierte ese silencio en un estado visible.
 *
 * SEGURIDAD:
 *  1. Rate limit ANTES de leer el body — un flood no paga ni parseo ni HMAC.
 *  2. Firma `X-Hub-Signature-256` obligatoria. Fail-closed: sin
 *     `WHATSAPP_APP_SECRET` configurado NUNCA se acepta un evento.
 *  3. El JSON se parsea SOLO después de validar la firma.
 *
 * ⚠️ NO HAY ANTI-REPLAY, Y NO SE PUEDE HABER. Meta no firma un timestamp, así
 * que una petición capturada se puede reproducir para siempre con firma válida.
 * Se compensa haciendo que reproducir sea inofensivo: los acuses SOLO avanzan
 * el estado (nunca lo retroceden) y la baja es idempotente.
 *
 * ES ORG-LEVEL, NO POR TENANT: la WABA de Rutax es una sola para todos los
 * couriers. El tenant se descubre DESPUÉS, al resolver a qué mensaje o a qué
 * contacto pertenece lo que llegó.
 *
 * ⚠️ SIEMPRE 200 SALVO EN FALLO PROPIO. Un 4xx hace que Meta reintente, y tras
 * suficientes fallos Meta DESACTIVA la suscripción entera — dejando a todos los
 * couriers sin acuses hasta que alguien lo note en la consola de Meta.
 */

import { NextRequest, NextResponse } from "next/server";
import { consumirRateLimit } from "@/lib/rate-limit";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { capturarMensaje } from "@/lib/observabilidad";
import { inngest } from "@/lib/inngest/cliente";
import type { EventoMensajeWhatsAppRecibido } from "@/lib/inngest/eventos";
import {
  verificarFirmaWebhookWhatsApp,
  resolverHandshakeWebhook,
} from "@/modules/integraciones/notificaciones/whatsapp/firma-webhook";
import {
  normalizarEventosWebhookWhatsApp,
  estadoAvanza,
  type EstadoMensajeWhatsApp,
  type AcuseMensaje,
  type MensajeEntrante,
} from "@/modules/integraciones/notificaciones/whatsapp/webhook-eventos";

/**
 * Clave de rate limit FIJA: la WABA es de organización y el tenant no se conoce
 * hasta resolver el mensaje. 600/min absorbe una ráfaga de acuses de un envío
 * masivo (cada mensaje genera hasta tres: sent, delivered, read) sin abrir la
 * puerta a un flood.
 */
const LLAVE_RATE_LIMIT = "whatsapp-webhook:global";
const LIMITE = 600;
const VENTANA_SEGUNDOS = 60;

// -----------------------------------------------------------------------------
// GET — handshake de verificación
// -----------------------------------------------------------------------------

/**
 * Meta llama una vez, al guardar la URL en la consola, con `hub.mode`,
 * `hub.verify_token` y `hub.challenge`.
 *
 * ⚠️ La respuesta va en TEXTO PLANO. Un `NextResponse.json(challenge)` devuelve
 * el número entre comillas y Meta rechaza la verificación con un mensaje que no
 * explica nada.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const parametros = request.nextUrl.searchParams;

  const challenge = resolverHandshakeWebhook({
    modo: parametros.get("hub.mode"),
    token: parametros.get("hub.verify_token"),
    challenge: parametros.get("hub.challenge"),
    tokenEsperado: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
  });

  if (challenge === null) {
    // 403 es lo que Meta espera de un handshake fallido. No se detalla por qué
    // —token errado, falta de configuración— para no confirmarle nada a quien
    // esté probando la URL a ciegas.
    return new Response("Forbidden", { status: 403 });
  }

  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// -----------------------------------------------------------------------------
// POST — eventos
// -----------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Rate limit.
  const limite = await consumirRateLimit(LLAVE_RATE_LIMIT, LIMITE, VENTANA_SEGUNDOS);
  if (!limite.permitido) {
    console.warn(`[webhook whatsapp] rate limit excedido (límite ${LIMITE}/${VENTANA_SEGUNDOS}s).`);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limite.reintentarEnSegundos) } },
    );
  }

  // 2. RAW body — la firma se calcula sobre los bytes exactos.
  const cuerpoCrudo = await request.text();

  // 3. Fail-closed sin secreto: jamás se procesa un evento que no se autentica.
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";
  if (!appSecret) {
    await capturarMensaje(
      "Webhook de WhatsApp recibido pero WHATSAPP_APP_SECRET no está configurado.",
      "error",
      { origen: "webhook:whatsapp" },
    );
    return NextResponse.json({ error: "webhook_no_configurado" }, { status: 401 });
  }

  const cabeceraFirma = request.headers.get("x-hub-signature-256") ?? "";
  if (!verificarFirmaWebhookWhatsApp({ cuerpoCrudo, cabeceraFirma, appSecret })) {
    await capturarMensaje("Webhook de WhatsApp con firma inválida.", "warning", {
      origen: "webhook:whatsapp",
    });
    return NextResponse.json({ error: "firma_invalida" }, { status: 401 });
  }

  // 4. Parsear SOLO después de validar la firma.
  let payload: unknown;
  try {
    payload = JSON.parse(cuerpoCrudo);
  } catch {
    return NextResponse.json({ error: "body_malformado" }, { status: 400 });
  }

  const eventos = normalizarEventosWebhookWhatsApp(payload);
  const cliente = crearClienteServiceRole();

  // 5. Acuses de entrega.
  let acusesAplicados = 0;
  for (const acuse of eventos.acuses) {
    if (await aplicarAcuse(cliente, acuse)) acusesAplicados += 1;
  }

  // 6. Mensajes entrantes — baja de consentimiento.
  let bajasAplicadas = 0;
  for (const entrante of eventos.entrantes) {
    if (await procesarEntrante(cliente, entrante)) bajasAplicadas += 1;
  }

  // 6b. Mensajes entrantes — consulta por WhatsApp (módulo `conversacion`).
  //
  // TODO entrante se RESERVA acá (idempotente por `meta_message_id`, igual que
  // los salientes) para que el reintento de Meta no lo procese dos veces. El
  // evento se publica SOLO si `pideBaja === false`: así la regla "nunca se le
  // manda un menú a quien pidió la baja" la impone la AUSENCIA del evento, no
  // un `if` dentro de `conversacion` (§8 del documento de alcance).
  //
  // ⚠️ Este webhook NO importa nada de `src/modules/conversacion`: solo
  // reserva la fila y publica el evento. La resolución de identidad y la
  // respuesta corren en el job que lo consume.
  let consultasPublicadas = 0;
  for (const entrante of eventos.entrantes) {
    if (entrante.pideBaja) continue;
    const mensajeEntranteId = await reservarMensajeEntrante(cliente, entrante);
    if (mensajeEntranteId) {
      await publicarConsultaWhatsApp(entrante, mensajeEntranteId);
      consultasPublicadas += 1;
    }
  }

  // 7. Cambios de estado de plantillas.
  //
  // NO se guardan en base a propósito: el catálogo vive en TypeScript y un
  // `estado_meta` persistido se convertiría en un filtro obsoleto que bloquea
  // envíos que Meta sí habría aceptado (ver `catalogo-plantillas.ts`). Se
  // registran en observabilidad para que un rechazo de Meta sea VISIBLE — que
  // es lo que realmente hacía falta — sin volverse una compuerta.
  for (const plantilla of eventos.plantillas) {
    const nivel = plantilla.estadoMeta === "rechazada" ? "error" : "info";
    await capturarMensaje(
      `Meta cambió el estado de la plantilla "${plantilla.nombrePlantilla}" (${plantilla.idioma}) a "${plantilla.estadoMeta}".`,
      nivel,
      { origen: "webhook:whatsapp" },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      acuses: acusesAplicados,
      entrantes: eventos.entrantes.length,
      bajas: bajasAplicadas,
      consultas: consultasPublicadas,
    },
    { status: 200 },
  );
}

// -----------------------------------------------------------------------------
// Acuses
// -----------------------------------------------------------------------------

/**
 * Aplica un acuse **solo si hace avanzar el estado**.
 *
 * ⚠️ Meta entrega los acuses DESORDENADOS y los reenvía en sus reintentos: un
 * `read` puede llegar antes que su `delivered`. Sin esta comparación, un
 * mensaje ya leído volvería a "enviado" y la pantalla mentiría. Es el mismo bug
 * que mordió en el webhook de payout de Fintoc con el `succeeded` tardío.
 *
 * Devuelve `true` si escribió.
 */
async function aplicarAcuse(
  cliente: ReturnType<typeof crearClienteServiceRole>,
  acuse: AcuseMensaje,
): Promise<boolean> {
  const { data: mensaje, error } = await cliente
    .schema("integraciones")
    .from("whatsapp_mensajes")
    .select("id, estado")
    .eq("meta_message_id", acuse.metaMessageId)
    .maybeSingle();

  if (error) {
    await capturarMensaje("No se pudo resolver el mensaje de un acuse de WhatsApp.", "error", {
      origen: "webhook:whatsapp",
    });
    return false;
  }

  // Sin correlación: un mensaje mandado fuera de Rutax (una respuesta manual
  // desde la app de WhatsApp Business), o anterior a que guardáramos el wamid.
  // No es un error.
  if (!mensaje) return false;

  if (!estadoAvanza(mensaje.estado as EstadoMensajeWhatsApp, acuse.estado)) return false;

  const { error: errorUpdate } = await cliente
    .schema("integraciones")
    .from("whatsapp_mensajes")
    .update({
      estado: acuse.estado,
      ...(acuse.motivo ? { error_motivo: acuse.motivo } : {}),
    })
    .eq("id", mensaje.id as string);

  if (errorUpdate) {
    await capturarMensaje("No se pudo registrar el acuse de un WhatsApp.", "error", {
      origen: "webhook:whatsapp",
    });
    return false;
  }

  return true;
}

// -----------------------------------------------------------------------------
// Mensajes entrantes
// -----------------------------------------------------------------------------

/**
 * Procesa un mensaje que alguien ESCRIBIÓ al número de Rutax.
 *
 * La v1 hace una sola cosa con ellos: si el texto pide la baja, revoca el
 * consentimiento. No hay bandeja de entrada — crearla generaría una expectativa
 * de respuesta que nadie está atendiendo.
 *
 * ⚠️ LA BAJA SE APLICA A TODOS LOS CONTACTOS CON ESE NÚMERO, DE TODOS LOS
 * COURIERS. Un mismo teléfono puede ser contacto de dos couriers a la vez (un
 * seller que trabaja con dos), y la persona que escribe "BAJA" no distingue
 * entre ellos: dijo que no quiere más mensajes de este número, y este número es
 * uno solo. Revocar solo en un tenant dejaría al otro escribiéndole igual.
 *
 * Devuelve `true` si revocó algo.
 */
async function procesarEntrante(
  cliente: ReturnType<typeof crearClienteServiceRole>,
  entrante: MensajeEntrante,
): Promise<boolean> {
  if (!entrante.pideBaja || !entrante.telefonoE164) return false;

  const { data: contactos, error } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .select("id, tenant_id")
    .eq("telefono_e164", entrante.telefonoE164)
    .neq("opt_in_estado", "revocado");

  if (error) {
    await capturarMensaje("No se pudieron resolver los contactos de una baja de WhatsApp.", "error", {
      origen: "webhook:whatsapp",
    });
    return false;
  }

  const afectados = (contactos ?? []) as Array<{ id: string; tenant_id: string }>;
  if (afectados.length === 0) return false;

  const { error: errorUpdate } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .update({ opt_in_estado: "revocado" })
    .in(
      "id",
      afectados.map((c) => c.id),
    );

  if (errorUpdate) {
    await capturarMensaje("No se pudo revocar el consentimiento de WhatsApp.", "error", {
      origen: "webhook:whatsapp",
    });
    return false;
  }

  // La revocación es un hecho de CONSENTIMIENTO y va a la bitácora: es la
  // evidencia de que se respetó la voluntad del destinatario, que es
  // exactamente lo que Meta audita si el número recibe reportes.
  //
  // El teléfono NO va en el detalle: es dato personal y `contacto_id` alcanza
  // para llegar a él por join cuando alguien con permiso lo necesite.
  for (const contacto of afectados) {
    await registrarEnBitacora(cliente, {
      tenantId: contacto.tenant_id,
      actorUsuarioId: null,
      actorTipo: "sistema",
      accion: "whatsapp.consentimiento_revocado",
      entidadTipo: "whatsapp_contacto",
      entidadId: contacto.id,
      detalle: { origen: "mensaje_entrante_baja" },
    });
  }

  return true;
}

// -----------------------------------------------------------------------------
// Consulta por WhatsApp (módulo `conversacion`)
// -----------------------------------------------------------------------------

/**
 * Reserva la fila de `integraciones.whatsapp_mensajes_entrantes` ANTES de
 * publicar el evento — la misma disciplina que los salientes: al revés, el
 * mensaje ya se respondió dos veces cuando uno se entera.
 *
 * ⚠️ `resolucion` nace en un valor PROVISIONAL, no en el definitivo: acá
 * todavía no se sabe de qué contacto es. Se guarda `ilegible` cuando Meta
 * mandó un teléfono que no normaliza (eso SÍ se sabe en este instante) y
 * `sin_contacto` en cualquier otro caso — «todavía no hay contacto resuelto»
 * es literalmente cierto en el momento de la reserva. El job de `conversacion`
 * hace la resolución real (§5) y ACTUALIZA esta misma fila con el resultado
 * final (`resuelto` | `ambiguo` | `sin_contacto` confirmado).
 *
 * Devuelve el id de la fila (nueva o ya existente, si es un reintento de Meta
 * sobre el mismo `meta_message_id`), o `null` si no se pudo escribir.
 */
async function reservarMensajeEntrante(
  cliente: ReturnType<typeof crearClienteServiceRole>,
  entrante: MensajeEntrante,
): Promise<string | null> {
  const resolucionProvisional = entrante.telefonoE164 ? "sin_contacto" : "ilegible";

  const { data: insertada, error } = await cliente
    .schema("integraciones")
    .from("whatsapp_mensajes_entrantes")
    .insert({
      meta_message_id: entrante.metaMessageId,
      telefono_e164: entrante.telefonoE164,
      resolucion: resolucionProvisional,
    })
    .select("id")
    .maybeSingle();

  if (!error && insertada) return insertada.id as string;

  // 23505 = ya reservado por un reintento anterior de Meta. No es un error:
  // se recupera el id para publicar el evento igual (Inngest deduplica por su
  // propio id determinístico, así que publicarlo de nuevo es inofensivo).
  if (error?.code === "23505") {
    const { data: existente } = await cliente
      .schema("integraciones")
      .from("whatsapp_mensajes_entrantes")
      .select("id")
      .eq("meta_message_id", entrante.metaMessageId)
      .maybeSingle();
    return (existente?.id as string | undefined) ?? null;
  }

  await capturarMensaje("No se pudo reservar un mensaje entrante de WhatsApp para conversación.", "error", {
    origen: "webhook:whatsapp",
  });
  return null;
}

/**
 * Publica `whatsapp/mensaje.recibido`. `id` determinístico por `metaMessageId`
 * (§9): sin anti-replay posible en este webhook, la deduplicación de Inngest
 * es la única barrera contra responder la misma consulta dos veces.
 */
async function publicarConsultaWhatsApp(
  entrante: MensajeEntrante,
  mensajeEntranteId: string,
): Promise<void> {
  try {
    const data: EventoMensajeWhatsAppRecibido["data"] = {
      metaMessageId: entrante.metaMessageId,
      mensajeEntranteId,
      telefonoE164: entrante.telefonoE164,
      texto: entrante.texto,
      recibidoEn: new Date().toISOString(),
    };
    await inngest.send({
      name: "whatsapp/mensaje.recibido",
      id: `consulta-whatsapp-${entrante.metaMessageId}`,
      data,
    });
  } catch {
    // La fila ya quedó reservada; un fallo al encolar no debe tumbar el
    // webhook (sigue respondiendo 200 — ver la cabecera del archivo).
  }
}
