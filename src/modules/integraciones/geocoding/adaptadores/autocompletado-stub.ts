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

/**
 * Calle y número, sin la comuna que la persona haya escrito al final.
 *
 * Google devuelve «La Montaña Sur 4603» y la comuna aparte; el stub devolvía
 * todo lo tecleado («… 4603 lampa»), y probando en local la elección dejaba la
 * comuna escrita en el campo. Solo se quita la comuna cuando va AL FINAL: en
 * «Av. Providencia 1234» la comuna es también el nombre de la calle y no se toca.
 */
function sinComunaAlFinal(texto: string, comunas: readonly string[]): string {
  const limpio = texto.trim();
  const buscado = normalizar(limpio);
  for (const comuna of comunas) {
    const c = normalizar(comuna);
    if (!buscado.endsWith(c)) continue;
    const corte = limpio.length - c.length;
    // Tiene que ir separada: «… 4603 lampa» sí, «… 4603lampa» no.
    if (corte > 0 && /[\s,]/.test(limpio[corte - 1])) {
      return limpio.slice(0, corte).replace(/[\s,]+$/, "");
    }
  }
  return limpio;
}

export class AutocompletadoStub implements PuertoAutocompletadoDireccion {
  async sugerir({ consulta }: { consulta: string }): Promise<SugerenciaDireccion[]> {
    const texto = consulta.trim();
    if (texto.length < 3) return [];

    // Si lo escrito nombra una comuna, se proponen direcciones de esa comuna.
    // Determinista: la misma consulta da siempre la misma lista.
    const buscado = normalizar(texto);
    const calzan = COMUNAS_RM.filter((c) => buscado.includes(normalizar(c)));

    // Sin comuna escrita no hay cómo saber en cuál está la calle, y inventar las
    // primeras cinco del catálogo (lo que hacía antes) mostraba direcciones que
    // no existen. Se ofrece UNA sugerencia sin comuna: al elegirla el formulario
    // pide la comuna, igual que con una dirección escrita a mano.
    if (calzan.length === 0) {
      return [
        {
          id: componerId(texto, ""),
          principal: texto,
          secundaria: "Región Metropolitana, Chile",
        },
      ];
    }

    const calle = sinComunaAlFinal(texto, calzan);
    return calzan.slice(0, TOPE).map((comuna) => ({
      id: componerId(calle, comuna),
      principal: calle,
      secundaria: `${comuna}, Región Metropolitana, Chile`,
    }));
  }

  async resolver({ id }: { id: string }): Promise<DireccionResuelta | null> {
    if (!id.startsWith("stub:")) return null;
    const [, calle, comuna] = id.split(":");
    if (!calle) return null;

    // Sin comuna: la calle se acepta tal cual y la comuna queda por decidir.
    if (!comuna) {
      return {
        direccion: decodeURIComponent(calle),
        direccionCorta: decodeURIComponent(calle),
        comuna: null,
        lat: null,
        long: null,
      };
    }

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
