/**
 * POST /api/whatsapp/send — disparar una notificación de WhatsApp.
 * =============================================================================
 * Valida, resuelve el tenant a partir de QUIEN LLAMA, y publica el evento
 * `notificaciones/whatsapp.solicitado`. El envío real ocurre en el job.
 *
 * -----------------------------------------------------------------------------
 * DEVUELVE 202, NO 200 — Y NO ES UN DETALLE
 * -----------------------------------------------------------------------------
 * El diseño original pedía que este endpoint enviara y devolviera "el estado del
 * envío". Eso obliga a esperar a Meta dentro del request (y a reintentar con
 * backoff ahí mismo, bloqueando al llamador varios segundos), lo que choca con
 * la regla del proyecto: los procesos pesados corren como jobs idempotentes con
 * reintentos, no en el request del usuario. Acá se acepta la solicitud, se
 * publica el evento y se responde 202; el estado real de cada mensaje vive en
 * `integraciones.whatsapp_mensajes` y lo actualiza el webhook de acuses.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL `tenantId` NO SE LEE DEL BODY
 * -----------------------------------------------------------------------------
 * El diseño original lo recibía en el JSON. Tal cual, cualquier llamador
 * autenticado podría mandar mensajes en nombre de CUALQUIER courier — el
 * aislamiento multi-tenant se cae por el lugar más tonto posible. Acá el tenant
 * sale SIEMPRE del principal autenticado: de la API key o de la sesión.
 *
 * AUTENTICACIÓN — dos caminos, ambos atados a un tenant:
 *   · `Authorization: Bearer <api-key>` con el permiso `notificaciones:enviar`.
 *   · Sesión de un usuario INTERNO del courier (cookies de Supabase Auth).
 * Un seller o un conductor NO pueden disparar avisos: no es su superficie.
 */

import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/cliente";
import { consumirRateLimit } from "@/lib/rate-limit";
import { autenticarApiKey } from "@/lib/api-v1/autenticar-api-key";
import { verificarPermiso } from "@/lib/api-v1/verificar-permiso";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { esClaveEventoConocida, obtenerPlantilla, clavesEventoConocidas } from "@/modules/integraciones/notificaciones/whatsapp";
import type { EventoWhatsAppSolicitado } from "@/lib/inngest/eventos";

/** Permiso que debe llevar la API key. */
const PERMISO = "notificaciones:enviar";

/** Tope por tenant. Generoso para un uso legítimo, cerrado para un bucle. */
const LIMITE = 60;
const VENTANA_SEGUNDOS = 60;

/** Tope de largo de cada variable. Meta rechaza cuerpos enormes; acá se ataja antes. */
const MAX_LARGO_VARIABLE = 1024;

interface CuerpoSolicitud {
  event_key?: unknown;
  referencia?: unknown;
  destino?: unknown;
  data?: unknown;
  variables?: unknown;
}

function error(mensaje: string, estado: number): NextResponse {
  return NextResponse.json({ error: mensaje }, { status: estado });
}

/**
 * Resuelve el tenant del llamador. Devuelve `null` si no está autenticado o si
 * no tiene derecho a disparar avisos.
 */
async function resolverTenantDelLlamador(request: NextRequest): Promise<string | null> {
  const contextoApiKey = await autenticarApiKey(request);
  if (contextoApiKey) {
    return verificarPermiso(contextoApiKey, PERMISO) ? contextoApiKey.tenantId : null;
  }

  const sesion = await obtenerSesionActual();
  if (!sesion) return null;
  // Solo usuarios internos del courier. Un seller autenticado en su portal no
  // puede hacer que Rutax le escriba a nadie.
  if (sesion.usuario.tipoUsuario !== "interno") return null;
  return sesion.usuario.tenantId;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const tenantId = await resolverTenantDelLlamador(request);
  if (!tenantId) {
    return error("no_autorizado", 401);
  }

  const limite = await consumirRateLimit(`whatsapp-send:${tenantId}`, LIMITE, VENTANA_SEGUNDOS);
  if (!limite.permitido) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limite.reintentarEnSegundos) } },
    );
  }

  let cuerpo: CuerpoSolicitud;
  try {
    cuerpo = (await request.json()) as CuerpoSolicitud;
  } catch {
    return error("body_malformado", 400);
  }

  // ---- Clave de evento ------------------------------------------------------
  const claveEvento = cuerpo.event_key;
  if (!esClaveEventoConocida(claveEvento)) {
    return error(
      `event_key desconocido. Los válidos son: ${clavesEventoConocidas().join(", ")}.`,
      400,
    );
  }
  const plantilla = obtenerPlantilla(claveEvento);
  if (!plantilla) return error("event_key desconocido.", 400);

  // ---- Referencia (la mitad variable de la idempotencia) --------------------
  //
  // Se EXIGE. Sin ella no habría forma de distinguir dos avisos legítimos del
  // mismo tipo, y el segundo se descartaría como duplicado para siempre.
  const referencia = typeof cuerpo.referencia === "string" ? cuerpo.referencia.trim() : "";
  if (referencia.length === 0 || referencia.length > 120) {
    return error(
      "Falta 'referencia': el identificador del hecho que originó el aviso (la sesión de retiro, el manifiesto…). Es lo que evita enviar dos veces lo mismo.",
      400,
    );
  }

  // ---- Variables ------------------------------------------------------------
  //
  // Se aceptan como arreglo ordenado o como objeto con los nombres del
  // catálogo. El objeto es más legible en el sitio que llama y elimina la clase
  // de bug de "se me traspusieron dos variables".
  const variables = normalizarVariables(cuerpo.variables ?? cuerpo.data, plantilla.variables);
  if (variables === null) {
    return error(
      `La plantilla "${plantilla.nombre}" espera ${plantilla.variables.length} variable(s): ${plantilla.variables.join(", ")}.`,
      400,
    );
  }
  if (variables.some((v) => v.length > MAX_LARGO_VARIABLE)) {
    return error(`Cada variable debe medir ${MAX_LARGO_VARIABLE} caracteres o menos.`, 400);
  }

  // ---- Destino --------------------------------------------------------------
  const destinoCrudo = (cuerpo.destino ?? {}) as Record<string, unknown>;
  const sellerId = typeof destinoCrudo.sellerId === "string" ? destinoCrudo.sellerId : null;
  const bodegaId = typeof destinoCrudo.bodegaId === "string" ? destinoCrudo.bodegaId : null;

  if (plantilla.rolDestinatario === "seller" && !sellerId) {
    return error(`El evento "${claveEvento}" va dirigido a un seller: falta destino.sellerId.`, 400);
  }
  if (plantilla.rolDestinatario === "bodega" && !bodegaId) {
    return error(`El evento "${claveEvento}" va dirigido a una bodega: falta destino.bodegaId.`, 400);
  }

  // ---- Publicar -------------------------------------------------------------
  const evento: EventoWhatsAppSolicitado = {
    name: "notificaciones/whatsapp.solicitado",
    data: { tenantId, claveEvento, referencia, destino: { sellerId, bodegaId }, variables },
  };

  await inngest.send(evento);

  return NextResponse.json(
    {
      aceptado: true,
      event_key: claveEvento,
      plantilla: plantilla.nombre,
      // El estado de cada mensaje se resuelve en el job y lo actualizan los
      // acuses del webhook; acá solo se confirma que la solicitud entró.
      detalle: "La notificación quedó encolada. Su estado vive en la bitácora de mensajes.",
    },
    { status: 202 },
  );
}

/**
 * Lleva las variables a un arreglo ordenado, vengan como arreglo o como objeto.
 *
 * Devuelve `null` si no calzan con el catálogo — que es el chequeo que evita el
 * 400 de Meta por "param mismatch", un error que no dice cuál falta.
 */
function normalizarVariables(entrada: unknown, esperadas: readonly string[]): string[] | null {
  if (Array.isArray(entrada)) {
    if (entrada.length !== esperadas.length) return null;
    return entrada.map((v) => String(v ?? ""));
  }

  if (entrada && typeof entrada === "object") {
    const objeto = entrada as Record<string, unknown>;
    const valores: string[] = [];
    for (const nombre of esperadas) {
      if (!(nombre in objeto)) return null;
      valores.push(String(objeto[nombre] ?? ""));
    }
    return valores;
  }

  // Sin variables y la plantilla tampoco las pide: caso válido (`hello_world`).
  return esperadas.length === 0 ? [] : null;
}
