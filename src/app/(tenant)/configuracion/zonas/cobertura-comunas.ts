/**
 * La aritmética de la cobertura comunal.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL CONTADOR DICE LO QUE FALTA, NO LO QUE HAY
 * -----------------------------------------------------------------------------
 * «9 de 52 · **6 sin zona**». El segundo número es el que importa y es el que
 * ninguna pantalla mostraba.
 *
 * Una comuna sin zona **no falla**: cae en la tarifa por defecto del courier y
 * se cobra igual, en silencio. Así que el síntoma de tener seis comunas
 * huérfanas no es un error en pantalla — es una diferencia de plata que aparece
 * en el cierre del período, si es que alguien la busca. Por eso el número de
 * huérfanas va a la vista y no el de asignadas, que es la cifra que hace sentir
 * que el trabajo está hecho.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ «SIN ZONA» SE CUENTA SOBRE TODAS LAS ZONAS, NO SOBRE LA QUE SE EDITA
 * -----------------------------------------------------------------------------
 * Una comuna que está en otra zona **no** es huérfana. Contarla como tal desde
 * la pantalla de la zona Norte diría «46 sin zona» con el mapa entero cubierto,
 * y un contador que grita cuando no pasa nada deja de leerse a la tercera vez.
 */

import { COMUNAS_RM } from "@/lib/ui/comunas-rm";

export interface AsignacionComuna {
  comuna: string;
  zonaId: string;
}

export interface EstadoComuna {
  comuna: string;
  /** `null` si nadie la tiene. */
  zonaIdDuena: string | null;
  /** El nombre de la zona dueña, para poder decirlo en la fila. */
  nombreZonaDuena: string | null;
  /** La tiene la zona que se está editando. */
  esDeEstaZona: boolean;
  /**
   * La tiene OTRA zona. **No se oculta y no se puede marcar desde acá**: quien
   * la está buscando necesita saber dónde está, y esconderla lo deja buscando
   * una comuna que sí existe.
   */
  esDeOtraZona: boolean;
}

export interface ConteoCobertura {
  /** Cuántas tiene la zona que se edita. */
  deEstaZona: number;
  /** El total de la Región Metropolitana. */
  total: number;
  /** 🔴 Las que no tiene NINGUNA zona. El número que importa. */
  sinZona: number;
}

/**
 * Cruza el catálogo de comunas con las asignaciones del tenant.
 *
 * @param seleccionadas lo que el usuario lleva marcado en esta sesión de
 * edición — puede diferir de lo guardado, y manda sobre `asignaciones` para la
 * zona en curso.
 */
export function estadoDeComunas(
  asignaciones: readonly AsignacionComuna[],
  nombrePorZona: ReadonlyMap<string, string>,
  zonaEnEdicion: string,
  seleccionadas: readonly string[],
): EstadoComuna[] {
  const duena = new Map(asignaciones.map((a) => [a.comuna, a.zonaId]));
  const marcadas = new Set(seleccionadas);

  return COMUNAS_RM.map((comuna) => {
    const zonaIdDuena = duena.get(comuna) ?? null;
    const deOtra = zonaIdDuena !== null && zonaIdDuena !== zonaEnEdicion;
    return {
      comuna,
      zonaIdDuena,
      nombreZonaDuena: zonaIdDuena ? (nombrePorZona.get(zonaIdDuena) ?? "otra zona") : null,
      // Lo marcado manda sobre lo guardado: si acabo de destildarla, se ve
      // destildada aunque en la base siga siendo mía.
      esDeEstaZona: !deOtra && marcadas.has(comuna),
      esDeOtraZona: deOtra,
    };
  });
}

export function contarCobertura(estados: readonly EstadoComuna[]): ConteoCobertura {
  let deEstaZona = 0;
  let sinZona = 0;
  for (const e of estados) {
    if (e.esDeEstaZona) deEstaZona += 1;
    // Huérfana = ni de esta zona ni de otra. Ojo: una que acabo de destildar y
    // todavía no guardo cuenta como huérfana, y está bien — es lo que va a
    // quedar si guardo así.
    if (!e.esDeEstaZona && !e.esDeOtraZona) sinZona += 1;
  }
  return { deEstaZona, total: estados.length, sinZona };
}

/**
 * El texto del contador, ya armado.
 *
 * La segunda mitad **solo aparece cuando hay huérfanas**: «9 de 52 · 0 sin
 * zona» es ruido, y peor, entrena a no leer el número que sí importa cuando
 * deja de ser cero.
 */
export function textoCobertura(c: ConteoCobertura): { principal: string; alerta: string | null } {
  return {
    principal: `${c.deEstaZona} de ${c.total}`,
    alerta: c.sinZona > 0 ? `${c.sinZona} sin zona` : null,
  };
}
