/**
 * Adaptador STUB de CLIMA — determinista, sin red.
 * =====================================================================
 *
 * Es el adaptador por defecto en dev/test/CI (`CONTEXTO_CLIMA_PROVIDER=stub`).
 * Cero costo, cero llamadas externas, cero dependencia de una API que un día
 * puede estar caída mientras alguien corre el CI.
 *
 * DETERMINISMO: los valores salen de un hash del par (comuna, hora), no de
 * `Math.random()`. Dos llamadas seguidas dentro del mismo día de Santiago dan
 * exactamente el mismo resultado — condición para que sirva en pruebas.
 *
 * PLAUSIBLE, NO REALISTA: el objetivo es que la Torre tenga algo que pintar y
 * que el motor de riesgo tenga algo que ponderar, no simular el clima. La
 * lluvia se concentra en unas pocas horas de la tarde para que la pantalla
 * muestre el caso interesante (§1 del diseño: "Lluvia 16–19 h sobre zona
 * Oriente…") en vez de un pronóstico plano.
 *
 * ZONA HORARIA: la serie arranca a las 00:00 del día CIVIL DE SANTIAGO, no de
 * UTC. Se construye con `ahoraEnSantiago()` + `combinarFechaHoraSantiago()` —
 * nunca `toISOString()`, que a partir de las 20:00 de Santiago daría el día
 * siguiente y el stub mostraría el clima del día equivocado. Ese es justamente
 * el bug que este módulo no se puede permitir, y también se prueba aquí.
 */

import {
  ahoraEnSantiago,
  combinarFechaHoraSantiago,
  sumarDiasCalendario,
} from '@/lib/fecha-santiago';
import { comunasDeConsulta } from '../../grilla-rm';
import { exito, fallo, MOTIVOS_DEGRADACION, sanearParaMensaje } from '../../resultado';
import type { ResultadoContexto } from '../../resultado';
import type { PuertoClima } from '../puerto';
import type {
  ParametrosClima,
  PronosticoClima,
  PronosticoHoraComuna,
} from '../tipos';

const DIAS_POR_DEFECTO = 3;

/**
 * Hash entero estable (FNV-1a de 32 bits) — mismo texto, mismo número, en
 * cualquier runtime y entre ejecuciones. No es criptográfico y no pretende
 * serlo: solo necesita ser reproducible.
 */
function hash(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Devuelve un número estable en [0, 1) a partir de una semilla textual. */
function fraccion(semilla: string): number {
  return hash(semilla) / 0x100000000;
}

export class StubClimaAdapter implements PuertoClima {
  /**
   * Fecha base 'YYYY-MM-DD' en calendario de Santiago. Inyectable para que las
   * pruebas fijen el día sin tocar el reloj del sistema.
   */
  constructor(private readonly fechaBase?: string) {}

  async obtenerPronostico(
    args: ParametrosClima = {},
  ): Promise<ResultadoContexto<PronosticoClima>> {
    const dias = Math.max(args.dias ?? DIAS_POR_DEFECTO, 1);

    let comunas;
    try {
      comunas = comunasDeConsulta(args.comunas);
    } catch (e) {
      return fallo(
        MOTIVOS_DEGRADACION.malConfigurada('clima'),
        sanearParaMensaje((e as Error).message),
        false,
      );
    }

    const base = this.fechaBase ?? ahoraEnSantiago().fecha;
    const horas: PronosticoHoraComuna[] = [];

    for (const comuna of comunas) {
      for (let d = 0; d < dias; d += 1) {
        const fecha = sumarDiasCalendario(base, d);
        for (let h = 0; h < 24; h += 1) {
          const semilla = `${comuna}|${fecha}|${h}`;
          const r = fraccion(semilla);

          // Ventana de lluvia concentrada en la tarde: es el escenario que la
          // pantalla necesita poder mostrar.
          const enVentanaDeLluvia = h >= 16 && h <= 19;
          const llueve = enVentanaDeLluvia && r > 0.55;

          horas.push({
            comuna,
            hora: combinarFechaHoraSantiago(fecha, `${String(h).padStart(2, '0')}:00`),
            precipitacionMm: llueve ? Math.round(r * 80) / 10 : 0,
            probPrecipitacion: enVentanaDeLluvia
              ? Math.round(r * 100)
              : Math.round(r * 20),
            // Viento 4–24 km/h; temperatura con curva diaria 8–22 °C.
            vientoKmh: Math.round((4 + r * 20) * 10) / 10,
            tempC:
              Math.round(
                (8 + 14 * Math.sin(((h - 6) / 24) * 2 * Math.PI) * 0.5 + 7 + r * 2) * 10,
              ) / 10,
          });
        }
      }
    }

    return exito({ proveedor: 'stub', horas, comunasResueltas: comunas });
  }
}
