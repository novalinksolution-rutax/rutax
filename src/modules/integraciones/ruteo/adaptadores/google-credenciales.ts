/**
 * Token de acceso de Google Cloud para el Route Optimization API.
 * =====================================================================
 *
 * =============================================================================
 * ESTE API NO ACEPTA UNA API KEY. NO BUSQUES EL PARÁMETRO: NO EXISTE
 * =============================================================================
 * Es la diferencia operativa más grande con el geocoding, que se autentica con
 * `GOOGLE_MAPS_API_KEY` y ya. `routeoptimization.googleapis.com` es un API de
 * Google **Cloud**, no de Maps clásico: exige OAuth con scope
 * `https://www.googleapis.com/auth/cloud-platform` y el permiso IAM
 * `routeoptimization.locations.use`.
 *
 * O sea: hace falta una **cuenta de servicio** creada en el proyecto de Google
 * Cloud, con su clave privada. No se puede reusar la key del geocoding.
 *
 * =============================================================================
 * POR QUÉ ESTO SE ESCRIBE A MANO Y NO CON `google-auth-library`
 * =============================================================================
 * El flujo `jwt-bearer` de servicio son cuarenta líneas de `node:crypto` y está
 * completamente especificado (RFC 7523). La alternativa arrastra un árbol de
 * dependencias grande para un solo POST, y este repo mantiene la lista de
 * dependencias corta a propósito. Además el proyecto ya hace su propio OAuth en
 * el adaptador de Mercado Libre: es el idioma de la casa, no una excepción.
 *
 * =============================================================================
 * LA TRAMPA DE LA CLAVE PRIVADA EN UNA VARIABLE DE ENTORNO
 * =============================================================================
 * El JSON de la cuenta de servicio trae la clave PEM con saltos de línea
 * REALES. Al pegarla en Vercel se convierten en la secuencia de dos caracteres
 * `\` + `n`, y `crypto.sign` falla con un error de OpenSSL que no dice nada
 * útil sobre la causa. Por eso se normaliza abajo. Es el fallo número uno de
 * esta integración y no se diagnostica solo.
 *
 * ⚠️ **La clave privada NUNCA se loguea, ni entera ni en fragmento, ni en el
 * mensaje de un error.** Los errores de acá nombran qué variable falta, jamás
 * su contenido.
 */

import { createSign } from 'node:crypto';

import { ErrorRuteoConfig, ErrorRuteoProveedor } from '../errores';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const URL_TOKEN = 'https://oauth2.googleapis.com/token';

/**
 * Un token de Google dura 3600 s. Se renueva a los 3300 para no llegar nunca
 * con uno recién vencido a una llamada que sale a las 15:59 — el margen es
 * barato y el fallo, caro.
 */
const VIDA_UTIL_S = 3300;

interface CredencialesServicio {
  clientEmail: string;
  privateKey: string;
}

/**
 * Caché de proceso. Vercel reusa la instancia entre invocaciones, así que en la
 * práctica una ruta del día pide el token una vez y las demás lo reusan.
 *
 * Deliberadamente NO es un caché compartido (Redis, tabla): un token de una
 * hora que se re-pide de vez en cuando no justifica infraestructura, y guardar
 * credenciales de plataforma en la base sería peor.
 */
let tokenEnCache: { valor: string; expiraEn: number } | null = null;

function leerCredenciales(): CredencialesServicio {
  const clientEmail = process.env.GOOGLE_RUTEO_CLIENT_EMAIL?.trim();
  const privateKeyCruda = process.env.GOOGLE_RUTEO_PRIVATE_KEY;

  if (!clientEmail) {
    throw new ErrorRuteoConfig('falta GOOGLE_RUTEO_CLIENT_EMAIL');
  }
  if (!privateKeyCruda) {
    throw new ErrorRuteoConfig('falta GOOGLE_RUTEO_PRIVATE_KEY');
  }

  // Ver la cabecera: la clave pegada en un panel trae `\n` de dos caracteres.
  const privateKey = privateKeyCruda.includes('\\n')
    ? privateKeyCruda.replace(/\\n/g, '\n')
    : privateKeyCruda;

  if (!privateKey.includes('BEGIN')) {
    // Sin exponer un solo carácter de la clave.
    throw new ErrorRuteoConfig(
      'GOOGLE_RUTEO_PRIVATE_KEY no parece una clave PEM (no contiene la cabecera BEGIN)',
    );
  }

  return { clientEmail, privateKey };
}

/** El id del proyecto de Google Cloud, que va en la ruta del endpoint. */
export function leerProyectoGoogle(): string {
  const proyecto = process.env.GOOGLE_RUTEO_PROJECT_ID?.trim();
  if (!proyecto) {
    throw new ErrorRuteoConfig('falta GOOGLE_RUTEO_PROJECT_ID');
  }
  return proyecto;
}

function base64Url(entrada: string | Buffer): string {
  return Buffer.from(entrada)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Firma el JWT de portador de la cuenta de servicio (RFC 7523).
 *
 * `ahoraS` entra como parámetro para que las pruebas no dependan del reloj.
 */
export function firmarJwtServicio(
  credenciales: CredencialesServicio,
  ahoraS: number,
): string {
  const cabecera = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const cuerpo = base64Url(
    JSON.stringify({
      iss: credenciales.clientEmail,
      scope: SCOPE,
      aud: URL_TOKEN,
      iat: ahoraS,
      exp: ahoraS + 3600,
    }),
  );

  const firmador = createSign('RSA-SHA256');
  firmador.update(`${cabecera}.${cuerpo}`);
  const firma = base64Url(firmador.sign(credenciales.privateKey));

  return `${cabecera}.${cuerpo}.${firma}`;
}

/**
 * Devuelve un token de acceso válido, reusando el del caché si le queda vida.
 *
 * Lanza `ErrorRuteoConfig` (no reintentable) si falta configuración, y
 * `ErrorRuteoProveedor` (reintentable) si Google no responde o rechaza.
 */
export async function obtenerTokenAcceso(
  ahoraMs: number = Date.now(),
): Promise<string> {
  if (tokenEnCache && tokenEnCache.expiraEn > ahoraMs) {
    return tokenEnCache.valor;
  }

  const credenciales = leerCredenciales();
  const ahoraS = Math.floor(ahoraMs / 1000);
  const jwt = firmarJwtServicio(credenciales, ahoraS);

  let respuesta: Response;
  try {
    respuesta = await fetch(URL_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });
  } catch (causa) {
    throw new ErrorRuteoProveedor(
      `no se pudo contactar el servicio de tokens (${causa instanceof Error ? causa.name : 'error de red'})`,
    );
  }

  if (!respuesta.ok) {
    // Un 400 acá casi siempre es la clave mal pegada o el reloj desfasado, y
    // NO se arregla reintentando. Un 5xx sí.
    const reintentable = respuesta.status >= 500 || respuesta.status === 429;
    throw new ErrorRuteoProveedor(
      `el servicio de tokens respondió ${respuesta.status}`,
      reintentable,
    );
  }

  const datos = (await respuesta.json()) as { access_token?: unknown };
  if (typeof datos.access_token !== 'string' || datos.access_token.length === 0) {
    throw new ErrorRuteoProveedor('el servicio de tokens no devolvió access_token');
  }

  tokenEnCache = {
    valor: datos.access_token,
    expiraEn: ahoraMs + VIDA_UTIL_S * 1000,
  };
  return tokenEnCache.valor;
}

/** Solo para pruebas: vacía el caché de proceso. */
export function _vaciarCacheToken(): void {
  tokenEnCache = null;
}
