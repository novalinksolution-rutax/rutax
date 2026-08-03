/**
 * Estado de la consola — Torre de control (README §6).
 *
 * Forma de estado tal como la documenta el handoff, "reutilizable como
 * `useReducer`". Se mantiene el nombre y la forma de cada campo exactamente
 * como en la especificación para que sea trazable contra el diseño aprobado.
 *
 * Dos campos se apartan del handoff, y en los dos casos porque la realidad que
 * describían dejó de existir al construir R3:
 *
 * - `marcaProv` era `{x, y}`: coordenadas del `viewBox` del SVG que el
 *   prototipo usaba como mapa. Con MapLibre no hay `viewBox` — hay terreno —,
 *   así que la marca guarda `{long, lat}`. Una marca en píxeles se despegaría
 *   del sitio que anota en cuanto el usuario hiciera zoom, que es exactamente
 *   lo que una anotación operativa no puede hacer.
 * - `lista` arrancaba en `true` porque el mapa no existía y era la única vista
 *   disponible. Ahora arranca en `false`: la vista por defecto de R3 es el
 *   mapa, y `L` conmuta. La lista sigue existiendo siempre (regla 7).
 */

import type { CapaMapa, Horizonte, NivelZoom } from "../_fixture/estado-torre";
import { MAX_CAPAS_ACTIVAS } from "../_fixture/estado-torre";

export interface EstadoConsola {
  horizonte: Horizonte;
  /** id de zona seleccionada → nivel 2. */
  zona: string | null;
  /** id de factor abierto → nivel 3. */
  factor: string | null;
  /** máx. `MAX_CAPAS_ACTIVAS`. */
  capas: CapaMapa[];
  zoom: NivelZoom;
  /** equivalente sin mapa (regla de producto 7); `L` lo conmuta con el mapa. */
  lista: boolean;
  filtro: string;
  marcando: boolean;
  /** Coordenadas geográficas, no de pantalla — ver cabecera. */
  marcaProv: { long: number; lat: number } | null;
}

export const ESTADO_CONSOLA_INICIAL: EstadoConsola = {
  horizonte: "hoy",
  zona: null,
  factor: null,
  capas: ["riesgo", "clima"],
  zoom: "zonas",
  lista: false,
  filtro: "",
  marcando: false,
  marcaProv: null,
};

export type AccionConsola =
  | { tipo: "cambiar-horizonte"; horizonte: Horizonte }
  | { tipo: "seleccionar-zona"; zonaId: string }
  | { tipo: "ir-a-zona"; zonaId: string }
  | { tipo: "abrir-factor"; factorId: string }
  | { tipo: "cerrar-desglose" }
  | { tipo: "alternar-capa"; capa: CapaMapa }
  | { tipo: "cambiar-zoom"; zoom: NivelZoom }
  | { tipo: "alternar-lista" }
  | { tipo: "cambiar-filtro"; filtro: string }
  | { tipo: "activar-modo-marca" }
  | { tipo: "cancelar-modo-marca" }
  | { tipo: "colocar-marca-provisional"; long: number; lat: number }
  | { tipo: "escape" };

export function reducirConsola(estado: EstadoConsola, accion: AccionConsola): EstadoConsola {
  switch (accion.tipo) {
    case "cambiar-horizonte":
      return { ...estado, horizonte: accion.horizonte };

    case "seleccionar-zona": {
      // Click en la zona ya seleccionada la deselecciona; siempre resetea `factor`.
      const yaSeleccionada = estado.zona === accion.zonaId;
      return { ...estado, zona: yaSeleccionada ? null : accion.zonaId, factor: null };
    }

    case "ir-a-zona":
      // Variante no-toggle: la usa la paleta de comandos ("ir a Oriente" siempre selecciona).
      return { ...estado, zona: accion.zonaId, factor: null };

    case "abrir-factor":
      return { ...estado, factor: estado.factor === accion.factorId ? null : accion.factorId };

    case "cerrar-desglose":
      return { ...estado, zona: null, factor: null };

    case "alternar-capa": {
      const activa = estado.capas.includes(accion.capa);
      if (activa) {
        return { ...estado, capas: estado.capas.filter((c) => c !== accion.capa) };
      }
      // Tope alcanzado: no-op explícito, se comunica visualmente (nunca un error).
      if (estado.capas.length >= MAX_CAPAS_ACTIVAS) {
        return estado;
      }
      return { ...estado, capas: [...estado.capas, accion.capa] };
    }

    case "cambiar-zoom":
      return { ...estado, zoom: accion.zoom };

    case "alternar-lista":
      return { ...estado, lista: !estado.lista };

    case "cambiar-filtro":
      return { ...estado, filtro: accion.filtro };

    case "activar-modo-marca":
      return { ...estado, marcando: true };

    case "cancelar-modo-marca":
      return { ...estado, marcando: false, marcaProv: null };

    case "colocar-marca-provisional":
      return { ...estado, marcaProv: { long: accion.long, lat: accion.lat } };

    case "escape":
      if (estado.marcando) return { ...estado, marcando: false, marcaProv: null };
      if (estado.factor) return { ...estado, factor: null };
      if (estado.zona) return { ...estado, zona: null, factor: null };
      return estado;

    default:
      return estado;
  }
}
