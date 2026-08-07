/**
 * Job `contexto/calendarioSincronizar` — feriados + restricción vehicular.
 * =====================================================================
 *
 * Cron mensual (día 1 a las 04:00). Es la fuente que menos cambia del módulo:
 * los feriados de Chile se fijan por ley con mucha anticipación.
 *
 * Hace dos cosas que conviene no confundir:
 *
 * 1. **Feriados → `contexto.calendario`.** Vienen del puerto (api.boostr.cl).
 *    Es una consulta externa y por tanto puede degradar.
 *
 * 2. **Restricción permanente → `contexto.restriccion_vehicular`.** NO se
 *    consulta a nadie: el calendario GEC por dígito es determinístico y se
 *    CALCULA. Por eso esta parte no puede "fallar por el proveedor" — solo
 *    depende de los feriados, y de forma explícita: la restricción no rige en
 *    feriados, así que si los feriados no se pudieron obtener, el cálculo
 *    marca `feriadosConsiderados: false` y este job propaga esa incertidumbre
 *    en vez de esconderla.
 *
 * Lo que este job NO hace, y es deliberado: la restricción EXTRAORDINARIA por
 * episodio (preemergencia/emergencia). Sus dígitos son fijados por decreto de
 * la autoridad y son, literalmente, aleatorios — no se derivan del feed ni del
 * titular de la noticia. Inventar un regex ahí dejaría fuera de ruta a
 * conductores que sí podían circular. Ese dato pertenece al pipeline de señales
 * (§13), donde un humano confirma.
 *
 * IDEMPOTENCIA: upsert por `(fecha, nombre)` en calendario y `(fecha, tipo)` en
 * restricción.
 */

import { inngest } from '@/lib/inngest/cliente';
import {
  obtenerPuertoCalendario,
  calcularRestriccionesEnRango,
} from '@/modules/integraciones/contexto';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { hoyEnSantiago, sumarDiasCalendario } from '@/lib/fecha-santiago';
import { registrarSaludFuente } from './fuentes-estado';

const CADENCIA_MINUTOS = 60 * 24 * 30;

/**
 * Horizonte de la restricción que se materializa. Un año cubre de sobra la
 * temporada GEC (4 de mayo → 31 de agosto) desde cualquier punto del año.
 */
const DIAS_HORIZONTE_RESTRICCION = 365;

export const jobSincronizarCalendario = inngest.createFunction(
  {
    id: 'contexto-calendario-sincronizar',
    name: 'Contexto · sincronizar feriados y restricción vehicular',
    triggers: [{ cron: '0 4 1 * *' }],
    retries: 2,
  },
  async ({ step }) => {
    // `hoyEnSantiago()` y NO `toISOString()`: este job decide qué AÑOS pedir, y
    // un 31 de diciembre a las 21:00 de Santiago UTC ya está en el año
    // siguiente — pediría el calendario equivocado.
    const hoy = hoyEnSantiago();
    const anioActual = Number(hoy.slice(0, 4));

    const calendario = await step.run('consultar-feriados', async () => {
      const puerto = obtenerPuertoCalendario();
      return puerto.obtenerFeriados({ anios: [anioActual, anioActual + 1] });
    });

    let feriadosEscritos = 0;
    let feriadosConocidos: ReadonlySet<string> | undefined;

    if (calendario.ok) {
      feriadosConocidos = new Set(calendario.datos.feriados.map((f) => f.fecha));

      feriadosEscritos = await step.run('upsert-calendario', async () => {
        const supabase = crearClienteServiceRole();
        const filas = calendario.datos.feriados.map((f) => ({
          fecha: f.fecha,
          nombre: f.nombre,
          tipo: f.tipo,
          irrenunciable: f.irrenunciable,
          actualizado_en: new Date().toISOString(),
        }));

        if (filas.length === 0) return 0;

        const { error } = await supabase
          .schema('contexto')
          .from('calendario')
          .upsert(filas, { onConflict: 'fecha,nombre' });

        if (error) throw new Error(`Error al escribir calendario: ${error.message}`);
        return filas.length;
      });

      await step.run('registrar-fuente-sana', async () => {
        await registrarSaludFuente({
          id: 'calendario',
          nombre: 'Calendario y feriados',
          cadenciaMinutos: CADENCIA_MINUTOS,
          estado: 'ok',
          motivo: null,
          actualizadoEn: new Date(),
        });
        return { registrado: true };
      });
    } else {
      await step.run('registrar-fuente-degradada', async () => {
        await registrarSaludFuente({
          id: 'calendario',
          nombre: 'Calendario y feriados',
          cadenciaMinutos: CADENCIA_MINUTOS,
          estado: calendario.reintentable ? 'atrasada' : 'caida',
          motivo: calendario.motivo,
          actualizadoEn: null,
        });
        return { registrado: true };
      });
    }

    // La restricción se calcula SIEMPRE, con o sin feriados. Sin ellos puede
    // sobre-declarar un día que en realidad es feriado; el flag lo dice.
    const restricciones = calcularRestriccionesEnRango(
      hoy,
      sumarDiasCalendario(hoy, DIAS_HORIZONTE_RESTRICCION),
      feriadosConocidos ? { feriados: feriadosConocidos } : {},
    );

    const restriccionesEscritas = await step.run('upsert-restriccion-vehicular', async () => {
      if (restricciones.length === 0) return 0;

      const supabase = crearClienteServiceRole();
      const filas = restricciones.map((r) => ({
        fecha: r.fecha,
        tipo: r.tipo,
        digitos: r.digitos,
        alcance: r.alcance,
        actualizado_en: new Date().toISOString(),
      }));

      const { error } = await supabase
        .schema('contexto')
        .from('restriccion_vehicular')
        .upsert(filas, { onConflict: 'fecha,tipo' });

      if (error) throw new Error(`Error al escribir restriccion_vehicular: ${error.message}`);
      return filas.length;
    });

    return {
      ok: calendario.ok,
      feriados: feriadosEscritos,
      restricciones: restriccionesEscritas,
      /**
       * `false` significa que la restricción se calculó SIN saber qué días son
       * feriados: puede declarar restricción en un día que no la tiene. Va en el
       * resumen para que quede en la telemetría del job, no enterrado en un log.
       */
      feriadosConsiderados: feriadosConocidos !== undefined,
    };
  },
);
