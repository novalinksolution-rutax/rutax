/**
 * El idioma del seller.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EL PORTAL NO PUEDE HABLAR COMO EL COURIER
 * -----------------------------------------------------------------------------
 * `traduccion-estados.ts` escribe el vocabulario de quien opera: «En ruta»,
 * «Fallido», «En gestión». Son palabras de bodega, y el seller no está en la
 * bodega — está mirando si su cliente recibió el paquete.
 *
 * «Fallido» no le dice qué pasó ni qué tiene que hacer. «Nadie recibió» sí.
 * «En gestión» suena a que el trámite avanza; «{courier} la está viendo» dice
 * quién tiene la pelota.
 *
 * -----------------------------------------------------------------------------
 * MISMO TONO Y MISMO GLIFO, OTRO TEXTO
 * -----------------------------------------------------------------------------
 * Solo cambia la palabra. El tono de estado —el que decide el color y la trama—
 * sigue saliendo de `tonos-estado.ts` por su eje y su valor, así que un pedido
 * fallido se pinta igual en las dos superficies. Si el portal además cambiara el
 * tono, el mismo hecho se vería distinto según quién mire, y eso ya no es
 * traducir: es contar otra cosa.
 *
 * -----------------------------------------------------------------------------
 * NO ES UN ALIAS: HAY ESTADOS QUE SE FUNDEN
 * -----------------------------------------------------------------------------
 * `entregado` y `entregado_manual` son dos estados del motor —cambia quién los
 * escribió— y para el seller son **el mismo hecho**: llegó. Igual `fallido` y
 * `fallido_manual`. Distinguirlos en el portal expone una diferencia interna que
 * no le sirve a nadie de afuera.
 */

import type { EstadoPedido, EstadoIncidencia, TipoIncidencia } from "@/modules/operacion/tipos";

/**
 * El estado del pedido, para el seller.
 *
 * `pendiente_asignacion` y `asignado` se funden en «Programado»: al seller le da
 * lo mismo si ya tiene conductor: lo que sabe es que todavía no salió.
 */
const ESTADO_PEDIDO_PORTAL: Record<EstadoPedido, string> = {
  pendiente_asignacion: "Programado",
  asignado: "Programado",
  en_ruta: "En camino",
  entregado: "Entregado",
  entregado_manual: "Entregado",
  fallido: "Nadie recibió",
  fallido_manual: "Nadie recibió",
  devuelto: "Devuelto",
  cancelado: "Cancelado",
};

export function estadoPedidoParaSeller(estado: EstadoPedido): string {
  return ESTADO_PEDIDO_PORTAL[estado] ?? estado;
}

/**
 * El estado de la incidencia, para el seller.
 *
 * `{courier}` se sustituye por el nombre del courier: la pregunta que se hace el
 * seller al ver una incidencia abierta es **de quién es el problema ahora**, y
 * «En gestión» no la responde.
 */
export function estadoIncidenciaParaSeller(
  estado: EstadoIncidencia,
  nombreCourier: string,
): string {
  switch (estado) {
    case "abierta":
      return "Recién reportada";
    case "en_gestion":
      return `${nombreCourier} la está viendo`;
    case "resuelta":
      return "Resuelta";
    case "cerrada":
      return "Cerrada";
  }
}

/**
 * Los siete tipos de incidencia, escritos para el seller.
 *
 * Son **los mismos siete del sistema** (decisión del usuario): si el courier y
 * el seller clasificaran distinto, la misma incidencia se contaría de dos formas
 * y la reportería dejaría de cuadrar. Lo único que cambia es cómo se leen.
 */
export const TIPO_INCIDENCIA_PORTAL: Record<TipoIncidencia, string> = {
  destinatario_ausente: "No había nadie",
  direccion_erronea: "La dirección estaba mala",
  paquete_danado: "El bulto llegó dañado",
  rechazo_destinatario: "El destinatario no lo quiso recibir",
  problema_acceso: "No se pudo entrar (portería, condominio, oficina cerrada)",
  reagendado: "Hay que reagendarlo",
  otro: "Otra cosa",
};

export function tipoIncidenciaParaSeller(tipo: TipoIncidencia): string {
  return TIPO_INCIDENCIA_PORTAL[tipo] ?? tipo;
}

/**
 * Cuándo llega, dicho como lo diría una persona.
 * -----------------------------------------------------------------------------
 * La columna del listado decía `F. compromiso` e imprimía la fecha ISO tal cual.
 * «2026-08-24» no responde la pregunta con la que el seller entra a la pantalla.
 *
 * `hoy` y la fecha son CIVILES ('YYYY-MM-DD') y se comparan como cadenas: pasar
 * por `Date` las interpretaría como medianoche UTC, que en Santiago es el día
 * anterior.
 */
export function textoLlegada(
  fechaCompromiso: string | null,
  hoy: string,
  estado: EstadoPedido,
): string {
  if (estado === "cancelado") return "Cancelado";
  if (estado === "devuelto") return "Volvió a tu bodega";
  if (estado === "fallido" || estado === "fallido_manual") return "Se reagenda";
  if (!fechaCompromiso) return "Sin fecha comprometida";

  const fecha = fechaCompromiso.slice(0, 10);
  const entregado = estado === "entregado" || estado === "entregado_manual";

  if (fecha === hoy) return entregado ? "Llegó hoy" : "Hoy";
  if (fecha < hoy) return entregado ? `Llegó el ${diaMes(fecha)}` : `Era el ${diaMes(fecha)}`;
  return diaMes(fecha);
}

/** `24 ago`, sin pasar por `Date`. */
function diaMes(fecha: string): string {
  const meses = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ];
  const [, mes, dia] = fecha.split("-");
  return `${Number(dia)} ${meses[Number(mes) - 1] ?? mes}`;
}

/**
 * Los cuatro grupos con que el seller mira su lista.
 * -----------------------------------------------------------------------------
 * El filtro de estado del portal ofrecía los NUEVE estados del motor, con el
 * vocabulario del courier. El seller no distingue `pendiente_asignacion` de
 * `asignado` —en los dos casos su paquete no ha salido— ni `fallido` de
 * `devuelto`, que para él son la misma pregunta: qué hago ahora.
 *
 * `cancelado` queda fuera de los tres grupos a propósito: no está en camino, no
 * se entregó y no tuvo un problema. Va como cajón excluido, y por eso la suma de
 * los cajones NO da el total — `BarraCajones` lo declara sola.
 */
export const GRUPOS_PEDIDO_PORTAL = {
  en_camino: ["pendiente_asignacion", "asignado", "en_ruta"],
  entregado: ["entregado", "entregado_manual"],
  problema: ["fallido", "fallido_manual", "devuelto"],
  cancelado: ["cancelado"],
} as const satisfies Record<string, readonly EstadoPedido[]>;

export type GrupoPedidoPortal = keyof typeof GRUPOS_PEDIDO_PORTAL;

export const ETIQUETA_GRUPO_PORTAL: Record<GrupoPedidoPortal, string> = {
  en_camino: "En camino",
  entregado: "Entregados",
  problema: "Con problemas",
  cancelado: "Cancelados",
};

/** El grupo al que pertenece un estado. Cada estado cae en exactamente uno. */
export function grupoDePedido(estado: EstadoPedido): GrupoPedidoPortal {
  for (const [grupo, estados] of Object.entries(GRUPOS_PEDIDO_PORTAL)) {
    if ((estados as readonly string[]).includes(estado)) return grupo as GrupoPedidoPortal;
  }
  return "en_camino";
}

/**
 * Lo que venga en `?estado=` de la URL, convertido a grupo.
 *
 * Acepta también un estado crudo del motor y lo sube a su grupo: el inicio del
 * portal enlazaba `?estado=en_ruta` y `?estado=fallido`, y los enlaces viejos
 * —incluido cualquier marcador que el seller haya guardado— tienen que seguir
 * llevando a algo, no a una lista vacía.
 */
export function normalizarGrupoPortal(valor: string | undefined): GrupoPedidoPortal | null {
  if (!valor) return null;
  if (valor in GRUPOS_PEDIDO_PORTAL) return valor as GrupoPedidoPortal;
  for (const [grupo, estados] of Object.entries(GRUPOS_PEDIDO_PORTAL)) {
    if ((estados as readonly string[]).includes(valor)) return grupo as GrupoPedidoPortal;
  }
  return null;
}

/**
 * Los cuatro hitos de la línea de tiempo, para el seller.
 *
 * NO se pueden sacar de `estadoPedidoParaSeller`: ahí `pendiente_asignacion` y
 * `asignado` se funden en «Programado» —que es lo correcto en una tabla, donde
 * lo único que importa es que el paquete no salió— y en la línea de tiempo eso
 * imprimiría «Programado → Programado → En camino → Entregado», con dos hitos
 * indistinguibles.
 *
 * Acá sí se separan, porque la línea existe justamente para mostrar el avance
 * entre un hito y el siguiente.
 */
export const HITO_LINEA_PORTAL: Record<string, string> = {
  pendiente_asignacion: "Lo recibimos",
  asignado: "Con un conductor",
  en_ruta: "En camino",
  entregado: "Entregado",
};

export function hitoLineaPortal(estado: EstadoPedido): string {
  return HITO_LINEA_PORTAL[estado] ?? estadoPedidoParaSeller(estado);
}
