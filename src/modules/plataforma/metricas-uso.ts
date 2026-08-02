/**
 * Métricas de USO agregadas de TODA la plataforma (F3, gap 2 AMPLIADO —
 * dashboard de negocio del backstage admin).
 * =============================================================================
 * Complementa a `obtenerMetricasNegocio` (`metricas-negocio.ts`, que agrega
 * SOLO el schema `plataforma`: MRR/ARR/churn/morosidad de las suscripciones
 * de los couriers A Rutax) con el volumen de USO real de la plataforma,
 * agregado sobre TODOS los tenants: GMV procesado por el motor
 * entrega→dinero, pedidos, DTEs emitidos, conductores activos.
 *
 * Vive en un archivo APARTE (no extiende `metricas-negocio.ts`): cruza un
 * footprint de esquemas distinto y más amplio (`operacion`, `dinero`,
 * `identidad`, además de `plataforma`) — mantener cada archivo con un
 * perímetro de acceso auditable por separado, en vez de un único archivo que
 * mezcle "cuánto nos paga cada courier" (financiero DE PLATAFORMA, un solo
 * schema) con "cuánto se mueve en la plataforma" (uso agregado DEL NEGOCIO
 * de cada courier, cross-schema). Mismo patrón `service_role`, admin-only,
 * solo lectura, que `obtenerMetricasNegocio`/`obtenerObservabilidadTenant`:
 * esta función NO verifica `tieneSesionAdmin()` por sí misma — el LLAMADOR
 * (la página/Server Action de `/admin/*`) debe exigirlo ANTES de invocarla.
 *
 * INVARIANTE (multitenant-rls / motor-entrega-dinero): todo lo que devuelve
 * es un AGREGADO (conteo o suma) cruzando todos los tenants — NUNCA una fila
 * identificable de un courier, seller, conductor o pedido individual. Esto es
 * lo único que justifica leer cross-tenant desde `service_role` fuera del
 * aislamiento normal por RLS: es el dashboard del DUEÑO DE RUTAX viendo la
 * salud agregada de SU negocio, no un reporte por-courier (para eso está
 * `observabilidad-tenant.ts`, que sí filtra por `tenantId` y a propósito NO
 * se usa aquí). Sin PII: ningún campo de destinatario/conductor/seller
 * individual sale de este módulo.
 *
 * Fuentes (confirmadas contra el esquema real, `supabase/migrations/`,
 * NO adivinadas):
 * - GMV: `dinero.periodos_cobro.monto_total_clp` — el monto BRUTO (neto+IVA)
 *   que el motor entrega→dinero ya calculó al CERRAR cada período (job C2,
 *   `dinero/jobs/cerrar-periodo.ts`, columna poblada en el UPDATE a
 *   `estado='cerrado'`). Es una tabla YA pre-agregada por período/seller (una
 *   fila por período de cobro, no una fila por pedido como `lineas_cobro`),
 *   así que sumarla cross-tenant es barato — mismo criterio que
 *   `obtenerResumenFinancieroDelMes` en `operacion/metricas.ts` (ahí por
 *   tenant, aquí sumado sobre todos). Se excluye `estado='anulado'`. Los
 *   períodos aún `abierto` aportan 0 (su `monto_total_clp` es NULL hasta que
 *   C2 los cierra) — intencional: "procesado" = ya pasó por el cierre del
 *   motor, no lo que todavía se está acumulando sin cerrar.
 * - Pedidos: `operacion.pedidos`, conteos `exact head:true` (mismo patrón que
 *   `operacion/metricas.ts` y `observabilidad-tenant.ts`, aquí sin filtro de
 *   `tenant_id` — cross-tenant a propósito).
 * - DTEs emitidos: `dinero.documentos_dte` con `tipo_documento = 33` (factura
 *   electrónica — 61 es nota de crédito, se excluye a propósito, no es una
 *   emisión de cobro). Cada fila representa un DTE que YA fue emitido al
 *   proveedor (se inserta en `jobs/emitir-dte-periodo.ts` DESPUÉS de la
 *   llamada exitosa al proveedor, nunca antes de intentarla) — no hace falta
 *   filtrar además por `estado_sii`/`estado_proveedor`.
 * - Conductores activos: `identidad.conductores` con `estado = 'activo'`.
 * - Opcional: `plataforma.suscripciones` con `estado = 'activa'` para
 *   "couriers activos" (`tenant_id` es UNIQUE en esa tabla — migración
 *   20260621000015 — 1:1 con tenant, sin riesgo de doble conteo) e
 *   `identidad.sellers` (total, sin filtro de estado: conteo simple, no
 *   exige un JOIN).
 *
 * Qué quedó FUERA por costo (anotado, no forzado):
 * - GMV histórico por-mes (serie temporal de varios meses) — exigiría o bien
 *   escanear/agrupar `lineas_cobro` por mes (cara, sin índice por mes) o una
 *   vista materializada nueva (migración). Se deja para cuando se decida
 *   abordar series temporales en el backstage; hoy solo se expone
 *   mes-en-curso + total acumulado.
 * - "Pedidos por estado" completo (todo el catálogo de `EstadoPedido`, no
 *   solo entregados) — barato de agregar en sí, pero no se incluye aquí para
 *   no multiplicar counts sin un consumidor concreto; si el frontend lo
 *   necesita, es una extensión de una línea (mismo patrón `porEstado` de
 *   `operacion/metricas.ts`).
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { ahoraEnSantiago, combinarFechaHoraSantiago, sumarDiasCalendario } from '@/lib/fecha-santiago';

type ClienteServiceRole = ReturnType<typeof crearClienteServiceRole>;

/** Tipo de documento SII: 33 = factura electrónica (se factura al seller). */
const TIPO_DOCUMENTO_FACTURA = 33;

/** Estados de pedido considerados "entregado" (éxito), para el conteo del mes. */
const ESTADOS_ENTREGADO: readonly string[] = ['entregado', 'entregado_manual'];

export interface MetricasUsoPlataforma {
  gmv: {
    /** Suma de `periodos_cobro.monto_total_clp` (no anulados) cerrados/facturados
     *  cuyo `fecha_inicio` cae en el mes calendario Santiago actual. CLP entero. */
    mesActualClp: number;
    /** Igual que `mesActualClp`, pero sin acotar por fecha (histórico completo). */
    totalClp: number;
  };
  pedidos: {
    /** Total histórico, todos los tenants, cualquier estado. */
    total: number;
    /** Pedidos creados (`creado_en`) en el mes calendario Santiago actual. */
    mes: number;
    /** De los del mes: cuántos llegaron a `entregado`/`entregado_manual`. */
    entregadosMes: number;
  };
  dtesEmitidos: {
    /** Total histórico de facturas (tipo_documento=33) emitidas, todos los tenants. */
    total: number;
    /** Facturas emitidas (`fecha_emision`) en el mes calendario Santiago actual. */
    mes: number;
  };
  /** `identidad.conductores` con `estado='activo'`, todos los tenants. */
  conductoresActivos: number;
  /** `plataforma.suscripciones` con `estado='activa'` (1:1 con tenant). */
  couriersActivos: number;
  /** `identidad.sellers`, total histórico, todos los tenants. */
  sellersTotal: number;
}

/**
 * Límites del mes calendario Santiago actual, en las DOS representaciones que
 * necesitan las columnas involucradas: `fecha_inicio`/`fecha_emision` son
 * `date` (comparación de string 'YYYY-MM-DD'), `creado_en` es `timestamptz`
 * (comparación de instante). Mismo algoritmo que el `limitesMesActualSantiago`
 * privado de `metricas-negocio.ts` — se recalcula aquí (no se importa) porque
 * ese es privado y este módulo necesita además las variantes string, que la
 * versión de `metricas-negocio.ts` no expone.
 */
function limitesMesActualSantiago(): {
  primerDia: string;
  primerDiaSiguiente: string;
  inicioInstanteIso: string;
  finInstanteExclusivoIso: string;
} {
  const { fecha: hoy } = ahoraEnSantiago();
  const primerDia = `${hoy.slice(0, 7)}-01`;
  const primerDiaSiguiente = sumarDiasCalendario(primerDia, 32).slice(0, 7) + '-01';
  return {
    primerDia,
    primerDiaSiguiente,
    inicioInstanteIso: combinarFechaHoraSantiago(primerDia, '00:00').toISOString(),
    finInstanteExclusivoIso: combinarFechaHoraSantiago(primerDiaSiguiente, '00:00').toISOString(),
  };
}

/**
 * GMV: suma `dinero.periodos_cobro.monto_total_clp` (no anulados) en una sola
 * pasada — total histórico y, del mismo resultado, lo acotado al mes actual
 * (evita una segunda consulta: un solo `select` sin filtro de fecha, reducido
 * dos veces en memoria). Ver rationale de la fuente en el header del archivo.
 */
async function calcularGmv(
  supabase: ClienteServiceRole,
  primerDiaMes: string,
  primerDiaMesSiguiente: string,
): Promise<{ mesActualClp: number; totalClp: number }> {
  const { data, error } = await supabase
    .schema('dinero')
    .from('periodos_cobro')
    .select('monto_total_clp, fecha_inicio')
    .neq('estado', 'anulado');

  if (error) throw new Error(`Error al calcular GMV de la plataforma: ${error.message}`);

  let totalClp = 0;
  let mesActualClp = 0;
  for (const p of data ?? []) {
    const monto = Math.round(Number(p.monto_total_clp ?? 0));
    totalClp += monto;
    const fechaInicio = p.fecha_inicio as string;
    if (fechaInicio >= primerDiaMes && fechaInicio < primerDiaMesSiguiente) {
      mesActualClp += monto;
    }
  }
  return { mesActualClp, totalClp };
}

/**
 * Cuenta `operacion.pedidos`, todos los tenants. Filtros opcionales:
 * `creado_en` en [`desdeIso`, `hastaIsoExclusivo`) y/o `estado IN estados`.
 */
async function contarPedidos(
  supabase: ClienteServiceRole,
  opciones?: { desdeIso?: string; hastaIsoExclusivo?: string; estados?: readonly string[] },
): Promise<number> {
  let query = supabase
    .schema('operacion')
    .from('pedidos')
    .select('id', { count: 'exact', head: true });

  if (opciones?.desdeIso && opciones?.hastaIsoExclusivo) {
    query = query.gte('creado_en', opciones.desdeIso).lt('creado_en', opciones.hastaIsoExclusivo);
  }
  if (opciones?.estados) {
    query = query.in('estado', [...opciones.estados]);
  }

  const { count, error } = await query;
  if (error) throw new Error(`Error al contar pedidos de la plataforma: ${error.message}`);
  return count ?? 0;
}

/**
 * Cuenta `dinero.documentos_dte` con `tipo_documento=33` (factura), todos los
 * tenants. Filtro opcional de `fecha_emision` en [`desde`, `hastaExclusivo`)
 * ('YYYY-MM-DD', columna `date`).
 */
async function contarDtesEmitidos(
  supabase: ClienteServiceRole,
  ventana?: { desde: string; hastaExclusivo: string },
): Promise<number> {
  let query = supabase
    .schema('dinero')
    .from('documentos_dte')
    .select('id', { count: 'exact', head: true })
    .eq('tipo_documento', TIPO_DOCUMENTO_FACTURA);

  if (ventana) {
    query = query.gte('fecha_emision', ventana.desde).lt('fecha_emision', ventana.hastaExclusivo);
  }

  const { count, error } = await query;
  if (error) throw new Error(`Error al contar DTEs emitidos de la plataforma: ${error.message}`);
  return count ?? 0;
}

async function contarConductoresActivos(supabase: ClienteServiceRole): Promise<number> {
  const { count, error } = await supabase
    .schema('identidad')
    .from('conductores')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'activo');

  if (error) throw new Error(`Error al contar conductores activos de la plataforma: ${error.message}`);
  return count ?? 0;
}

async function contarCouriersActivos(supabase: ClienteServiceRole): Promise<number> {
  const { count, error } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'activa');

  if (error) throw new Error(`Error al contar couriers activos: ${error.message}`);
  return count ?? 0;
}

async function contarSellersTotal(supabase: ClienteServiceRole): Promise<number> {
  const { count, error } = await supabase
    .schema('identidad')
    .from('sellers')
    .select('id', { count: 'exact', head: true });

  if (error) throw new Error(`Error al contar sellers de la plataforma: ${error.message}`);
  return count ?? 0;
}

/**
 * Métricas de uso agregadas de TODA la plataforma (cross-tenant), para el
 * dashboard de negocio del backstage admin. Solo lectura, `service_role`,
 * ADMIN-ONLY — ver invariantes y fuentes en el header del archivo.
 */
export async function obtenerMetricasUsoPlataforma(): Promise<MetricasUsoPlataforma> {
  const supabase = crearClienteServiceRole();
  const { primerDia, primerDiaSiguiente, inicioInstanteIso, finInstanteExclusivoIso } =
    limitesMesActualSantiago();

  const [
    gmv,
    pedidosTotal,
    pedidosMes,
    pedidosEntregadosMes,
    dtesTotal,
    dtesMes,
    conductoresActivos,
    couriersActivos,
    sellersTotal,
  ] = await Promise.all([
    calcularGmv(supabase, primerDia, primerDiaSiguiente),
    contarPedidos(supabase),
    contarPedidos(supabase, { desdeIso: inicioInstanteIso, hastaIsoExclusivo: finInstanteExclusivoIso }),
    contarPedidos(supabase, {
      desdeIso: inicioInstanteIso,
      hastaIsoExclusivo: finInstanteExclusivoIso,
      estados: ESTADOS_ENTREGADO,
    }),
    contarDtesEmitidos(supabase),
    contarDtesEmitidos(supabase, { desde: primerDia, hastaExclusivo: primerDiaSiguiente }),
    contarConductoresActivos(supabase),
    contarCouriersActivos(supabase),
    contarSellersTotal(supabase),
  ]);

  return {
    gmv,
    pedidos: { total: pedidosTotal, mes: pedidosMes, entregadosMes: pedidosEntregadosMes },
    dtesEmitidos: { total: dtesTotal, mes: dtesMes },
    conductoresActivos,
    couriersActivos,
    sellersTotal,
  };
}
