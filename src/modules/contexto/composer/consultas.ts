/**
 * Composer de la Torre — la capa de I/O, memoizada por request.
 * =====================================================================
 *
 * Aquí vive TODO lo que toca la base para armar la pantalla, y nada más:
 * ninguna de estas funciones decide, agrega ni redacta. Eso es de los módulos
 * de `armado-*.ts`, que son puros y se prueban sin base.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ `cache()` DE REACT
 * -----------------------------------------------------------------------------
 * La pantalla no es un árbol de datos: es seis regiones que necesitan trozos
 * que se solapan. `zonas` las necesitan R3 (el mapa), R4 (el riel) y R5 (la
 * línea de tiempo); `frescura` la necesitan R1 y el resolutor de capas. Con un
 * `<Suspense>` por región, cada región pide lo suyo por su cuenta — y sin
 * memoización, la misma consulta saldría tres veces por render.
 *
 * `cache()` la memoiza **por request**, no entre requests: no es un caché de
 * datos, es deduplicación. Dos regiones que piden lo mismo comparten un solo
 * viaje, y ninguna espera a la otra.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ `service_role` Y CÓMO NO CONVERTIRLO EN UN AGUJERO
 * -----------------------------------------------------------------------------
 * Las ocho tablas globales del carve-out (`clima_horario`, `aire_horario`,
 * `restriccion_vehicular`, `fuentes_estado`, `senales`…) son
 * **deny-all**: RLS forzada sin políticas y sin un solo grant a `authenticated`.
 * Es a propósito, y la propia migración lo dice: se leen con
 * `crearClienteServiceRole()` desde el composer del módulo. No hay otra puerta.
 *
 * La contrapartida es que `service_role` bypassa RLS, así que el aislamiento de
 * las tablas POR TENANT queda en manos de este archivo. Dos reglas, sin
 * excepciones:
 *
 *   1. **Toda consulta a una tabla de negocio lleva `.eq('tenant_id', tenantId)`.**
 *      Si alguna vez ves una que no lo lleva, es un bug de aislamiento, no un
 *      descuido de estilo.
 *   2. **`tenantId` viene SIEMPRE de la sesión validada** (`page.tsx`:
 *      `sesion.usuario.tenantId` + `puedeVerTorreControl`). Nunca de la URL, de
 *      un query param ni de un header.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SE PAGINA
 * -----------------------------------------------------------------------------
 * PostgREST corta en `max_rows = 1000` sin avisar. Todo lo que después se
 * agrega —el pronóstico horario por comuna, los entregados por zona— se lee con
 * `leerTodasLasFilas`. Un corte silencioso aquí no produce un error: produce un
 * tablero con cifras plausibles y equivocadas.
 *
 * -----------------------------------------------------------------------------
 * ZONA HORARIA
 * -----------------------------------------------------------------------------
 * Todas las fechas son civiles de Santiago y todos los rangos de instante salen
 * de `limitesDelDiaSantiago`. Nunca UTC: a las 20:00 de Santiago UTC ya está en
 * el día siguiente, y el tablero mostraría el día equivocado sin fallar.
 */

import { cache } from 'react';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { leerTodasLasFilas } from '@/lib/supabase/leer-paginado';
import { limitesDelDiaSantiago, sumarDiasCalendario } from '@/lib/fecha-santiago';
import type { NivelAire } from '../contrato-torre';

// =============================================================================
// Constantes de dominio (mismas que usa el job — un solo criterio)
// =============================================================================

/** Estados de pedido que cuentan como carga pendiente. Espeja el job. */
export const ESTADOS_PENDIENTES = ['pendiente_asignacion', 'asignado', 'en_ruta'] as const;

/** Estados que cuentan como entrega lograda. */
export const ESTADOS_ENTREGADOS = ['entregado', 'entregado_manual'] as const;

/** Días hacia atrás que se leen de `riesgo_zona` para comparar contra la semana pasada. */
export const DIAS_COMPARACION = 7;

// =============================================================================
// Formas de fila (lo que devuelve cada consulta, en snake_case como la BD)
// =============================================================================

export interface FilaZonaConfigurada {
  id: string;
  nombre: string;
}

export interface FilaZonaComuna {
  zona_id: string;
  comuna: string;
}

export interface FilaRiesgoZona {
  zona_id: string;
  fecha: string;
  franja: 'manana' | 'tarde' | 'punta';
  puntaje: number;
  desglose: Record<string, unknown>;
  pedidos_pendientes: number;
  monto_comprometido_clp: number;
  calculado_en: string;
}

export interface FilaFuenteEstado {
  id: string;
  nombre: string;
  actualizado_en: string | null;
  cadencia_minutos: number;
  estado: 'ok' | 'atrasada' | 'caida';
  motivo: string | null;
}

export interface FilaConductor {
  id: string;
  nombre_completo: string;
  capacidad_paradas: number | null;
  disponible: boolean;
}

export interface FilaAsignacionZona {
  conductor_id: string;
  zona_id: string;
}

export interface FilaVentanaCorte {
  zona_id: string | null;
  hora_corte: string;
  activa: boolean;
}

export interface FilaClimaHorario {
  comuna: string;
  hora: string;
  precipitacion_mm: number | null;
  viento_kmh: number | null;
}

export interface FilaAireHorario {
  comuna: string;
  hora: string;
  pm25: number | null;
  nivel_estimado: NivelAire;
}

export interface FilaRestriccion {
  fecha: string;
  tipo: 'permanente' | 'preemergencia' | 'emergencia';
  digitos: number[];
  alcance: string;
}

export interface FilaMarcaOperativa {
  id: string;
  lat: number;
  long: number;
  radio_m: number;
  nota: string;
  vigencia_inicio: string;
  vigencia_fin: string | null;
  autor_usuario_id: string | null;
  creada_en: string;
}

export interface FilaSenalTenant {
  senal_id: string;
  pedidos_en_rango: number;
  zonas_afectadas: string[];
  marca_humana: 'confirmada' | 'descartada' | null;
  senales: {
    id: string;
    titulo: string;
    resumen: string;
    tipo: 'corte_transito' | 'manifestacion' | 'paro' | 'emergencia' | 'transporte' | 'otro';
    comunas: string[];
    ejes_viales: string[];
    ventana_inicio: string | null;
    ventana_fin: string | null;
    severidad: 'critica' | 'alta' | 'media' | 'informativa';
    confianza: number;
    afecta_operacion: boolean;
    fuentes: unknown;
  } | null;
}

/** Pedido entregado, reducido a lo mínimo para contarlo por zona y fecha. */
export interface FilaEntregado {
  destinatario_comuna: string;
  fecha_compromiso: string | null;
}

/** Pedido pendiente, con lo mínimo para agregarlo por zona y valorizarlo. */
export interface PedidoPendienteFila {
  destinatario_comuna: string;
  fecha_compromiso: string | null;
  tarifa_aplicable_id: string | null;
}

export interface ConteosPedidos {
  /** Total de pedidos con compromiso en cada fecha de horizonte. */
  totalPorFecha: Record<string, number>;
  /** Total de la misma fecha una semana antes. Base de la variación. */
  totalSemanaAnteriorPorFecha: Record<string, number>;
  /** Pendientes con compromiso ANTERIOR a hoy: llegaron tarde y siguen abiertos. */
  atrasados: number;
  /** Pendientes del horizonte sin geocodificar: no aparecen en el mapa. */
  sinGeocodificar: number;
}

// =============================================================================
// Cabecera — courier y frescura de fuentes
// =============================================================================

export const obtenerCourier = cache(async function obtenerCourier(
  tenantId: string,
): Promise<{ id: string; nombre: string }> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema('identidad')
    .from('tenants')
    .select('id, nombre_fantasia')
    .eq('id', tenantId)
    .maybeSingle();

  if (error) throw new Error(`Error al leer el courier: ${error.message}`);
  return { id: tenantId, nombre: (data?.nombre_fantasia as string) ?? 'Tu operación' };
});

/**
 * Las cinco fuentes externas con su salud. Es GLOBAL —no lleva `tenant_id`— y
 * está sembrada por la migración, así que siempre devuelve las cinco filas
 * aunque ningún job haya corrido. La regla de producto es que una fuente nunca
 * desaparece en silencio: se marca.
 */
export const obtenerFrescuraFuentes = cache(async function obtenerFrescuraFuentes(): Promise<
  FilaFuenteEstado[]
> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema('contexto')
    .from('fuentes_estado')
    .select('id, nombre, actualizado_en, cadencia_minutos, estado, motivo');

  if (error) throw new Error(`Error al leer fuentes_estado: ${error.message}`);
  return (data ?? []) as FilaFuenteEstado[];
});

// =============================================================================
// Configuración del courier — zonas, capacidad, cortes
// =============================================================================

export const obtenerZonasConfiguradas = cache(async function obtenerZonasConfiguradas(
  tenantId: string,
): Promise<{ zonas: FilaZonaConfigurada[]; mapeo: FilaZonaComuna[] }> {
  const supabase = crearClienteServiceRole();

  const [zonas, mapeo] = await Promise.all([
    supabase
      .schema('identidad')
      .from('zonas')
      .select('id, nombre')
      .eq('tenant_id', tenantId)
      .eq('activa', true)
      .order('nombre'),
    supabase
      .schema('identidad')
      .from('zona_comunas')
      .select('zona_id, comuna')
      .eq('tenant_id', tenantId),
  ]);

  if (zonas.error) throw new Error(`Error al leer zonas: ${zonas.error.message}`);
  if (mapeo.error) throw new Error(`Error al leer zona_comunas: ${mapeo.error.message}`);

  return {
    zonas: (zonas.data ?? []) as FilaZonaConfigurada[],
    mapeo: (mapeo.data ?? []) as FilaZonaComuna[],
  };
});

/**
 * Conductores activos (disponibles y no) + sus zonas preferentes.
 *
 * Se traen los NO disponibles a propósito, aunque el motor de riesgo solo cuente
 * los disponibles: la pantalla muestra dos cifras distintas —«conductores
 * asignados» y «disponibles»— y sin los ausentes serían siempre el mismo número.
 * Saber que una zona tiene 5 asignados pero 2 disponibles es justamente lo que
 * explica su presión.
 *
 * La CAPACIDAD, en cambio, se calcula solo con los disponibles: es la misma
 * cuenta que hizo el motor, y si aquí se sumaran los ausentes la holgura de la
 * pantalla contradiría el puntaje que la pantalla muestra al lado.
 */
export const obtenerCapacidadInstalada = cache(async function obtenerCapacidadInstalada(
  tenantId: string,
): Promise<{ conductores: FilaConductor[]; asignaciones: FilaAsignacionZona[] }> {
  const supabase = crearClienteServiceRole();

  const [conductores, asignaciones] = await Promise.all([
    supabase
      .schema('identidad')
      .from('conductores')
      .select('id, nombre_completo, capacidad_paradas, disponible')
      .eq('tenant_id', tenantId)
      .eq('estado', 'activo'),
    supabase
      .schema('identidad')
      .from('conductor_zonas')
      .select('conductor_id, zona_id')
      .eq('tenant_id', tenantId),
  ]);

  if (conductores.error) {
    throw new Error(`Error al leer conductores: ${conductores.error.message}`);
  }
  if (asignaciones.error) {
    throw new Error(`Error al leer conductor_zonas: ${asignaciones.error.message}`);
  }

  return {
    conductores: (conductores.data ?? []) as FilaConductor[],
    asignaciones: (asignaciones.data ?? []) as FilaAsignacionZona[],
  };
});

export const obtenerVentanasCorte = cache(async function obtenerVentanasCorte(
  tenantId: string,
): Promise<FilaVentanaCorte[]> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema('identidad')
    .from('ventanas_corte')
    .select('zona_id, hora_corte, activa')
    .eq('tenant_id', tenantId)
    .eq('activa', true);

  if (error) throw new Error(`Error al leer ventanas_corte: ${error.message}`);
  return (data ?? []) as FilaVentanaCorte[];
});

// =============================================================================
// Riesgo persistido — lo que dejó el job, no un recálculo
// =============================================================================

/**
 * Filas de `contexto.riesgo_zona` para la ventana de horizontes y su semana
 * anterior.
 *
 * **El composer NO recalcula el riesgo.** Lee lo que el job dejó, tal cual. Si
 * recalculara por su cuenta, el mapa podría discrepar del puntaje que generó la
 * excepción del riel — y la jerarquía de tres niveles se sostiene justamente
 * sobre que nivel 1, 2 y 3 son el mismo número mirado con más detalle.
 *
 * Que la tabla venga vacía es un estado legítimo (el job todavía no corrió para
 * este tenant): el armado lo traduce a puntaje 0 y lo dice, no lo inventa.
 */
export const obtenerRiesgoZona = cache(async function obtenerRiesgoZona(
  tenantId: string,
  fechaDesde: string,
  fechaHasta: string,
): Promise<FilaRiesgoZona[]> {
  const supabase = crearClienteServiceRole();
  return leerTodasLasFilas<FilaRiesgoZona>('riesgo_zona', (desde, hasta) =>
    supabase
      .schema('contexto')
      .from('riesgo_zona')
      .select(
        'zona_id, fecha, franja, puntaje, desglose, pedidos_pendientes, monto_comprometido_clp, calculado_en',
      )
      .eq('tenant_id', tenantId)
      .gte('fecha', fechaDesde)
      .lte('fecha', fechaHasta)
      .range(desde, hasta),
  );
});

// =============================================================================
// Carga operativa — entregados y conteos
// =============================================================================

/**
 * Pedidos ya entregados con compromiso dentro de la ventana de horizontes.
 *
 * Se leen las filas (no un `count`) porque el desglose es POR ZONA y
 * `operacion.pedidos` no tiene `zona_id`: la agregación comuna→zona la hace la
 * aplicación, con el mismo helper de normalización que escribió `zona_comunas`.
 */
export const obtenerEntregados = cache(async function obtenerEntregados(
  tenantId: string,
  fechaDesde: string,
  fechaHasta: string,
): Promise<FilaEntregado[]> {
  const supabase = crearClienteServiceRole();
  return leerTodasLasFilas<FilaEntregado>('pedidos entregados', (desde, hasta) =>
    supabase
      .schema('operacion')
      .from('pedidos')
      .select('destinatario_comuna, fecha_compromiso')
      .eq('tenant_id', tenantId)
      .in('estado', [...ESTADOS_ENTREGADOS])
      .gte('fecha_compromiso', fechaDesde)
      .lte('fecha_compromiso', fechaHasta)
      .range(desde, hasta),
  );
});

/**
 * Pedidos pendientes de la ventana, con su tarifa.
 *
 * Es el RESPALDO de `riesgo_zona`, no su reemplazo: mientras el job no haya
 * corrido para un tenant, esa tabla está vacía y el tablero mostraría cero
 * pendientes y cero comprometido teniendo la operación llena. Con esto la
 * pantalla sigue diciendo la verdad —cuántos pedidos hay y cuánto valen— aunque
 * el puntaje de riesgo todavía no exista.
 *
 * Cuando SÍ hay fila de riesgo se usa la de la fila, no esta: el motor calculó
 * su presión operativa con ese número y su explicación lo cita literal («86
 * pedidos pendientes contra capacidad de 60»). Mostrar al lado un conteo más
 * fresco haría que el nivel 1 y el nivel 2 se contradijeran en pantalla.
 */
/** Fila de un pedido ya ubicado, para el nivel 3 del mapa. */
export interface FilaPedidoUbicado {
  id: string;
  lat: number;
  long: number;
  estado: string;
  destinatario_comuna: string | null;
}

/**
 * Pedidos del día con coordenada resuelta, para pintarlos en el mapa.
 *
 * ⚠️ **El `select` es deliberadamente corto: NO trae dirección, ni nombre, ni
 * teléfono del destinatario.** El mapa solo necesita el punto y el estado; la
 * dirección se ve al abrir el pedido, en la pantalla de operación. Traer aquí
 * campos que la pantalla no dibuja los expondría en el payload igual, así que
 * la minimización empieza en la consulta y no en el render.
 *
 * `geo_estado = 'resuelto'` es el filtro que garantiza que lat/long no son
 * nulos: el resto queda fuera y lo cuenta el contador de «sin ubicar».
 */
export const obtenerPedidosUbicados = cache(async function obtenerPedidosUbicados(
  tenantId: string,
  fechaDesde: string,
  fechaHasta: string,
): Promise<FilaPedidoUbicado[]> {
  const supabase = crearClienteServiceRole();
  return leerTodasLasFilas<FilaPedidoUbicado>('pedidos ubicados', (desde, hasta) =>
    supabase
      .schema('operacion')
      .from('pedidos')
      .select('id, lat, long, estado, destinatario_comuna')
      .eq('tenant_id', tenantId)
      .eq('geo_estado', 'resuelto')
      .not('lat', 'is', null)
      .gte('fecha_compromiso', fechaDesde)
      .lte('fecha_compromiso', fechaHasta)
      .range(desde, hasta),
  );
});

export const obtenerPedidosPendientes = cache(async function obtenerPedidosPendientes(
  tenantId: string,
  fechaDesde: string,
  fechaHasta: string,
): Promise<PedidoPendienteFila[]> {
  const supabase = crearClienteServiceRole();
  return leerTodasLasFilas<PedidoPendienteFila>('pedidos pendientes', (desde, hasta) =>
    supabase
      .schema('operacion')
      .from('pedidos')
      .select('destinatario_comuna, fecha_compromiso, tarifa_aplicable_id')
      .eq('tenant_id', tenantId)
      .in('estado', [...ESTADOS_PENDIENTES])
      .gte('fecha_compromiso', fechaDesde)
      .lte('fecha_compromiso', fechaHasta)
      .range(desde, hasta),
  );
});

/** Tarifas del courier, para valorizar lo pendiente. */
export const obtenerTarifas = cache(async function obtenerTarifas(
  tenantId: string,
): Promise<{ id: string; monto_clp: number }[]> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema('identidad')
    .from('tarifas')
    .select('id, monto_clp')
    .eq('tenant_id', tenantId);

  if (error) throw new Error(`Error al leer tarifas: ${error.message}`);
  return (data ?? []) as { id: string; monto_clp: number }[];
});

/**
 * Los cuatro conteos del riel, resueltos con `count: 'exact'` en la base.
 *
 * Contar en Postgres y no en la aplicación no es una micro-optimización: traer
 * las filas para contarlas es exactamente donde el tope de 1.000 de PostgREST
 * convierte «hay 3.400 pedidos» en «hay 1.000» sin un solo error.
 */
export const obtenerConteosPedidos = cache(async function obtenerConteosPedidos(
  tenantId: string,
  fechaBase: string,
): Promise<ConteosPedidos> {
  const supabase = crearClienteServiceRole();
  const fechas = [0, 1, 2].map((offset) => sumarDiasCalendario(fechaBase, offset));
  const ultimaFecha = fechas[fechas.length - 1];

  const pedidos = () => supabase.schema('operacion').from('pedidos');
  const soloConteo = { count: 'exact' as const, head: true };

  async function resolver(
    etiqueta: string,
    promesa: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  ): Promise<number> {
    const { count, error } = await promesa;
    if (error) throw new Error(`Error al contar ${etiqueta}: ${error.message}`);
    return count ?? 0;
  }

  const [totales, totalesSemanaAnterior, atrasados, sinGeocodificar] = await Promise.all([
    Promise.all(
      fechas.map((fecha) =>
        resolver(
          `pedidos de ${fecha}`,
          pedidos()
            .select('id', soloConteo)
            .eq('tenant_id', tenantId)
            .eq('fecha_compromiso', fecha),
        ),
      ),
    ),
    Promise.all(
      fechas.map((fecha) => {
        const referencia = sumarDiasCalendario(fecha, -DIAS_COMPARACION);
        return resolver(
          `pedidos de ${referencia}`,
          pedidos()
            .select('id', soloConteo)
            .eq('tenant_id', tenantId)
            .eq('fecha_compromiso', referencia),
        );
      }),
    ),
    resolver(
      'pedidos atrasados',
      pedidos()
        .select('id', soloConteo)
        .eq('tenant_id', tenantId)
        .in('estado', [...ESTADOS_PENDIENTES])
        .lt('fecha_compromiso', fechaBase),
    ),
    resolver(
      'pedidos sin geocodificar',
      pedidos()
        .select('id', soloConteo)
        .eq('tenant_id', tenantId)
        .in('estado', [...ESTADOS_PENDIENTES])
        .neq('geo_estado', 'resuelto')
        .lte('fecha_compromiso', ultimaFecha),
    ),
  ]);

  const totalPorFecha: Record<string, number> = {};
  const totalSemanaAnteriorPorFecha: Record<string, number> = {};
  fechas.forEach((fecha, i) => {
    totalPorFecha[fecha] = totales[i] ?? 0;
    totalSemanaAnteriorPorFecha[fecha] = totalesSemanaAnterior[i] ?? 0;
  });

  return { totalPorFecha, totalSemanaAnteriorPorFecha, atrasados, sinGeocodificar };
});

// =============================================================================
// Flota en vivo
// =============================================================================

export interface FilaUbicacionConductor {
  conductor_id: string;
  lat: number | null;
  long: number | null;
  actualizado_en: string;
}

export interface FilaParadaDeConductor {
  driver_id: string;
  pedido_id: string;
}

/**
 * Última posición conocida de cada conductor del courier.
 *
 * ⚠️ **DATO PERSONAL DEL TRABAJADOR (Ley 21.431).** El modelo guarda a propósito
 * UNA fila por conductor —la última posición— y **no un histórico de recorrido**:
 * es minimización deliberada, no una tabla a medio hacer. Lo que se lee aquí solo
 * viaja a la pantalla de los roles internos del propio courier, que ya tienen esa
 * visibilidad por RLS, y nunca a un log ni a una URL.
 */
export const obtenerFlotaEnVivo = cache(async function obtenerFlotaEnVivo(
  tenantId: string,
): Promise<FilaUbicacionConductor[]> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema('operacion')
    .from('ubicacion_conductor')
    .select('conductor_id, lat, long, actualizado_en')
    .eq('tenant_id', tenantId)
    .not('lat', 'is', null)
    .not('long', 'is', null);

  if (error) throw new Error(`Error al leer ubicacion_conductor: ${error.message}`);
  return (data ?? []) as FilaUbicacionConductor[];
});

/**
 * Paradas asignadas hoy a cada conductor, con el estado de su pedido.
 *
 * Se lee de las asignaciones ACTIVAS del manifiesto del día — no de
 * `pedidos.driver_id_asignado` — porque una reasignación deja el denormalizado
 * apuntando al último conductor y perdería las paradas del primero.
 */
export const obtenerParadasDelDia = cache(async function obtenerParadasDelDia(
  tenantId: string,
  fecha: string,
): Promise<{ driver_id: string; estado: string }[]> {
  const supabase = crearClienteServiceRole();

  const manifiestos = await leerTodasLasFilas<{ id: string; driver_id: string; estado: string }>(
    'manifiestos del día',
    (desde, hasta) =>
      supabase
        .schema('operacion')
        .from('manifiestos')
        .select('id, driver_id, estado')
        .eq('tenant_id', tenantId)
        .eq('fecha_operacion', fecha)
        .neq('estado', 'cancelado')
        .range(desde, hasta),
  );
  if (manifiestos.length === 0) return [];

  const asignaciones = await leerTodasLasFilas<{ manifiesto_id: string; pedido_id: string }>(
    'asignaciones del día',
    (desde, hasta) =>
      supabase
        .schema('operacion')
        .from('asignaciones_pedido')
        .select('manifiesto_id, pedido_id')
        .eq('tenant_id', tenantId)
        .eq('activa', true)
        .in('manifiesto_id', manifiestos.map((m) => m.id))
        .range(desde, hasta),
  );
  if (asignaciones.length === 0) return [];

  const pedidos = await leerTodasLasFilas<{ id: string; estado: string }>(
    'pedidos de las paradas',
    (desde, hasta) =>
      supabase
        .schema('operacion')
        .from('pedidos')
        .select('id, estado')
        .eq('tenant_id', tenantId)
        .in('id', asignaciones.map((a) => a.pedido_id))
        .range(desde, hasta),
  );

  const estadoDePedido = new Map(pedidos.map((p) => [p.id, p.estado]));
  const conductorDeManifiesto = new Map(manifiestos.map((m) => [m.id, m.driver_id]));

  return asignaciones.flatMap((a) => {
    const driverId = conductorDeManifiesto.get(a.manifiesto_id);
    const estado = estadoDePedido.get(a.pedido_id);
    return driverId && estado ? [{ driver_id: driverId, estado }] : [];
  });
});

/** Manifiestos del día por conductor, para saber si ya terminó su ruta. */
export const obtenerManifiestosDelDia = cache(async function obtenerManifiestosDelDia(
  tenantId: string,
  fecha: string,
): Promise<{ driver_id: string; estado: string }[]> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema('operacion')
    .from('manifiestos')
    .select('driver_id, estado')
    .eq('tenant_id', tenantId)
    .eq('fecha_operacion', fecha)
    .neq('estado', 'cancelado');

  if (error) throw new Error(`Error al leer manifiestos: ${error.message}`);
  return (data ?? []) as { driver_id: string; estado: string }[];
});

// =============================================================================
// Calendario comercial — la ola entrante
// =============================================================================

export interface FilaEventoComercial {
  id: string;
  nombre: string;
  arquetipo: 'venta' | 'regalo';
  organizador: string | null;
  inicio: string;
  fin: string;
  multiplicador_base: number;
  curva_rezago: Record<string, number>;
}

/**
 * El catálogo comercial. Es GLOBAL (mismo para todos los couriers) y lo mantiene
 * una migración, no un job: son tres fechas al año que la Cámara de Comercio
 * anuncia con pocas semanas de anticipación, y un scraper para eso se cae solo.
 */
export const obtenerEventosComerciales = cache(async function obtenerEventosComerciales(
  fechaDesde: string,
  fechaHasta: string,
): Promise<FilaEventoComercial[]> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema('contexto')
    .from('eventos_comerciales')
    .select('id, nombre, arquetipo, organizador, inicio, fin, multiplicador_base, curva_rezago')
    // La ventana de entregas puede empezar ANTES del evento (fechas regalo), así
    // que se busca con holgura hacia atrás y el filtro fino lo hace `proximaOla`.
    .gte('fin', fechaDesde)
    .lte('inicio', fechaHasta)
    .order('inicio');

  if (error) throw new Error(`Error al leer eventos_comerciales: ${error.message}`);
  return (data ?? []) as FilaEventoComercial[];
});

/**
 * Volumen base por día de semana: cuántos pedidos mueve este courier un lunes
 * normal, un martes normal, etc.
 *
 * Es la línea base contra la que se mide la ola, y por eso se calcula sobre
 * pedidos REALES del propio courier y no sobre un supuesto. Se leen los últimos
 * `dias` días de compromiso; el promedio por día de semana lo hace el armado.
 *
 * ⚠️ Incluye la ola anterior si cayó dentro de la ventana — un CyberDay reciente
 * infla la base. Es el motivo por el que `contexto.olas_historicas` (§12.5, F3)
 * existe: cuando haya histórico de olas se podrán excluir esos días. Hasta
 * entonces la base es honesta pero cruda, y conviene saberlo al leer la curva.
 */
export const obtenerVolumenBase = cache(async function obtenerVolumenBase(
  tenantId: string,
  fechaDesde: string,
  fechaHasta: string,
): Promise<{ fecha_compromiso: string }[]> {
  const supabase = crearClienteServiceRole();
  return leerTodasLasFilas<{ fecha_compromiso: string }>('volumen base', (desde, hasta) =>
    supabase
      .schema('operacion')
      .from('pedidos')
      .select('fecha_compromiso')
      .eq('tenant_id', tenantId)
      .gte('fecha_compromiso', fechaDesde)
      .lte('fecha_compromiso', fechaHasta)
      .range(desde, hasta),
  );
});

/**
 * Días entre que un pedido entra y su fecha de compromiso, por comuna.
 *
 * Es «el tiempo real del courier» del que habla §12.4: sirve para decirle al
 * seller hasta cuándo puede vender para que el regalo llegue antes de la fecha.
 * Se mide, no se supone — una fecha límite calculada sobre un supuesto es lo que
 * hace que un seller pierda una venta.
 */
export const obtenerPlazosDeEntrega = cache(async function obtenerPlazosDeEntrega(
  tenantId: string,
  fechaDesde: string,
  fechaHasta: string,
): Promise<{ destinatario_comuna: string; fecha_compromiso: string; creado_en: string }[]> {
  const supabase = crearClienteServiceRole();
  return leerTodasLasFilas<{
    destinatario_comuna: string;
    fecha_compromiso: string;
    creado_en: string;
  }>('plazos de entrega', (desde, hasta) =>
    supabase
      .schema('operacion')
      .from('pedidos')
      .select('destinatario_comuna, fecha_compromiso, creado_en')
      .eq('tenant_id', tenantId)
      .in('estado', [...ESTADOS_ENTREGADOS])
      .gte('fecha_compromiso', fechaDesde)
      .lte('fecha_compromiso', fechaHasta)
      .range(desde, hasta),
  );
});

// =============================================================================
// Contexto externo — las tablas globales del carve-out
// =============================================================================

export interface ContextoExterno {
  clima: FilaClimaHorario[];
  aire: FilaAireHorario[];
  restricciones: FilaRestriccion[];
}

/**
 * Clima, aire y restricción vehicular de la ventana.
 *
 * El filtro por comuna acota a las que el courier realmente opera. Va como
 * string separado por comas y no como arreglo para que `cache()` pueda usarlo
 * de clave: `cache()` compara argumentos por identidad, y dos arreglos con el
 * mismo contenido son objetos distintos — la memoización no dispararía nunca.
 */
export const obtenerContextoExterno = cache(async function obtenerContextoExterno(
  comunasCsv: string,
  fechaDesde: string,
  fechaHasta: string,
): Promise<ContextoExterno> {
  const supabase = crearClienteServiceRole();
  const comunas = comunasCsv ? comunasCsv.split(',') : [];

  if (comunas.length === 0) {
    return { clima: [], aire: [], restricciones: [] };
  }

  // `limitesDelDiaSantiago` y no un literal UTC: Santiago es −04:00 en invierno
  // y −03:00 en verano, y un offset fijo corre la ventana media hora larga del
  // año.
  const desdeInstante = limitesDelDiaSantiago(fechaDesde).desde.toISOString();
  const hastaInstante = limitesDelDiaSantiago(fechaHasta).hasta.toISOString();

  const [clima, aire, restricciones] = await Promise.all([
    leerTodasLasFilas<FilaClimaHorario>('clima_horario', (desde, hasta) =>
      supabase
        .schema('contexto')
        .from('clima_horario')
        .select('comuna, hora, precipitacion_mm, viento_kmh')
        .in('comuna', comunas)
        .gte('hora', desdeInstante)
        .lte('hora', hastaInstante)
        .range(desde, hasta),
    ),
    leerTodasLasFilas<FilaAireHorario>('aire_horario', (desde, hasta) =>
      supabase
        .schema('contexto')
        .from('aire_horario')
        .select('comuna, hora, pm25, nivel_estimado')
        .in('comuna', comunas)
        .gte('hora', desdeInstante)
        .lte('hora', hastaInstante)
        .range(desde, hasta),
    ),
    leerTodasLasFilas<FilaRestriccion>('restriccion_vehicular', (desde, hasta) =>
      supabase
        .schema('contexto')
        .from('restriccion_vehicular')
        .select('fecha, tipo, digitos, alcance')
        .gte('fecha', fechaDesde)
        .lte('fecha', fechaHasta)
        .range(desde, hasta),
    ),
  ]);

  return { clima, aire, restricciones };
});

// =============================================================================
// Marcas operativas y señales de prensa
// =============================================================================

/**
 * Marcas que el coordinador puso a mano y siguen vigentes en la ventana.
 *
 * ⚠️ `nota` es texto libre y PUEDE CONTENER DATOS PERSONALES (el propio dummy
 * del contrato dice «Confirmado por Marcelo»). No debe salir en logs ni en
 * URLs, y si alguna vez se le pasa a un LLM, pasa antes por
 * `seguridad-cumplimiento`. Aquí solo viaja a la pantalla del courier dueño.
 */
export const obtenerMarcasOperativas = cache(async function obtenerMarcasOperativas(
  tenantId: string,
  fechaDesde: string,
  fechaHasta: string,
): Promise<FilaMarcaOperativa[]> {
  const supabase = crearClienteServiceRole();
  const desdeInstante = limitesDelDiaSantiago(fechaDesde).desde.toISOString();
  const hastaInstante = limitesDelDiaSantiago(fechaHasta).hasta.toISOString();

  return leerTodasLasFilas<FilaMarcaOperativa>('marcas_operativas', (desde, hasta) =>
    supabase
      .schema('contexto')
      .from('marcas_operativas')
      .select('id, lat, long, radio_m, nota, vigencia_inicio, vigencia_fin, autor_usuario_id, creada_en')
      .eq('tenant_id', tenantId)
      .lte('vigencia_inicio', hastaInstante)
      .or(`vigencia_fin.is.null,vigencia_fin.gte.${desdeInstante}`)
      .range(desde, hasta),
  );
});

/** Nombres de los autores de las marcas, para mostrarlos en vez de un UUID. */
export const obtenerNombresDeUsuarios = cache(async function obtenerNombresDeUsuarios(
  tenantId: string,
  usuarioIdsCsv: string,
): Promise<Map<string, string>> {
  const ids = usuarioIdsCsv ? usuarioIdsCsv.split(',') : [];
  if (ids.length === 0) return new Map();

  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema('identidad')
    .from('usuarios_perfil')
    // `usuarios_perfil.id` ES el uuid de `auth.users`: no hay columna aparte.
    .select('id, nombre_completo')
    .eq('tenant_id', tenantId)
    .in('id', ids);

  if (error) throw new Error(`Error al leer usuarios_perfil: ${error.message}`);

  const nombres = new Map<string, string>();
  for (const fila of data ?? []) {
    nombres.set(fila.id as string, fila.nombre_completo as string);
  }
  return nombres;
});

/**
 * Señales de prensa del tenant: la parte global (el acontecimiento) unida a la
 * parte del courier (cuántos pedidos suyos toca, qué zonas suyas).
 *
 * El desdoblamiento es lo que impide que el volumen de pedidos de un courier
 * quede visible en la fila global que leen todos los demás. Aquí se vuelven a
 * unir, ya filtrado por tenant.
 *
 * Hoy devuelve vacío: el radar de prensa (bloque D, §13) todavía no tiene sus
 * jobs. La consulta existe para que encender ese bloque no obligue a tocar el
 * composer.
 */
export const obtenerSenalesDelTenant = cache(async function obtenerSenalesDelTenant(
  tenantId: string,
  fechaHasta: string,
): Promise<FilaSenalTenant[]> {
  const supabase = crearClienteServiceRole();
  const hastaInstante = limitesDelDiaSantiago(fechaHasta).hasta.toISOString();

  // El recorte fino de la ventana (¿la señal sigue en curso el día que miro?)
  // lo hace el armado sobre las filas ya traídas: son pocas, y expresar «fin es
  // nulo O fin >= X» sobre un recurso EMBEBIDO en PostgREST es frágil de un
  // modo que no compensa. Aquí se acota solo por el borde superior, que sí es
  // un filtro simple sobre la tabla embebida.
  return leerTodasLasFilas<FilaSenalTenant>('senales del tenant', (desde, hasta) =>
    supabase
      .schema('contexto')
      .from('senales_tenant')
      .select(
        'senal_id, pedidos_en_rango, zonas_afectadas, marca_humana, ' +
          'senales!inner(id, titulo, resumen, tipo, comunas, ejes_viales, ventana_inicio, ventana_fin, severidad, confianza, afecta_operacion, fuentes)',
      )
      .eq('tenant_id', tenantId)
      .eq('senales.clasificacion_estado', 'clasificada')
      .lte('senales.ventana_inicio', hastaInstante)
      .range(desde, hasta)
      .returns<FilaSenalTenant[]>(),
  );
});
