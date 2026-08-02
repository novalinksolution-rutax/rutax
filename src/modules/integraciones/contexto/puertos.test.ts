/**
 * Pruebas de las TRES fábricas de puerto.
 * =====================================================================
 *
 * Lo que se protege:
 *   · el default es SIEMPRE el stub (dev/CI nunca sale a la red por accidente),
 *   · un valor de entorno desconocido falla ruidosamente en vez de caer en un
 *     adaptador silenciosamente equivocado,
 *   · el error de configuración NO filtra el valor de ninguna credencial,
 *   · y el llamador puede convertir ese error en degradación sin tumbar el job.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { obtenerPuertoClima } from './clima/puerto';
import { obtenerPuertoAire } from './aire/puerto';
import { obtenerPuertoCalendario } from './calendario/puerto';
import { ErrorContextoConfig } from './errores';
import { degradarDesdeError } from './resultado';

const CLAVES = [
  'CONTEXTO_CLIMA_PROVIDER',
  'CONTEXTO_AIRE_PROVIDER',
  'CONTEXTO_CALENDARIO_PROVIDER',
  'OPEN_METEO_API_KEY',
  'OPEN_METEO_CLIMA_BASE_URL',
  'OPEN_METEO_AIRE_BASE_URL',
  'BOOSTR_BASE_URL',
] as const;

afterEach(() => {
  for (const k of CLAVES) delete process.env[k];
});

describe('default = stub (nada de red en dev/CI por descuido)', () => {
  it('sin variable, los tres puertos devuelven el stub', async () => {
    // Se verifica por el `proveedor` del resultado, no por instanceof: el
    // consumidor solo conoce la interfaz.
    const clima = await obtenerPuertoClima().obtenerPronostico({
      comunas: ['Santiago'],
      dias: 1,
    });
    const aire = await obtenerPuertoAire().obtenerPronostico({
      comunas: ['Santiago'],
      dias: 1,
    });
    const cal = await obtenerPuertoCalendario().obtenerFeriados({ anios: [2026] });

    if (!clima.ok || !aire.ok || !cal.ok) throw new Error('esperaba éxito');
    expect(clima.datos.proveedor).toBe('stub');
    expect(aire.datos.proveedor).toBe('stub');
    expect(cal.datos.proveedor).toBe('stub');
  });

  it('el valor explícito "stub" también funciona, y no distingue mayúsculas', () => {
    process.env.CONTEXTO_CLIMA_PROVIDER = ' STUB ';
    expect(() => obtenerPuertoClima()).not.toThrow();
  });
});

describe('selección del adaptador real', () => {
  // La fábrica CONSTRUYE sin credenciales a propósito: la clave se exige al
  // hacer la llamada, no al instanciar. Así un despliegue sin `OPENWEATHER_API_KEY`
  // degrada la capa de clima con un motivo legible en vez de tumbar el arranque
  // del job entero.
  it('openweather construye el adaptador real de clima sin exigir credenciales', () => {
    process.env.CONTEXTO_CLIMA_PROVIDER = 'openweather';
    expect(() => obtenerPuertoClima()).not.toThrow();
  });

  it('openweather construye el adaptador real de aire sin exigir credenciales', () => {
    process.env.CONTEXTO_AIRE_PROVIDER = 'openweather';
    expect(() => obtenerPuertoAire()).not.toThrow();
  });

  it('open-meteo YA NO se acepta: su tier libre prohíbe el uso comercial', () => {
    process.env.CONTEXTO_CLIMA_PROVIDER = 'open-meteo';
    expect(() => obtenerPuertoClima()).toThrow(ErrorContextoConfig);
    process.env.CONTEXTO_AIRE_PROVIDER = 'open-meteo';
    expect(() => obtenerPuertoAire()).toThrow(ErrorContextoConfig);
  });

  it('boostr construye el adaptador real de feriados sin exigir credenciales', () => {
    process.env.CONTEXTO_CALENDARIO_PROVIDER = 'boostr';
    expect(() => obtenerPuertoCalendario()).not.toThrow();
  });
});

describe('configuración inválida', () => {
  it('un proveedor desconocido lanza ErrorContextoConfig en los tres puertos', () => {
    process.env.CONTEXTO_CLIMA_PROVIDER = 'accuweather';
    expect(() => obtenerPuertoClima()).toThrow(ErrorContextoConfig);

    process.env.CONTEXTO_AIRE_PROVIDER = 'purpleair';
    expect(() => obtenerPuertoAire()).toThrow(ErrorContextoConfig);

    process.env.CONTEXTO_CALENDARIO_PROVIDER = 'apis-digital-gob-cl';
    expect(() => obtenerPuertoCalendario()).toThrow(ErrorContextoConfig);
  });

  it('el mensaje de error NO incluye el valor de una credencial', () => {
    process.env.CONTEXTO_CLIMA_PROVIDER = 'inventado';
    process.env.OPEN_METEO_API_KEY = 'CLAVE-SUPER-SECRETA';

    try {
      obtenerPuertoClima();
      throw new Error('debió lanzar');
    } catch (e) {
      expect((e as Error).message).not.toContain('CLAVE-SUPER-SECRETA');
      expect((e as Error).message).toContain('inventado');
    }
  });

  it('el llamador puede degradar el error de configuración sin tumbar el job', () => {
    process.env.CONTEXTO_AIRE_PROVIDER = 'inventado';

    // Este es el patrón que usará A4.
    let resultado;
    try {
      obtenerPuertoAire();
      resultado = null;
    } catch (e) {
      resultado = degradarDesdeError(e, 'calidad del aire');
    }

    expect(resultado).not.toBeNull();
    expect(resultado!.ok).toBe(false);
    expect(resultado!.reintentable).toBe(false);
    expect(resultado!.motivo).toContain('calidad del aire');
  });
});
