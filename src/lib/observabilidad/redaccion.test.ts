/**
 * Tests de redacción de datos sensibles. Puros, sin red ni BD.
 */

import { describe, it, expect } from 'vitest';
import { redactarSensible, MARCA_REDACTADO } from './redaccion';

describe('redactarSensible — redacción por llave', () => {
  it('redacta secretos y tokens por nombre de propiedad', () => {
    const entrada = {
      access_token: 'abc123',
      refreshToken: 'xyz',
      api_key: 'k',
      clave: 'p',
      firma: 'sig',
      link_token: 'lt',
      certificado: 'cert',
      cookie: 'c',
      authorization: 'Bearer x',
    };
    const salida = redactarSensible(entrada) as Record<string, unknown>;
    for (const k of Object.keys(entrada)) {
      expect(salida[k]).toBe(MARCA_REDACTADO);
    }
  });

  it('redacta PII directa: rut, email, teléfono, dirección, nombre del destinatario', () => {
    const entrada = {
      rut: '11111111-1',
      email: 'a@b.cl',
      telefono: '+56 9 1234 5678',
      direccion: 'Av. Siempreviva 742',
      nombre_destinatario: 'Juan Pérez',
    };
    const salida = redactarSensible(entrada) as Record<string, unknown>;
    expect(Object.values(salida).every((v) => v === MARCA_REDACTADO)).toBe(true);
  });

  it('preserva identificadores de negocio (no son secretos ni PII)', () => {
    const entrada = {
      tenantId: 't-1',
      pedidoId: 'p-9',
      sellerId: 's-3',
      montoClp: 15000,
      estado: 'entregado',
    };
    const salida = redactarSensible(entrada) as Record<string, unknown>;
    expect(salida).toEqual(entrada);
  });
});

describe('redactarSensible — redacción por valor y estructura', () => {
  it('redacta un JWT aunque la llave sea inocua', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcDEF123456';
    const salida = redactarSensible({ dato: jwt }) as Record<string, unknown>;
    expect(salida.dato).toBe(MARCA_REDACTADO);
  });

  it('redacta strings largos con forma de credencial base64/hex', () => {
    const largo = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0';
    const salida = redactarSensible({ dato: largo }) as Record<string, unknown>;
    expect(salida.dato).toBe(MARCA_REDACTADO);
  });

  it('recurre en objetos anidados y arreglos', () => {
    const entrada = { nivel1: { secret: 'x', ok: 'visible' }, lista: [{ token: 't' }] };
    const salida = redactarSensible(entrada) as {
      nivel1: Record<string, unknown>;
      lista: Array<Record<string, unknown>>;
    };
    expect(salida.nivel1.secret).toBe(MARCA_REDACTADO);
    expect(salida.nivel1.ok).toBe('visible');
    expect(salida.lista[0].token).toBe(MARCA_REDACTADO);
  });

  it('convierte Error en {name, message} sin arrastrar el stack como valor suelto', () => {
    const salida = redactarSensible(new Error('boom')) as Record<string, unknown>;
    expect(salida).toEqual({ name: 'Error', message: 'boom' });
  });

  it('no lanza ante null/undefined/primitivos', () => {
    expect(redactarSensible(null)).toBeNull();
    expect(redactarSensible(undefined)).toBeUndefined();
    expect(redactarSensible(42)).toBe(42);
    expect(redactarSensible(true)).toBe(true);
  });
});
