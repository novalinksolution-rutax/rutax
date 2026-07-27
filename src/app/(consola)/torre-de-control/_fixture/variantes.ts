/**
 * Variantes de la fixture, una por `EstadoPantalla`.
 * =====================================================================
 *
 * Los seis estados del handoff (§8) no son casos borde con un mensaje encima:
 * **cada uno cambia qué regiones existen**. Sin estas variantes solo se puede
 * ver `con_excepciones`, que es lo que trae el dataset congelado, y los otros
 * cinco quedan sin ejercitar hasta que aparezcan en producción — que es el peor
 * momento para descubrir que no se renderizan.
 *
 * ⚠️ SOLO PARA DESARROLLO. En producción `EstadoPantalla` lo DERIVA EL SERVIDOR
 * desde los datos reales; nunca lo elige la interfaz ni un query param. Ver la
 * nota de `page.tsx`.
 *
 * Cada variante se deriva del dataset base y es COHERENTE consigo misma. Esto
 * importa especialmente en `tranquilo`: el prototipo del handoff conserva ahí
 * los puntajes del dummy (Oriente 81), que contradicen el mensaje «ninguna zona
 * supera el umbral». El propio README advierte que en producción ese estado
 * solo debe aparecer cuando ningún puntaje lo supere de verdad, y que no se
 * fuerce con un flag sobre datos calientes. Así que aquí se bajan los puntajes
 * en vez de mentir.
 */

import type { EstadoPantalla, EstadoTorre, Zona } from "./estado-torre";
import { ESTADO_TORRE } from "./estado-torre";

/** Recalcula el nivel a partir del puntaje, con los cortes del handoff (§7). */
function nivelDesde(puntaje: number): Zona["nivel"] {
  if (puntaje <= 20) return "calmo";
  if (puntaje <= 40) return "bajo";
  if (puntaje <= 60) return "medio";
  if (puntaje <= 75) return "alto";
  return "critico";
}

/**
 * Baja el riesgo de una zona a un valor calmo manteniendo la proporción entre
 * sus factores: un tablero tranquilo no es uno con los factores en cero, es uno
 * donde nada cruza el umbral.
 */
function apaciguar(zona: Zona): Zona {
  const puntaje = Math.min(18, Math.round(zona.riesgo / 5));
  return {
    ...zona,
    riesgo: puntaje,
    nivel: nivelDesde(puntaje),
    factores: zona.factores.map((f) => ({ ...f, valor: Math.round(f.valor / 5) })),
  };
}

const TRANQUILO: EstadoTorre = {
  ...ESTADO_TORRE,
  estado: "tranquilo",
  zonas: ESTADO_TORRE.zonas.map(apaciguar),
  excepciones: [],
  // Las señales sin impacto siguen existiendo (viven colapsadas en el riel);
  // las que afectan la operación, no — si afectaran, no estaríamos tranquilos.
  senales: ESTADO_TORRE.senales.filter((s) => !s.afectaOperacion),
  timeline: ESTADO_TORRE.timeline.filter((b) => b.tipo !== "corte_en_riesgo"),
};

const DEGRADADO: EstadoTorre = {
  ...ESTADO_TORRE,
  estado: "degradado",
  // §8: en `degradado` la fuente de tránsito se marca CAÍDA con `✕`, no
  // atrasada. El resto del tablero opera con normalidad.
  frescura: ESTADO_TORRE.frescura.map((f) =>
    f.id === "transito"
      ? { ...f, estado: "caida" as const, motivo: "El proveedor no responde desde las 08:36." }
      : f,
  ),
  capas: ESTADO_TORRE.capas.map((c) =>
    c.id === "transito"
      ? { ...c, activa: false, disponible: false, motivoNoDisponible: "La fuente de tránsito está caída." }
      : c,
  ),
};

/**
 * Fallback de macro-zonas de la RM.
 *
 * Hallazgo verificado: las cinco zonas del dataset **particionan exactamente
 * las 52 comunas de la Región Metropolitana** (8+7+14+9+14), sin repetir
 * ninguna. O sea que el dummy YA es el catálogo de macro-zonas del fallback —
 * no hay que inventar otras. Lo que cambia es que son genéricas, no las del
 * courier: sin conductores asignados ni ventanas de corte propias.
 */
const SIN_ZONAS: EstadoTorre = {
  ...ESTADO_TORRE,
  estado: "sin_zonas",
  zonas: ESTADO_TORRE.zonas.map((z) => ({
    ...z,
    conductoresAsignados: 0,
    conductoresDisponibles: 0,
  })),
};

const SIN_PEDIDOS: EstadoTorre = {
  ...ESTADO_TORRE,
  estado: "sin_pedidos",
  metricas: [],
  excepciones: [],
  senales: [],
  timeline: [],
  zonas: ESTADO_TORRE.zonas.map((z) => ({
    ...z,
    riesgo: 0,
    nivel: "calmo" as const,
    pedidosPendientes: 0,
    pedidosEntregados: 0,
    montoComprometidoClp: 0,
    factores: z.factores.map((f) => ({ ...f, valor: 0 })),
  })),
  pedidosSinGeocodificar: 0,
};

/**
 * `cargando` no es una variante de DATOS: es la ausencia de ellos. Se conserva
 * el dataset base porque el árbol se reemplaza por esqueletos antes de leerlo
 * (ver `EsqueletoConsola`), pero el estado se marca para que la consola sepa
 * qué renderizar.
 */
const CARGANDO: EstadoTorre = { ...ESTADO_TORRE, estado: "cargando" };

export const VARIANTES: Record<EstadoPantalla, EstadoTorre> = {
  con_excepciones: ESTADO_TORRE,
  tranquilo: TRANQUILO,
  cargando: CARGANDO,
  degradado: DEGRADADO,
  sin_zonas: SIN_ZONAS,
  sin_pedidos: SIN_PEDIDOS,
};

const ESTADOS_VALIDOS = Object.keys(VARIANTES) as EstadoPantalla[];

/** `true` si el texto es uno de los seis estados. Valida el query param. */
export function esEstadoPantalla(valor: string | undefined): valor is EstadoPantalla {
  return valor !== undefined && (ESTADOS_VALIDOS as string[]).includes(valor);
}
