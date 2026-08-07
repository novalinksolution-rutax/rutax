/**
 * Pruebas de la fábrica del puerto de calendario.
 * =====================================================================
 *
 * Eran tres puertos (clima, aire, calendario). Los de clima y aire se retiraron
 * con el rediseño v2 de la Torre, que sacó esas dos capas del producto entero
 * (`docs/torre-de-control/alcance-v2.md` §3). Queda el calendario, que alimenta
 * las olas comerciales.
 *
 * Lo que se protege:
 *   · el default es SIEMPRE el stub (dev/CI nunca sale a la red por accidente),
 *   · un valor de entorno desconocido falla ruidosamente en vez de caer en un
 *     adaptador silenciosamente equivocado,
 *   · el error de configuración NO filtra el valor de ninguna credencial,
 *   · y el llamador puede convertir ese error en degradación sin tumbar el job.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { obtenerPuertoCalendario } from './calendario/puerto';
import { ErrorContextoConfig } from './errores';
import { degradarDesdeError } from './resultado';

const CLAVES = ['CONTEXTO_CALENDARIO_PROVIDER', 'BOOSTR_BASE_URL', 'BOOSTR_API_KEY'] as const;

afterEach(() => {
  for (const k of CLAVES) delete process.env[k];
});

describe('default = stub (nada de red en dev/CI por descuido)', () => {
  it('sin variable, el puerto devuelve el stub', async () => {
    // Se verifica por el `proveedor` del resultado, no por instanceof: el
    // consumidor solo conoce la interfaz.
    const cal = await obtenerPuertoCalendario().obtenerFeriados({ anios: [2026] });

    if (!cal.ok) throw new Error('esperaba éxito');
    expect(cal.datos.proveedor).toBe('stub');
  });

  it('el valor explícito "stub" también funciona, y no distingue mayúsculas', () => {
    process.env.CONTEXTO_CALENDARIO_PROVIDER = ' STUB ';
    expect(() => obtenerPuertoCalendario()).not.toThrow();
  });
});

describe('selección del adaptador real', () => {
  // La fábrica CONSTRUYE sin credenciales a propósito: la clave se exige al
  // hacer la llamada, no al instanciar. Así un despliegue sin credencial degrada
  // la capa con un motivo legible en vez de tumbar el arranque del job entero.
  it('boostr construye el adaptador real de feriados sin exigir credenciales', () => {
    process.env.CONTEXTO_CALENDARIO_PROVIDER = 'boostr';
    expect(() => obtenerPuertoCalendario()).not.toThrow();
  });
});

describe('configuración inválida', () => {
  it('un proveedor desconocido lanza ErrorContextoConfig', () => {
    process.env.CONTEXTO_CALENDARIO_PROVIDER = 'apis-digital-gob-cl';
    expect(() => obtenerPuertoCalendario()).toThrow(ErrorContextoConfig);
  });

  it('el mensaje de error NO incluye el valor de una credencial', () => {
    process.env.CONTEXTO_CALENDARIO_PROVIDER = 'inventado';
    process.env.BOOSTR_API_KEY = 'CLAVE-SUPER-SECRETA';

    try {
      obtenerPuertoCalendario();
      throw new Error('debió lanzar');
    } catch (e) {
      expect((e as Error).message).not.toContain('CLAVE-SUPER-SECRETA');
      expect((e as Error).message).toContain('inventado');
    }
  });

  it('el llamador puede degradar el error de configuración sin tumbar el job', () => {
    process.env.CONTEXTO_CALENDARIO_PROVIDER = 'inventado';

    let resultado;
    try {
      obtenerPuertoCalendario();
      resultado = null;
    } catch (e) {
      resultado = degradarDesdeError(e, 'calendario de feriados');
    }

    expect(resultado).not.toBeNull();
    expect(resultado!.ok).toBe(false);
    expect(resultado!.reintentable).toBe(false);
    expect(resultado!.motivo).toContain('calendario de feriados');
  });
});
