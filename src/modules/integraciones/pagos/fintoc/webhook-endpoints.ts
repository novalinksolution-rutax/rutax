/**
 * Registro programático de Webhook Endpoints de Fintoc.
 * =============================================================================
 *
 * POR QUÉ EXISTE
 * -----------------------------------------------------------------------------
 * Fintoc firma (`Fintoc-Signature`) SOLO los webhooks que salen de un «Webhook
 * Endpoint» REGISTRADO — el que se crea por API o desde el dashboard y que
 * devuelve un `secret` propio. El `webhookUrl` que se le pasa al widget
 * (`Fintoc.create({ product: "movements", webhookUrl })`) es un canal ad-hoc y
 * llega SIN firma (verificado en producción; ver la migración
 * `20260926000001_identidad_cobranza_conexiones_pendientes.sql`).
 *
 * Por eso, en el momento en que aterriza el `link.created` del canal ad-hoc,
 * registramos el endpoint REAL del tenant y guardamos su `secret` cifrado: de ahí
 * en adelante los eventos de dinero (`transfer.inbound.succeeded`) sí llegan
 * firmados y el webhook los valida como corresponde.
 *
 * CONTRATO VERIFICADO CONTRA LA DOC OFICIAL (2026-09-26)
 * -----------------------------------------------------------------------------
 *  - `POST /v1/webhook_endpoints` — body: `url` (HTTPS, requerido),
 *    `enabled_events` (array, requerido), `description`/`name` (opcionales).
 *    201 devuelve `id` y `secret`; cita literal de la doc: «Secret used to verify
 *    the signature of the webhooks sent to the endpoint. **Only returned when the
 *    endpoint is created**». O sea: el `secret` se cifra al vuelo o se pierde.
 *  - `GET /v1/webhook_endpoints` — «Lists the webhook endpoints of your
 *    organization for the `live` or `test` mode of the API key used».
 *  - `DELETE /v1/webhook_endpoints/{id}` — 204 sin cuerpo; 404 si no existe, ya
 *    se borró, o pertenece a otro modo que la API key.
 *
 * ⚠️ EL ENDPOINT ES DE ORGANIZACIÓN, NO SE PUEDE ACOTAR A UN LINK. La doc de
 * creación no admite `link_id` ni filtro equivalente. Lo que nos separa por
 * courier es la URL (`/api/webhooks/fintoc/{tenantId}`) y su secreto propio, no
 * un alcance del proveedor. Consecuencia registrada para quien siga: un evento
 * de transferencia de la organización llega a la URL de cada endpoint
 * registrado, así que el camino de dinero del webhook debe verificar que el
 * movimiento pertenece a la cuenta del tenant antes de conciliar. (Fuera del
 * alcance de este archivo; anotado a propósito.)
 *
 * SEGURIDAD: la secret key de la organización y el `secret` devuelto NUNCA se
 * loguean ni se incluyen en un error. Los mensajes de error llevan solo el
 * status y el detalle que da Fintoc.
 */

import { ErrorPagosProveedor } from "../errores";
import { FINTOC_BASE_URL } from "./adaptador";

/** Eventos de dinero real que el endpoint del courier debe recibir firmados. */
export const EVENTOS_WEBHOOK_COBRANZA = ["transfer.inbound.succeeded"] as const;

export interface WebhookEndpointRegistrado {
  /** Id del endpoint en Fintoc (no es secreto; sirve para borrarlo luego). */
  id: string;
  /** Secreto de firma. SECRETO: cifrar de inmediato, nunca loguear. */
  secret: string;
}

function cabeceras(secretKey: string): HeadersInit {
  return {
    // Auth verificada en vivo: secret key DIRECTA, sin prefijo "Bearer".
    Authorization: secretKey,
    accept: "application/json",
    "content-type": "application/json",
  };
}

async function detalleDelError(respuesta: Response): Promise<string> {
  const cuerpo = (await respuesta.json().catch(() => null)) as
    | { error?: { message?: string; code?: string } }
    | null;
  return cuerpo?.error?.message ?? cuerpo?.error?.code ?? "sin detalle del proveedor";
}

/**
 * Registra el Webhook Endpoint del tenant y devuelve su `id` + `secret`.
 * El `secret` solo viene en esta respuesta: quien llama lo cifra de inmediato.
 */
export async function registrarWebhookEndpointCobranza(args: {
  secretKey: string;
  url: string;
  descripcion?: string;
  baseUrl?: string;
}): Promise<WebhookEndpointRegistrado> {
  const base = args.baseUrl ?? FINTOC_BASE_URL;

  const respuesta = await fetch(`${base}/webhook_endpoints`, {
    method: "POST",
    headers: cabeceras(args.secretKey),
    body: JSON.stringify({
      url: args.url,
      enabled_events: [...EVENTOS_WEBHOOK_COBRANZA],
      description: args.descripcion ?? "Rutax — cobranza courier→seller",
    }),
  });

  if (!respuesta.ok) {
    throw new ErrorPagosProveedor(
      respuesta.status,
      `Fintoc rechazó el registro del webhook endpoint: ${await detalleDelError(respuesta)}`,
    );
  }

  const cuerpo = (await respuesta.json().catch(() => null)) as
    | { id?: string; secret?: string }
    | null;

  if (!cuerpo?.id || !cuerpo?.secret) {
    // Sin `secret` el endpoint es inútil para nosotros: la doc dice que no se
    // puede volver a pedir. Se trata como fallo del proveedor.
    throw new ErrorPagosProveedor(
      502,
      "Fintoc creó el webhook endpoint sin devolver id y secret.",
    );
  }

  return { id: cuerpo.id, secret: cuerpo.secret };
}

/**
 * Borra los Webhook Endpoints ya registrados para esta URL.
 *
 * Importa al RECONECTAR: si quedara el endpoint viejo, Fintoc mandaría cada
 * evento DOS veces a la misma URL —una firmada con el secreto viejo, que ya no
 * tenemos— y esa copia respondería 401 para siempre, con Fintoc reintentando.
 *
 * Es «best effort» a propósito: devuelve cuántos borró y NO lanza. Fallar aquí no
 * debe impedir registrar el endpoint nuevo (el costo de no borrar es ruido de
 * reintentos, el de abortar es quedarse sin webhook de dinero).
 */
export async function borrarWebhookEndpointsDeUrl(args: {
  secretKey: string;
  url: string;
  baseUrl?: string;
}): Promise<number> {
  const base = args.baseUrl ?? FINTOC_BASE_URL;

  let existentes: Array<{ id?: string; url?: string }>;
  try {
    const respuesta = await fetch(`${base}/webhook_endpoints`, {
      method: "GET",
      headers: cabeceras(args.secretKey),
    });
    if (!respuesta.ok) return 0;
    const cuerpo = (await respuesta.json().catch(() => null)) as unknown;
    // La doc muestra una colección; se toleran las dos formas habituales.
    existentes = Array.isArray(cuerpo)
      ? (cuerpo as Array<{ id?: string; url?: string }>)
      : Array.isArray((cuerpo as { data?: unknown } | null)?.data)
        ? ((cuerpo as { data: Array<{ id?: string; url?: string }> }).data)
        : [];
  } catch {
    return 0;
  }

  let borrados = 0;
  for (const endpoint of existentes) {
    if (!endpoint?.id || endpoint.url !== args.url) continue;
    try {
      const respuesta = await fetch(`${base}/webhook_endpoints/${endpoint.id}`, {
        method: "DELETE",
        headers: cabeceras(args.secretKey),
      });
      // 404 = ya no estaba; cuenta igual como "no queda nada que estorbe".
      if (respuesta.ok || respuesta.status === 404) borrados += 1;
    } catch {
      // Ignorado a propósito (ver el comentario de la firma).
    }
  }
  return borrados;
}
