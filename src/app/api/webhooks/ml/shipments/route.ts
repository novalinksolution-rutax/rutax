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
 * 2. CHECK de cuenta ingiriendo: si el `user_id` no corresponde a una conexión
 *    ML que hoy pueda ingerir, se responde 200 SIN encolar (cero evento Inngest,
 *    cero fetch a ML). Cierra el vector "user_id aleatorio" que el rate limit
 *    por user_id no acota.
 * La integridad de los DATOS ya está protegida por el modelo de "consultar el
 * recurso con nuestro token".
 *
 * ---------------------------------------------------------------------------
 * 🔴 CUENTA APAGADA: EL CHECK MIRA LA SALUD, NO SOLO LA EXISTENCIA (26-08-2026)
 * ---------------------------------------------------------------------------
 * Desconectar una cuenta de venta en Rutax **no le revoca a Rutax el permiso en
 * Mercado Libre** — es una decisión explícita del producto, y ML tampoco
 * documenta endpoint de revocación. Consecuencia directa: **ML sigue
 * notificando esa cuenta para siempre.**
 *
 * Y como desconectar es un borrado BLANDO (`estado_salud = 'desvinculada'` +
 * los `*_token_ref` en null, la fila intacta para conservar el autor y la
 * bitácora), el check de acá —que preguntaba solo si EXISTÍA una fila con ese
 * `ml_user_id`— seguía encolando. El job caía en el paso `consultar-ml` sin
 * token, agotaba sus 4 reintentos y levantaba una alerta en Sentry **por cada
 * notificación**. Detectado en producción el 26-08-2026, el mismo día en que se
 * construyó la desconexión.
 *
 * Por eso el filtro es `estado_salud <> 'desvinculada'` y no
 * `desconectada_por_usuario_id is null`: cubre las dos causas con el mismo
 * predicado que ya usan la ingesta, el polling y el sondeo. Una conexión CAÍDA
 * (token vencido) tampoco tiene con qué consultar a ML, y su recuperación es de
 * `sondeo-salud` + el backfill de la reconexión, no de este webhook.
 *
 * ⚠️ Lo que se pierde a propósito: mientras la cuenta esté apagada o caída, las
 * notificaciones de ML se descartan sin registro. No se pierde información —al
 * reconectar, el backfill barre 7 días y el repaso del cron `ml/ingestaPedidos`
 * recorre los no terminales—, pero no busques esos envíos en ningún log.
 *
 * Fuente del esquema correcto: documentación de notificaciones de ML marketplace
 * + verificación en vivo (junio 2026).
 */

import { z } from "zod";
import { inngest } from "@/lib/inngest/cliente";
import { consumirRateLimit } from "@/lib/rate-limit";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { NextRequest, NextResponse } from "next/server";

/** Límite de notificaciones por seller (user_id de ML) por ventana. */
const LIMITE_POR_USER_ID = 120;
const VENTANA_SEGUNDOS = 60;

/**
 * Cuerpo que ML envía en cada notificación de shipment, validado con zod en el
 * borde (#10): el body es JSON EXTERNO no confiable — se valida de verdad en vez
 * de un `as` que solo le promete la forma al compilador. `user_id`/`application_id`
 * llegan como número o string según el caso; el resto del body se ignora.
 */
const esquemaNotificacionMl = z.object({
  resource: z.string(),
  user_id: z.union([z.string(), z.number()]),
  topic: z.string(),
  application_id: z.union([z.string(), z.number()]).optional(),
  sent: z.string().optional(),
});
type NotificacionMl = z.infer<typeof esquemaNotificacionMl>;

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
  // Leer y validar el body (JSON externo no confiable → zod, no un cast).
  let body: NotificacionMl;
  try {
    const crudo = await request.json();
    const parsed = esquemaNotificacionMl.safeParse(crudo);
    if (!parsed.success) {
      return NextResponse.json({ error: "body_malformado" }, { status: 400 });
    }
    body = parsed.data;
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

  // CHECK de cuenta INGIRIENDO: un user_id que no corresponde a ninguna conexión
  // ML capaz de ingerir no encola nada (200 para que ML no reintente; si fuera un
  // seller legítimo recién conectado, el backfill/polling lo cubre después).
  const supabase = crearClienteServiceRole();
  // NOTA QA: `ml_user_id` NO tiene UNIQUE en BD (solo `seller_id` lo es), así que
  // un mismo user_id de ML podría aparecer en >1 conexión (p. ej. la misma cuenta
  // de ML conectada por dos couriers, o una fila vieja + una nueva). Con
  // `.maybeSingle()` PostgREST DEVOLVERÍA ERROR ante 2+ filas y, como aquí solo
  // miramos `data`, la notificación se perdería en silencio pese a existir
  // conexiones válidas. Usamos una lista acotada y miramos si hay AL MENOS UNA:
  // basta una conexión que ingiera para encolar (el job consulta el recurso con
  // el token del seller correcto y descarta lo que no corresponda).
  //
  // 🔴 EL FILTRO DE SALUD NO ES COSMÉTICO — ver el bloque «CUENTA APAGADA» del
  // encabezado. Desconectar es un borrado BLANDO: la fila sigue existiendo, así
  // que preguntar solo «¿existe?» dejaba pasar cada notificación de una cuenta
  // apagada y el job moría sin token, 5 intentos y una alerta por notificación.
  const { data: conexiones } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select("id")
    .eq("ml_user_id", userId)
    .neq("estado_salud", "desvinculada")
    .limit(1);

  if (!conexiones || conexiones.length === 0) {
    // Sin conexión que ingiera → ignorar silenciosamente (sin evento, sin fetch).
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
