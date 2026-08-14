/**
 * Clasificación y magnitudes de la pantalla "Preparación del día" — lógica
 * PURA, sin React. Ver docs/ux/etapa-5-preparacion-del-dia.md §4, §5 y §13.
 *
 * Todo lo que decide QUÉ estado de cabecera aplica, CUÁNTO suman las cuatro
 * magnitudes de la franja, y CÓMO se agrupan/ordenan las visitas y las
 * comunas vive acá y no en un `.tsx`, por la misma razón que
 * `reloj-inactividad.ts`: Vitest corre en entorno `node` y solo recoge
 * `src/**\/*.test.ts` — nada que viva dentro de un componente se puede probar.
 *
 * `cargando` / `sin_acceso` / `error_carga` (los otros tres de los siete
 * estados de §5) son orquestación de la propia `page.tsx` — dependen de la
 * sesión y de si la consulta a la base falló, no de los DATOS que llegaron.
 * No viven acá.
 */

import type { VisitaRetiroResumenCourier } from "@/modules/operacion/retiro/preparacion";
import { ultimaSenalDe, visitaSuperaUmbral } from "./reloj-inactividad";

/** 1 → singular; 0 o 2+ → plural. Nunca un "(s)" literal en pantalla (§13). */
export function pluralizar(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

// =============================================================================
// Magnitudes de la franja (§13 "Franja de magnitudes")
// =============================================================================

export interface MagnitudesPreparacion {
  bultosRetiradosHoy: number;
  enBodegaAhora: number;
  deVuelta: number;
  sinNovedades: number;
  /** Bultos escaneados hoy que no calzaron con ningún pedido. Cuenta viva. */
  bultosSinIdentificar: number;
}

/**
 * LA FRANJA CUENTA LO VIVO, NUNCA EL ACTA — y la distinción no es cosmética.
 *
 * El acta es un documento firmado que respalda un pago, y por eso se congela al
 * cerrar la visita y no se recalcula: un escaneo que llega después (la cola sin
 * conexión drenando) NO la mueve. Ahí manda, y ahí se muestra: en la tarjeta de
 * la visita, con su línea "+ N escaneados después de cerrar".
 *
 * Pero la franja responde otra pregunta: **cuántos bultos hay en la bodega ahora
 * mismo**, que es con lo que el coordinador decide cuántos conductores manda a
 * cada zona. Un bulto que llegó tarde está físicamente arriba de la van igual.
 *
 * Y hay una razón dura además de la conceptual: "Carga por comuna", veinte
 * líneas más abajo en la MISMA pantalla, cuenta bultos vivos. Con el acta aquí,
 * la franja decía "4 bultos no se pudieron identificar todavía" mientras la
 * tabla de comunas mostraba "Sin comuna conocida · 5 bultos". Dos cifras de lo
 * mismo, discrepando a la vista, es exactamente lo que hace que el coordinador
 * deje de creerle a la pantalla.
 */
function bultosDeVisita(v: VisitaRetiroResumenCourier): number {
  return v.vivos.total;
}

function sinResolverDeVisita(v: VisitaRetiroResumenCourier): number {
  return v.vivos.sinResolver;
}

/**
 * Las cinco cifras de la franja, en UNA pasada sobre las visitas del día.
 *
 * "Sin novedades" reusa `visitaSuperaUmbral` — la MISMA cuenta que colorea de
 * ámbar cada tarjeta individual en el cliente (`_componentes/reloj-visita.tsx`),
 * para que el número de la franja y lo que se ve en las tarjetas cuenten la
 * misma historia en el instante del render. Pueden desalinearse minutos
 * después, entre un refresco de Realtime y el siguiente — aceptado (§6): el
 * reloj de cada tarjeta sigue corriendo en el cliente aunque la página no se
 * haya vuelto a refrescar.
 */
export function calcularMagnitudes(
  visitas: readonly VisitaRetiroResumenCourier[],
  ahoraMs: number,
): MagnitudesPreparacion {
  let bultosRetiradosHoy = 0;
  let enBodegaAhora = 0;
  let deVuelta = 0;
  let sinNovedades = 0;
  let bultosSinIdentificar = 0;

  for (const v of visitas) {
    bultosRetiradosHoy += bultosDeVisita(v);
    bultosSinIdentificar += sinResolverDeVisita(v);

    if (v.estado === "cerrada") {
      deVuelta += 1;
    } else {
      enBodegaAhora += 1;
      if (visitaSuperaUmbral({ ultimoEscaneoEn: v.ultimoEscaneoEn, abiertaEn: v.abiertaEn, ahoraMs })) {
        sinNovedades += 1;
      }
    }
  }

  return { bultosRetiradosHoy, enBodegaAhora, deVuelta, sinNovedades, bultosSinIdentificar };
}

// =============================================================================
// Estado de cabecera (§5.4-§5.7)
// =============================================================================

export type EstadoCabeceraPreparacion =
  | "arranque_vacio"
  | "en_curso_tranquilo"
  | "en_curso_con_avisos"
  | "cierre_de_manana";

/**
 * Cero visitas → `arranque_vacio`. Con al menos una: cero abiertas es
 * `cierre_de_manana` (por construcción, si hay visitas y ninguna está
 * abierta, al menos una está cerrada — solo hay dos estados posibles), y con
 * abiertas, el color lo decide si alguna superó el umbral.
 */
export function clasificarEstadoCabecera(
  visitas: readonly VisitaRetiroResumenCourier[],
  magnitudes: Pick<MagnitudesPreparacion, "enBodegaAhora" | "sinNovedades">,
): EstadoCabeceraPreparacion {
  if (visitas.length === 0) return "arranque_vacio";
  if (magnitudes.enBodegaAhora === 0) return "cierre_de_manana";
  return magnitudes.sinNovedades > 0 ? "en_curso_con_avisos" : "en_curso_tranquilo";
}

/**
 * Texto exacto de §13 cuando la consulta de VISITAS falló. Es el único texto
 * de este módulo que no depende de datos —`page.tsx` lo usa directamente,
 * antes de intentar clasificar nada, porque sin visitas no hay nada que
 * clasificar.
 */
export const TEXTO_SUBTITULO_ERROR_CABECERA = "No pudimos cargar el estado de hoy.";

/** El subtítulo de la cabecera para los cuatro estados CON datos (§13). */
export function calcularSubtituloCabecera(
  estado: EstadoCabeceraPreparacion,
  magnitudes: MagnitudesPreparacion,
): string {
  const bultos = `${magnitudes.bultosRetiradosHoy} ${pluralizar(magnitudes.bultosRetiradosHoy, "bulto retirado", "bultos retirados")}`;

  switch (estado) {
    case "arranque_vacio":
      return "Ningún conductor ha abierto una visita todavía.";
    case "cierre_de_manana":
      return `${bultos} en total · todos los conductores están de vuelta.`;
    case "en_curso_con_avisos": {
      const avisos = `${magnitudes.sinNovedades} ${pluralizar(magnitudes.sinNovedades, "visita sin novedades", "visitas sin novedades")}`;
      return `${bultos} hasta ahora · ${avisos}.`;
    }
    case "en_curso_tranquilo": {
      const enBodega = `${magnitudes.enBodegaAhora} ${pluralizar(magnitudes.enBodegaAhora, "conductor en bodega", "conductores en bodega")}`;
      return `${bultos} hasta ahora · ${enBodega}.`;
    }
  }
}

// =============================================================================
// Agrupar/ordenar visitas (§4 "'En bodega ahora' primero" + wireframes §9/§10)
// =============================================================================

/**
 * Abiertas primero (nunca al revés, §4), y cada grupo ordenado para que lo
 * más urgente quede arriba:
 *   · abiertas: la señal MÁS antigua primero — la visita más cerca de (o ya
 *     sobre) el umbral es la que más necesita que el coordinador la mire.
 *   · cerradas: la más RECIENTE primero, el orden natural de "lo último que pasó".
 *
 * No especificado literalmente por el documento (que no fija un orden de
 * lista dentro de cada subgrupo) — es la lectura más consistente con el
 * criterio de jerarquía de §4 ("lo que necesita atención primero").
 */
export function agruparVisitas(
  visitas: readonly VisitaRetiroResumenCourier[],
): { abiertas: VisitaRetiroResumenCourier[]; cerradas: VisitaRetiroResumenCourier[] } {
  const abiertas = visitas.filter((v) => v.estado === "abierta");
  const cerradas = visitas.filter((v) => v.estado === "cerrada");

  abiertas.sort((a, b) => new Date(ultimaSenalDe(a)).getTime() - new Date(ultimaSenalDe(b)).getTime());
  cerradas.sort((a, b) => new Date(b.cerradaEn ?? 0).getTime() - new Date(a.cerradaEn ?? 0).getTime());

  return { abiertas, cerradas };
}

// =============================================================================
// Carga por comuna
// =============================================================================
// No hay función de orden acá: `obtenerCargaPorComuna`
// (`src/modules/operacion/retiro/preparacion.ts`) YA entrega el arreglo
// ordenado —mayor carga primero, "Sin comuna conocida" siempre al final y
// solo si tiene bultos— como parte documentada de su propio contrato (reglas
// 4 y 5 de su JSDoc). Reordenarlo otra vez acá duplicaría esa regla de
// negocio en dos capas que podrían desincronizarse en silencio — el mismo
// riesgo, a menor escala, que el incidente del CHECK de `tipo_diferencia`
// (CLAUDE.md §Invariantes). `_componentes/carga-por-comuna.tsx` consume las
// filas tal cual llegan.
