/**
 * El puerto de notificaciones push a la app del conductor.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * TRES AVISOS, Y NI UNO MÁS
 * -----------------------------------------------------------------------------
 * · **Tu ruta está lista** — cuando el coordinador confirma su manifiesto.
 * · **Te traspasaron bultos** — cuando otro conductor le pasa carga.
 * · **Tienes un retiro nuevo** — cuando le asignan una visita a bodega.
 *
 * Las dos primeras se pueden apagar. **La del traspaso no**: sin ella el
 * traspaso se queda esperando la aceptación del receptor y alguien termina
 * cargando bultos que no son suyos. Es la única del producto que no se apaga, y
 * el motivo es ése, no la insistencia.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ES UN ADAPTADOR AISLADO
 * -----------------------------------------------------------------------------
 * Misma regla que ML, Shopify y DTE: el núcleo no llama APIs externas. Acá vive
 * lo único que sabe de Expo —el endpoint, la forma del mensaje y su tabla de
 * errores— y el resto del producto solo ve `notificarConductor`.
 *
 * -----------------------------------------------------------------------------
 * LO QUE NO PUEDE PASAR: QUE UN AVISO TUMBE UNA OPERACIÓN
 * -----------------------------------------------------------------------------
 * ⚠️ **Ninguna función de este archivo lanza.** Un traspaso que ya se guardó no
 * se puede deshacer porque el servidor de Expo esté caído, y un manifiesto
 * confirmado no puede volver a borrador porque un token estaba vencido. Los
 * fallos se devuelven contados, quien llama los registra, y la operación sigue.
 *
 * La contrapartida está asumida: **un aviso que no salió no se reintenta.** Se
 * pierde. Reintentar exigiría una cola propia, y este proyecto no las tiene por
 * decisión permanente; la red real es que las tres pantallas se pueden abrir
 * igual sin haber recibido nada.
 */

const ENDPOINT_EXPO = "https://exp.host/--/api/v2/push/send";

/** Cuántos mensajes por llamada. Expo documenta 100 como tope del lote. */
const TOPE_LOTE = 100;

export type MotivoPush = "ruta_lista" | "traspaso_recibido" | "retiro_nuevo";

export interface MensajePush {
  /** `ExponentPushToken[...]`. */
  token: string;
  titulo: string;
  cuerpo: string;
  /** A dónde lleva el toque. Lo interpreta la app, no el servidor. */
  destino: string;
  motivo: MotivoPush;
}

export interface ResultadoEnvio {
  enviados: number;
  fallidos: number;
  /**
   * Tokens que Expo declaró muertos (`DeviceNotRegistered`): la app se
   * desinstaló o el token se rotó. Quien llama los borra — dejarlos vivos hace
   * que cada aviso siguiente gaste una llamada en un teléfono que no existe.
   */
  tokensMuertos: string[];
}

interface RespuestaExpo {
  data?: Array<{
    status: "ok" | "error";
    message?: string;
    details?: { error?: string };
  }>;
  errors?: Array<{ message?: string }>;
}

/**
 * Manda los mensajes, en tandas de 100.
 *
 * **Nunca lanza.** Un fallo de red devuelve todo el lote como fallido y la
 * operación que llamó sigue su curso.
 */
export async function enviarPush(mensajes: readonly MensajePush[]): Promise<ResultadoEnvio> {
  const salida: ResultadoEnvio = { enviados: 0, fallidos: 0, tokensMuertos: [] };
  if (mensajes.length === 0) return salida;

  for (let i = 0; i < mensajes.length; i += TOPE_LOTE) {
    const tanda = mensajes.slice(i, i + TOPE_LOTE);
    try {
      const respuesta = await fetch(ENDPOINT_EXPO, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Expo acepta gzip y lo prefiere; sin esta cabecera responde igual.
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(
          tanda.map((m) => ({
            to: m.token,
            title: m.titulo,
            body: m.cuerpo,
            data: { destino: m.destino, motivo: m.motivo },
            // El canal de alerta, no el silencioso: estos tres avisos existen
            // para interrumpir. Un aviso de ruta que llega sin sonido a las
            // 15:40 no sirve de nada.
            sound: "default",
            priority: "high",
            channelId: "operacion",
          })),
        ),
      });

      if (!respuesta.ok) {
        salida.fallidos += tanda.length;
        continue;
      }

      const cuerpo = (await respuesta.json()) as RespuestaExpo;

      // ⚠️ Expo responde 200 con `errors` cuando el lote entero falló. Es la
      // misma trampa del cliente de Shopify: un 200 no es un éxito.
      if (cuerpo.errors?.length) {
        salida.fallidos += tanda.length;
        continue;
      }

      const tickets = cuerpo.data ?? [];
      tickets.forEach((t, j) => {
        if (t.status === "ok") {
          salida.enviados++;
          return;
        }
        salida.fallidos++;
        if (t.details?.error === "DeviceNotRegistered") {
          const muerto = tanda[j]?.token;
          if (muerto) salida.tokensMuertos.push(muerto);
        }
      });
      // Un ticket menos que mensajes enviados: Expo cortó la respuesta.
      if (tickets.length < tanda.length) salida.fallidos += tanda.length - tickets.length;
    } catch {
      salida.fallidos += tanda.length;
    }
  }

  return salida;
}

/** Los textos de los tres avisos. Están juntos para poder leerlos como voz. */
export function redactarAviso(
  motivo: MotivoPush,
  datos: { paradas?: number; deQuien?: string; bultos?: number; bodega?: string },
): { titulo: string; cuerpo: string; destino: string } {
  switch (motivo) {
    case "ruta_lista":
      return {
        titulo: "Tu ruta está lista",
        cuerpo:
          datos.paradas != null
            ? `${datos.paradas} ${datos.paradas === 1 ? "parada" : "paradas"} para hoy. Empieza cuando quieras.`
            : "Ya puedes empezar cuando quieras.",
        destino: "/(main)/manifiesto",
      };
    case "traspaso_recibido":
      return {
        titulo: "Te traspasaron bultos",
        // Nombra a quién: sin el nombre, el conductor no sabe a quién buscar si
        // el traspaso no calza con lo que tiene en la mano.
        cuerpo: `${datos.deQuien ?? "Otro conductor"} te quiere pasar ${datos.bultos ?? 0} ${
          datos.bultos === 1 ? "bulto" : "bultos"
        }. Revísalos y acepta.`,
        destino: "/(main)/traspaso",
      };
    case "retiro_nuevo":
      return {
        titulo: "Tienes un retiro nuevo",
        cuerpo: `${datos.bodega ?? "Una bodega"}${
          datos.bultos != null ? `, ${datos.bultos} bultos` : ""
        }.`,
        destino: "/(main)/retiro",
      };
  }
}
