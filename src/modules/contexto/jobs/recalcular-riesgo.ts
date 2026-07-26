/**
 * Jobs `contexto/riesgoBarrido` y `contexto/riesgoRecalcularTenant`.
 * =====================================================================
 *
 * El par caliente del módulo: recalcula el puntaje de riesgo de cada zona de
 * cada courier y lo deja en `contexto.riesgo_zona`, que es lo que la Torre lee
 * para pintar el mapa. Corre cada 15 minutos.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SON DOS JOBS Y NO UNO — fan-out real
 * -----------------------------------------------------------------------------
 * Los dos jobs del repo que hoy iteran tenants (`plataforma/verificar-salud`,
 * `notificar-comunicacion`) hacen todo el trabajo dentro de UN `step.run` con
 * `Promise.allSettled`. Para ellos está bien: corren una vez al día o al
 * publicar algo. Aquí no sirve, por dos razones concretas:
 *
 *   · Un tenant lento consume el presupuesto de tiempo del step, y con él, el
 *     de todos los demás. A los 15 minutos entra el ciclo siguiente.
 *   · Un fallo en un tenant reintenta el LOTE completo, recalculando de nuevo
 *     los que ya estaban bien.
 *
 * Con fan-out, el barrido solo enumera y despacha; cada tenant corre en su
 * propio run, con sus propios reintentos y su propia fila de telemetría en
 * `infra.ejecuciones_job`. `concurrency` acota cuántos corren a la vez para no
 * saturar la base.
 *
 * ⚠️ Es la PRIMERA vez que este repo usa `step.sendEvent` y `concurrency`:
 * antes de esto había cero de ambos en todo `src/`. Si algo se comporta raro
 * con reintentos o con el tablero de salud, empezar mirando aquí.
 *
 * -----------------------------------------------------------------------------
 * IDEMPOTENCIA
 * -----------------------------------------------------------------------------
 * El upsert va contra la PK `(tenant_id, zona_id, fecha, franja)`. Correr el
 * job de más es inofensivo: deja exactamente el mismo estado. El `id`
 * determinístico del evento refuerza eso, no lo sustituye.
 *
 * -----------------------------------------------------------------------------
 * ZONA HORARIA
 * -----------------------------------------------------------------------------
 * Todo el módulo es sensible a fecha. `hoyEnSantiago()` y nunca UTC: a las
 * 20:00 de Santiago, UTC ya está en el día siguiente y el job escribiría el
 * riesgo del día equivocado — que aquí no significa una tabla vacía, sino un
 * coordinador decidiendo con datos de mañana creyendo que son de hoy.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { ahoraEnSantiago, horaAMinutos, sumarDiasCalendario } from '@/lib/fecha-santiago';
import { normalizarComuna } from '@/modules/integraciones/geocoding/normalizacion';
import { calcularRiesgoZona, colapsarRiesgoPorFranjas } from '../motor-riesgo';
import type { ResultadoRiesgoZona } from '../motor-riesgo';
import { FRANJAS, type Franja, type HorizonteRiesgo } from '../tipos';

/** Ventana horaria local de cada franja, para acotar clima y aire. */
const RANGO_FRANJA: Readonly<Record<Franja, { desde: string; hasta: string }>> = {
  manana: { desde: '08:00', hasta: '12:00' },
  tarde: { desde: '12:00', hasta: '17:00' },
  punta: { desde: '17:00', hasta: '21:00' },
};

/** Estados de pedido que cuentan como carga pendiente de la zona. */
const ESTADOS_PENDIENTES = [
  'pendiente_asignacion',
  'asignado',
  'en_ruta',
] as const;

const HORIZONTES: readonly HorizonteRiesgo[] = ['hoy', 'manana', '72h'];

/** Desplazamiento en días de cada horizonte respecto de la fecha base. */
const OFFSET_HORIZONTE: Readonly<Record<HorizonteRiesgo, number>> = {
  hoy: 0,
  manana: 1,
  '72h': 2,
};

// =============================================================================
// Barrido — solo enumera tenants activos y despacha. No calcula nada.
// =============================================================================

export const jobRiesgoBarrido = inngest.createFunction(
  {
    id: 'contexto-riesgo-barrido',
    name: 'Contexto · barrido de recálculo de riesgo (fan-out por tenant)',
    triggers: [{ cron: '*/15 * * * *' }],
    retries: 2,
  },
  async ({ step }) => {
    const fechaBase = ahoraEnSantiago().fecha;

    const tenants = await step.run('listar-tenants-activos', async () => {
      const supabase = crearClienteServiceRole();
      const { data, error } = await supabase
        .schema('identidad')
        .from('tenants')
        .select('id')
        .neq('estado', 'suspendido');

      if (error) throw new Error(`Error al listar tenants: ${error.message}`);
      return (data ?? []).map((t) => t.id as string);
    });

    if (tenants.length === 0) {
      return { despachados: 0, fechaBase };
    }

    // Cuarto de hora actual, para que un reintento del barrido dentro del mismo
    // ciclo no dispare un segundo recálculo del mismo tenant.
    const { hora } = ahoraEnSantiago();
    const slot15 = Math.floor(horaAMinutos(hora) / 15);

    await step.sendEvent(
      'despachar-recalculo-por-tenant',
      tenants.map((tenantId) => ({
        name: 'contexto/riesgo.recalcular-tenant' as const,
        id: `riesgo-${tenantId}-${fechaBase}-${slot15}`,
        data: {
          tenantId,
          fechaBase,
          horizontes: [...HORIZONTES],
          origen: 'cron' as const,
        },
      })),
    );

    return { despachados: tenants.length, fechaBase };
  },
);

// =============================================================================
// Recálculo de UN tenant
// =============================================================================

export const jobRiesgoRecalcularTenant = inngest.createFunction(
  {
    id: 'contexto-riesgo-recalcular-tenant',
    name: 'Contexto · recalcular riesgo de un tenant',
    triggers: [{ event: 'contexto/riesgo.recalcular-tenant' }],
    // Acota cuántos tenants se recalculan a la vez. Sin esto, un despliegue con
    // muchos couriers dispararía N runs simultáneos contra la misma base.
    concurrency: { limit: 5 },
    retries: 2,
  },
  async ({ event, step }) => {
    const { tenantId, fechaBase, horizontes } = event.data;

    const insumos = await step.run('reunir-insumos', async () => {
      const supabase = crearClienteServiceRole();

      // --- Zonas del tenant y su mapeo de comunas ----------------------------
      const { data: zonas, error: errZonas } = await supabase
        .schema('identidad')
        .from('zonas')
        .select('id, nombre')
        .eq('tenant_id', tenantId)
        .eq('activa', true);

      if (errZonas) throw new Error(`Error al leer zonas: ${errZonas.message}`);
      if (!zonas || zonas.length === 0) return null;

      const { data: mapeo, error: errMapeo } = await supabase
        .schema('identidad')
        .from('zona_comunas')
        .select('zona_id, comuna')
        .eq('tenant_id', tenantId);

      if (errMapeo) throw new Error(`Error al leer zona_comunas: ${errMapeo.message}`);

      // --- Carga pendiente ---------------------------------------------------
      // `operacion.pedidos` NO tiene `zona_id`: la agregación comuna→zona la
      // hace la aplicación, con el MISMO helper de normalización que se usó al
      // escribir `zona_comunas` (que guarda la forma sin acentos y minúscula).
      const hasta = sumarDiasCalendario(fechaBase, 2);
      const { data: pedidos, error: errPedidos } = await supabase
        .schema('operacion')
        .from('pedidos')
        .select('destinatario_comuna, fecha_compromiso, estado')
        .eq('tenant_id', tenantId)
        .in('estado', ESTADOS_PENDIENTES)
        .gte('fecha_compromiso', fechaBase)
        .lte('fecha_compromiso', hasta);

      if (errPedidos) throw new Error(`Error al leer pedidos: ${errPedidos.message}`);

      // --- Capacidad ---------------------------------------------------------
      const { data: conductores, error: errCond } = await supabase
        .schema('identidad')
        .from('conductores')
        .select('id, capacidad_paradas, disponible')
        .eq('tenant_id', tenantId)
        .eq('estado', 'activo')
        .eq('disponible', true);

      if (errCond) throw new Error(`Error al leer conductores: ${errCond.message}`);

      return {
        zonas: zonas as { id: string; nombre: string }[],
        mapeo: (mapeo ?? []) as { zona_id: string; comuna: string }[],
        pedidos: (pedidos ?? []) as {
          destinatario_comuna: string;
          fecha_compromiso: string | null;
        }[],
        conductores: (conductores ?? []) as { id: string; capacidad_paradas: number }[],
      };
    });

    // Tenant sin zonas configuradas: la Torre cae al fallback de macro-zonas en
    // la pantalla (estado `sin_zonas`). No hay nada que persistir aquí.
    if (insumos === null) {
      return { ok: true as const, zonas: 0, filas: 0, motivo: 'sin_zonas' };
    }

    const comunaAZona = new Map<string, string>();
    for (const fila of insumos.mapeo) {
      comunaAZona.set(normalizarComuna(fila.comuna), fila.zona_id);
    }

    /**
     * Capacidad por zona. Sin `conductor_zonas` cargado aquí, se reparte la
     * capacidad total del pool entre las zonas activas. Es una aproximación
     * declarada, no un dato fino: el reparto real por zona preferente entra
     * junto con el composer, que ya necesita esa consulta para el nivel 2.
     */
    const capacidadTotal = insumos.conductores.reduce(
      (acc, c) => acc + (c.capacidad_paradas ?? 0),
      0,
    );
    const capacidadPorZona = Math.max(
      1,
      Math.floor(capacidadTotal / Math.max(1, insumos.zonas.length)),
    );
    const ahora = ahoraEnSantiago();
    const filas: Record<string, unknown>[] = [];

    for (const horizonte of horizontes as HorizonteRiesgo[]) {
      const fecha = sumarDiasCalendario(fechaBase, OFFSET_HORIZONTE[horizonte]);

      // Pendientes por zona para ESTA fecha. Para 'manana' y '72h' se cuentan
      // SOLO pedidos ya ingestados con compromiso en la ventana — nunca una
      // proyección. Consecuencia aceptada y correcta: a 72 h se verá casi
      // vacío. La proyección de volumen vive en el horizonte 'olas', donde va
      // etiquetada como tal.
      const pendientesPorZona = new Map<string, number>();
      for (const p of insumos.pedidos) {
        if (p.fecha_compromiso !== fecha) continue;
        const zonaId = comunaAZona.get(normalizarComuna(p.destinatario_comuna));
        if (!zonaId) continue;
        pendientesPorZona.set(zonaId, (pendientesPorZona.get(zonaId) ?? 0) + 1);
      }

      for (const zona of insumos.zonas) {
        const pendientes = pendientesPorZona.get(zona.id) ?? 0;
        const porFranja: Partial<Record<Franja, ResultadoRiesgoZona>> = {};

        for (const franja of FRANJAS) {
          const rango = RANGO_FRANJA[franja];
          porFranja[franja] = calcularRiesgoZona({
            presionOperativa: {
              pedidosPendientes: pendientes,
              capacidadEstimada: capacidadPorZona,
              minutosHastaCorte: null,
            },
            // Clima y aire entran con valores neutros hasta que el composer
            // cruce `contexto.clima_horario` / `aire_horario` por comuna de la
            // zona. Se deja explícito en vez de inventar un valor: un factor
            // en 0 con su explicación es honesto; uno estimado a ojo, no.
            clima: {
              precipitacionMaximaMmHora: 0,
              vientoMaximoKmh: 0,
              ventanaInicioLocal: rango.desde,
              ventanaFinLocal: rango.hasta,
            },
            aire: { nivelPeorEnVentana: 'bueno', restriccionVigenteHoy: false },
            eventos: { eventos: [] },
            historico: { tasaFallidosPct: null },
          });
        }

        const colapsado = colapsarRiesgoPorFranjas(porFranja, {
          horizonte,
          ahora: { fecha: ahora.fecha, horaMinutos: horaAMinutos(ahora.hora) },
        });

        // Se persiste una fila por franja con el desglose de esa franja, y la
        // franja dominante viaja dentro de `desglose` para que el composer no
        // tenga que re-derivarla (y para que el nivel 1 y el nivel 2 nunca se
        // contradigan en pantalla).
        for (const franja of FRANJAS) {
          const resultado = porFranja[franja];
          if (!resultado) continue;

          filas.push({
            tenant_id: tenantId,
            zona_id: zona.id,
            fecha,
            franja,
            puntaje: resultado.puntaje,
            desglose: {
              factores: resultado.desglose.factores,
              franja_dominante: colapsado.desglose.franjaDominante,
              puntaje_colapsado: colapsado.puntaje,
              horizonte,
            },
            pedidos_pendientes: pendientes,
            monto_comprometido_clp: 0,
            calculado_en: new Date(),
          });
        }
      }
    }

    const escritas = await step.run('upsert-riesgo-zona', async () => {
      if (filas.length === 0) return 0;

      const supabase = crearClienteServiceRole();
      const { error } = await supabase
        .schema('contexto')
        .from('riesgo_zona')
        .upsert(filas, { onConflict: 'tenant_id,zona_id,fecha,franja' });

      if (error) throw new Error(`Error al escribir riesgo_zona: ${error.message}`);
      return filas.length;
    });

    return { ok: true as const, zonas: insumos.zonas.length, filas: escritas };
  },
);
