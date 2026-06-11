/**
 * Webhook handler de Mercado Libre — topic `shipments`
 * =====================================================================
 * POST /api/webhooks/ml/shipments
 *
 * ML marketplace NO firma sus notificaciones (VERIFICADO EMPÍRICAMENTE con una
 * notificación real: ML envía SIN header `x-signature`, user-agent
 * `github.com/go-loco/restful`). El esquema `x-signature`/HMAC con clave
 * secreta es de **Mercado Pago**, un producto distinto — no aplica aquí, y por
 * eso el DevCenter de ML marketplace no entrega clave de webhook.
 *
 * Modelo de seguridad de las notificaciones de ML marketplace:
 * - La notificación es solo un DISPARADOR liviano; su body NO es fuente de
 *   verdad y no se confía en su contenido.
 * - Se valida que la notificación sea para NUESTRA app (`application_id` ==
 *   ML_APP_CLIENT_ID) y que el topic sea `shipments`.
 * - La FUENTE DE VERDAD se obtiene después en el job `procesarShipmentActualizado`,
 *   que consulta `/shipments/{id}` con el access_token del seller. Una
 *   notificación falsa, a lo sumo, dispara una consulta a ML de un shipment que,
 *   si no pertenece a un seller conectado, se ignora (ver procesar-shipment).
 * - Se responde 200 lo antes posible (< 500ms); el trabajo pesado es asíncrono.
 *
 * Body de ML (verificado): { _id, topic, resource: "/shipments/{id}", user_id,
 *   application_id, sent, received, attempts, actions }.
 *
 * NOTA DE SEGURIDAD (para revisión de `seguridad-cumplimiento` antes de prod):
 * al no haber firma criptográfica (limitación de ML marketplace, no nuestra),
 * conviene evaluar rate-limiting del endpoint y/o verificar que `user_id`
 * corresponde a un seller conectado antes de encolar, para acotar abuso por
 * disparos falsos. La integridad de los DATOS ya está protegida por el modelo
 * de "consultar el recurso con nuestro token".
 *
 * Fuente del esquema correcto: documentación de notificaciones de ML marketplace
 * + verificación en vivo (junio 2026).
 */

import { inngest } from "@/lib/inngest/cliente";
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
export function extraerShipmentId(resource: string): string | null {
  const match = /\/shipments\/(\d+)/.exec(resource);
  return match?.[1] ?? null;
}

/**
 * La notificación es para NUESTRA app si su `application_id` coincide con
 * `ML_APP_CLIENT_ID`. Si la variable no está configurada, no se puede validar y
 * se rechaza (fail-closed). Es la defensa disponible: ML marketplace no ofrece
 * firma criptográfica para estas notificaciones.
 */
export function esParaNuestraApp(
  applicationId: unknown,
  clientId: string | undefined,
): boolean {
  if (!clientId) return false;
  return String(applicationId) === String(clientId);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Leer y parsear el body.
  let body: NotificacionMl;
  try {
    body = (await request.json()) as NotificacionMl;
  } catch {
    return NextResponse.json({ error: "body_malformado" }, { status: 400 });
  }

  // Validar que la notificación es para nuestra app. ML marketplace no firma,
  // así que esta (más el topic) es la verificación previa al encolado; la
  // integridad real la garantiza el fetch del recurso con nuestro token.
  if (!esParaNuestraApp(body.application_id, process.env.ML_APP_CLIENT_ID)) {
    // No es para nosotros / no validable → ignorar sin pedir reintentos.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Solo procesamos el topic 'shipments'.
  if (body.topic !== "shipments") {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const shipmentId = extraerShipmentId(body.resource);
  if (!shipmentId) {
    // Body válido pero recurso mal formado — 200 para que ML no reintente.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Publicar evento Inngest con SOLO los datos necesarios para el job — nunca el
  // body completo (menor superficie de exposición en el dashboard de Inngest).
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
