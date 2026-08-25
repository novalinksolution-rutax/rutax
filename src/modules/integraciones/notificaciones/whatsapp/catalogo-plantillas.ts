/**
 * Catálogo de plantillas de WhatsApp.
 * =============================================================================
 * El mapa `clave de evento → plantilla aprobada en Meta`, con su idioma, a qué
 * rol de contacto se dirige y **qué variables lleva, en qué orden**.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTO ES CÓDIGO Y NO UNA TABLA
 * -----------------------------------------------------------------------------
 * El diseño inicial lo puso en `infra.whatsapp_plantillas`. Se descartó por dos
 * razones que se pagan caro después:
 *
 *  1. **El orden de las variables está atado al sitio que las manda.** Si el
 *     catálogo vive en la base, el código y la fila pueden discrepar, y la fila
 *     gana en tiempo de ejecución: el aviso sale con el nombre del conductor en
 *     el lugar de la patente y nada falla. Acá, en cambio, los nombres de las
 *     variables son parte del tipo y el compilador obliga a que calcen.
 *
 *  2. **Un `estado_meta` guardado se convierte en un filtro obsoleto que
 *     bloquea.** La tentación era no enviar salvo que la fila dijera `aprobada`.
 *     Ese patrón ya mordió en este repo el 2026-08-25: la lista blanca de
 *     estados de ML escondió el botón de etiqueta en 5 de 8 pedidos que SÍ
 *     funcionaban. Y los dos errores no cuestan lo mismo — bloquear un aviso que
 *     Meta habría aceptado detiene la operación del courier, mientras que
 *     intentarlo y comerse un 400 cuesta una llamada que **Meta no cobra**
 *     (solo se factura la conversación entregada). La autoridad sobre si una
 *     plantilla sirve es Meta, en el momento del envío.
 *
 * ⚠️ AL AGREGAR UNA PLANTILLA: primero se crea y se aprueba en el Administrador
 * de WhatsApp de Meta, y RECIÉN DESPUÉS se agrega acá con el mismo nombre,
 * idioma y número de variables. Al revés, el envío falla con un 400 legible pero
 * el aviso no sale.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ `es_CL` NO EXISTE COMO IDIOMA DE PLANTILLA. NO LO VUELVAS A PONER.
 * -----------------------------------------------------------------------------
 * Es el error obvio en un producto Chile-only, y estuvo acá hasta el 2026-08-25.
 * Meta acepta cuatro variantes del castellano y ninguna es Chile:
 *
 *     es · es_AR · es_ES · es_MX
 *
 * Se usa `es` (castellano neutro): el texto lo escribimos nosotros, así que la
 * variante regional no cambia una coma de lo que lee el destinatario — solo
 * decide si Meta encuentra la plantilla o no.
 *
 * El modo en que falla es especialmente confuso: la plantilla existe, está
 * aprobada y se ve en el panel, pero el envío devuelve «template name does not
 * exist in the translation». Uno se pasa la tarde revisando el NOMBRE.
 *
 * REGLAS DE DEPENDENCIAS (hoja del grafo): no importa nada.
 */

/**
 * Los códigos de idioma que Meta acepta para una plantilla, de los que a este
 * producto le sirven. La lista completa es larga; acá van los que aplican.
 */
export const IDIOMAS_PLANTILLA_VALIDOS = ["es", "es_AR", "es_ES", "es_MX", "en_US"] as const;

/** A qué tipo de contacto se dirige un aviso. Espeja el CHECK de `rol` en la BD. */
export type RolDestinatario = "seller" | "courier" | "bodega";

export interface DefinicionPlantilla {
  /** Nombre EXACTO con el que la plantilla está aprobada en Meta. */
  nombre: string;
  /** Código de idioma de la plantilla aprobada (`es`, `en_US`…). */
  idioma: string;
  /** A quién se le manda. Determina cómo se resuelven los destinatarios. */
  rolDestinatario: RolDestinatario;
  /**
   * Nombres de las variables del cuerpo, EN EL ORDEN de `{{1}}`, `{{2}}`, …
   *
   * No viajan a Meta: existen para que el sitio que arma el aviso sea legible y
   * para que un desajuste de cantidad se detecte antes de gastar la llamada.
   */
  variables: readonly string[];
}

/**
 * ⚠️ `hello_world` es la plantilla predefinida de Meta: viene aprobada en toda
 * WABA nueva y es lo único con lo que se puede probar la cadena completa antes
 * de que Meta apruebe una propia. Va en `en_US` y sin variables porque así la
 * define Meta — no es un descuido.
 */
export const CATALOGO_PLANTILLAS = {
  prueba_conexion: {
    nombre: "hello_world",
    idioma: "en_US",
    rolDestinatario: "courier",
    variables: [],
  },

  /**
   * El aviso que motivó esta integración. Reemplaza el «jefe, retiré 20 al
   * seller X» por WhatsApp con un mensaje que sale solo al cerrar la sesión de
   * retiro.
   *
   * Cuerpo aprobado en Meta:
   *   📦 RUTAX
   *   Hola {{1}} 👋
   *   Hoy retiramos {{2}} pedidos desde tu bodega.
   *   Conductor: {{3}}
   *   Vehículo: {{4}}
   *   Detalle:
   *   {{5}}
   *   Gracias por utilizar Rutax.
   */
  retiro_completado: {
    nombre: "notificacion_retiro_pedidos",
    idioma: "es",
    rolDestinatario: "seller",
    variables: [
      "nombreDestinatario",
      "cantidadPedidos",
      "nombreConductor",
      "patenteVehiculo",
      "detalleRutas",
    ],
  },
} as const satisfies Record<string, DefinicionPlantilla>;

/** Las claves de evento válidas. Un typo no compila. */
export type ClaveEventoWhatsApp = keyof typeof CATALOGO_PLANTILLAS;

/** ¿Esta cadena —que viene de un JSON— es una clave de evento conocida? */
export function esClaveEventoConocida(valor: unknown): valor is ClaveEventoWhatsApp {
  return typeof valor === "string" && Object.hasOwn(CATALOGO_PLANTILLAS, valor);
}

/** La definición de una plantilla, o `null` si la clave no existe. */
export function obtenerPlantilla(claveEvento: string): DefinicionPlantilla | null {
  if (!esClaveEventoConocida(claveEvento)) return null;
  return CATALOGO_PLANTILLAS[claveEvento];
}

/** Todas las claves conocidas — para diagnóstico y mensajes de error. */
export function clavesEventoConocidas(): string[] {
  return Object.keys(CATALOGO_PLANTILLAS);
}
