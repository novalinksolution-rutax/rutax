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
 * DEFENSAS ANTI-ABUSO (ítem #7 de la auditoría — al no haber firma de ML):
 * 1. RATE LIMIT por `user_id` (`ml:{user_id}`, 120/60s — ~60-100x el volumen
 *    normal de un seller grande, absorbe ráfagas legítimas de backfill). NO se
 *    limita por IP: las notificaciones legítimas vienen de pocas IPs
 *    compartidas de ML y un límite por IP estrangularía a TODOS los sellers.
 *    Al exceder → 429 + Retry-After; ML reintenta, y el polling C5 (cada 15
 *    min) es la red de seguridad final — ninguna entrega se pierde.
 * 2. CHECK de seller conectado: si el `user_id` no corresponde a una conexión
 *    ML registrada, se responde 200 SIN encolar (cero evento Inngest, cero
 *    fetch a ML). Cierra el vector "user_id aleatorio" que el rate limit por
 *    user_id no acota.
 * La integridad de los DATOS ya está protegida por el modelo de "consultar el
 * recurso con nuestro token".
 *
 * Fuente del esquema correcto: documentación de notificaciones de ML marketplace
 * + verificación en vivo (junio 2026).
 */

import { inngest } from "@/lib/inngest/cliente";
import { consumirRateLimit } from "@/lib/rate-limit";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { NextRequest, NextResponse } from "next/server";

/** Límite de notificaciones por seller (user_id de ML) por ventana. */
const LIMITE_POR_USER_ID = 120;
const VENTANA_SEGUNDOS = 60;

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

  // RATE LIMIT por user_id — antes de tocar BD de negocio o encolar. Fail-open
  // si el limitador falla (ver src/lib/rate-limit). Log sin body.
  const userId = String(body.user_id);
  const limite = await consumirRateLimit(
    `ml:${userId}`,
    LIMITE_POR_USER_ID,
    VENTANA_SEGUNDOS,
  );
  if (!limite.permitido) {
    console.warn(
      `[webhook ml/shipments] rate limit excedido para llave=ml:${userId} ` +
        `(límite ${LIMITE_POR_USER_ID}/${VENTANA_SEGUNDOS}s).`,
    );
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limite.reintentarEnSegundos) } },
    );
  }

  // CHECK de seller conectado: un user_id que no corresponde a ninguna conexión
  // ML registrada no encola nada (200 para que ML no reintente; si fuera un
  // seller legítimo recién conectado, el backfill/polling lo cubre después).
  const supabase = crearClienteServiceRole();
  // NOTA QA: `ml_user_id` NO tiene UNIQUE en BD (solo `seller_id` lo es), así que
  // un mismo user_id de ML podría aparecer en >1 conexión (p. ej. la misma cuenta
  // de ML conectada por dos couriers, o una fila vieja + una nueva). Con
  // `.maybeSingle()` PostgREST DEVOLVERÍA ERROR ante 2+ filas y, como aquí solo
  // miramos `data`, la notificación se perdería en silencio pese a existir
  // conexiones válidas. Usamos una lista acotada y miramos si hay AL MENOS UNA:
  // basta una conexión conocida para encolar (el job consulta el recurso con el
  // token del seller correcto y descarta lo que no corresponda).
  const { data: conexiones } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select("id")
    .eq("ml_user_id", userId)
    .limit(1);

  if (!conexiones || conexiones.length === 0) {
    // Sin conexión conocida → ignorar silenciosamente (sin evento, sin fetch).
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
