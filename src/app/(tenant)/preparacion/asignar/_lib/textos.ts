/**
 * Textos con pluralización explícita de la bandeja de asignación (§13 del
 * documento: "1 → singular, 0 o 2+ → plural. Nunca un '(s)' literal en
 * pantalla"). Lógica PURA y separada del `.tsx` por el mismo motivo que el
 * resto de `_lib/`: es donde se cuelan los errores de concordancia
 * (singular/plural, género del verbo) y Vitest no puede probar nada dentro
 * de un componente.
 *
 * Reusa `pluralizar` de la pantalla madre (`preparacion/_lib/estado-preparacion.ts`)
 * en vez de duplicarla — es la misma regla, ya escrita y probada ahí.
 */

import { pluralizar } from "../../_lib/estado-preparacion";
import type { MotivoNoAsignado } from "./resultado";

// =============================================================================
// Cabecera (§13 "Cabecera")
// =============================================================================

/**
 * `{total} pedidos retirados · {sinAsignar} sin asignar`, con singular en 1.
 *
 * ⚠️ Dice "retirados", NO "retirados hoy", y la diferencia importa: la bandeja
 * acota `retirado_en` **solo por arriba** (ver la cabecera de
 * `modules/operacion/asignacion.ts`), así que también ofrece lo que se retiró
 * ayer y nunca llegó a asignarse — está en la bodega igual. Poner "hoy" en el
 * texto haría que esa cifra contradijera a la propia lista debajo el día que
 * quede un rezagado, y el coordinador tendría razón en desconfiar de las dos.
 */
export function textoCabecera(totalRetirados: number, totalSinAsignar: number): string {
  const retirados = `${totalRetirados} ${pluralizar(totalRetirados, "pedido retirado", "pedidos retirados")}`;
  return `${retirados} · ${totalSinAsignar} sin asignar`;
}

// =============================================================================
// Resultado del envío — éxito sin omisiones (§7.5)
// =============================================================================

/** `{n} pedidos asignados a {conductor}`. */
export function textoExitoSinOmisiones(totalQuedaronCon: number, conductorNombre: string): string {
  const n = `${totalQuedaronCon} ${pluralizar(totalQuedaronCon, "pedido asignado", "pedidos asignados")}`;
  return `${n} a ${conductorNombre}`;
}

/** `{r} de ellos venían de otro conductor.` — condicional, solo si `totalReasignados > 0`. */
export function textoSubLineaVeniaDeOtro(totalReasignados: number): string {
  const verbo = pluralizar(totalReasignados, "venía", "venían");
  return `${totalReasignados} de ellos ${verbo} de otro conductor.`;
}

// =============================================================================
// Resultado del envío — con omisiones (§7.5)
// =============================================================================

/** `{n} pedidos quedaron con {conductor}` — encabezado del diálogo de resultado. */
export function textoQuedaronCon(totalQuedaronCon: number, conductorNombre: string): string {
  const n = `${totalQuedaronCon} ${pluralizar(totalQuedaronCon, "pedido quedó", "pedidos quedaron")}`;
  return `${n} con ${conductorNombre}`;
}

/** `{r} reasignados desde otro conductor` — sub-línea, solo si `totalReasignados > 0`. */
export function textoReasignadosDesdeOtro(totalReasignados: number): string {
  return `${totalReasignados} ${pluralizar(totalReasignados, "reasignado", "reasignados")} desde otro conductor`;
}

/** `{n} ya estaba con {conductor} — no hizo falta cambiar nada` — bloque neutro. */
export function textoYaEstabaCon(cantidad: number, conductorNombre: string): string {
  const verbo = pluralizar(cantidad, "estaba", "estaban");
  return `${cantidad} ya ${verbo} con ${conductorNombre} — no hizo falta cambiar nada`;
}

/** `{n} no se pudo asignar` — encabezado del bloque ámbar. */
export function textoNoSePudoAsignar(cantidad: number): string {
  return `${cantidad} no se ${pluralizar(cantidad, "pudo asignar", "pudieron asignar")}`;
}

/**
 * Motivo de cada ítem del bloque ámbar (§13 glosario). `ajeno` no está en el
 * glosario del documento — texto propio de esta etapa, ver el comentario de
 * cabecera de `resultado.ts`.
 */
const TEXTO_MOTIVO_NO_ASIGNADO: Record<MotivoNoAsignado, string> = {
  no_retirado: "Ya no figura como retirado. Puede haber vuelto a la bandeja de candidatos.",
  estado_no_asignable: "Cambió de estado antes de confirmar (por ejemplo, se canceló). Revisa el pedido.",
  ajeno: "Ya no está disponible para asignar. Actualiza la página e inténtalo de nuevo.",
};

export function textoMotivoNoAsignado(motivo: MotivoNoAsignado): string {
  return TEXTO_MOTIVO_NO_ASIGNADO[motivo];
}

/** Solo `estado_no_asignable` ofrece el botón "Ver pedido" (tabla del §7.5). */
export function ofreceVerPedido(motivo: MotivoNoAsignado): boolean {
  return motivo === "estado_no_asignable";
}

// =============================================================================
// Diálogo de reasignación (§7.3 / §13)
// =============================================================================

/** `{conductorActual} — {n} pedidos` — una línea de grupo dentro del diálogo. */
export function textoGrupoReasignacion(conductorNombre: string, cantidad: number): string {
  return `${conductorNombre} — ${cantidad} ${pluralizar(cantidad, "pedido", "pedidos")}`;
}
