/**
 * Pruebas del job C8 — la línea de liquidación por visita a bodega (etapa 8).
 *
 * Se prueba la FUNCIÓN REAL (`resolverMontoVisita`, exportada del job), no un
 * reflejo suyo escrito acá. La diferencia importa: un test que reimplementa la
 * lógica que dice probar sigue verde cuando el código de producción cambia, y
 * este repo ya se quemó con dobles que fingían APIs inexistentes.
 *
 * Lo que estas pruebas custodian es una regla de plata: **sin monto configurado
 * NO se escribe una línea de $0**. El 2026-08-15 se descubrió que
 * `identidad.tarifas.monto_conductor_clp` había nacido con `default 0`, que
 * ningún formulario la escribía, y que toda liquidación de producción se generó
 * en cero durante meses en silencio. Si alguna vez alguien "simplifica"
 * `resolverMontoVisita` para que devuelva 0 en vez de null, estos tests caen.
 */

import { describe, it, expect } from 'vitest';
import { resolverMontoVisita } from './generar-linea-retiro';

describe('resolverMontoVisita — de dónde sale cuánto vale una visita', () => {
  it('sin override y sin config del tenant → SIN CONFIGURAR, nunca cero', () => {
    const r = resolverMontoVisita(null, null);

    // El `null` es el punto entero de esta función: el job lo lee y levanta una
    // excepción bloqueante en vez de pagarle $0 al conductor.
    expect(r.montoClp).toBeNull();
    expect(r.origen).toBe('sin_configurar');
    expect(r.montoClp).not.toBe(0);
  });

  it('solo config del tenant → se usa esa, y queda dicho que vino del tenant', () => {
    const r = resolverMontoVisita(null, 3000);
    expect(r).toEqual({ montoClp: 3000, origen: 'tenant' });
  });

  it('el override de la bodega GANA sobre el del tenant', () => {
    // Una bodega en Lampa no vale lo mismo que una en Providencia: es la razón
    // de ser del override.
    const r = resolverMontoVisita(5000, 3000);
    expect(r).toEqual({ montoClp: 5000, origen: 'bodega' });
  });

  it('override sin config del tenant → igual funciona', () => {
    // El tenant puede no haber configurado nada general y aun así tener una
    // bodega con monto propio. No se cae al `sin_configurar`.
    const r = resolverMontoVisita(4200, null);
    expect(r).toEqual({ montoClp: 4200, origen: 'bodega' });
  });

  it('`undefined` se trata igual que `null` — es lo que devuelve una fila ausente', () => {
    expect(resolverMontoVisita(undefined, undefined).origen).toBe('sin_configurar');
    expect(resolverMontoVisita(undefined, 2500)).toEqual({ montoClp: 2500, origen: 'tenant' });
  });

  it('PostgREST devuelve numeric como STRING y no debe romper la aritmética', () => {
    // `numeric(12,0)` llega como '3000', no como 3000. Sin el `Number()` el
    // monto viajaría como texto hasta el INSERT.
    const r = resolverMontoVisita(null, '3000');
    expect(r.montoClp).toBe(3000);
    expect(typeof r.montoClp).toBe('number');
  });

  it('un 0 en el override NO cae al tenant: se respeta como valor presente', () => {
    // Los CHECK de la base prohíben el 0 en las dos columnas, así que hoy esto
    // no puede llegar. Se prueba igual porque la precedencia no debe depender
    // de una garantía que vive en otra capa: si el CHECK se relajara alguna vez,
    // un `if (override)` falsy haría que el 0 se leyera como "sin configurar" y
    // pagaría el monto del tenant sobre una bodega marcada como gratis.
    const r = resolverMontoVisita(0, 3000);
    expect(r).toEqual({ montoClp: 0, origen: 'bodega' });
  });

  it('redondea a peso entero — CLP no tiene decimales', () => {
    expect(resolverMontoVisita(null, 2999.6).montoClp).toBe(3000);
  });
});
