/**
 * Autocompletado determinista, sin red — el que corre en desarrollo y en CI.
 *
 * No inventa calles: propone **la dirección que se está escribiendo, en cada
 * comuna de la Región Metropolitana que calce con lo tecleado**, y resuelve al
 * centroide de esa comuna. Es exactamente lo que el stub de geocoding ya hace,
 * así que las dos mitades del formulario cuentan la misma historia en local.
 *
 * Sirve para lo que un stub tiene que servir: ejercitar el camino completo
 * —escribir, ver la lista, elegir, que se llenen comuna y coordenada— sin
 * llamar a Google ni gastar una sesión facturada por cada recarga en desarrollo.
 */

import { COMUNAS_RM, type ComunaRM } from "@/lib/ui/comunas-rm";
import { CENTROIDES_RM } from "@/lib/geo/centroides-rm";
import type {
  DireccionResuelta,
  PuertoAutocompletadoDireccion,
  SugerenciaDireccion,
} from "../autocompletado";

/** Cuántas sugerencias devuelve Google como máximo. Se imita para que la lista
 *  se vea igual de larga en desarrollo que en producción. */
const TOPE = 5;

/** El id lleva dentro todo lo que `resolver` necesita: el stub no guarda estado. */
function componerId(calle: string, comuna: string): string {
  return `stub:${encodeURIComponent(calle)}:${encodeURIComponent(comuna)}`;
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export class AutocompletadoStub implements PuertoAutocompletadoDireccion {
  async sugerir({ consulta }: { consulta: string }): Promise<SugerenciaDireccion[]> {
    const texto = consulta.trim();
    if (texto.length < 3) return [];

    // Si lo escrito nombra una comuna, se proponen direcciones de esa comuna;
    // si no, se recorren las primeras del catálogo. Determinista en los dos
    // casos: la misma consulta da siempre la misma lista.
    const buscado = normalizar(texto);
    const calzan = COMUNAS_RM.filter((c) => buscado.includes(normalizar(c)));
    const comunas = (calzan.length > 0 ? calzan : COMUNAS_RM).slice(0, TOPE);

    return comunas.map((comuna) => ({
      id: componerId(texto, comuna),
      principal: texto,
      secundaria: `${comuna}, Región Metropolitana, Chile`,
    }));
  }

  async resolver({ id }: { id: string }): Promise<DireccionResuelta | null> {
    if (!id.startsWith("stub:")) return null;
    const [, calle, comuna] = id.split(":");
    if (!calle || !comuna) return null;

    const nombreComuna = decodeURIComponent(comuna);
    const centroide = CENTROIDES_RM[nombreComuna as ComunaRM];

    return {
      // El stub guarda en el id justo la calle que se tecleó, así que la corta
      // y la larga son la misma. Se devuelven las DOS igual: si devolviera
      // `direccionCorta: null`, en desarrollo se ejercitaría siempre el camino
      // de respaldo y nunca el normal — y el bug viviría hasta producción.
      direccion: decodeURIComponent(calle),
      direccionCorta: decodeURIComponent(calle),
      comuna: nombreComuna,
      lat: centroide?.lat ?? null,
      long: centroide?.long ?? null,
    };
  }
}
