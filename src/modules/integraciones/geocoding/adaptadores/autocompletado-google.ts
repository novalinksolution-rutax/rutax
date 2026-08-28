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

/**
 * 🔴 **Que el proveedor rechace NO es «no hay resultados».**
 *
 * `pedir` devolvía `null` ante cualquier respuesta no-OK y los dos métodos lo
 * traducían a lista vacía. O sea que el fallo más probable de todos —403 porque
 * la Places API (New) no está habilitada en el proyecto de Google, o porque la
 * llave está restringida a otra API— se veía en pantalla como «esa dirección no
 * existe», y en el servidor no quedaba más que un `warn` sin el código.
 *
 * Habilitar la Geocoding API **no** habilita ésta: son dos productos distintos
 * (`maps.googleapis.com/maps/api/geocode` contra `places.googleapis.com/v1`).
 * Es exactamente el tipo de cosa que hay que poder leer en un log.
 */
export class ErrorProveedorAutocompletado extends Error {
  constructor(readonly estado: number) {
    super(`El proveedor de autocompletado respondió ${estado}`);
    this.name = "ErrorProveedorAutocompletado";
  }
}

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

/**
 * Los dos componentes con los que se arma «calle y número».
 *
 * En Chile el número va DESPUÉS de la calle («Los Militares 5001»), al revés
 * que en inglés. Google entrega los dos por separado, así que el orden lo
 * decide este archivo y no hay que adivinarlo del texto.
 */
const TIPO_CALLE = "route";
const TIPO_NUMERO = "street_number";

/**
 * Tipos que describen un LUGAR ADMINISTRATIVO, no una dirección.
 *
 * Escribir «pucon» proponía «Pucón, Chile» y se podía elegir: una comuna entera
 * como dirección de una bodega o de una factura. Google no ofrece un
 * `includedPrimaryTypes` que resuelva esto —comprobado en su documentación: las
 * ÚNICAS colecciones son `(cities)` y `(regions)`, y «address» NO existe como
 * colección en la API nueva—, así que el descarte se hace acá.
 */
const TIPOS_ADMINISTRATIVOS = new Set([
  "locality",
  "sublocality",
  "sublocality_level_1",
  "sublocality_level_2",
  "neighborhood",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "administrative_area_level_4",
  "administrative_area_level_5",
  "country",
  "postal_code",
  "postal_code_prefix",
  "political",
  "plus_code",
]);

/**
 * ¿Esta sugerencia es un sitio al que se puede llegar, o solo un área?
 *
 * 🔴 **Es una lista de DESCARTE, no de permitidos, y falla ABIERTO.** Con una
 * lista de permitidos habría que enumerar todo lo que Google puede devolver para
 * una dirección buena —`street_address`, `premise`, `subpremise`, y los cientos
 * de tipos de establecimiento— y lo que faltara desaparecería del buscador sin
 * que nadie lo note. Acá, si `types` no viene o trae algo no listado, la
 * sugerencia SE CONSERVA: lo peor que pasa es que se cuele una de más.
 *
 * Un centro comercial o un edificio con nombre propio SÍ pasan: tienen tipos de
 * establecimiento además de los administrativos, y son direcciones legítimas
 * —el propio `CampoDireccion` cuenta con ello para «Mall Parque Arauco»—.
 * Lo que se va es lo que NO tiene nada más que administrativo: una comuna, una
 * región, un país, un código postal.
 */
function esUnLugarAlQueSePuedeLlegar(tipos: string[] | undefined): boolean {
  if (!tipos || tipos.length === 0) return true;
  return tipos.some((t) => !TIPOS_ADMINISTRATIVOS.has(t));
}

interface RespuestaSugerencias {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
      text?: { text?: string };
      /** Clasificación de Google. Se usa para descartar ciudades y regiones. */
      types?: string[];
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

      const datos = respuesta as RespuestaSugerencias;
      return (datos.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
        // Fuera las comunas, regiones y países sueltos: una dirección tiene que
        // ser un sitio al que se pueda llegar.
        .filter((p) => esUnLugarAlQueSePuedeLlegar(p.types))
        .map((p) => ({
          id: p.placeId as string,
          principal: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
          secundaria: p.structuredFormat?.secondaryText?.text ?? "",
        }))
        .filter((s) => s.principal !== "");
    } catch (error) {
      // ⚠️ El rechazo del proveedor SE PROPAGA: quien llama lo traduce a «no
      // pudimos buscar», que es distinto de «no hay ninguna dirección así».
      // Tragárselo acá es lo que hacía invisible una API sin habilitar.
      if (error instanceof ErrorProveedorAutocompletado) throw error;
      // El resto —red caída, timeout— también, y por lo mismo.
      // Sin datos en el mensaje: la consulta es una dirección que alguien está
      // escribiendo.
      console.warn("[autocompletado] Google no respondió a tiempo.");
      throw new ErrorProveedorAutocompletado(0);
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

      const datos = respuesta as RespuestaDetalle;
      const componentes = datos.addressComponents ?? [];
      const buscar = (tipo: string) =>
        componentes.find((c) => c.types?.includes(tipo))?.longText ?? null;

      const comuna =
        TIPOS_COMUNA.map(buscar).find((v): v is string => Boolean(v)) ?? null;

      /**
       * 🔴 «Calle y número», compuesto — no recortado.
       *
       * Se arma con los componentes estructurados y NUNCA cortando el texto
       * largo por comas: «Av. Pdte. Riesco 5335, Las Condes» y «Camino El Alba,
       * Km 2, Lo Barnechea» no tienen la misma forma, y un recorte por comas
       * fallaría guardando media dirección — en silencio, y solo en las
       * direcciones raras, que son justo las que el conductor no encuentra.
       *
       * Sin calle no se inventa nada: se devuelve `null` y decide quien llama.
       */
      const calle = buscar(TIPO_CALLE);
      const numero = buscar(TIPO_NUMERO);
      const direccionCorta = calle ? [calle, numero].filter(Boolean).join(" ") : null;

      return {
        direccion: datos.formattedAddress ?? "",
        direccionCorta,
        comuna,
        lat: datos.location?.latitude ?? null,
        long: datos.location?.longitude ?? null,
      };
    } catch (error) {
      // Acá sí se devuelve `null` y no se propaga: el campo ya tiene el texto
      // que la persona eligió de la lista y lo conserva (ver `elegir` en
      // `CampoDireccion`). Lo que se pierde es la coordenada, y eso el job de
      // geocoding lo resuelve después — o sea que hay camino de vuelta.
      console.warn(
        "[autocompletado] No se pudo resolver la dirección elegida:",
        error instanceof ErrorProveedorAutocompletado ? `HTTP ${error.estado}` : "error de red",
      );
      return null;
    }
  }

  /** Un solo lugar donde viven la llave, el timeout y la máscara. */
  private async pedir(
    url: string,
    opciones: { metodo: "GET" | "POST"; cuerpo?: unknown; mascara?: string },
  ): Promise<unknown> {
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
      // El código importa y hay que poder leerlo: 403 es «la API no está
      // habilitada o la llave está restringida», 429 es cuota. Devolver `null`
      // los volvía a todos «sin resultados».
      if (!r.ok) throw new ErrorProveedorAutocompletado(r.status);
      return await r.json();
    } finally {
      clearTimeout(reloj);
    }
  }
}
