/**
 * Webhook de WhatsApp — normalización del payload de Meta.
 * =============================================================================
 * Meta manda TODO por el mismo endpoint y anidado en cuatro niveles
 * (`entry[].changes[].value.{statuses,messages}`). Este archivo lo aplana a las
 * tres cosas que a Rutax le importan, y descarta el resto sin ruido.
 *
 *   1. **Acuses** (`statuses`) — sent / delivered / read / failed.
 *   2. **Entrantes** (`messages`) — lo que la gente ESCRIBE al número. Se
 *      registran y, si dicen BAJA/STOP, revocan el consentimiento.
 *   3. **Estado de plantillas** (`message_template_status_update`) — Meta
 *      aprueba o rechaza días después, y a veces desaprueba algo ya vivo.
 *
 * Es una función PURA: no toca la base ni la red. Eso la hace probable sin
 * levantar nada, que es justo lo que hace falta para un payload tan anidado.
 *
 * REGLAS DE DEPENDENCIAS (hoja del grafo): solo importa el normalizador de
 * teléfono, que a su vez no importa nada.
 */

import { normalizarTelefonoE164 } from "./telefono";

// -----------------------------------------------------------------------------
// Estados y su orden
// -----------------------------------------------------------------------------

export type EstadoMensajeWhatsApp = "encolado" | "enviado" | "entregado" | "leido" | "fallido";

/**
 * ⚠️ EL ESTADO SOLO AVANZA. Meta entrega los acuses DESORDENADOS: un `read`
 * puede llegar antes que su `delivered`, y los reintentos de Meta reenvían
 * acuses viejos. Con un `UPDATE estado = <lo que llegó>` a secas, un mensaje ya
 * leído volvería a "enviado" y la pantalla mentiría.
 *
 * Este bug exacto ya mordió en este repo, en el webhook de payout de Fintoc con
 * el `succeeded` tardío. Acá se ataja comparando rangos antes de escribir.
 *
 * `fallido` va arriba de todo porque es terminal: un mensaje que Meta declaró
 * fallido no se entrega después, y si llegara un acuse tardío de otro tipo,
 * preferimos conservar el fallo visible.
 */
export const RANGO_ESTADO: Record<EstadoMensajeWhatsApp, number> = {
  encolado: 0,
  enviado: 1,
  entregado: 2,
  leido: 3,
  fallido: 4,
};

/** ¿El estado nuevo es un avance respecto del que ya está guardado? */
export function estadoAvanza(
  estadoActual: EstadoMensajeWhatsApp,
  estadoNuevo: EstadoMensajeWhatsApp,
): boolean {
  return RANGO_ESTADO[estadoNuevo] > RANGO_ESTADO[estadoActual];
}

/** Los nombres que usa Meta → los nuestros. Lo que no esté acá se ignora. */
const MAPA_ESTADOS: Record<string, EstadoMensajeWhatsApp> = {
  sent: "enviado",
  delivered: "entregado",
  read: "leido",
  failed: "fallido",
};

// -----------------------------------------------------------------------------
// Detección de baja
// -----------------------------------------------------------------------------

/**
 * Palabras con las que alguien pide que no le escribamos más.
 *
 * Se incluyen las inglesas porque los teclados de WhatsApp sugieren "STOP" y
 * porque es la convención universal de opt-out.
 */
const PALABRAS_DE_BAJA = new Set([
  "BAJA",
  "STOP",
  "SALIR",
  "CANCELAR",
  "DESUSCRIBIR",
  "UNSUBSCRIBE",
  "NOMOLESTAR",
]);

/** Cuántas palabras puede tener un mensaje para que aún cuente como una baja. */
const MAX_PALABRAS_BAJA = 5;

/**
 * Marcas diacríticas combinantes que deja sueltas `normalize("NFD")`.
 *
 * Se escribe con escapes `\u` y no con los caracteres literales: son invisibles
 * en un editor, y un guardado con otra codificación los convierte en basura sin
 * que nada falle al compilar.
 */
const DIACRITICOS = /[\u0300-\u036f]/g;

/** Mayúsculas, sin tildes, sin puntuación, espacios colapsados. */
function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿Este mensaje es una solicitud de baja?
 *
 * ⚠️ DELIBERADAMENTE PERMISIVO, pero acotado. No exige coincidencia exacta
 * ("BAJA por favor" cuenta) porque **los dos errores no cuestan lo mismo**:
 * ignorar una baja legítima es seguir escribiéndole a alguien que dijo que no
 * —lo que Meta castiga bajando la calidad del número, que es uno solo para
 * todos los couriers—, mientras que una baja de más solo apaga un aviso que el
 * courier puede volver a activar.
 *
 * El tope de palabras es el freno: en un mensaje largo la palabra "cancelar"
 * casi siempre habla del PEDIDO, no de las notificaciones.
 */
export function esSolicitudDeBaja(texto: string): boolean {
  const normalizado = normalizarTexto(texto);
  if (normalizado.length === 0) return false;

  const palabras = normalizado.split(" ");
  if (palabras.length > MAX_PALABRAS_BAJA) return false;

  // "NO MOLESTAR" se escribe en dos palabras; se compara también la versión
  // pegada del mensaje completo.
  if (PALABRAS_DE_BAJA.has(palabras.join(""))) return true;

  return palabras.some((palabra) => PALABRAS_DE_BAJA.has(palabra));
}

// -----------------------------------------------------------------------------
// Forma normalizada del payload
// -----------------------------------------------------------------------------

export interface AcuseMensaje {
  /** El `wamid.***`: la llave por la que se encuentra la fila en la bitácora. */
  metaMessageId: string;
  estado: EstadoMensajeWhatsApp;
  /** Descripción saneada del fallo, o `null`. Solo viene con `fallido`. */
  motivo: string | null;
}

export interface MensajeEntrante {
  metaMessageId: string;
  /** Quién escribió, ya en E.164 sin `+`. `null` si Meta mandó algo ilegible. */
  telefonoE164: string | null;
  /** El texto, recortado. `null` si el mensaje no era de texto (audio, imagen…). */
  texto: string | null;
  /** `true` si el texto pide la baja de las notificaciones. */
  pideBaja: boolean;
}

export interface ActualizacionPlantilla {
  nombrePlantilla: string;
  idioma: string;
  estadoMeta: "aprobada" | "pendiente" | "rechazada";
}

export interface EventosWebhookWhatsApp {
  acuses: AcuseMensaje[];
  entrantes: MensajeEntrante[];
  plantillas: ActualizacionPlantilla[];
}

const MAPA_ESTADO_PLANTILLA: Record<string, ActualizacionPlantilla["estadoMeta"]> = {
  APPROVED: "aprobada",
  REJECTED: "rechazada",
  PENDING: "pendiente",
  // Meta usa estos cuando degrada una plantilla que YA estaba viva. Se tratan
  // como rechazo: el efecto práctico es el mismo — no se puede enviar con ella,
  // y el envío tiene que fallar cerrado en vez de comerse un 400.
  PAUSED: "rechazada",
  DISABLED: "rechazada",
  PENDING_DELETION: "rechazada",
};

/** Recorta y sanea un texto del proveedor — nunca dejamos entrar algo sin límite. */
function sanear(valor: unknown, largo = 300): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim().replace(/\s+/g, " ").slice(0, largo);
  return limpio.length > 0 ? limpio : null;
}

function comoArreglo(valor: unknown): Record<string, unknown>[] {
  return Array.isArray(valor) ? (valor.filter((v) => typeof v === "object" && v !== null) as Record<string, unknown>[]) : [];
}

/**
 * Aplana el payload de Meta a lo que Rutax procesa.
 *
 * Nunca lanza: cualquier forma inesperada produce listas vacías y el llamador
 * responde 200. Un 4xx haría que Meta reintente para siempre un evento que
 * nunca vamos a poder procesar — y tras suficientes fallos, Meta desactiva la
 * suscripción del webhook entera.
 */
export function normalizarEventosWebhookWhatsApp(payload: unknown): EventosWebhookWhatsApp {
  const vacio: EventosWebhookWhatsApp = { acuses: [], entrantes: [], plantillas: [] };

  if (typeof payload !== "object" || payload === null) return vacio;
  const raiz = payload as Record<string, unknown>;

  // Meta manda `object: "whatsapp_business_account"`. Otro valor es una
  // suscripción de otro producto que no nos toca.
  if (raiz.object !== "whatsapp_business_account") return vacio;

  const acuses: AcuseMensaje[] = [];
  const entrantes: MensajeEntrante[] = [];
  const plantillas: ActualizacionPlantilla[] = [];

  for (const entrada of comoArreglo(raiz.entry)) {
    for (const cambio of comoArreglo(entrada.changes)) {
      const valor = (cambio.value ?? {}) as Record<string, unknown>;

      // ---- 1. Estado de plantillas -----------------------------------------
      if (cambio.field === "message_template_status_update") {
        const nombrePlantilla = sanear(valor.message_template_name, 120);
        const evento = typeof valor.event === "string" ? valor.event.toUpperCase() : "";
        const estadoMeta = MAPA_ESTADO_PLANTILLA[evento];
        if (nombrePlantilla && estadoMeta) {
          plantillas.push({
            nombrePlantilla,
            idioma: sanear(valor.message_template_language, 20) ?? "es",
            estadoMeta,
          });
        }
        continue;
      }

      // ---- 2. Acuses de entrega --------------------------------------------
      for (const estadoCrudo of comoArreglo(valor.statuses)) {
        const metaMessageId = sanear(estadoCrudo.id, 200);
        const estado =
          typeof estadoCrudo.status === "string" ? MAPA_ESTADOS[estadoCrudo.status] : undefined;
        if (!metaMessageId || !estado) continue;

        // El motivo solo viene cuando `failed`. Meta pone lo útil en
        // `error_data.details`; `title` es genérico.
        let motivo: string | null = null;
        const errores = comoArreglo(estadoCrudo.errors);
        if (errores.length > 0) {
          const primero = errores[0];
          const datos = (primero.error_data ?? {}) as Record<string, unknown>;
          const codigo = typeof primero.code === "number" ? `código ${primero.code}` : null;
          const detalle = sanear(datos.details) ?? sanear(primero.title) ?? sanear(primero.message);
          motivo = [codigo, detalle].filter(Boolean).join(": ") || null;
        }

        acuses.push({ metaMessageId, estado, motivo });
      }

      // ---- 3. Mensajes entrantes -------------------------------------------
      for (const mensaje of comoArreglo(valor.messages)) {
        const metaMessageId = sanear(mensaje.id, 200);
        if (!metaMessageId) continue;

        const desde = sanear(mensaje.from, 20);
        const normalizado = desde ? normalizarTelefonoE164(desde) : null;

        // Solo se lee el texto. Audio, imagen y ubicación se registran como
        // entrantes sin contenido: no hay nada que Rutax haga con ellos y
        // guardar media de terceros es responsabilidad que nadie pidió.
        const cuerpoTexto = (mensaje.text ?? {}) as Record<string, unknown>;
        const texto = mensaje.type === "text" ? sanear(cuerpoTexto.body, 1000) : null;

        entrantes.push({
          metaMessageId,
          telefonoE164: normalizado?.valido ? normalizado.telefonoE164 : null,
          texto,
          pideBaja: texto !== null && esSolicitudDeBaja(texto),
        });
      }
    }
  }

  return { acuses, entrantes, plantillas };
}
