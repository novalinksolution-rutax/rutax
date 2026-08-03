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
import { leerTodasLasFilas } from '@/lib/supabase/leer-paginado';
import {
  ahoraEnSantiago,
  horaAMinutos,
  limitesDelDiaSantiago,
  sumarDiasCalendario,
} from '@/lib/fecha-santiago';
import { normalizarComuna } from '@/modules/integraciones/geocoding/normalizacion';
import { calcularRiesgoZona, colapsarRiesgoPorFranjas } from '../motor-riesgo';
import type { ResultadoRiesgoZona } from '../motor-riesgo';
import {
  aireDeZonaFranja,
  capacidadPorZona,
  cargaPorZona,
  climaDeZonaFranja,
  eventosDeZonaFranja,
  indexarPorComunaFechaFranja,
  minutosHastaCorte,
  tasaFallidosPorZona,
  type FilaAire,
  type FilaClima,
  type FilaEvento,
} from '../agregacion';
import { FRANJAS, type Franja, type HorizonteRiesgo } from '../tipos';

/** Estados de pedido que cuentan como carga pendiente de la zona. */
const ESTADOS_PENDIENTES = [
  'pendiente_asignacion',
  'asignado',
  'en_ruta',
] as const;

/** Estados cerrados que alimentan la tasa de fallidos histórica. */
const ESTADOS_CERRADOS = [
  'entregado',
  'entregado_manual',
  'fallido',
  'fallido_manual',
] as const;

/** Ventana de historia propia para el factor `historico`, en días. */
const DIAS_HISTORICO = 30;

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

      // --- Carga pendiente y su valor ---------------------------------------
      // `operacion.pedidos` NO tiene `zona_id`: la agregación comuna→zona la
      // hace la aplicación, con el MISMO helper de normalización que se usó al
      // escribir `zona_comunas` (que guarda la forma sin acentos y minúscula).
      // Paginado, no una consulta suelta: PostgREST corta en `max_rows = 1000`
      // SIN AVISAR, y estas filas se agregan por zona. Un courier con volumen
      // real cruza ese tope en un día, y el resultado no sería un error sino un
      // tablero con pendientes y dinero comprometido plausibles y equivocados.
      const hasta = sumarDiasCalendario(fechaBase, 2);
      const pedidos = await leerTodasLasFilas<{
        destinatario_comuna: string;
        fecha_compromiso: string | null;
        tarifa_aplicable_id: string | null;
      }>('pedidos pendientes', (desde, hastaFila) =>
        supabase
          .schema('operacion')
          .from('pedidos')
          .select('destinatario_comuna, fecha_compromiso, tarifa_aplicable_id')
          .eq('tenant_id', tenantId)
          .in('estado', ESTADOS_PENDIENTES)
          .gte('fecha_compromiso', fechaBase)
          .lte('fecha_compromiso', hasta)
          .range(desde, hastaFila),
      );

      // Tarifas del courier, para valorizar lo pendiente. NO se usan
      // `dinero.lineas_cobro`: esas nacen con la ENTREGA, así que para los
      // pedidos que aún no se entregan darían siempre cero — y el dinero en
      // riesgo es justamente el de lo no entregado.
      const { data: tarifas, error: errTarifas } = await supabase
        .schema('identidad')
        .from('tarifas')
        .select('id, monto_clp')
        .eq('tenant_id', tenantId);

      if (errTarifas) throw new Error(`Error al leer tarifas: ${errTarifas.message}`);

      // --- Capacidad ---------------------------------------------------------
      const { data: conductores, error: errCond } = await supabase
        .schema('identidad')
        .from('conductores')
        .select('id, capacidad_paradas, disponible')
        .eq('tenant_id', tenantId)
        .eq('estado', 'activo')
        .eq('disponible', true);

      if (errCond) throw new Error(`Error al leer conductores: ${errCond.message}`);

      const { data: asignaciones, error: errAsig } = await supabase
        .schema('identidad')
        .from('conductor_zonas')
        .select('conductor_id, zona_id')
        .eq('tenant_id', tenantId);

      if (errAsig) throw new Error(`Error al leer conductor_zonas: ${errAsig.message}`);

      // --- Ventanas de corte -------------------------------------------------
      const { data: ventanas, error: errVentanas } = await supabase
        .schema('identidad')
        .from('ventanas_corte')
        .select('zona_id, hora_corte, activa')
        .eq('tenant_id', tenantId)
        .eq('activa', true);

      if (errVentanas) throw new Error(`Error al leer ventanas_corte: ${errVentanas.message}`);

      // --- Contexto externo (tablas GLOBALES del carve-out) ------------------
      // Se leen con service_role: son deny-all para sesiones de usuario. El
      // filtro por comuna acota a las que el courier realmente opera, y el de
      // instante a la ventana de los tres horizontes. `limitesDelDiaSantiago`
      // y NO un literal UTC: Santiago es −04:00 en invierno y −03:00 en verano.
      const comunasDelTenant = [...new Set((mapeo ?? []).map((m) => m.comuna as string))];
      const desdeInstante = limitesDelDiaSantiago(fechaBase).desde.toISOString();
      const hastaInstante = limitesDelDiaSantiago(hasta).hasta.toISOString();

      // También paginado: 52 comunas × 72 horas son ~3.700 filas de pronóstico,
      // casi cuatro veces el tope de PostgREST. Sin paginar, el motor evaluaría
      // el clima de un tercio de la ciudad y daría por bueno el resto.
      const [clima, aire] = await Promise.all([
        leerTodasLasFilas<{
          comuna: string;
          hora: string;
          precipitacion_mm: number | null;
          viento_kmh: number | null;
        }>('clima_horario', (desde, hastaFila) =>
          supabase
            .schema('contexto')
            .from('clima_horario')
            .select('comuna, hora, precipitacion_mm, viento_kmh')
            .in('comuna', comunasDelTenant)
            .gte('hora', desdeInstante)
            .lte('hora', hastaInstante)
            .range(desde, hastaFila),
        ),
        leerTodasLasFilas<{
          comuna: string;
          hora: string;
          nivel_estimado: FilaAire['nivelEstimado'];
        }>('aire_horario', (desde, hastaFila) =>
          supabase
            .schema('contexto')
            .from('aire_horario')
            .select('comuna, hora, nivel_estimado')
            .in('comuna', comunasDelTenant)
            .gte('hora', desdeInstante)
            .lte('hora', hastaInstante)
            .range(desde, hastaFila),
        ),
      ]);

      // --- Restricción vehicular vigente ------------------------------------
      const { data: restricciones, error: errRestric } = await supabase
        .schema('contexto')
        .from('restriccion_vehicular')
        .select('fecha, tipo')
        .gte('fecha', fechaBase)
        .lte('fecha', hasta);

      if (errRestric) {
        throw new Error(`Error al leer restriccion_vehicular: ${errRestric.message}`);
      }

      // --- Histórico propio --------------------------------------------------
      // El factor que ninguna API entrega: cuánto le cuesta a ESTE courier
      // repartir en ESA zona. Ventana móvil de 30 días sobre pedidos cerrados.
      // 30 días de pedidos cerrados es la consulta más grande del job: para un
      // courier con volumen real son decenas de miles de filas. Truncada en
      // 1.000, la tasa de fallidos saldría de una muestra sesgada hacia el
      // principio del período — y ese factor es justamente el que ninguna API
      // entrega y el que se vuelve el foso del producto.
      const cerrados = await leerTodasLasFilas<{ destinatario_comuna: string; estado: string }>(
        'histórico de pedidos cerrados',
        (desde, hastaFila) =>
          supabase
            .schema('operacion')
            .from('pedidos')
            .select('destinatario_comuna, estado')
            .eq('tenant_id', tenantId)
            .in('estado', ESTADOS_CERRADOS)
            .gte('fecha_compromiso', sumarDiasCalendario(fechaBase, -DIAS_HISTORICO))
            .lt('fecha_compromiso', fechaBase)
            .range(desde, hastaFila),
      );

      return {
        zonas: zonas as { id: string; nombre: string }[],
        mapeo: (mapeo ?? []) as { zona_id: string; comuna: string }[],
        pedidos,
        tarifas: (tarifas ?? []) as { id: string; monto_clp: number }[],
        conductores: (conductores ?? []) as { id: string; capacidad_paradas: number }[],
        asignaciones: (asignaciones ?? []) as { conductor_id: string; zona_id: string }[],
        ventanas: (ventanas ?? []) as {
          zona_id: string | null;
          hora_corte: string;
          activa: boolean;
        }[],
        clima,
        aire,
        eventos,
        restricciones: (restricciones ?? []) as { fecha: string; tipo: string }[],
        cerrados,
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
    /** Comunas de cada zona, para colapsar el contexto externo por zona. */
    const comunasDeZona = new Map<string, string[]>();
    for (const fila of insumos.mapeo) {
      const lista = comunasDeZona.get(fila.zona_id);
      if (lista) lista.push(fila.comuna);
      else comunasDeZona.set(fila.zona_id, [fila.comuna]);
    }

    const zonaIds = insumos.zonas.map((z) => z.id);

    // Capacidad REAL por zona, usando las zonas preferentes del conductor. Antes
    // se dividía el pool completo a partes iguales, con lo que una zona sin un
    // solo conductor propio mostraba holgura como si los tuviera.
    const capacidad = capacidadPorZona(
      insumos.conductores.map((c) => ({ id: c.id, capacidadParadas: c.capacidad_paradas ?? 0 })),
      insumos.asignaciones.map((a) => ({ conductorId: a.conductor_id, zonaId: a.zona_id })),
      zonaIds,
    );

    const ventanas = insumos.ventanas.map((v) => ({
      zonaId: v.zona_id,
      horaCorte: v.hora_corte,
      activa: v.activa,
    }));

    const tarifas = new Map(insumos.tarifas.map((t) => [t.id, t.monto_clp]));

    // Índices del contexto externo. Se arman UNA vez y los comparten las tres
    // franjas × N zonas × tres horizontes.
    const indiceClima = indexarPorComunaFechaFranja<FilaClima>(
      insumos.clima.map((c) => ({
        comuna: c.comuna,
        hora: c.hora,
        precipitacionMm: c.precipitacion_mm,
        vientoKmh: c.viento_kmh,
      })),
    );
    const indiceAire = indexarPorComunaFechaFranja<FilaAire>(
      insumos.aire.map((a) => ({
        comuna: a.comuna,
        hora: a.hora,
        nivelEstimado: a.nivel_estimado,
      })),
    );
    // El factor `eventos` se quedó sin fuente (nadie puebla `eventos_ciudad`) y
    // por eso su peso efectivo es 0. Se le pasa la lista vacía a propósito: el
    // motor devuelve entonces valor 0 con su explicación, que es exactamente lo
    // que aportó al puntaje. Leer la tabla sería E/S muerta.
    const eventos: FilaEvento[] = [];
    const fechasConRestriccion = new Set(insumos.restricciones.map((r) => r.fecha));

    const tasasFallidos = tasaFallidosPorZona(
      insumos.cerrados.map((p) => ({
        destinatarioComuna: p.destinatario_comuna,
        estado: p.estado,
      })),
      comunaAZona,
    );

    const ahora = ahoraEnSantiago();
    const ahoraMinutos = horaAMinutos(ahora.hora);
    const filas: Record<string, unknown>[] = [];

    for (const horizonte of horizontes as HorizonteRiesgo[]) {
      const fecha = sumarDiasCalendario(fechaBase, OFFSET_HORIZONTE[horizonte]);

      // Pendientes por zona para ESTA fecha. Para 'manana' y '72h' se cuentan
      // SOLO pedidos ya ingestados con compromiso en la ventana — nunca una
      // proyección. Consecuencia aceptada y correcta: a 72 h se verá casi
      // vacío. La proyección de volumen vive en el horizonte 'olas', donde va
      // etiquetada como tal.
      const carga = cargaPorZona(
        insumos.pedidos.map((p) => ({
          destinatarioComuna: p.destinatario_comuna,
          fechaCompromiso: p.fecha_compromiso,
          tarifaAplicableId: p.tarifa_aplicable_id,
        })),
        comunaAZona,
        tarifas,
        fecha,
      );
      const hayRestriccion = fechasConRestriccion.has(fecha);

      for (const zona of insumos.zonas) {
        const { pendientes, montoClp } = carga.get(zona.id) ?? { pendientes: 0, montoClp: 0 };
        const comunas = comunasDeZona.get(zona.id) ?? [];
        const minutosCorte = minutosHastaCorte(ventanas, zona.id, fecha, {
          fecha: ahora.fecha,
          horaMinutos: ahoraMinutos,
        });
        const porFranja: Partial<Record<Franja, ResultadoRiesgoZona>> = {};

        for (const franja of FRANJAS) {
          porFranja[franja] = calcularRiesgoZona({
            presionOperativa: {
              pedidosPendientes: pendientes,
              capacidadEstimada: capacidad.get(zona.id) ?? 0,
              minutosHastaCorte: minutosCorte,
            },
            clima: climaDeZonaFranja(indiceClima, comunas, fecha, franja),
            aire: {
              nivelPeorEnVentana: aireDeZonaFranja(indiceAire, comunas, fecha, franja),
              restriccionVigenteHoy: hayRestriccion,
            },
            eventos: eventosDeZonaFranja(eventos, comunas, fecha, franja),
            historico: { tasaFallidosPct: tasasFallidos.get(zona.id) ?? null },
          });
        }

        const colapsado = colapsarRiesgoPorFranjas(porFranja, {
          horizonte,
          ahora: { fecha: ahora.fecha, horaMinutos: ahoraMinutos },
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
            monto_comprometido_clp: montoClp,
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
