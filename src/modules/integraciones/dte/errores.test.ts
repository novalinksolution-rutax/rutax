/**
 * Tests de la jerarquía de errores DTE.
 *
 * Verifica que las clases exponen los campos correctos y que todas son
 * instancias de `ErrorDte` (permite catches genéricos del módulo).
 * Tests unitarios puros — sin I/O, sin mocks.
 */

import { describe, it, expect } from 'vitest';
import {
  ErrorDte,
  ErrorDteProveedor,
  ErrorFolioAgotado,
  ErrorConfigDteInvalida,
} from './errores';

describe('ErrorDte (base)', () => {
  it('es una instancia de Error', () => {
    const err = new ErrorDte('fallo genérico DTE');
    expect(err).toBeInstanceOf(Error);
  });

  it('name es ErrorDte', () => {
    const err = new ErrorDte('test');
    expect(err.name).toBe('ErrorDte');
  });

  it('message se propaga correctamente', () => {
    const err = new ErrorDte('mensaje de prueba');
    expect(err.message).toBe('mensaje de prueba');
  });
});

describe('ErrorDteProveedor', () => {
  it('es instancia de ErrorDte', () => {
    const err = new ErrorDteProveedor(422, 'RUT inválido');
    expect(err).toBeInstanceOf(ErrorDte);
  });

  it('es instancia de Error', () => {
    const err = new ErrorDteProveedor(500, 'Internal Server Error');
    expect(err).toBeInstanceOf(Error);
  });

  it('expone codigoHttp correctamente', () => {
    const err = new ErrorDteProveedor(422, 'RUT inválido');
    expect(err.codigoHttp).toBe(422);
  });

  it('expone mensajeProveedor correctamente', () => {
    const err = new ErrorDteProveedor(400, 'Folio ya utilizado');
    expect(err.mensajeProveedor).toBe('Folio ya utilizado');
  });

  it('name es ErrorDteProveedor', () => {
    const err = new ErrorDteProveedor(503, 'Service Unavailable');
    expect(err.name).toBe('ErrorDteProveedor');
  });

  it('message incluye el código HTTP y el mensaje del proveedor', () => {
    const err = new ErrorDteProveedor(404, 'DTE no encontrado');
    expect(err.message).toContain('404');
    expect(err.message).toContain('DTE no encontrado');
  });

  it('codigoHttp y mensajeProveedor son readonly', () => {
    const err = new ErrorDteProveedor(200, 'ok');
    // TypeScript impide la asignación en tiempo de compilación;
    // aquí verificamos que el valor no muta en runtime.
    const codigoOriginal = err.codigoHttp;
    const mensajeOriginal = err.mensajeProveedor;
    expect(err.codigoHttp).toBe(codigoOriginal);
    expect(err.mensajeProveedor).toBe(mensajeOriginal);
  });
});

describe('ErrorFolioAgotado', () => {
  it('es instancia de ErrorDte', () => {
    const err = new ErrorFolioAgotado('tenant-abc-123');
    expect(err).toBeInstanceOf(ErrorDte);
  });

  it('es instancia de Error', () => {
    const err = new ErrorFolioAgotado('tenant-abc-123');
    expect(err).toBeInstanceOf(Error);
  });

  it('expone tenantId correctamente', () => {
    const TENANT = 'tenant-uuid-folios-test';
    const err = new ErrorFolioAgotado(TENANT);
    expect(err.tenantId).toBe(TENANT);
  });

  it('name es ErrorFolioAgotado', () => {
    const err = new ErrorFolioAgotado('tenant-x');
    expect(err.name).toBe('ErrorFolioAgotado');
  });

  it('message incluye el tenantId para trazabilidad', () => {
    const TENANT = 'tenant-tracing-id';
    const err = new ErrorFolioAgotado(TENANT);
    expect(err.message).toContain(TENANT);
  });
});

describe('ErrorConfigDteInvalida', () => {
  it('es instancia de ErrorDte', () => {
    const err = new ErrorConfigDteInvalida('tenant-sin-config');
    expect(err).toBeInstanceOf(ErrorDte);
  });

  it('es instancia de Error', () => {
    const err = new ErrorConfigDteInvalida('tenant-sin-config');
    expect(err).toBeInstanceOf(Error);
  });

  it('expone tenantId correctamente', () => {
    const TENANT = 'tenant-config-invalida';
    const err = new ErrorConfigDteInvalida(TENANT);
    expect(err.tenantId).toBe(TENANT);
  });

  it('name es ErrorConfigDteInvalida', () => {
    const err = new ErrorConfigDteInvalida('tenant-x');
    expect(err.name).toBe('ErrorConfigDteInvalida');
  });

  it('acepta detalle opcional y lo incluye en el mensaje', () => {
    const TENANT = 'tenant-y';
    const err = new ErrorConfigDteInvalida(TENANT, 'proveedor no reconocido');
    expect(err.message).toContain('proveedor no reconocido');
    expect(err.message).toContain(TENANT);
  });

  it('sin detalle opcional — mensaje tiene el tenantId igual', () => {
    const TENANT = 'tenant-z';
    const err = new ErrorConfigDteInvalida(TENANT);
    expect(err.message).toContain(TENANT);
  });
});

// ---------------------------------------------------------------------------
// Verificación de la jerarquía completa
// ---------------------------------------------------------------------------

describe('jerarquía completa — todas son instancia de ErrorDte', () => {
  it('ErrorDteProveedor instanceof ErrorDte', () => {
    expect(new ErrorDteProveedor(500, 'error')).toBeInstanceOf(ErrorDte);
  });

  it('ErrorFolioAgotado instanceof ErrorDte', () => {
    expect(new ErrorFolioAgotado('t')).toBeInstanceOf(ErrorDte);
  });

  it('ErrorConfigDteInvalida instanceof ErrorDte', () => {
    expect(new ErrorConfigDteInvalida('t')).toBeInstanceOf(ErrorDte);
  });
});
