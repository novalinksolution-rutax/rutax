/**
 * Adaptador REAL de WhatsApp vía Cloud API de Meta (`graph.facebook.com`).
 * =============================================================================
 * Por REST directo (`fetch`), deliberadamente SIN sumar un SDK de Meta: la
 * superficie que usamos es un único POST JSON. Mismo criterio que el adaptador
 * de Resend y los de Fintoc.
 *
 * GATE SANDBOX/REAL: lo resuelve `fabrica-whatsapp.ts`, NO este archivo. Esta
 * clase solo se instancia cuando el gate YA está abierto.
 *
 * -----------------------------------------------------------------------------
 * QUÉ SE REINTENTA Y QUÉ NO — la decisión vive acá porque solo acá se sabe
 * -----------------------------------------------------------------------------
 * Meta mezcla en el mismo 400 cosas muy distintas: "estás yendo muy rápido"
 * (transitorio) y "esa plantilla no existe" (permanente). Reintentar lo segundo
 * quema cuota sin cambiar nada; peor, si la llamada SÍ llegó y lo que falló fue
 * la respuesta, reintentar **duplica el mensaje y el cobro**. Por eso el
 * adaptador devuelve `reintentable` explícito y el job obedece.
 *
 * ⚠️ HTTP 200 CON `error` EN EL CUERPO SE TRATA COMO FALLO. La lección ya está
 * escrita en el cliente de Shopify de este repo; acá se aplica preventivamente
 * porque el costo de creerle a un 200 mentiroso es marcar como enviado algo que
 * no salió.
 *
 * SEGURIDAD:
 *  - El token viaja SOLO en `Authorization: Bearer`. NUNCA se loguea ni aparece
 *    en un error.
 *  - El TELÉFONO tampoco sale de acá: `errorDescripcion` va a la bitácora y a
 *    los logs, y es dato personal.
 *  - `enviarPlantilla` NUNCA lanza.
 *
 * REGLAS DE DEPENDENCIAS (adaptador = hoja del grafo): solo importa del puerto.
 */

import type {
  EnviarPlantillaArgs,
  PuertoWhatsApp,
  ResultadoEnvioWhatsApp,
} from "../puerto-whatsapp";

const GRAPH_BASE_URL = "https://graph.facebook.com";

/**
 * Timeout de la llamada. Generoso comparado con los 8 s de Resend: la Cloud API
 * responde lento cuando está congestionada, y cortar antes de tiempo es el
 * escenario que DUPLICA mensajes (el mensaje salió, nosotros no vimos el ack y
 * el job reintenta).
 */
const TIMEOUT_MS = 15_000;

/**
 * Códigos de Meta que significan "ahora no, prueba de nuevo".
 *
 * Se enumeran en vez de reintentar todo 4xx porque la mayoría de los 4xx de
 * Meta son permanentes (plantilla inexistente, parámetros que no calzan, token
 * sin permiso) y reintentarlos es puro desperdicio.
 *
 *   4      · límite de tasa de la aplicación
 *   80007  · límite de tasa de la cuenta (WABA)
 *   130429 · límite de mensajes por segundo
 *   131056 · demasiados mensajes al mismo destinatario en poco tiempo
 *   131000 · "algo salió mal" genérico del lado de Meta
 *   133016 · la cuenta está bloqueada temporalmente por volumen
 */
const CODIGOS_REINTENTABLES = new Set([4, 80007, 130429, 131056, 131000, 133016]);

export interface CloudApiConfig {
  /** Token permanente del System User. NUNCA se loguea ni se expone. */
  accessToken: string;
  /** El Phone Number ID de la WABA de Rutax (no el número: su id). */
  phoneNumberId: string;
  /** Versión de la Graph API, p. ej. `v25.0`. */
  version: string;
}

interface RespuestaMeta {
  messages?: Array<{ id?: string }>;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_data?: { details?: string };
  };
}

/**
 * Arma una descripción legible del error SIN filtrar el token ni el teléfono.
 *
 * `error_data.details` es donde Meta pone lo realmente útil ("template name does
 * not exist in the translation"), mientras que `message` suele ser genérico.
 */
function describirErrorMeta(cuerpo: RespuestaMeta | null, estadoHttp: number): string {
  const error = cuerpo?.error;
  if (!error) return `Meta respondió HTTP ${estadoHttp} sin detalle.`;

  const partes: string[] = [];
  if (typeof error.code === "number") partes.push(`código ${error.code}`);
  const detalle = error.error_data?.details ?? error.message;
  if (detalle) partes.push(detalle);

  const texto = partes.length > 0 ? partes.join(": ") : `HTTP ${estadoHttp}`;
  // Recorte duro: un mensaje del proveedor sin límite termina en la bitácora.
  return texto.replace(/\s+/g, " ").slice(0, 300);
}

export class CloudApiWhatsAppAdapter implements PuertoWhatsApp {
  private readonly config: CloudApiConfig;

  constructor(config: CloudApiConfig) {
    this.config = config;
  }

  async enviarPlantilla(args: EnviarPlantillaArgs): Promise<ResultadoEnvioWhatsApp> {
    const url = `${GRAPH_BASE_URL}/${this.config.version}/${this.config.phoneNumberId}/messages`;

    // `components` se omite ENTERO cuando la plantilla no tiene variables.
    // Mandar un `body` con `parameters: []` a `hello_world` es un 400 —
    // Meta valida que la forma calce exactamente con la plantilla aprobada.
    const componentes =
      args.variables.length > 0
        ? [
            {
              type: "body",
              parameters: args.variables.map((valor) => ({ type: "text", text: valor })),
            },
          ]
        : [];

    const cuerpoPeticion = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: args.telefonoE164,
      type: "template",
      template: {
        name: args.nombrePlantilla,
        language: { code: args.idioma },
        ...(componentes.length > 0 ? { components: componentes } : {}),
      },
    };

    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cuerpoPeticion),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // Red, DNS, TLS o timeout. Reintentable por definición: nadie del lado de
      // Meta dijo que no, solo se cortó el camino.
      //
      // ⚠️ Un timeout entra por acá y ES ambiguo: el mensaje pudo haber salido.
      // Se marca reintentable igual porque perder un aviso es peor que
      // arriesgar un duplicado, y la llave de idempotencia de
      // `whatsapp_mensajes` acota la ventana.
      const esTimeout = error instanceof Error && error.name === "TimeoutError";
      return {
        enviado: false,
        modo: "real",
        reintentable: true,
        errorDescripcion: esTimeout
          ? `Meta no respondió en ${TIMEOUT_MS / 1000} s.`
          : "No se pudo alcanzar la Cloud API de Meta.",
      };
    }

    let cuerpo: RespuestaMeta | null = null;
    try {
      cuerpo = (await respuesta.json()) as RespuestaMeta;
    } catch {
      cuerpo = null;
    }

    // Fallo explícito: HTTP no-2xx, O un 200 que trae `error` en el cuerpo.
    if (!respuesta.ok || cuerpo?.error) {
      const codigo = cuerpo?.error?.code;
      const reintentable =
        respuesta.status === 429 ||
        respuesta.status >= 500 ||
        (typeof codigo === "number" && CODIGOS_REINTENTABLES.has(codigo));

      return {
        enviado: false,
        modo: "real",
        reintentable,
        errorDescripcion: describirErrorMeta(cuerpo, respuesta.status),
      };
    }

    const metaMessageId = cuerpo?.messages?.[0]?.id;
    if (!metaMessageId) {
      // 2xx sin id: Meta dice que aceptó pero no da con qué correlacionar el
      // acuse. No se reintenta —el mensaje probablemente salió y reintentar lo
      // duplicaría— pero se registra como fallo para que quede visible.
      return {
        enviado: false,
        modo: "real",
        reintentable: false,
        errorDescripcion: "Meta aceptó el mensaje pero no devolvió su identificador.",
      };
    }

    return { enviado: true, modo: "real", metaMessageId, reintentable: false };
  }
}
