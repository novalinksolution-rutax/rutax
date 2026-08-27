/**
 * Pruebas de la credencial de Google para el ruteo.
 * =====================================================================
 *
 * Todo este archivo existe por un error que no dice nada:
 * `error:1E08010C:DECODER routines::unsupported`. Es lo único que devuelve
 * OpenSSL cuando el PEM no se puede decodificar, y no distingue entre «tiene
 * comillas», «los saltos vienen escapados» o «esto no es una clave». Apareció
 * en producción el 2026-08-27 al calcular la primera ruta real, y la causa fue
 * la más tonta: la clave copiada del JSON con las comillas que la envuelven.
 */

import { describe, expect, it } from 'vitest';

import { normalizarClavePem } from './google-credenciales';

/** Un PEM de juguete. No es una clave: solo tiene que conservar su forma. */
const CUERPO = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC';
const PEM = `-----BEGIN PRIVATE KEY-----\n${CUERPO}\n-----END PRIVATE KEY-----\n`;

describe('normalizarClavePem', () => {
  it('deja intacta una clave que ya viene bien', () => {
    expect(normalizarClavePem(PEM)).toBe(PEM);
  });

  it('quita las comillas dobles que se copian del JSON — la causa real', () => {
    expect(normalizarClavePem(`"${PEM.trimEnd()}"`)).toBe(PEM);
  });

  it('quita comillas simples', () => {
    expect(normalizarClavePem(`'${PEM.trimEnd()}'`)).toBe(PEM);
  });

  it('convierte los \\n escapados que produce pegar en un panel', () => {
    const escapada = `-----BEGIN PRIVATE KEY-----\\n${CUERPO}\\n-----END PRIVATE KEY-----`;
    expect(normalizarClavePem(escapada)).toBe(PEM);
  });

  it('aguanta el caso combinado: comillas Y saltos escapados', () => {
    const fea = `"-----BEGIN PRIVATE KEY-----\\n${CUERPO}\\n-----END PRIVATE KEY-----\\n"`;
    expect(normalizarClavePem(fea)).toBe(PEM);
  });

  it('normaliza los CRLF de un editor de Windows', () => {
    const crlf = `-----BEGIN PRIVATE KEY-----\r\n${CUERPO}\r\n-----END PRIVATE KEY-----\r\n`;
    expect(normalizarClavePem(crlf)).toBe(PEM);
  });

  it('agrega el salto final que OpenSSL espera tras el END', () => {
    expect(normalizarClavePem(PEM.trimEnd())).toBe(PEM);
    expect(normalizarClavePem(PEM.trimEnd()).endsWith('-----\n')).toBe(true);
  });

  it('no inventa una clave donde no la hay: sin BEGIN sigue sin BEGIN', () => {
    // El llamador es quien rechaza esto; acá solo se comprueba que la
    // normalización no lo disfrace de PEM válido.
    expect(normalizarClavePem('"no soy una clave"')).toBe('no soy una clave\n');
  });
});
