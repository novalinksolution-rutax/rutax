/**
 * Tests de las funciones puras de telemetría de jobs (QW3).
 *
 * Cubren el saneo de lo que se persiste en `infra.ejecuciones_job`: redacción
 * de secretos/PII, acotado de tamaño del resumen, y la lectura defensiva del id
 * del job. La escritura por RPC (`registrarTelemetriaRun`) no se prueba aquí —
 * es I/O y nunca lanza por diseño.
 */

import { describe, it, expect } from 'vitest';
import {
  acotarResumen,
  mensajeErrorTelemetria,
  leerIdJob,
  RESUMEN_MAX_CHARS,
} from './telemetria-jobs';
import { MARCA_REDACTADO } from '@/lib/observabilidad/redaccion';

describe('acotarResumen', () => {
  it('conserva un resumen de conteos (objeto normal)', () => {
    const salida = acotarResumen({ cerrados: 3, errores: 0 }) as Record<string, unknown>;
    expect(salida).toEqual({ cerrados: 3, errores: 0 });
  });

  it('envuelve primitivos en { valor } para que el jsonb sea navegable', () => {
    expect(acotarResumen('sin_periodos')).toEqual({ valor: 'sin_periodos' });
    expect(acotarResumen(42)).toEqual({ valor: 42 });
  });

  it('redacta llaves sensibles del output (nunca tokens/PII en el tablero)', () => {
    const salida = acotarResumen({ ok: true, access_token: 'abc123', email: 'a@b.cl' }) as Record<
      string,
      unknown
    >;
    expect(salida.ok).toBe(true);
    expect(salida.access_token).toBe(MARCA_REDACTADO);
    expect(salida.email).toBe(MARCA_REDACTADO);
  });

  it('acota un resumen demasiado grande a un marcador de truncado', () => {
    // 100 frases largas (no-secretas, bajo el tope por-string) superan el cap total.
    const items = Array.from({ length: 100 }, () =>
      'una frase de prueba con varias palabras reales para ocupar espacio '.repeat(2),
    );
    const salida = acotarResumen({ items }) as Record<string, unknown>;
    expect(salida.truncado).toBe(true);
    expect(typeof salida.tamano).toBe('number');
    expect(salida.tamano as number).toBeGreaterThan(RESUMEN_MAX_CHARS);
  });
});

describe('mensajeErrorTelemetria', () => {
  it('extrae el mensaje de un Error', () => {
    expect(mensajeErrorTelemetria(new Error('algo falló'))).toBe('algo falló');
  });

  it('acepta strings y otros valores', () => {
    expect(mensajeErrorTelemetria('texto crudo')).toBe('texto crudo');
    expect(typeof mensajeErrorTelemetria({ x: 1 })).toBe('string');
  });

  it('redacta un mensaje con forma de secreto (defensa en profundidad)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123456';
    expect(mensajeErrorTelemetria(jwt)).toBe(MARCA_REDACTADO);
  });
});

describe('leerIdJob', () => {
  it('usa fn.id() cuando existe', () => {
    expect(leerIdJob({ id: () => 'dinero/cerrarPeriodo' })).toBe('dinero/cerrarPeriodo');
  });

  it('cae a fn.name si no hay id()', () => {
    expect(leerIdJob({ name: 'Un Job' })).toBe('Un Job');
  });

  it('devuelve "desconocido" si no puede resolver el id', () => {
    expect(leerIdJob({})).toBe('desconocido');
    expect(
      leerIdJob({
        id: () => {
          throw new Error('boom');
        },
      }),
    ).toBe('desconocido');
  });
});
