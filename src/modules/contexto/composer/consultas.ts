/**
 * Composer de la Torre v2 — la capa de I/O, memoizada por request.
 * =====================================================================
 *
 * Aquí vive TODO lo que toca la base para armar la pantalla, y nada más:
 * ninguna de estas funciones decide, agrega ni redacta. Eso es de los módulos de
 * `armado-*.ts`, que son puros y se prueban sin base.
 *
 * -----------------------------------------------------------------------------
 * DE DÓNDE SALE «ENTREGADO» — la decisión que gobierna este archivo
 * -----------------------------------------------------------------------------
 * La Torre cuenta lo que el conductor declaró en la **app de Rutax**, no lo que
 * dice el estado oficial del pedido. Son dos tablas, según la fuente:
 *
 *   · **same-day** → `operacion.pruebas_entrega`. Es el POD AUTORITATIVO: su foto
 *     ES la confirmación y además mueve `pedidos.estado`. La Torre y el estado
 *     oficial coinciden siempre.
 *   · **Flex** → `operacion.cierres_conductor`. Es el registro PARALELO del
 *     courier: el conductor cierra la parada en Rutax, pero el estado oficial lo
 *     sigue gobernando la app de Mercado Envíos (obligatoria y no integrable), y
 *     llega con retraso por la sincronización.
 *
 * **La consecuencia, dicha de frente:** durante unas horas la Torre puede mostrar
 * menos pendientes que `/operaciones`, porque va por delante del estado oficial.
 * Es deliberado (decisión del usuario, 2026-08-03) y la pantalla lo declara. El
 * motor entrega→dinero NO se toca: sigue rigiéndose por el estado oficial.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ `cache()` DE REACT
 * -----------------------------------------------------------------------------
 * La pantalla pide trozos que se solapan desde varias regiones con `<Suspense>`
 * independiente. `cache()` memoiza **por request** —no entre requests: no es un
 * caché de datos, es deduplicación—, así dos regiones que piden lo mismo
 * comparten un solo viaje y ninguna espera a la otra.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ `service_role` Y CÓMO NO CONVERTIRLO EN UN AGUJERO
 * -----------------------------------------------------------------------------
 * Las tablas de referencia de `contexto` son **deny-all**: RLS forzada sin
 * políticas y sin un solo grant a `authenticated` (que en este repo incluye
 * seller y conductor). Se leen con `crearClienteServiceRole()` desde acá; no hay
 * otra puerta.
 *
 * La contrapartida es que `service_role` bypassa RLS, así que el aislamiento de
 * las tablas POR TENANT queda en manos de este archivo. Dos reglas, sin
 * excepciones:
 *
 *   1. **Toda consulta a una tabla de negocio lleva `.eq('tenant_id', tenantId)`.**
 *      Si ves una que no lo lleva, es un bug de aislamiento, no un descuido.
 *   2. **`tenantId` viene SIEMPRE de la sesión validada** (`sesion.usuario.tenantId`
 *      + `puedeVerTorreControl`). Nunca de la URL, de un query param ni de un header.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SE PAGINA
 * -----------------------------------------------------------------------------
 * PostgREST corta en `max_rows = 1000` **sin avisar**. Todo lo que después se
 * agrega se lee con `leerTodasLasFilas`. Contar pedidos por comuna es exactamente
 * el patrón que ese tope arruina: no produce un error, produce un tablero con
 * cifras plausibles y equivocadas. Ya mordió una vez al job de riesgo.
 *
 * -----------------------------------------------------------------------------
 * ZONA HORARIA
 * -----------------------------------------------------------------------------
 * Todas las fechas son civiles de Santiago y todos los rangos de instante salen
 * de `limitesDelDiaSantiago`. Nunca UTC: a las 21:00 de Santiago UTC ya está en
 * el día siguiente, y el tablero mostraría el día equivocado sin fallar.
 */

import { cache } from 'react';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { leerTodasLasFilas } from '@/lib/supabase/leer-paginado';
import { limitesDelDiaSantiago } from '@/lib/fecha-santiago';

// =============================================================================
// Constantes de dominio
// =============================================================================

/**
 * Estados de pedido que cuentan como carga del día.
 *
 * Se enumeran los que ENTRAN y no los que salen (`cancelado`, `devuelto`) por dos
 * razones: `.in()` mantiene la inferencia de tipos de PostgREST, que `.not(…,
 * 'in', …)` pierde; y si mañana se agrega un estado nuevo al enum, quedará fuera
 * de la carga hasta que alguien lo agregue acá a conciencia — que es la falla
 * segura correcta para un contador.
 *
 * Un pedido cancelado o devuelto nunca se va a entregar: sumarlo al denominador
 * de «38 de 120» inflaría el total con paquetes que nadie está esperando.
 */
export const ESTADOS_DE_CARGA = [
  'pendiente_asignacion',
  'asignado',
  'en_ruta',
  'entregado',
  'entregado_manual',
  'fallido',
  'fallido_manual',
] as const;

/** Estados de incidencia que siguen pidiendo atención. */
export const ESTADOS_INCIDENCIA_ABIERTA = ['abierta', 'en_gestion'] as const;

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

/**
 * Un pedido del día, reducido a lo que la Torre dibuja.
 *
 * ⚠️ **El `select` es deliberadamente corto: NO trae dirección, ni nombre, ni
 * teléfono del destinatario, ni `tracking_token`.** La minimización empieza en la
 * consulta y no en el render — un campo que la pantalla no dibuja pero que viaja
 * en el payload está expuesto igual. Ver el encabezado de `contrato-torre.ts`.
 */
export interface FilaPedidoDelDia {
  id: string;
  estado: string;
  destinatario_comuna: string | null;
  /** Código de envío de Flex. */
  ml_shipment_id: string | null;
  /** Código de envío de same-day (`RX-XXXX-XXXX`). */
  codigo_interno: string | null;
  driver_id_asignado: string | null;
  lat: number | null;
  long: number | null;
  geo_estado: string | null;
}

/** Cierre operativo declarado por el conductor en la app de Rutax (Flex y same-day). */
export interface FilaCierreConductor {
  pedido_id: string;
  conductor_id: string;
  resultado: 'entregado' | 'no_entregado';
  cerrado_en: string;
}

/** POD autoritativo del same-day propio. */
export interface FilaPruebaEntrega {
  pedido_id: string;
  conductor_id: string;
  tipo_resultado: string;
  capturado_en: string;
}

export interface FilaIncidenciaAbierta {
  id: string;
  pedido_id: string;
  tipo: string;
  estado: string;
  abierta_en: string;
}

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

// =============================================================================
// Cabecera
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

// =============================================================================
// Configuración del courier — zonas, capacidad, cortes
// =============================================================================

/**
 * Las zonas del courier y su mapeo a comunas.
 *
 * **En la v2 las zonas NO agregan el mapa** —la unidad es la comuna—, pero
 * siguen haciendo falta para dos cosas: resolver qué ventana de corte aplica a
 * cada comuna (F7) y colgar un `zonaId` del que puedan pender los enlaces
 * profundos. Un courier sin zonas configuradas es un caso normal, no un estado
 * degradado: las comunas de la RM existen igual.
 */
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
 * Conductores activos + sus zonas preferentes.
 *
 * Se traen los NO disponibles a propósito: el panel de F13 muestra el avance de
 * quien está en la calle hoy, y alguien marcado no-disponible que igual tiene
 * paradas asignadas es justamente el caso que hay que ver. La CAPACIDAD para la
 * brecha de la ola, en cambio, se calcula solo con los disponibles.
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
// La carga del día — una sola lectura, todo lo demás se deriva
// =============================================================================

/**
 * Todos los pedidos con compromiso de HOY.
 *
 * **Una sola consulta, no cuatro.** En la v1 había `obtenerEntregados`,
 * `obtenerPedidosPendientes`, `obtenerPedidosUbicados` y `obtenerConteosPedidos`,
 * cada una con su propio filtro de estado. Con la comuna como unidad hace falta
 * la fracción completa —cuántos hay, cuántos faltan, cuántos no se pudieron
 * ubicar— y esas cuatro consultas podían contradecirse entre sí en el borde de
 * un cambio de estado concurrente. Una lectura y una derivación no pueden.
 *
 * Se leen también los pedidos SIN geocodificar: son los que alimentan el contador
 * de «sin ubicar» (F8). Un mapa que esconde lo que no pudo ubicar miente sobre la
 * carga real.
 */
export const obtenerPedidosDelDia = cache(async function obtenerPedidosDelDia(
  tenantId: string,
  fecha: string,
): Promise<FilaPedidoDelDia[]> {
  const supabase = crearClienteServiceRole();
  return leerTodasLasFilas<FilaPedidoDelDia>('pedidos del día', (desde, hasta) =>
    supabase
      .schema('operacion')
      .from('pedidos')
      // Un solo literal, sin concatenar con `+`: la concatenación ensancha el
      // tipo a `string` y supabase-js pierde la inferencia del `select`.
      .select(
        'id, estado, destinatario_comuna, ml_shipment_id, codigo_interno, driver_id_asignado, lat, long, geo_estado',
      )
      .eq('tenant_id', tenantId)
      .eq('fecha_compromiso', fecha)
      .in('estado', [...ESTADOS_DE_CARGA])
      .range(desde, hasta),
  );
});

/**
 * Los cierres que los conductores declararon hoy en la app de Rutax.
 *
 * Aplica a **Flex y same-day** (la tabla no tiene frontera de tipo). Para Flex es
 * la ÚNICA señal de entrega que Rutax tiene en el momento, porque el POD lo
 * gobierna Mercado Envíos.
 *
 * Se acota por instante de cierre y no por la fecha del pedido: un conductor que
 * cierra a las 23:40 una parada comprometida para hoy tiene que contar hoy.
 */
export const obtenerCierresDelDia = cache(async function obtenerCierresDelDia(
  tenantId: string,
  fecha: string,
): Promise<FilaCierreConductor[]> {
  const supabase = crearClienteServiceRole();
  const { desde: inicioDia, hasta: finDia } = limitesDelDiaSantiago(fecha);

  return leerTodasLasFilas<FilaCierreConductor>('cierres del conductor', (desde, hasta) =>
    supabase
      .schema('operacion')
      .from('cierres_conductor')
      .select('pedido_id, conductor_id, resultado, cerrado_en')
      .eq('tenant_id', tenantId)
      .gte('cerrado_en', inicioDia.toISOString())
      .lte('cerrado_en', finDia.toISOString())
      .range(desde, hasta),
  );
});

/**
 * Los POD del same-day capturados hoy.
 *
 * Es el registro autoritativo: a diferencia del cierre, este SÍ movió el estado
 * del pedido. Se lee igual porque su `capturado_en` es la marca de tiempo con la
 * que se mide la frescura (F6) y el ritmo del conductor (F13) — el estado del
 * pedido no guarda CUÁNDO cambió.
 */
export const obtenerPodDelDia = cache(async function obtenerPodDelDia(
  tenantId: string,
  fecha: string,
): Promise<FilaPruebaEntrega[]> {
  const supabase = crearClienteServiceRole();
  const { desde: inicioDia, hasta: finDia } = limitesDelDiaSantiago(fecha);

  return leerTodasLasFilas<FilaPruebaEntrega>('pruebas de entrega', (desde, hasta) =>
    supabase
      .schema('operacion')
      .from('pruebas_entrega')
      .select('pedido_id, conductor_id, tipo_resultado, capturado_en')
      .eq('tenant_id', tenantId)
      .gte('capturado_en', inicioDia.toISOString())
      .lte('capturado_en', finDia.toISOString())
      .range(desde, hasta),
  );
});

/**
 * Incidencias todavía abiertas de los pedidos de hoy.
 *
 * Es lo único que se pinta en rojo en la pantalla (regla 4 del alcance). Se
 * filtra por los pedidos del día ya leídos en vez de por fecha de apertura: una
 * incidencia abierta ayer sobre un pedido que sigue comprometido para hoy tiene
 * que seguir apareciendo.
 */
export const obtenerIncidenciasAbiertas = cache(async function obtenerIncidenciasAbiertas(
  tenantId: string,
  pedidoIdsCsv: string,
): Promise<FilaIncidenciaAbierta[]> {
  const pedidoIds = pedidoIdsCsv ? pedidoIdsCsv.split(',') : [];
  if (pedidoIds.length === 0) return [];

  const supabase = crearClienteServiceRole();
  return leerTodasLasFilas<FilaIncidenciaAbierta>('incidencias abiertas', (desde, hasta) =>
    supabase
      .schema('operacion')
      .from('incidencias')
      .select('id, pedido_id, tipo, estado, abierta_en')
      .eq('tenant_id', tenantId)
      .in('estado', [...ESTADOS_INCIDENCIA_ABIERTA])
      .in('pedido_id', pedidoIds)
      .range(desde, hasta),
  );
});

/**
 * Paradas asignadas hoy a cada conductor (F13, el denominador de «12 de 40»).
 *
 * Se lee de las asignaciones ACTIVAS del manifiesto del día —no de
 * `pedidos.driver_id_asignado`— porque una reasignación deja el denormalizado
 * apuntando al último conductor y perdería las paradas del primero.
 */
export const obtenerParadasDelDia = cache(async function obtenerParadasDelDia(
  tenantId: string,
  fecha: string,
): Promise<{ driver_id: string; pedido_id: string }[]> {
  const supabase = crearClienteServiceRole();

  const manifiestos = await leerTodasLasFilas<{ id: string; driver_id: string }>(
    'manifiestos del día',
    (desde, hasta) =>
      supabase
        .schema('operacion')
        .from('manifiestos')
        .select('id, driver_id')
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
        .in(
          'manifiesto_id',
          manifiestos.map((m) => m.id),
        )
        .range(desde, hasta),
  );

  const conductorDeManifiesto = new Map(manifiestos.map((m) => [m.id, m.driver_id]));
  return asignaciones.flatMap((a) => {
    const driverId = conductorDeManifiesto.get(a.manifiesto_id);
    return driverId ? [{ driver_id: driverId, pedido_id: a.pedido_id }] : [];
  });
});

// =============================================================================
// Calendario comercial — las olas entrantes (F9)
// =============================================================================

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
    // que se busca con holgura hacia atrás y el filtro fino lo hacen las olas.
    .gte('fin', fechaDesde)
    .lte('inicio', fechaHasta)
    .order('inicio');

  if (error) throw new Error(`Error al leer eventos_comerciales: ${error.message}`);
  return (data ?? []) as FilaEventoComercial[];
});

/**
 * Volumen base por día de semana: cuántos pedidos mueve este courier un lunes
 * normal, un martes normal, etc. Es la línea base contra la que se mide la ola, y
 * por eso se calcula sobre pedidos REALES del propio courier.
 *
 * ⚠️ Incluye la ola anterior si cayó dentro de la ventana — un CyberDay reciente
 * infla la base. Es honesta pero cruda, y conviene saberlo al leer la brecha.
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
