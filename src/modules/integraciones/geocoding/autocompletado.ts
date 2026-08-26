/**
 * Puerto de autocompletado de direcciones — sugerir mientras se escribe.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ES UN PUERTO APARTE Y NO DOS MÉTODOS MÁS EN `PuertoGeocoding`
 * -----------------------------------------------------------------------------
 * Se parecen y no son lo mismo:
 *
 *   · **Geocoding** convierte UNA dirección ya escrita en coordenadas. Corre en
 *     un job, sin nadie mirando, y su resultado se cachea para siempre porque
 *     una dirección normalizada es un hecho geográfico estable.
 *   · **Autocompletado** propone direcciones mientras alguien teclea. Corre en
 *     el request, con un humano esperando, y se factura por *sesión de tecleo*,
 *     no por consulta.
 *
 * En Google son además dos productos distintos —Places API contra Geocoding
 * API—, con endpoints, formas de respuesta y precios distintos. Y hay una razón
 * práctica más: `PuertoGeocoding` ya tiene dobles de prueba en varios archivos;
 * agregarle métodos obligatorios los rompería a todos, y agregarlos opcionales
 * escondería que un adaptador no sabe sugerir.
 *
 * -----------------------------------------------------------------------------
 * LA SESIÓN, QUE NO ES UN DETALLE DE IMPLEMENTACIÓN
 * -----------------------------------------------------------------------------
 * Google cobra el autocompletado **por sesión**: todas las pulsaciones que
 * llevan a elegir una dirección, más el detalle de esa dirección, se cobran
 * como una sola cuando comparten `sessionToken`. Sin token, **cada tecla es una
 * consulta facturada**. Por eso el token es obligatorio en la firma y no un
 * parámetro opcional que se pueda olvidar: escribir «Av. Prov» son ocho
 * consultas, y a nadie se le nota en la factura hasta fin de mes.
 *
 * El token lo genera el cliente al empezar a escribir y lo descarta al elegir.
 *
 * -----------------------------------------------------------------------------
 * SOLO CHILE
 * -----------------------------------------------------------------------------
 * Decisión del usuario (23-08-2026): las sugerencias se restringen a Chile, no
 * se sesgan hacia Chile. Son cosas distintas y el puerto lo impone —el
 * adaptador no elige—: un courier de Santiago que ve «Providencia, Buenos
 * Aires» en la lista tiene una forma nueva de equivocarse, y el error solo se
 * descubre cuando el conductor ya salió.
 */

import { ErrorGeocodingConfig } from "./errores";
import { AutocompletadoGoogle } from "./adaptadores/autocompletado-google";
import { AutocompletadoStub } from "./adaptadores/autocompletado-stub";

export interface SugerenciaDireccion {
  /**
   * Identificador opaco del proveedor. **No se guarda en la base**: sirve solo
   * para pedir el detalle dentro de la misma sesión de tecleo.
   */
  id: string;
  /** La línea principal: «Av. Providencia 1234». */
  principal: string;
  /** La línea de contexto: «Providencia, Región Metropolitana, Chile». */
  secundaria: string;
}

export interface DireccionResuelta {
  /**
   * La dirección completa tal como la escribe el proveedor, con comuna, región
   * y país. **No es lo que se muestra**: se conserva porque es el dato crudo y
   * porque sirve de respaldo cuando no se puede componer la corta.
   */
  direccion: string;
  /**
   * 🔴 **Solo calle y número** — «Los Militares 5001», sin código postal, sin
   * comuna, sin región y sin país. Es lo que va al campo (encargo del usuario,
   * 26-08-2026).
   *
   * No es un recorte cosmético del texto largo: se COMPONE de los componentes
   * estructurados que devuelve el proveedor (`route` + `street_number`).
   * Recortar por comas sería adivinar — «Av. Pdte. Riesco 5335, Las Condes» y
   * «Camino El Alba, Km 2, Lo Barnechea» no tienen la misma forma, y el día que
   * fallara lo haría guardando media dirección.
   *
   * `null` cuando el proveedor no entrega calle —un lugar con nombre propio,
   * «Mall Parque Arauco»—. Ahí decide quien llama: la lista ya mostraba la
   * línea principal, que es exactamente esto.
   *
   * ⚠️ Perder la comuna del texto NO pierde el dato: viaja en `comuna` y se
   * guarda en su propia columna. El job de geocoding recibe dirección y comuna
   * por separado, así que sigue resolviendo igual.
   */
  direccionCorta: string | null;
  /** La comuna, cuando el proveedor la entrega. Es lo que llena el campo. */
  comuna: string | null;
  lat: number | null;
  long: number | null;
}

export interface PuertoAutocompletadoDireccion {
  /**
   * Sugerencias para lo que se lleva escrito. Devuelve lista vacía —nunca
   * lanza— cuando no hay nada que proponer: escribir «xyz» no es un error.
   */
  sugerir(args: { consulta: string; sesion: string }): Promise<SugerenciaDireccion[]>;

  /**
   * El detalle de una sugerencia elegida: dirección normalizada, comuna y
   * coordenada. `null` si el proveedor ya no la reconoce.
   */
  resolver(args: { id: string; sesion: string }): Promise<DireccionResuelta | null>;
}

/**
 * Elige el adaptador con las MISMAS variables que el geocoding, a propósito: si
 * alguien apaga el proveedor real para no gastar, se apagan los dos y no queda
 * la mitad del formulario llamando a Google.
 *
 * ⚠️ Con `GEOCODING_PROVIDER=google`, la llave necesita **Places API (New)**
 * habilitada además de Geocoding. Son dos productos y se habilitan por
 * separado en la consola de Google Cloud; si falta, el adaptador devuelve lista
 * vacía y el campo sigue aceptando texto libre, que es el modo degradado
 * declarado.
 */
export function obtenerPuertoAutocompletado(): PuertoAutocompletadoDireccion {
  const proveedor = (process.env.GEOCODING_PROVIDER ?? "stub").trim().toLowerCase();

  switch (proveedor) {
    case "stub":
    case "":
      return new AutocompletadoStub();

    case "google": {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey || apiKey.trim() === "") {
        throw new ErrorGeocodingConfig(
          "GEOCODING_PROVIDER=google requiere GOOGLE_MAPS_API_KEY; no está definida",
        );
      }
      return new AutocompletadoGoogle(apiKey);
    }

    default:
      throw new ErrorGeocodingConfig(
        `GEOCODING_PROVIDER='${proveedor}' no es un proveedor conocido (stub | google)`,
      );
  }
}
