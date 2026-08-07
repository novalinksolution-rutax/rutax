/**
 * Lógica de períodos de cobro y liquidaciones de conductor.
 *
 * Responsabilidades:
 * - Calcular las fechas de inicio/fin del período al que pertenece una entrega.
 * - Crear o reutilizar un período abierto para un seller (idempotente).
 * - Crear o reutilizar una liquidación abierta para un conductor (idempotente).
 *
 * Todos los cálculos de fechas usan la zona horaria America/Santiago
 * (requerimiento de localización Chile — CLAUDE.md).
 *
 * La idempotencia se garantiza por el UNIQUE constraint en BD:
 * - `periodos_cobro`: UNIQUE (tenant_id, seller_id, fecha_inicio, fecha_fin)
 * - `liquidaciones`: UNIQUE (tenant_id, driver_id, fecha_inicio, fecha_fin)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TipoPeriodoFacturacion } from './tipos';
import {
  diaSemanaCalendario,
  fechaLocalEnSantiago,
  sumarDiasCalendario,
} from '@/lib/fecha-santiago';

// =============================================================================
// Cálculo de fechas de período
// =============================================================================

/**
 * Último día del mes al que pertenece `fecha`, en calendario de Santiago,
 * como 'YYYY-MM-DD'.
 *
 * La versión anterior construía instantes con el offset `-03:00` CLAVADO y les
 * restaba un milisegundo. Santiago es −04:00 en invierno, así que medio año el
 * borde del mes quedaba una hora corrido y una entrega de las 23:xx del último
 * día caía en el período de facturación equivocado. Aquí no hay instantes que
 * ubicar: el mes se cierra con aritmética de fecha CIVIL (primero del mes
 * siguiente menos un día), que no tiene huso horario que resolver.
 */
function ultimoDiaMesStr(fecha: Date): string {
  const [anio, mes] = fechaLocalEnSantiago(fecha).split('-').map(Number);
  const anioSiguiente = mes === 12 ? anio + 1 : anio;
  const mesSiguiente = mes === 12 ? 1 : mes + 1;
  const primeroDelSiguiente = `${anioSiguiente}-${String(mesSiguiente).padStart(2, '0')}-01`;
  return sumarDiasCalendario(primeroDelSiguiente, -1);
}

/**
 * Lunes de la semana que contiene `fecha`, en calendario de Santiago.
 *
 * La versión anterior anclaba a mediodía SIN sufijo de zona
 * (`new Date('YYYY-MM-DDT12:00:00')`), que el runtime interpreta en el huso del
 * proceso. El ancla a mediodía sobrevive un desplazamiento de ±12 h, así que
 * funcionaba en UTC por accidente, no por diseño.
 */
function lunesDeSemana(fecha: Date): string {
  const fechaLocal = fechaLocalEnSantiago(fecha);
  const diaSemana = diaSemanaCalendario(fechaLocal); // 0=domingo, 1=lunes…
  const diasDesdeLunes = diaSemana === 0 ? 6 : diaSemana - 1;
  return sumarDiasCalendario(fechaLocal, -diasDesdeLunes);
}

/**
 * Domingo que CIERRA la semana que empieza en `inicio` ('YYYY-MM-DD').
 * (Se llamaba `domingoDeSemanaSiguiente`, que sugería la semana de después.)
 */
function domingoDeSemana(inicio: string): string {
  return sumarDiasCalendario(inicio, 6);
}

/**
 * Calcula {fechaInicio, fechaFin} del período al que pertenece `fechaEntrega`,
 * según el tipo de período configurado.
 *
 * Fallback: si no hay configuración, usa `mensual` y el mes calendario.
 */
export function calcularRangoPeriodo(
  fechaEntrega: Date,
  tipoPeriodo: TipoPeriodoFacturacion,
): { fechaInicio: string; fechaFin: string } {
  const [anioStr, mesStr, diaStr] = fechaLocalEnSantiago(fechaEntrega).split('-');
  const diaLocal = parseInt(diaStr, 10);

  if (tipoPeriodo === 'mensual') {
    return {
      fechaInicio: `${anioStr}-${mesStr}-01`,
      fechaFin: ultimoDiaMesStr(fechaEntrega),
    };
  }

  if (tipoPeriodo === 'quincenal') {
    if (diaLocal <= 15) {
      return {
        fechaInicio: `${anioStr}-${mesStr}-01`,
        fechaFin: `${anioStr}-${mesStr}-15`,
      };
    } else {
      return {
        fechaInicio: `${anioStr}-${mesStr}-16`,
        fechaFin: ultimoDiaMesStr(fechaEntrega),
      };
    }
  }

  if (tipoPeriodo === 'semanal') {
    const inicio = lunesDeSemana(fechaEntrega);
    const fin = domingoDeSemana(inicio);
    return { fechaInicio: inicio, fechaFin: fin };
  }

  // Fallback seguro — mensual
  return {
    fechaInicio: `${anioStr}-${mesStr}-01`,
    fechaFin: ultimoDiaMesStr(fechaEntrega),
  };
}

// =============================================================================
// obtenerOCrearPeriodoCobroAbierto
// =============================================================================

/**
 * Devuelve el ID del período de cobro abierto para el seller y rango de fechas
 * correspondiente a `fechaEntrega`. Si no existe, lo crea.
 *
 * Idempotente: el UNIQUE constraint (tenant_id, seller_id, fecha_inicio, fecha_fin)
 * absorbe el segundo intento con ON CONFLICT DO NOTHING. Luego se relée el ID.
 *
 * Flujo:
 * 1. Leer config_periodos para el seller (o tenant si no hay config por seller).
 * 2. Calcular fechaInicio/fechaFin con calcularRangoPeriodo.
 * 3. INSERT período con ON CONFLICT DO NOTHING.
 * 4. SELECT para obtener el ID (tanto si se creó ahora como si ya existía).
 */
export async function obtenerOCrearPeriodoCobroAbierto(
  cliente: SupabaseClient,
  params: { tenantId: string; sellerId: string; fechaEntrega: Date },
): Promise<string> {
  const { tenantId, sellerId, fechaEntrega } = params;

  // 1. Leer configuración de período: primero para el seller, luego para el tenant.
  const { data: configRows } = await cliente
    .schema('dinero')
    .from('config_periodos')
    .select('tipo_periodo, seller_id')
    .eq('tenant_id', tenantId)
    .eq('activa', true)
    .or(`seller_id.eq.${sellerId},seller_id.is.null`)
    .order('seller_id', { ascending: false, nullsFirst: false }) // seller-específico primero
    .limit(2);

  const tipoPeriodo: TipoPeriodoFacturacion =
    (configRows?.[0]?.tipo_periodo as TipoPeriodoFacturacion | undefined) ?? 'mensual';

  // 2. Calcular rango del período.
  const { fechaInicio, fechaFin } = calcularRangoPeriodo(fechaEntrega, tipoPeriodo);

  // 3. UPSERT idempotente — ignoreDuplicates absorbe el conflicto del UNIQUE constraint.
  await cliente
    .schema('dinero')
    .from('periodos_cobro')
    .upsert(
      {
        tenant_id: tenantId,
        seller_id: sellerId,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        tipo_periodo: tipoPeriodo,
        estado: 'abierto',
        total_lineas: 0,
      },
      { onConflict: 'tenant_id,seller_id,fecha_inicio,fecha_fin', ignoreDuplicates: true },
    );

  // 4. Leer el período (creado ahora o ya existente).
  const { data: periodo, error } = await cliente
    .schema('dinero')
    .from('periodos_cobro')
    .select('id, estado')
    .eq('tenant_id', tenantId)
    .eq('seller_id', sellerId)
    .eq('fecha_inicio', fechaInicio)
    .eq('fecha_fin', fechaFin)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener período de cobro: ${error.message}`);
  }

  if (!periodo) {
    throw new Error(
      `No se pudo crear ni encontrar el período de cobro para ` +
      `seller=${sellerId} rango=${fechaInicio}/${fechaFin}`,
    );
  }

  // GUARDA (QA): el UNIQUE (tenant, seller, fecha_inicio, fecha_fin) permite UNA
  // sola fila por rango, sin discriminar `estado`. Si el período de ese rango ya
  // existe pero NO está `abierto` (cerrado/facturado/anulado), el upsert con
  // ignoreDuplicates NO lo reabre y este SELECT devolvería un período cerrado.
  // Reimputar/asignar líneas a un período facturado las dejaría fuera de toda
  // facturación (nunca se vuelven a emitir) — corrupción silenciosa. El nombre y
  // contrato de esta función prometen un período ABIERTO: si no lo es, fallamos
  // con un error claro y RETRYABLE (Inngest reintenta; un humano abre el período
  // o ajusta el rango) en vez de misfilar las líneas en silencio.
  if ((periodo.estado as string) !== 'abierto') {
    throw new Error(
      `El período de cobro del rango ${fechaInicio}/${fechaFin} para seller=` +
        `${sellerId} existe pero está en estado '${periodo.estado}', no 'abierto'. ` +
        'No se asignan líneas a un período no abierto (evita facturación perdida).',
    );
  }

  return periodo.id as string;
}

// =============================================================================
// obtenerOCrearLiquidacionAbierta
// =============================================================================

/**
 * Devuelve el ID de la liquidación abierta (borrador) para el conductor y rango
 * de fechas correspondiente a `fechaEntrega`. Si no existe, la crea.
 *
 * Idempotente: el UNIQUE constraint (tenant_id, driver_id, fecha_inicio, fecha_fin)
 * absorbe duplicados.
 *
 * Para el tipo_relacion_conductor se lee de `identidad.conductores`.
 * Si no se puede leer, default 'independiente' (más conservador para el MVP).
 */
export async function obtenerOCrearLiquidacionAbierta(
  cliente: SupabaseClient,
  params: { tenantId: string; driverId: string; fechaEntrega: Date },
): Promise<string> {
  const { tenantId, driverId, fechaEntrega } = params;

  // 1. Leer configuración de período del tenant (las liquidaciones siguen el período del tenant).
  const { data: configRows } = await cliente
    .schema('dinero')
    .from('config_periodos')
    .select('tipo_periodo')
    .eq('tenant_id', tenantId)
    .is('seller_id', null)
    .eq('activa', true)
    .limit(1);

  const tipoPeriodo: TipoPeriodoFacturacion =
    (configRows?.[0]?.tipo_periodo as TipoPeriodoFacturacion | undefined) ?? 'mensual';

  // 2. Calcular rango del período.
  const { fechaInicio, fechaFin } = calcularRangoPeriodo(fechaEntrega, tipoPeriodo);

  // 3. Leer tipo_relacion del conductor.
  const { data: conductorData } = await cliente
    .schema('identidad')
    .from('conductores')
    .select('tipo_relacion')
    .eq('id', driverId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const tipoRelacion = (conductorData?.tipo_relacion as 'dependiente' | 'independiente' | undefined) ?? 'independiente';

  // 4. INSERT idempotente (ON CONFLICT DO NOTHING vía upsert con ignoreDuplicates).
  await cliente
    .schema('dinero')
    .from('liquidaciones')
    .insert({
      tenant_id: tenantId,
      driver_id: driverId,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      tipo_periodo: tipoPeriodo,
      estado: 'borrador',
      total_entregas: 0,
      tipo_relacion_conductor: tipoRelacion,
    })
    .select('id');
  // El constraint UNIQUE (tenant_id, driver_id, fecha_inicio, fecha_fin) absorbe duplicados.
  // Si el INSERT falla por conflicto, ignoramos el error y hacemos SELECT.

  // 5. Leer la liquidación (creada ahora o ya existente).
  const { data: liquidacion, error } = await cliente
    .schema('dinero')
    .from('liquidaciones')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('driver_id', driverId)
    .eq('fecha_inicio', fechaInicio)
    .eq('fecha_fin', fechaFin)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener liquidación abierta: ${error.message}`);
  }

  if (!liquidacion) {
    throw new Error(
      `No se pudo crear ni encontrar la liquidación para ` +
      `driver=${driverId} rango=${fechaInicio}/${fechaFin}`,
    );
  }

  return liquidacion.id as string;
}
