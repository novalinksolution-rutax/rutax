/**
 * Job C7 · dinero/conciliarTresFuentes
 * =====================================================================
 * Trigger: Cron `30 2 * * *` (02:30 hora Santiago, diario)
 *          — se ejecuta después del cron de liquidaciones de las 02:00.
 *
 * Responsabilidad (F17, Bloque 3):
 * Cruza TRES fuentes de verdad dentro de períodos cerrados o facturados:
 *   (1) líneas de cobro al seller
 *   (2) líneas de liquidación al conductor
 *   (3) rate card vigente del seller (mínimos y recargos)
 *
 * Los 6 detectores implementados:
 *   D1 · `pagado_conductor_sin_cobro_seller`  — FUGA DIRECTA: hay línea de
 *        liquidación pero NO de cobro para el mismo pedido.
 *   D2 · `cobrado_seller_no_pagado_conductor` — inverso: hay cobro al seller
 *        pero, siendo el pedido con conductor, no hay liquidación.
 *   D3 · `reprogramacion_no_cobrada`          — pedido con incidencia
 *        `reagendado` y ajuste_incidencia_clp=0, cuando la tarifa vigente
 *        tiene recargo_reprogramacion_clp > 0.
 *   D4 · `minimo_omitido`                     — el monto_total_clp del período
 *        (sin anuladas) quedó bajo minimo_facturacion_clp de la tarifa; o una
 *        línea quedó bajo minimo_retiro_clp.
 *   D5 · `pago_seller_faltante`               — período `facturado` con saldo
 *        impago (estado_cobro != 'pagado') — usa campo estado_cobro si existe.
 *   D6 · `pago_conductor_faltante`            — liquidación `emitida` hace más
 *        de DIAS_PAGO_CONDUCTOR_MAX días sin pasar a `pagada`.
 *
 * Idempotencia:
 * - EventId del cron: Inngest deduplica por `conciliar-3f-${tenantId}-${fecha}`.
 * - Antes de insertar CADA hallazgo individual se verifica que no exista ya un
 *   evento del mismo `(tipo_diferencia, pedido_id|periodo_cobro_id|liquidacion_id)`
 *   para el mismo tenant. Re-run no duplica.
 *
 * Detective puro — NUNCA muta:
 * - No anula líneas.
 * - No emite NC.
 * - No paga liquidaciones.
 * Solo inserta filas en `dinero.eventos_conciliacion`.
 *
 * Aislamiento:
 * - Usa service_role con filtro `tenant_id` explícito en cada consulta.
 * - Itera todos los tenants activos en el sistema (el cron es global;
 *   los datos de cada tenant están aislados por RLS a nivel BD aunque
 *   el service_role la bypass — el filtro de código lo garantiza).
 *
 * SEGURIDAD:
 * - Los logs solo incluyen tenant_id, IDs de entidades y conteos.
 * - Nunca se loguean montos cruzados entre tenants ni datos de conductores.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { leerTodasLasFilas, leerPorLotesDeIds } from '@/lib/supabase/leer-paginado';
import { capturarMensaje } from '@/lib/observabilidad';
import { existeEventoConciliacion, insertarEventoConciliacion } from '../conciliacion-insercion';
import { diferenciaEnDiasCalendario, hoyEnSantiago } from '@/lib/fecha-santiago';

/**
 * Días máximos tras emitir una liquidación para que pase a `pagada`.
 * Después de este plazo C7 genera un evento `pago_conductor_faltante`.
 * Configurable por env (default: 7 días).
 */
const DIAS_PAGO_CONDUCTOR_MAX = (() => {
  const v = Number(process.env.DINERO_DIAS_PAGO_CONDUCTOR_MAX);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 7;
})();

export const jobConciliarTresFuentes = inngest.createFunction(
  {
    id: 'dinero/conciliarTresFuentes',
    name: 'Dinero · Conciliar 3 fuentes (cobro, liquidación, rate card)',
    triggers: [{ cron: '30 2 * * *' }],
    retries: 3,
  },
  async ({ step, logger, runId }) => {
    const fecha = hoyEnSantiago();

    // =========================================================================
    // Paso 0: obtener todos los tenants activos
    // =========================================================================
    const tenants = await step.run('obtener-tenants', async () => {
      const supabase = crearClienteServiceRole();
      // `identidad.tenants` no tiene columna booleana `activo`: su estado vive en
      // la columna `estado` (enum estado_tenant: 'activo' | 'suspendido' |
      // 'onboarding'). Antes se filtraba por `.eq('activo', true)` — columna
      // inexistente → el paso fallaba y C7 nunca corría. Conciliamos los tenants
      // operativos: 'activo' y 'onboarding' (este último ya puede tener pedidos);
      // se excluyen solo los 'suspendido'.
      const { data, error } = await supabase
        .schema('identidad')
        .from('tenants')
        .select('id')
        .neq('estado', 'suspendido');

      if (error) throw new Error(`Error al obtener tenants: ${error.message}`);
      return (data ?? []).map((t) => t.id as string);
    });

    logger.info(`C7 conciliarTresFuentes · fecha=${fecha} · tenants=${tenants.length}`);

    if (tenants.length === 0) {
      return { resultado: 'sin_tenants', fecha };
    }

    // Procesar cada tenant de forma secuencial para evitar saturar la BD.
    // Un fallo en un tenant no cancela los demás.
    let totalEventos = 0;

    for (const tenantId of tenants) {
      const eventosDelTenant = await step.run(
        `conciliar-tenant-${tenantId}`,
        async () => {
          return ejecutarDetectoresTenant(tenantId, fecha, runId, logger);
        },
      );
      totalEventos += eventosDelTenant;

      // Alerta a la observabilidad cuando aparecen discrepancias NUEVAS para
      // este tenant: el cruce de integridad deja de ser silencioso (auditoría
      // §2.7/QW6). In-app ya lo ve el dueño en el centro de avisos; esto lleva
      // la señal al equipo (Sentry/logs), con el tenant para saber a quién.
      // En su propio step → idempotente: un reintento no re-alerta.
      if (eventosDelTenant > 0) {
        await step.run(`alerta-integridad-${tenantId}`, async () => {
          await capturarMensaje(
            `Conciliación C7: ${eventosDelTenant} discrepancia(s) de integridad nueva(s).`,
            'warning',
            {
              origen: 'job:dinero/conciliarTresFuentes',
              tenantId,
              correlacionId: runId,
              etiquetas: { fecha, nuevas: String(eventosDelTenant) },
            },
          );
          return { alertado: true, nuevas: eventosDelTenant };
        });
      }
    }

    logger.info(`C7 completado · fecha=${fecha} · eventos_insertados=${totalEventos}`);
    return { resultado: 'completado', fecha, totalEventos };
  },
);

// =============================================================================
// Lógica de detección por tenant
// =============================================================================

/**
 * Ejecuta los 6 detectores para un tenant y devuelve el número de eventos
 * nuevos insertados en esta ejecución.
 */
async function ejecutarDetectoresTenant(
  tenantId: string,
  fecha: string,
  runId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger: any,
): Promise<number> {
  let count = 0;

  count += await detectorD1_PagadoConductorSinCobroSeller(tenantId, runId, logger);
  count += await detectorD2_CobradoSellerNoPagadoConductor(tenantId, runId, logger);
  count += await detectorD3_ReprogramacionNoCobrada(tenantId, runId, logger);
  count += await detectorD4_MinimoOmitido(tenantId, runId, logger);
  count += await detectorD5_PagoSellerFaltante(tenantId, fecha, runId, logger);
  count += await detectorD6_PagoConductorFaltante(tenantId, fecha, runId, logger);

  return count;
}

// =============================================================================
// Helpers de inserción idempotente — ver `../conciliacion-insercion.ts`
// (extraídos de aquí para que el motor de payout — webhook + polling + la
// conciliación inmediata post-confirmación — reuse la MISMA lógica).
// =============================================================================

// =============================================================================
// D1 · pagado_conductor_sin_cobro_seller (FUGA DIRECTA)
// =====================================================================
// Hay lineas_liquidacion (anulada=false) para el pedido pero NO hay
// lineas_cobro (anulada=false) para ese mismo pedido, dentro de períodos
// cerrados o facturados del tenant.
// monto_diferencia_clp = monto_final_clp de la línea de liquidación (lo que
// se paga al conductor sin haber cobrado al seller).
// Pobla driver_id porque la discrepancia es de la fuente 3 (liquidación).
// =============================================================================

async function detectorD1_PagadoConductorSinCobroSeller(
  tenantId: string,
  runId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger: any,
): Promise<number> {
  const supabase = crearClienteServiceRole();

  // Obtener períodos cerrados/facturados del tenant.
  const { data: periodos, error: errPeriodos } = await supabase
    .schema('dinero')
    .from('periodos_cobro')
    .select('id, seller_id')
    .eq('tenant_id', tenantId)
    .in('estado', ['cerrado', 'facturado']);

  if (errPeriodos) throw new Error(`D1 · Error al leer periodos: ${errPeriodos.message}`);
  if (!periodos || periodos.length === 0) return 0;

  const periodosIds = periodos.map((p) => p.id as string);

  // Líneas de liquidación vigentes (anulada=false) cuyos pedidos pertenecen
  // a los períodos cerrados/facturados (a través de lineas_cobro.periodo_cobro_id).
  // Primero: pedidos que tienen línea de cobro activa en esos períodos.
  // PAGINADO. Un detector que lee 1.000 filas de 18.000 informa "sin
  // discrepancias" habiendo mirado el 5%, y eso se lee como que todo cuadra.
  const lineasCobro = await leerTodasLasFilas<{ pedido_id: string }>(
    'D1 · líneas de cobro de los períodos',
    (desde, hasta) => supabase
      .schema('dinero')
      .from('lineas_cobro')
      .select('pedido_id')
      .eq('tenant_id', tenantId)
      .eq('anulada', false)
      .in('periodo_cobro_id', periodosIds)
      .order('id')
      .range(desde, hasta),
  );

  const pedidosConCobro = new Set(lineasCobro.map((l) => l.pedido_id));

  // Pedidos que tienen línea de liquidación activa en esos períodos de cobro.
  // La línea de liquidación no tiene periodo_cobro_id directamente — filtramos
  // por las mismas líneas de cobro para obtener el universo de pedidos del período.
  // Como la línea de liquidación puede existir aunque no haya cobro, buscamos
  // las liquidaciones vigentes asociadas a los periodos_cobro del tenant.
  // Usamos la fecha_entrega para circunscribir al universo del período.
  // Estrategia: obtener todos los pedido_id con linea_liquidacion vigente del tenant,
  // luego cruzar contra los que NO tienen linea_cobro vigente en un periodo cerrado.
  // PAGINADO, y esta es la peor de todas: barre las líneas de liquidación de
  // TODO el tenant, sin filtro de período. A escala de piloto son ~18.000 filas.
  const lineasLiq = await leerTodasLasFilas<{
    pedido_id: string;
    driver_id: string;
    liquidacion_id: string | null;
    monto_final_clp: number | string;
  }>(
    'D1 · líneas de liquidación del tenant',
    (desde, hasta) => supabase
      .schema('dinero')
      .from('lineas_liquidacion')
      // liquidacion_id (§1.1 P1): permite que el hook `bloqueaPago` enlace este
      // tipo de evento a una liquidación concreta (antes solo poblaba driver_id).
      .select('pedido_id, driver_id, liquidacion_id, monto_final_clp')
      .eq('tenant_id', tenantId)
      .eq('anulada', false)
      .order('id')
      .range(desde, hasta),
  );

  // Para cada línea de liquidación: ¿existe cobro al seller (anulada=false)?
  // Si no existe → FUGA DIRECTA.
  let insertados = 0;

  for (const linea of lineasLiq ?? []) {
    const pedidoId = linea.pedido_id as string;

    // Solo aplica si el pedido pertenece al universo de períodos cerrados/facturados.
    // Verificamos si ese pedido tiene linea_cobro (aunque anulada) en algún periodo cerrado.
    // Si nunca tuvo cobro registrado en esos períodos, puede ser un pedido still-open → omitir.
    // La forma correcta: buscar si el pedido tiene periodo_cobro_id en algún periodo cerrado
    // via cualquier linea_cobro (incluso anulada). Pedidos sin linea_cobro en absoluto
    // pueden ser same-day gasto propio — no es una fuga, se omite.
    const { data: lineaCobroDelPedido } = await supabase
      .schema('dinero')
      .from('lineas_cobro')
      .select('id, periodo_cobro_id, anulada')
      .eq('tenant_id', tenantId)
      .eq('pedido_id', pedidoId)
      .maybeSingle();

    // Sin línea de cobro en absoluto → puede ser gasto propio del courier; omitir (no falso positivo).
    if (!lineaCobroDelPedido) continue;

    // El periodo_cobro_id de ese pedido debe ser un periodo cerrado/facturado.
    const periodoDelPedido = lineaCobroDelPedido.periodo_cobro_id as string | null;
    if (!periodoDelPedido || !periodosIds.includes(periodoDelPedido)) continue;

    // ¿Tiene cobro activo (anulada=false)?
    if (pedidosConCobro.has(pedidoId)) continue; // cobro vigente → no es fuga D1

    // Sí: hay liquidación pero no cobro → FUGA DIRECTA.
    const driverId = linea.driver_id as string;
    const liquidacionId = (linea.liquidacion_id as string | null) ?? null;
    const montoFinalClp = Math.round(Number(linea.monto_final_clp ?? 0));

    // Obtener seller_id desde la linea_cobro (aunque anulada, tiene seller_id).
    const sellerId = (
      await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .select('seller_id')
        .eq('tenant_id', tenantId)
        .eq('pedido_id', pedidoId)
        .maybeSingle()
    ).data?.seller_id as string | null;

    const yaExiste = await existeEventoConciliacion(supabase, tenantId, 'pagado_conductor_sin_cobro_seller', {
      pedidoId,
    });
    if (yaExiste) continue;

    await insertarEventoConciliacion(supabase, {
      tenant_id: tenantId,
      seller_id: sellerId ?? null,
      periodo_cobro_id: periodoDelPedido,
      pedido_id: pedidoId,
      driver_id: driverId,
      liquidacion_id: liquidacionId,
      tipo_diferencia: 'pagado_conductor_sin_cobro_seller',
      descripcion:
        `Pedido ${pedidoId}: existe línea de liquidación al conductor (${montoFinalClp} CLP) ` +
        `pero NO hay línea de cobro activa al seller. Fuga directa de ${montoFinalClp} CLP.`,
      monto_diferencia_clp: montoFinalClp,
      estado: 'pendiente',
      job_run_id: runId,
    });
    insertados++;
  }

  if (insertados > 0) {
    logger.warn(`D1 [tenant=${tenantId}]: ${insertados} fugas directas (pagado sin cobrar).`);
  }
  return insertados;
}

// =============================================================================
// D2 · cobrado_seller_no_pagado_conductor
// =====================================================================
// Hay lineas_cobro (anulada=false) para el pedido con conductor asignado,
// pero NO hay lineas_liquidacion (anulada=false).
// monto_diferencia_clp = monto_final_clp de la línea de cobro.
// =============================================================================

async function detectorD2_CobradoSellerNoPagadoConductor(
  tenantId: string,
  runId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger: any,
): Promise<number> {
  const supabase = crearClienteServiceRole();

  // Períodos cerrados/facturados del tenant.
  const { data: periodos, error: errPeriodos } = await supabase
    .schema('dinero')
    .from('periodos_cobro')
    .select('id, seller_id')
    .eq('tenant_id', tenantId)
    .in('estado', ['cerrado', 'facturado']);

  if (errPeriodos) throw new Error(`D2 · Error al leer periodos: ${errPeriodos.message}`);
  if (!periodos || periodos.length === 0) return 0;

  const periodosIds = periodos.map((p) => p.id as string);

  // Líneas de cobro activas en esos períodos.
  const lineasCobro = await leerTodasLasFilas<{
    pedido_id: string;
    seller_id: string;
    periodo_cobro_id: string;
    monto_final_clp: number | string;
  }>(
    'D2 · líneas de cobro de los períodos',
    (desde, hasta) => supabase
      .schema('dinero')
      .from('lineas_cobro')
      .select('pedido_id, seller_id, periodo_cobro_id, monto_final_clp')
      .eq('tenant_id', tenantId)
      .eq('anulada', false)
      .in('periodo_cobro_id', periodosIds)
      .order('id')
      .range(desde, hasta),
  );

  if (lineasCobro.length === 0) return 0;

  // Obtener pedidos con conductor asignado (driver_id_asignado NOT NULL).
  // EN LOTES: la lista de ids crece con el volumen del período.
  const pedidoIdsConCobro = lineasCobro.map((l) => l.pedido_id);

  const pedidosConDriver = await leerPorLotesDeIds<{ id: string; driver_id_asignado: string }>(
    'D2 · pedidos con conductor',
    pedidoIdsConCobro,
    (lote) => supabase
      .schema('operacion')
      .from('pedidos')
      .select('id, driver_id_asignado')
      .eq('tenant_id', tenantId)
      .in('id', lote)
      .not('driver_id_asignado', 'is', null),
  );

  const pedidosConDriverSet = new Set(pedidosConDriver.map((p) => p.id));

  // Pedidos con línea de liquidación activa.
  const lineasLiq = await leerPorLotesDeIds<{ pedido_id: string }>(
    'D2 · líneas de liquidación por pedido',
    pedidoIdsConCobro,
    (lote) => supabase
      .schema('dinero')
      .from('lineas_liquidacion')
      .select('pedido_id')
      .eq('tenant_id', tenantId)
      .eq('anulada', false)
      .in('pedido_id', lote),
  );

  const pedidosConLiqSet = new Set(
    (lineasLiq ?? []).map((l) => l.pedido_id as string),
  );

  let insertados = 0;

  for (const linea of lineasCobro) {
    const pedidoId = linea.pedido_id as string;

    // Solo aplica si el pedido tenía conductor asignado.
    if (!pedidosConDriverSet.has(pedidoId)) continue;

    // Si ya tiene liquidación activa → no es discrepancia D2.
    if (pedidosConLiqSet.has(pedidoId)) continue;

    const sellerId = linea.seller_id as string;
    const periodoCobroId = linea.periodo_cobro_id as string;
    const montoCobro = Math.round(Number(linea.monto_final_clp ?? 0));

    const yaExiste = await existeEventoConciliacion(supabase, tenantId, 'cobrado_seller_no_pagado_conductor', {
      pedidoId,
    });
    if (yaExiste) continue;

    await insertarEventoConciliacion(supabase, {
      tenant_id: tenantId,
      seller_id: sellerId,
      periodo_cobro_id: periodoCobroId,
      pedido_id: pedidoId,
      tipo_diferencia: 'cobrado_seller_no_pagado_conductor',
      descripcion:
        `Pedido ${pedidoId}: cobrado al seller (${montoCobro} CLP) ` +
        `pero sin línea de liquidación al conductor asignado.`,
      monto_diferencia_clp: montoCobro,
      estado: 'pendiente',
      job_run_id: runId,
    });
    insertados++;
  }

  if (insertados > 0) {
    logger.warn(`D2 [tenant=${tenantId}]: ${insertados} cobros sin liquidación al conductor.`);
  }
  return insertados;
}

// =============================================================================
// D3 · reprogramacion_no_cobrada
// =====================================================================
// El pedido tuvo incidencia tipo `reagendado` Y su lineas_cobro.ajuste_incidencia_clp
// = 0 PERO la tarifa vigente del seller tiene recargo_reprogramacion_clp > 0.
// monto_diferencia_clp = recargo_reprogramacion_clp de la tarifa (recargo no aplicado).
// =============================================================================

async function detectorD3_ReprogramacionNoCobrada(
  tenantId: string,
  runId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger: any,
): Promise<number> {
  const supabase = crearClienteServiceRole();

  // Períodos cerrados/facturados.
  const { data: periodos, error: errPeriodos } = await supabase
    .schema('dinero')
    .from('periodos_cobro')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('estado', ['cerrado', 'facturado']);

  if (errPeriodos) throw new Error(`D3 · Error al leer periodos: ${errPeriodos.message}`);
  if (!periodos || periodos.length === 0) return 0;

  const periodosIds = periodos.map((p) => p.id as string);

  // Líneas de cobro activas en esos períodos con ajuste_incidencia_clp = 0.
  const lineasCobro = await leerTodasLasFilas<{
    id: string;
    pedido_id: string;
    seller_id: string;
    periodo_cobro_id: string;
    tarifa_id: string | null;
    ajuste_incidencia_clp: number;
  }>(
    'D3 · líneas de cobro sin ajuste',
    (desde, hasta) => supabase
      .schema('dinero')
      .from('lineas_cobro')
      .select('id, pedido_id, seller_id, periodo_cobro_id, tarifa_id, ajuste_incidencia_clp')
      .eq('tenant_id', tenantId)
      .eq('anulada', false)
      .eq('ajuste_incidencia_clp', 0)
      .in('periodo_cobro_id', periodosIds)
      .order('id')
      .range(desde, hasta),
  );

  if (lineasCobro.length === 0) return 0;

  const pedidoIds = lineasCobro.map((l) => l.pedido_id);

  // Pedidos que tienen incidencia tipo `reagendado` resuelta o cerrada
  // (incidencias abiertas/en_gestion pueden aún no haber ajustado el cobro).
  const incidenciasReagendado = await leerPorLotesDeIds<{ pedido_id: string }>(
    'D3 · incidencias reagendadas',
    pedidoIds,
    (lote) => supabase
      .schema('operacion')
      .from('incidencias')
      .select('pedido_id')
      .eq('tenant_id', tenantId)
      .eq('tipo', 'reagendado')
      .in('pedido_id', lote)
      .in('estado', ['resuelta', 'cerrada']),
  );

  const pedidosConReagendado = new Set(
    (incidenciasReagendado ?? []).map((i) => i.pedido_id as string),
  );

  if (pedidosConReagendado.size === 0) return 0;

  // Para cada línea con reagendado y ajuste=0, verificar si la tarifa tiene recargo.
  let insertados = 0;

  for (const linea of lineasCobro) {
    const pedidoId = linea.pedido_id as string;
    if (!pedidosConReagendado.has(pedidoId)) continue;

    const tarifaId = linea.tarifa_id as string;

    // Leer tarifa vigente.
    const { data: tarifa, error: errTarifa } = await supabase
      .schema('identidad')
      .from('tarifas')
      .select('recargo_reprogramacion_clp')
      .eq('id', tarifaId)
      .maybeSingle();

    if (errTarifa) throw new Error(`D3 · Error al leer tarifa ${tarifaId}: ${errTarifa.message}`);

    // Si la tarifa no tiene recargo configurado (NULL o 0) → no es discrepancia.
    const recargo = Number(tarifa?.recargo_reprogramacion_clp ?? 0);
    if (!tarifa || recargo <= 0) continue;

    const sellerId = linea.seller_id as string;
    const periodoCobroId = linea.periodo_cobro_id as string;

    const yaExiste = await existeEventoConciliacion(supabase, tenantId, 'reprogramacion_no_cobrada', {
      pedidoId,
    });
    if (yaExiste) continue;

    await insertarEventoConciliacion(supabase, {
      tenant_id: tenantId,
      seller_id: sellerId,
      periodo_cobro_id: periodoCobroId,
      pedido_id: pedidoId,
      tipo_diferencia: 'reprogramacion_no_cobrada',
      descripcion:
        `Pedido ${pedidoId}: tuvo reprogramación (incidencia reagendado) pero no se ` +
        `aplicó el recargo de ${recargo} CLP (ajuste_incidencia_clp=0). ` +
        `Recargo no cobrado: ${recargo} CLP.`,
      monto_diferencia_clp: recargo,
      estado: 'pendiente',
      job_run_id: runId,
    });
    insertados++;
  }

  if (insertados > 0) {
    logger.warn(`D3 [tenant=${tenantId}]: ${insertados} reprogramaciones sin recargo cobrado.`);
  }
  return insertados;
}

// =============================================================================
// D4 · minimo_omitido
// =====================================================================
// El monto_total_clp del período (excluyendo anuladas) quedó bajo
// minimo_facturacion_clp de la tarifa vigente del seller, o una línea
// quedó bajo minimo_retiro_clp.
// Si la tarifa no tiene mínimos configurados (NULL) → se omite (no falso positivo).
// monto_diferencia_clp = diferencia hasta el mínimo.
// =============================================================================

async function detectorD4_MinimoOmitido(
  tenantId: string,
  runId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger: any,
): Promise<number> {
  const supabase = crearClienteServiceRole();

  // Períodos cerrados/facturados con su monto_total_clp y seller_id.
  const { data: periodos, error: errPeriodos } = await supabase
    .schema('dinero')
    .from('periodos_cobro')
    .select('id, seller_id, monto_total_clp')
    .eq('tenant_id', tenantId)
    .in('estado', ['cerrado', 'facturado']);

  if (errPeriodos) throw new Error(`D4 · Error al leer periodos: ${errPeriodos.message}`);
  if (!periodos || periodos.length === 0) return 0;

  let insertados = 0;

  for (const periodo of periodos) {
    const periodoId = periodo.id as string;
    const sellerId = periodo.seller_id as string;
    const montoTotalPeriodo = Math.round(Number(periodo.monto_total_clp ?? 0));

    // Obtener tarifa vigente del seller para este tenant.
    // `identidad.tarifas` no tiene columna booleana `activa`: su estado vive en
    // la columna `estado` (enum identidad.estado_tarifa: 'activa' | 'inactiva').
    // Antes se filtraba por `.eq('activa', true)` — columna inexistente → 42703,
    // el `throw` de la línea siguiente tumbaba el `step.run` completo del tenant
    // (D5 y D6 tampoco corrían) y, tras 3 reintentos, todo el job C7 fallaba.
    // Mismo patrón que el fix de `tenants.activo` en el paso 0 de este archivo.
    const { data: tarifa, error: errTarifa } = await supabase
      .schema('identidad')
      .from('tarifas')
      .select('id, minimo_facturacion_clp, minimo_retiro_clp')
      .eq('tenant_id', tenantId)
      .eq('seller_id', sellerId)
      .eq('estado', 'activa')
      .maybeSingle();

    if (errTarifa) throw new Error(`D4 · Error al leer tarifa seller ${sellerId}: ${errTarifa.message}`);

    // Sin tarifa configurada o sin mínimos → omitir (no falso positivo).
    if (!tarifa) continue;

    const minimoFacturacion = Number(tarifa.minimo_facturacion_clp ?? 0);
    const minimoRetiro = Number(tarifa.minimo_retiro_clp ?? 0);

    // Sub-detector 4a: monto total del período bajo mínimo de facturación.
    if (minimoFacturacion > 0 && montoTotalPeriodo < minimoFacturacion) {
      const diferencia = minimoFacturacion - montoTotalPeriodo;

      const yaExiste = await existeEventoConciliacion(
        supabase,
        tenantId,
        'minimo_omitido',
        { periodoCobroidId: periodoId },
      );

      if (!yaExiste) {
        await insertarEventoConciliacion(supabase, {
          tenant_id: tenantId,
          seller_id: sellerId,
          periodo_cobro_id: periodoId,
          tipo_diferencia: 'minimo_omitido',
          descripcion:
            `Período ${periodoId}: monto total (${montoTotalPeriodo} CLP) ` +
            `quedó bajo el mínimo de facturación (${minimoFacturacion} CLP). ` +
            `Diferencia sin cobrar: ${diferencia} CLP.`,
          monto_diferencia_clp: diferencia,
          estado: 'pendiente',
          job_run_id: runId,
        });
        insertados++;
      }
    }

    // Sub-detector 4b: líneas individuales bajo mínimo de retiro.
    if (minimoRetiro > 0) {
      const { data: lineasBajoMinimo, error: errLineas } = await supabase
        .schema('dinero')
        .from('lineas_cobro')
        .select('id, pedido_id, monto_final_clp')
        .eq('tenant_id', tenantId)
        .eq('seller_id', sellerId)
        .eq('periodo_cobro_id', periodoId)
        .eq('anulada', false)
        .lt('monto_final_clp', minimoRetiro);

      if (errLineas) throw new Error(`D4b · Error al leer lineas_cobro: ${errLineas.message}`);

      for (const linea of lineasBajoMinimo ?? []) {
        const pedidoId = linea.pedido_id as string;
        const montoLinea = Math.round(Number(linea.monto_final_clp ?? 0));
        const diferencia = minimoRetiro - montoLinea;

        const yaExiste = await existeEventoConciliacion(supabase, tenantId, 'minimo_omitido', {
          pedidoId,
        });
        if (yaExiste) continue;

        await insertarEventoConciliacion(supabase, {
          tenant_id: tenantId,
          seller_id: sellerId,
          periodo_cobro_id: periodoId,
          pedido_id: pedidoId,
          tipo_diferencia: 'minimo_omitido',
          descripcion:
            `Pedido ${pedidoId}: línea de cobro (${montoLinea} CLP) ` +
            `por debajo del mínimo de retiro (${minimoRetiro} CLP). ` +
            `Diferencia sin cobrar: ${diferencia} CLP.`,
          monto_diferencia_clp: diferencia,
          estado: 'pendiente',
          job_run_id: runId,
        });
        insertados++;
      }
    }
  }

  if (insertados > 0) {
    logger.warn(`D4 [tenant=${tenantId}]: ${insertados} mínimos omitidos.`);
  }
  return insertados;
}

// =============================================================================
// D5 · pago_seller_faltante
// =====================================================================
// Período `facturado` con estado_cobro distinto de 'pagado' — saldo impago.
// Si la columna estado_cobro no existe en el período, se omite (graceful).
// monto_diferencia_clp = monto_total_clp del período (saldo impago completo).
// =============================================================================

async function detectorD5_PagoSellerFaltante(
  tenantId: string,
  fecha: string,
  runId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger: any,
): Promise<number> {
  const supabase = crearClienteServiceRole();

  // Períodos facturados con estado_cobro pendiente o parcial.
  const { data: periodos, error } = await supabase
    .schema('dinero')
    .from('periodos_cobro')
    .select('id, seller_id, monto_total_clp, estado_cobro, fecha_fin')
    .eq('tenant_id', tenantId)
    .eq('estado', 'facturado')
    .neq('estado_cobro', 'pagado');

  if (error) throw new Error(`D5 · Error al leer periodos: ${error.message}`);
  if (!periodos || periodos.length === 0) return 0;

  let insertados = 0;

  for (const periodo of periodos) {
    const periodoId = periodo.id as string;
    const sellerId = periodo.seller_id as string;
    const monto = Math.round(Number(periodo.monto_total_clp ?? 0));

    // Idempotencia: un evento por período.
    const yaExiste = await existeEventoConciliacion(supabase, tenantId, 'pago_seller_faltante', {
      periodoCobroidId: periodoId,
    });
    if (yaExiste) continue;

    const estadoCobro = (periodo.estado_cobro as string | null) ?? 'pendiente';
    const fechaFin = periodo.fecha_fin as string;
    const diasAtraso = diferenciaEnDiasCalendario(fechaFin, fecha);

    await insertarEventoConciliacion(supabase, {
      tenant_id: tenantId,
      seller_id: sellerId,
      periodo_cobro_id: periodoId,
      tipo_diferencia: 'pago_seller_faltante',
      descripcion:
        `Período ${periodoId} facturado con saldo impago (estado_cobro=${estadoCobro}). ` +
        `Monto pendiente: ${monto} CLP. Días desde cierre: ${diasAtraso}.`,
      monto_diferencia_clp: monto,
      estado: 'pendiente',
      job_run_id: runId,
    });
    insertados++;
  }

  if (insertados > 0) {
    logger.warn(`D5 [tenant=${tenantId}]: ${insertados} períodos facturados sin pago del seller.`);
  }
  return insertados;
}

// =============================================================================
// D6 · pago_conductor_faltante
// =====================================================================
// Liquidación `emitida` hace más de DIAS_PAGO_CONDUCTOR_MAX días sin pasar
// a `pagada`.
// Pobla driver_id y liquidacion_id (discrepancia de fuente 3).
// =============================================================================

async function detectorD6_PagoConductorFaltante(
  tenantId: string,
  fecha: string,
  runId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger: any,
): Promise<number> {
  const supabase = crearClienteServiceRole();

  // Liquidaciones en estado `emitida`.
  const { data: liquidaciones, error } = await supabase
    .schema('dinero')
    .from('liquidaciones')
    .select('id, driver_id, generado_en, monto_total_clp')
    .eq('tenant_id', tenantId)
    .eq('estado', 'emitida');

  if (error) throw new Error(`D6 · Error al leer liquidaciones: ${error.message}`);
  if (!liquidaciones || liquidaciones.length === 0) return 0;

  let insertados = 0;

  for (const liq of liquidaciones) {
    const liquidacionId = liq.id as string;
    const driverId = liq.driver_id as string;
    const generadoEn = liq.generado_en as string | null;

    if (!generadoEn) continue; // sin fecha de emisión, no se puede calcular antigüedad

    // Calcular días desde la emisión.
    const fechaEmision = generadoEn.substring(0, 10); // YYYY-MM-DD
    const dias = diferenciaEnDiasCalendario(fechaEmision, fecha);

    if (dias <= DIAS_PAGO_CONDUCTOR_MAX) continue;

    const monto = Math.round(Number(liq.monto_total_clp ?? 0));

    const yaExiste = await existeEventoConciliacion(supabase, tenantId, 'pago_conductor_faltante', {
      liquidacionId,
    });
    if (yaExiste) continue;

    await insertarEventoConciliacion(supabase, {
      tenant_id: tenantId,
      driver_id: driverId,
      liquidacion_id: liquidacionId,
      tipo_diferencia: 'pago_conductor_faltante',
      descripcion:
        `Liquidación ${liquidacionId} en estado 'emitida' desde hace ${dias} días ` +
        `(límite: ${DIAS_PAGO_CONDUCTOR_MAX} días) sin pasar a 'pagada'. ` +
        `Monto pendiente: ${monto} CLP.`,
      monto_diferencia_clp: monto,
      estado: 'pendiente',
      job_run_id: runId,
    });
    insertados++;
  }

  if (insertados > 0) {
    logger.warn(`D6 [tenant=${tenantId}]: ${insertados} liquidaciones emitidas sin pago al conductor.`);
  }
  return insertados;
}
