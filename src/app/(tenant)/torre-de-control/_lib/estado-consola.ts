/**
 * Estado de la consola — Torre de control (README §6).
 *
 * Forma de estado tal como la documenta el handoff, "reutilizable como
 * `useReducer`". Se mantiene el nombre y la forma de cada campo exactamente
 * como en la especificación para que sea trazable contra el diseño aprobado.
 *
 * Nota de alcance (paso B3): `zoom` y `capas` viven aquí porque son parte del
 * contrato de estado documentado, pero hoy no tienen un control visual propio
 * — son del mapa de R3, que este paso no construye (ver README del repo,
 * "NO construyas el mapa de R3"). `alternarCapa` ya implementa la regla del
 * tope de 2 para que, cuando el mapa exista, el reductor no cambie.
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
  /** equivalente sin mapa (regla de producto 7). Sin mapa construido todavía,
   * arranca en `true`: es la única vista disponible hasta que R3 exista. */
  lista: boolean;
  paleta: boolean;
  filtro: string;
  /** id de acción esperando confirmación en el sitio. */
  confirmando: string | null;
  /** ids de excepción ocultas (optimista; el POST de descarte va detrás). */
  descartadas: string[];
  marcando: boolean;
  marcaProv: { x: number; y: number } | null;
  /** desplegables del bloque de prensa: "ver fuentes" de la señal principal. */
  senal: boolean;
  /** desplegable de "señales sin impacto" (secundarias). */
  otras: boolean;
}

export const ESTADO_CONSOLA_INICIAL: EstadoConsola = {
  horizonte: "hoy",
  zona: null,
  factor: null,
  capas: ["riesgo", "clima"],
  zoom: "zonas",
  lista: true,
  paleta: false,
  filtro: "",
  confirmando: null,
  descartadas: [],
  marcando: false,
  marcaProv: null,
  senal: false,
  otras: false,
};

export type AccionConsola =
  | { tipo: "cambiar-horizonte"; horizonte: Horizonte }
  | { tipo: "seleccionar-zona"; zonaId: string }
  | { tipo: "ir-a-zona"; zonaId: string }
  | { tipo: "abrir-factor"; factorId: string }
  | { tipo: "cerrar-desglose" }
  | { tipo: "alternar-capa"; capa: CapaMapa }
  | { tipo: "alternar-lista" }
  | { tipo: "abrir-paleta" }
  | { tipo: "cerrar-paleta" }
  | { tipo: "cambiar-filtro"; filtro: string }
  | { tipo: "pedir-confirmacion"; accionId: string }
  | { tipo: "cancelar-confirmacion" }
  | { tipo: "confirmar-accion" }
  | { tipo: "descartar-excepcion"; excepcionId: string }
  | { tipo: "activar-modo-marca" }
  | { tipo: "cancelar-modo-marca" }
  | { tipo: "colocar-marca-provisional"; x: number; y: number }
  | { tipo: "alternar-fuentes-senal" }
  | { tipo: "alternar-otras-senales" }
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

    case "alternar-lista":
      return { ...estado, lista: !estado.lista };

    case "abrir-paleta":
      return { ...estado, paleta: true, filtro: "" };

    case "cerrar-paleta":
      return { ...estado, paleta: false, filtro: "" };

    case "cambiar-filtro":
      return { ...estado, filtro: accion.filtro };

    case "pedir-confirmacion":
      return { ...estado, confirmando: accion.accionId };

    case "cancelar-confirmacion":
      return { ...estado, confirmando: null };

    case "confirmar-accion":
      return { ...estado, confirmando: null };

    case "descartar-excepcion":
      return { ...estado, descartadas: [...estado.descartadas, accion.excepcionId] };

    case "activar-modo-marca":
      return { ...estado, marcando: true };

    case "cancelar-modo-marca":
      return { ...estado, marcando: false, marcaProv: null };

    case "colocar-marca-provisional":
      return { ...estado, marcaProv: { x: accion.x, y: accion.y } };

    case "alternar-fuentes-senal":
      return { ...estado, senal: !estado.senal };

    case "alternar-otras-senales":
      return { ...estado, otras: !estado.otras };

    case "escape":
      if (estado.paleta) return { ...estado, paleta: false, filtro: "" };
      if (estado.marcando) return { ...estado, marcando: false, marcaProv: null };
      if (estado.confirmando) return { ...estado, confirmando: null };
      if (estado.factor) return { ...estado, factor: null };
      if (estado.zona) return { ...estado, zona: null, factor: null };
      return estado;

    default:
      return estado;
  }
}
