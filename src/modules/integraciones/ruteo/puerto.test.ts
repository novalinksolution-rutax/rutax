/**
 * Pruebas de la fábrica del puerto de ruteo.
 * =====================================================================
 * Mismo molde que `integraciones/contexto/puertos.test.ts`: el default nunca
 * sale a la red por descuido, un proveedor desconocido falla ruidoso, y el
 * error de configuración no filtra nada sensible.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { obtenerPuertoMatriz } from './puerto';
import { HaversineMatrizAdapter } from './adaptadores/haversine';
import { ErrorRuteoConfig } from './errores';

afterEach(() => {
  delete process.env.RUTEO_MATRIZ_PROVIDER;
});

describe('default = haversine', () => {
  it('sin variable de entorno, devuelve el adaptador haversine', () => {
    delete process.env.RUTEO_MATRIZ_PROVIDER;
    expect(obtenerPuertoMatriz()).toBeInstanceOf(HaversineMatrizAdapter);
  });

  it('el valor explícito "haversine" también funciona, y no distingue mayúsculas ni espacios', () => {
    process.env.RUTEO_MATRIZ_PROVIDER = '  HAVERSINE  ';
    expect(obtenerPuertoMatriz()).toBeInstanceOf(HaversineMatrizAdapter);
  });

  it('una cadena vacía se trata igual que "ausente"', () => {
    process.env.RUTEO_MATRIZ_PROVIDER = '';
    expect(obtenerPuertoMatriz()).toBeInstanceOf(HaversineMatrizAdapter);
  });
});

describe('configuración inválida', () => {
  it('un proveedor desconocido lanza ErrorRuteoConfig', () => {
    process.env.RUTEO_MATRIZ_PROVIDER = 'google-route-matrix';
    expect(() => obtenerPuertoMatriz()).toThrow(ErrorRuteoConfig);
  });

  it('el mensaje de error cita el valor recibido, sin inventar nada más', () => {
    process.env.RUTEO_MATRIZ_PROVIDER = 'inventado';
    expect(() => obtenerPuertoMatriz()).toThrow(/inventado/);
  });
});
