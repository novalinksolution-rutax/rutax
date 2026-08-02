/**
 * Adaptador STUB de CALIDAD DEL AIRE — determinista, sin red.
 * =====================================================================
 *
 * Por defecto en dev/test/CI (`CONTEXTO_AIRE_PROVIDER=stub`).
 *
 * Genera una serie de PM2.5 con la forma que tiene de verdad el invierno en
 * Santiago —peak nocturno y de madrugada por inversión térmica, mínimo al
 * mediodía— y la pasa por EL MISMO clasificador que el adaptador real
 * (`clasificarSerie`, media móvil de 24 h). Esto importa: si el stub inventara
 * sus propios niveles, el CI validaría una lógica que no es la de producción.
 *
 * Determinista vía hash de (comuna, fecha, hora), igual que el stub de clima.
 * Zona horaria: siempre a través de los helpers de Santiago, nunca
 * `toISOString()`.
 */

import {
  ahoraEnSantiago,
  combinarFechaHoraSantiago,
  sumarDiasCalendario,
} from '@/lib/fecha-santiago';
import { puntosDeConsulta } from '../../open-meteo-comun';
import {
  exito,
  fallo,
  MOTIVOS_DEGRADACION,
  sanearParaMensaje,
  type ResultadoContexto,
} from '../../resultado';
import { clasificarSerie } from '../niveles';
import type { PuertoAire } from '../puerto';
import type {
  ParametrosAire,
  PronosticoAireHorario,
  PronosticoHoraAire,
} from '../tipos';

const DIAS_POR_DEFECTO = 3;

function hash(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function fraccion(semilla: string): number {
  return hash(semilla) / 0x100000000;
}

/**
 * Curva diaria típica de PM2.5 en Santiago: alto de noche y madrugada (capa de
 * inversión), bajo al mediodía. Multiplicador sobre la base de la comuna.
 */
function factorHorario(h: number): number {
  // Mínimo ~0,5 a las 15:00; máximo ~1,5 a las 03:00.
  return 1 + 0.5 * Math.cos(((h - 3) / 24) * 2 * Math.PI);
}

export class StubAireAdapter implements PuertoAire {
  /** Fecha base 'YYYY-MM-DD' de Santiago. Inyectable para fijar el día en tests. */
  constructor(private readonly fechaBase?: string) {}

  async obtenerPronostico(
    args: ParametrosAire = {},
  ): Promise<ResultadoContexto<PronosticoAireHorario>> {
    const dias = Math.max(args.dias ?? DIAS_POR_DEFECTO, 1);

    let comunas;
    try {
      comunas = puntosDeConsulta(args.comunas).map((p) => p.comuna);
    } catch (e) {
      return fallo(
        MOTIVOS_DEGRADACION.malConfigurada('calidad del aire'),
        sanearParaMensaje((e as Error).message),
        false,
      );
    }

    const base = this.fechaBase ?? ahoraEnSantiago().fecha;
    // Se arranca un día antes para tener las 24 h de historia que la ventana
    // móvil necesita, igual que `past_days=1` en el adaptador real.
    const inicio = sumarDiasCalendario(base, -1);
    const ahora = Date.now();
    const filas: PronosticoHoraAire[] = [];

    for (const comuna of comunas) {
      // Base por comuna estable: 25–75 µg/m³. Cruzada con el factor horario da
      // valores horarios de ~12 a ~110, que es el rango real del invierno.
      const baseComuna = 25 + fraccion(`base|${comuna}`) * 50;

      const marcas: Date[] = [];
      const pm25: Array<number | null> = [];
      const pm10: Array<number | null> = [];

      for (let d = 0; d <= dias; d += 1) {
        const fecha = sumarDiasCalendario(inicio, d);
        for (let h = 0; h < 24; h += 1) {
          const ruido = 0.85 + fraccion(`${comuna}|${fecha}|${h}`) * 0.3;
          const valor = baseComuna * factorHorario(h) * ruido;
          marcas.push(combinarFechaHoraSantiago(fecha, `${String(h).padStart(2, '0')}:00`));
          pm25.push(Math.round(valor * 10) / 10);
          // PM10 en Santiago corre por encima del PM2.5; ~1,6× es plausible.
          pm10.push(Math.round(valor * 16) / 10);
        }
      }

      // MISMO clasificador que producción — no una copia simplificada.
      const clasificada = clasificarSerie(pm25);

      // Las primeras 24 filas son HISTORIA (el equivalente de `past_days=1` del
      // adaptador real): no se descartan, porque el job las necesita para poder
      // recalcular la ventana móvil si algún día reprocesa.
      for (let i = 0; i < marcas.length; i += 1) {
        filas.push({
          comuna,
          hora: marcas[i],
          pm25: pm25[i],
          pm10: pm10[i],
          media24hPm25: clasificada[i].media24h,
          nivelEstimado: clasificada[i].nivel,
          esProyeccion: marcas[i].getTime() > ahora,
        });
      }
    }

    return exito({ proveedor: 'stub', horas: filas, comunasResueltas: comunas });
  }
}
