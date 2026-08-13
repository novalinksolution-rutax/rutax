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

  it('redacta las llaves del retiro en bodega (QR de Flex): hash_code, qr_payload, qr, codigo_bulto, security_digit, codigo_crudo — snake_case y camelCase', () => {
    const entrada = {
      hash_code: 'fwH77GO2qbT3SrRS/UKb14MN2s5JA3AhWG4Pen/l6WY=',
      hashCode: 'fwH77GO2qbT3SrRS/UKb14MN2s5JA3AhWG4Pen/l6WY=',
      qr_payload: '{"id":"44760788897"}',
      qrPayload: '{"id":"44760788897"}',
      qr: '{"id":"44760788897"}',
      codigo_bulto: 'RX-7K2M-9PQR',
      codigoBulto: 'RX-7K2M-9PQR',
      security_digit: '0',
      securityDigit: '0',
      codigo_crudo: 'un garabato ilegible',
      codigoCrudo: 'un garabato ilegible',
    };
    const salida = redactarSensible(entrada) as Record<string, unknown>;
    for (const k of Object.keys(entrada)) {
      expect(salida[k]).toBe(MARCA_REDACTADO);
    }
  });

  it('el payload real de la etiqueta Flex, logueado por error bajo la llave `codigo`, NO se redacta por FORMA — por eso el endpoint de escaneos nunca lo loguea', () => {
    // Documenta el motivo exacto por el que CLAUDE.md exige que el endpoint de
    // escaneos nunca loguee el body: el JSON crudo trae `{`, `"`, `:`, que caen
    // fuera de la clase de caracteres de PATRON_LLAVE_SENSIBLE, así que una
    // llave inocua como `codigo` NO dispara la redacción por llave. La defensa
    // real es no loguear el body en absoluto, no este helper.
    const payloadRealFlex =
      '{"id":"44760788897","sender_id":2114191787,"hash_code":"fwH77GO2qbT3SrRS/UKb14MN2s5JA3AhWG4Pen/l6WY=","security_digit":"0"}';
    const salida = redactarSensible({ codigo: payloadRealFlex }) as Record<string, unknown>;
    expect(salida.codigo).toBe(payloadRealFlex);
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
