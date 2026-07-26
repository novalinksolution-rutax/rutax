/**
 * Job `contexto/aireRefrescar` — pronóstico horario de PM2.5/PM10 por comuna.
 * =====================================================================
 *
 * Cron cada 60 minutos (a los :10, desplazado del de clima para no apilar dos
 * llamadas externas en el mismo minuto).
 *
 * Deja `contexto.aire_horario`, de donde el motor de riesgo lee el factor
 * "aire y restricción" y de donde sale la alerta de preemergencia.
 *
 * EL NIVEL YA VIENE CALCULADO POR EL PUERTO, y sobre el promedio móvil de 24 h
 * — no sobre la hora suelta. Es la parte que se rompe por descuido: la norma
 * chilena de episodios críticos (Plan Operacional GEC del MMA) define Alerta,
 * Preemergencia y Emergencia sobre la media móvil de 24 h. Clasificar la hora
 * suelta produce preemergencias fantasma cada noche de invierno — medido: 97
 * µg/m³ a medianoche real, que como hora suelta grita y como media móvil no.
 * Este job NO reclasifica: persiste `nivelEstimado` tal como lo entregó el
 * puerto.
 *
 * IDEMPOTENCIA: upsert por `(comuna, hora)`.
 * DEGRADACIÓN: idéntica a la del job de clima — el puerto no lanza.
 */

import { inngest } from '@/lib/inngest/cliente';
import { obtenerPuertoAire } from '@/modules/integraciones/contexto';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarSaludFuente } from './fuentes-estado';

const CADENCIA_MINUTOS = 60;
const TAMANO_LOTE = 1_000;

export const jobRefrescarAire = inngest.createFunction(
  {
    id: 'contexto-aire-refrescar',
    name: 'Contexto · refrescar calidad del aire',
    triggers: [{ cron: '10 * * * *' }],
    retries: 2,
  },
  async ({ step }) => {
    const pronostico = await step.run('consultar-proveedor', async () => {
      const puerto = obtenerPuertoAire();
      return puerto.obtenerPronostico({ dias: 3 });
    });

    if (!pronostico.ok) {
      await step.run('registrar-fuente-degradada', async () => {
        await registrarSaludFuente({
          id: 'aire',
          nombre: 'Calidad del aire',
          cadenciaMinutos: CADENCIA_MINUTOS,
          estado: pronostico.reintentable ? 'atrasada' : 'caida',
          motivo: pronostico.motivo,
          actualizadoEn: null,
        });
        return { registrado: true };
      });

      return { ok: false as const, motivo: pronostico.motivo, filas: 0 };
    }

    // `h.hora` ya viene serializado a string ISO por `step.run` (ver la nota
    // equivalente en refrescar-clima.ts).
    const filas = pronostico.datos.horas.map((h) => ({
      comuna: h.comuna,
      hora: h.hora,
      pm25: h.pm25,
      pm10: h.pm10,
      nivel_estimado: h.nivelEstimado,
      actualizado_en: new Date().toISOString(),
    }));

    const escritas = await step.run('upsert-aire-horario', async () => {
      const supabase = crearClienteServiceRole();
      let total = 0;

      for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
        const lote = filas.slice(i, i + TAMANO_LOTE);
        const { error } = await supabase
          .schema('contexto')
          .from('aire_horario')
          .upsert(lote, { onConflict: 'comuna,hora' });

        if (error) {
          throw new Error(`Error al escribir aire_horario: ${error.message}`);
        }
        total += lote.length;
      }

      return total;
    });

    await step.run('registrar-fuente-sana', async () => {
      await registrarSaludFuente({
        id: 'aire',
        nombre: 'Calidad del aire',
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
