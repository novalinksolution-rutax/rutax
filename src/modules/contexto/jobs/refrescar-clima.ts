/**
 * Job `contexto/climaRefrescar` — pronóstico horario por comuna.
 * =====================================================================
 *
 * Cron cada 60 minutos (a los :05, desplazado fuera de la hora en punto: el
 * repo ya tiene un cluster de crones en 02:00–02:30 y 05:00–06:00).
 *
 * Trae el pronóstico de las próximas 72 h y lo deja en `contexto.clima_horario`,
 * que es de donde el motor de riesgo lee el factor clima. **La pantalla nunca
 * llama a una API externa en el render** — todo viene precalculado por este job,
 * y eso es lo que hace que la Torre se sienta instantánea (§8.4).
 *
 * IDEMPOTENCIA: upsert por `(comuna, hora)`, la PK de la tabla. Correr el job
 * dos veces deja exactamente el mismo estado; un reintento de Inngest no
 * duplica ni una fila.
 *
 * DEGRADACIÓN: el puerto no lanza — devuelve `{ ok: false, motivo }`. Si el
 * proveedor falla, se registra la fuente como caída con su motivo y el job
 * termina bien. El resto del tablero sigue operando y la capa de lluvia aparece
 * marcada, no desaparecida.
 */

import { inngest } from '@/lib/inngest/cliente';
import { obtenerPuertoClima } from '@/modules/integraciones/contexto';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarSaludFuente } from './fuentes-estado';

/** Cadencia declarada, en minutos. Debe calzar con el cron de abajo. */
const CADENCIA_MINUTOS = 60;

/**
 * Tamaño de lote del upsert. 52 comunas × 72 h ≈ 3.700 filas: mandarlas en una
 * sola sentencia es pedirle problemas al límite de payload de PostgREST.
 */
const TAMANO_LOTE = 1_000;

export const jobRefrescarClima = inngest.createFunction(
  {
    id: 'contexto-clima-refrescar',
    name: 'Contexto · refrescar pronóstico de clima',
    triggers: [{ cron: '5 * * * *' }],
    retries: 2,
  },
  async ({ step }) => {
    const pronostico = await step.run('consultar-proveedor', async () => {
      const puerto = obtenerPuertoClima();
      return puerto.obtenerPronostico({ dias: 3 });
    });

    if (!pronostico.ok) {
      await step.run('registrar-fuente-degradada', async () => {
        await registrarSaludFuente({
          id: 'clima',
          nombre: 'Clima',
          cadenciaMinutos: CADENCIA_MINUTOS,
          estado: pronostico.reintentable ? 'atrasada' : 'caida',
          motivo: pronostico.motivo,
          actualizadoEn: null,
        });
        return { registrado: true };
      });

      // Se devuelve un resumen, NO se lanza: que el proveedor esté caído no es
      // un fallo del job. Lanzar aquí solo llenaría el tablero de salud de
      // rojo por algo que ya está declarado en `fuentes_estado`.
      return { ok: false as const, motivo: pronostico.motivo, filas: 0 };
    }

    // `h.hora` ya es un string ISO, no un Date: todo lo que devuelve un
    // `step.run` pasa por JSON para que Inngest pueda persistirlo y reanudar el
    // run, así que los Date del puerto llegan aquí serializados. El tipado de
    // Inngest v4 lo modela bien y por eso `.toISOString()` no compila — hacerle
    // caso al compilador en vez de castear es lo correcto.
    const filas = pronostico.datos.horas.map((h) => ({
      comuna: h.comuna,
      hora: h.hora,
      precipitacion_mm: h.precipitacionMm,
      prob_precipitacion: h.probPrecipitacion,
      viento_kmh: h.vientoKmh,
      temp_c: h.tempC,
      actualizado_en: new Date().toISOString(),
    }));

    const escritas = await step.run('upsert-clima-horario', async () => {
      const supabase = crearClienteServiceRole();
      let total = 0;

      for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
        const lote = filas.slice(i, i + TAMANO_LOTE);
        const { error } = await supabase
          .schema('contexto')
          .from('clima_horario')
          .upsert(lote, { onConflict: 'comuna,hora' });

        if (error) {
          throw new Error(`Error al escribir clima_horario: ${error.message}`);
        }
        total += lote.length;
      }

      return total;
    });

    await step.run('registrar-fuente-sana', async () => {
      await registrarSaludFuente({
        id: 'clima',
        nombre: 'Clima',
        cadenciaMinutos: CADENCIA_MINUTOS,
        estado: 'ok',
        motivo: null,
        actualizadoEn: new Date(),
      });
      return { registrado: true };
    });

    return {
      ok: true as const,
      proveedor: pronostico.datos.proveedor,
      comunas: pronostico.datos.comunasResueltas.length,
      filas: escritas,
    };
  },
);
