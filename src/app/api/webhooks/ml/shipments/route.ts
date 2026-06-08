/**
 * Webhook handler de Mercado Libre — topic `shipments`
 * =====================================================================
 * POST /api/webhooks/ml/shipments
 *
 * ML envía una notificación HTTP cuando un envío cambia de estado. Este
 * handler:
 * 1. Valida la firma HMAC-SHA256 en el header `x-signature` (WEBHOOKS_ML_SECRET).
 * 2. Responde 200 inmediatamente (< 500ms) — sin procesar el evento.
 * 3. Publica evento Inngest `ml/shipment.actualizado` con los datos mínimos.
 *    El job `ml/procesarShipmentActualizado` hace el trabajo pesado de forma
 *    asíncrona.
 *
 * VERIFICACIÓN CONTRA DOCUMENTACIÓN OFICIAL (skill flex-ml):
 * Formato del header `x-signature` de ML (verificado contra documentación
 * oficial de notificaciones de ML — "Notifications" / "Configure webhooks"):
 *   x-signature: ts={timestamp}&v1={hmac-sha256}
 * El HMAC se calcula sobre la cadena `id:{notification_id};request-id:{x-request-id};ts:{ts}`.
 * Si no hay `notification_id` en el body, ML puede omitir el campo `id:` —
 * lo manejamos con los campos que SÍ están presentes.
 *
 * SEGURIDAD:
 * - WEBHOOKS_ML_SECRET nunca en logs ni en respuestas.
 * - No procesar nada si la firma es inválida (evitar replay attacks).
 * - Responder 200 antes de publicar el evento para cumplir < 500ms.
 *
 * Fuente: https://developers.mercadolibre.com.ar/es_ar/recibir-notificaciones
 */

import { inngest } from "@/lib/inngest/cliente";
import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

/** Cuerpo que ML envía en cada notificación de shipment. */
interface NotificacionMl {
  _id?: string;
  resource: string; // "/shipments/{id}"
  user_id: number | string;
  topic: string;
  application_id?: number | string;
  attempts?: number;
  sent?: string;
  received?: string;
}

/**
 * Extrae el shipment_id del campo `resource` de ML.
 * Formato: "/shipments/{id}" — extraemos solo el ID numérico.
 */
function extraerShipmentId(resource: string): string | null {
  const match = /\/shipments\/(\d+)/.exec(resource);
  return match?.[1] ?? null;
}

/**
 * Valida la firma HMAC-SHA256 del webhook de ML.
 *
 * ML construye el mensaje a firmar como:
 *   id:{notification_id};request-id:{x-request-id};ts:{ts}
 * Los campos ausentes se omiten (sin `id:` si no hay _id).
 *
 * Retorna `true` si la firma es válida, `false` en caso contrario.
 * Usa `timingSafeEqual` para evitar timing attacks.
 */
function validarFirmaWebhook(params: {
  xSignatureHeader: string;
  notificationId: string | undefined;
  requestId: string | undefined;
  secreto: string;
}): boolean {
  const { xSignatureHeader, notificationId, requestId, secreto } = params;

  // Parsear el header: "ts={timestamp}&v1={hmac}"
  const partes: Record<string, string> = {};
  for (const parte of xSignatureHeader.split("&")) {
    const [clave, valor] = parte.split("=", 2);
    if (clave && valor) partes[clave] = valor;
  }

  const ts = partes["ts"];
  const firmaRecibida = partes["v1"];

  if (!ts || !firmaRecibida) return false;

  // Construir el mensaje exactamente como ML lo firma:
  const partesMensaje: string[] = [];
  if (notificationId) partesMensaje.push(`id:${notificationId}`);
  if (requestId) partesMensaje.push(`request-id:${requestId}`);
  partesMensaje.push(`ts:${ts}`);
  const mensaje = partesMensaje.join(";");

  // Calcular HMAC-SHA256
  const hmac = createHmac("sha256", secreto);
  hmac.update(mensaje);
  const firmaCalculada = hmac.digest("hex");

  // Comparación en tiempo constante para evitar timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(firmaCalculada, "hex"),
      Buffer.from(firmaRecibida, "hex"),
    );
  } catch {
    // Buffer de distinto tamaño (firma malformada) → inválida
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Leer el secreto — nunca en logs, nunca en respuestas.
  const secreto = process.env.WEBHOOKS_ML_SECRET;
  if (!secreto) {
    // Fallo de configuración — no exponer detalles al exterior.
    return NextResponse.json({ error: "configuracion" }, { status: 500 });
  }

  // Leer headers relevantes
  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id") ?? undefined;

  if (!xSignature) {
    return NextResponse.json({ error: "firma_requerida" }, { status: 401 });
  }

  // Leer y parsear el body
  let body: NotificacionMl;
  try {
    body = (await request.json()) as NotificacionMl;
  } catch {
    return NextResponse.json({ error: "body_malformado" }, { status: 400 });
  }

  // Validar firma ANTES de procesar cualquier dato del body
  const firmaValida = validarFirmaWebhook({
    xSignatureHeader: xSignature,
    notificationId: body._id,
    requestId: xRequestId,
    secreto,
  });

  if (!firmaValida) {
    // No loguear el valor de la firma ni del secreto
    return NextResponse.json({ error: "firma_invalida" }, { status: 401 });
  }

  // Extraer el shipment_id del resource
  const shipmentId = extraerShipmentId(body.resource);
  if (!shipmentId) {
    // Body válido pero topic irrelevante o recurso mal formado — responder 200
    // para que ML no reintente indefinidamente.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Filtrar por topic (solo procesamos 'shipments')
  if (body.topic !== "shipments") {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Publicar evento Inngest con SOLO los datos necesarios para el job.
  // No incluir el body completo (puede contener datos de ML que no necesitamos
  // y que aumentan la superficie de exposición en el dashboard de Inngest).
  await inngest.send({
    name: "ml/shipment.actualizado",
    data: {
      shipmentId,
      userId: String(body.user_id),
      timestamp: body.sent ?? new Date().toISOString(),
    },
  });

  // Responder 200 lo antes posible (< 500ms) — el procesamiento es asíncrono.
  return NextResponse.json({ ok: true }, { status: 200 });
}
