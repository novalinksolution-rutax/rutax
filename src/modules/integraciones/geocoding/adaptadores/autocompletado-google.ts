/**
 * Autocompletado de direcciones con **Places API (New)** de Google.
 *
 * -----------------------------------------------------------------------------
 * TRES COSAS QUE LA API NUEVA HACE DISTINTO Y CUESTAN UNA TARDE
 * -----------------------------------------------------------------------------
 * 1. **La máscara de campos es obligatoria** en el detalle del lugar. Sin la
 *    cabecera `X-Goog-FieldMask` la petición falla con 400 — no devuelve todo
 *    por omisión como la API vieja. Y pedir de más se cobra de más: los campos
 *    están en tramos de precio, así que se piden exactamente los tres que se
 *    usan.
 * 2. **La llave va en cabecera, nunca en la URL.** `X-Goog-Api-Key`. En la URL
 *    terminaría en cualquier log de proxy o de error, y la regla del proyecto es
 *    que esta llave no aparece en logs ni en URLs.
 * 3. **`includedRegionCodes` restringe; `regionCode` solo sesga.** Acá se usa el
 *    primero: la decisión es que no aparezca una dirección de otro país, no que
 *    aparezca más abajo.
 *
 * -----------------------------------------------------------------------------
 * NINGÚN FALLO DE ESTE ADAPTADOR ROMPE EL FORMULARIO
 * -----------------------------------------------------------------------------
 * Sugerir direcciones es una ayuda, no un requisito: el campo acepta texto
 * libre y el geocoding del job sigue existiendo detrás. Si Google responde mal,
 * si la Places API no está habilitada en la llave o si la red se cae, esto
 * devuelve lista vacía y el courier escribe la dirección a mano, como hasta
 * hoy. Por eso los errores se tragan **con un log sin datos sensibles** en vez
 * de propagarse: un formulario que no deja crear un pedido porque el
 * autocompletado está caído es peor que uno sin autocompletado.
 */

import type {
  DireccionResuelta,
  PuertoAutocompletadoDireccion,
  SugerenciaDireccion,
} from "../autocompletado";

const URL_AUTOCOMPLETE = "https://places.googleapis.com/v1/places:autocomplete";
const URL_DETALLE = "https://places.googleapis.com/v1/places";

/** Un humano espera: más de esto y conviene que escriba a mano. */
const TIMEOUT_MS = 4_000;

/**
 * Solo lo que se usa. Cada campo extra sube el tramo de precio del detalle.
 * `addressComponents` es el que trae la comuna.
 */
const MASCARA_DETALLE = "formattedAddress,location,addressComponents";

/**
 * En Chile la comuna es `administrative_area_level_3` en el modelo de Google.
 * Se buscan varios niveles porque no todas las direcciones traen los mismos, y
 * `locality` es el respaldo más frecuente en la Región Metropolitana.
 */
const TIPOS_COMUNA = ["administrative_area_level_3", "locality", "sublocality"];

interface RespuestaSugerencias {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
      text?: { text?: string };
    };
  }>;
}

interface RespuestaDetalle {
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
}

export class AutocompletadoGoogle implements PuertoAutocompletadoDireccion {
  constructor(private readonly apiKey: string) {}

  async sugerir({
    consulta,
    sesion,
  }: {
    consulta: string;
    sesion: string;
  }): Promise<SugerenciaDireccion[]> {
    const texto = consulta.trim();
    // Menos de tres letras no propone nada útil y sí gasta: la sesión se cobra
    // igual, pero las primeras pulsaciones no valen el viaje.
    if (texto.length < 3) return [];

    try {
      const respuesta = await this.pedir(URL_AUTOCOMPLETE, {
        metodo: "POST",
        cuerpo: {
          input: texto,
          // Restringe, no sesga. Ver la nota de cabecera.
          includedRegionCodes: ["cl"],
          languageCode: "es",
          sessionToken: sesion,
        },
      });
      if (!respuesta) return [];

      const datos = respuesta as RespuestaSugerencias;
      return (datos.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
        .map((p) => ({
          id: p.placeId as string,
          principal: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
          secundaria: p.structuredFormat?.secondaryText?.text ?? "",
        }))
        .filter((s) => s.principal !== "");
    } catch {
      // Sin datos en el log: la consulta es una dirección que alguien está
      // escribiendo, y el fallo no cambia lo que el formulario puede hacer.
      console.warn("[autocompletado] Google no respondió; el campo sigue en texto libre.");
      return [];
    }
  }

  async resolver({
    id,
    sesion,
  }: {
    id: string;
    sesion: string;
  }): Promise<DireccionResuelta | null> {
    try {
      const respuesta = await this.pedir(
        `${URL_DETALLE}/${encodeURIComponent(id)}?sessionToken=${encodeURIComponent(sesion)}`,
        { metodo: "GET", mascara: MASCARA_DETALLE },
      );
      if (!respuesta) return null;

      const datos = respuesta as RespuestaDetalle;
      const componentes = datos.addressComponents ?? [];
      const comuna =
        TIPOS_COMUNA.map(
          (tipo) => componentes.find((c) => c.types?.includes(tipo))?.longText,
        ).find((v): v is string => Boolean(v)) ?? null;

      return {
        direccion: datos.formattedAddress ?? "",
        comuna,
        lat: datos.location?.latitude ?? null,
        long: datos.location?.longitude ?? null,
      };
    } catch {
      console.warn("[autocompletado] No se pudo resolver la dirección elegida.");
      return null;
    }
  }

  /** Un solo lugar donde viven la llave, el timeout y la máscara. */
  private async pedir(
    url: string,
    opciones: { metodo: "GET" | "POST"; cuerpo?: unknown; mascara?: string },
  ): Promise<unknown | null> {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), TIMEOUT_MS);
    try {
      const cabeceras: Record<string, string> = {
        // En cabecera, nunca en la URL.
        "X-Goog-Api-Key": this.apiKey,
      };
      if (opciones.cuerpo) cabeceras["Content-Type"] = "application/json";
      if (opciones.mascara) cabeceras["X-Goog-FieldMask"] = opciones.mascara;

      const r = await fetch(url, {
        method: opciones.metodo,
        headers: cabeceras,
        body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
        signal: control.signal,
      });
      if (!r.ok) return null;
      return await r.json();
    } finally {
      clearTimeout(reloj);
    }
  }
}
