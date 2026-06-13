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

const TZ = 'America/Santiago';

// =============================================================================
// Cálculo de fechas de período
// =============================================================================

/**
 * Extrae la fecha local en Santiago en formato 'YYYY-MM-DD'.
 *
 * BUG FIX: la versión anterior usaba `toLocaleDateString('es-CL', ...)` y
 * asumía que el locale `es-CL` devuelve 'DD-MM-YYYY'. Eso depende del motor
 * de JS del entorno y no es garantizado. Se usa `Intl.DateTimeFormat('en-CA')`
 * que garantiza el formato ISO 'YYYY-MM-DD' en todos los entornos.
 */
function fechaLocalSantiago(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
}

/**
 * Calcula el primer día del mes en zona Santiago (no UTC).
 */
function primerDiaMes(fecha: Date): Date {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha).split('-'); // 'YYYY-MM-DD'
  // Construir la fecha como medianoche UTC del día local en Santiago
  return new Date(`${partes[0]}-${partes[1]}-01T00:00:00-03:00`);
}

/**
 * Calcula el último día del mes en zona Santiago.
 *
 * BUG FIX: la versión anterior usaba `new Date(anio, mes, 0)` que crea la
 * fecha en la timezone local del servidor (UTC en Vercel). Para una fecha
 * cerca de la medianoche UTC cuya hora local en Santiago pertenece al día
 * anterior, el mes calculado podría ser incorrecto.
 * La versión corregida representa el último día explícitamente como string
 * ISO 'YYYY-MM-DD' sin depender de la timezone del servidor.
 */
function ultimoDiaMes(fecha: Date): Date {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha).split('-');
  const anio = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10);
  // Construir el primer día del mes siguiente y restar un día,
  // todo en zona Santiago para evitar el problema de la timezone del servidor.
  // Usamos offset fijo -03:00 (hora de Santiago sin DST en invierno;
  // en producción se usaría temporal-polyfill para manejar DST correctamente,
  // pero para el propósito de obtener el último día del mes es suficiente).
  const primerDelSiguiente = new Date(`${anio}-${String(mes % 12 + 1).padStart(2, '0')}-01T00:00:00-03:00`);
  // Corregir mes 12 → enero del año siguiente
  if (mes === 12) {
    const primerEneroSiguiente = new Date(`${anio + 1}-01-01T00:00:00-03:00`);
    // Restar 1 ms para obtener el último instante del 31/12
    return new Date(primerEneroSiguiente.getTime() - 1);
  }
  return new Date(primerDelSiguiente.getTime() - 1);
}

/**
 * Devuelve la fecha ISO 'YYYY-MM-DD' del último día del mes.
 */
function ultimoDiaMesStr(fecha: Date): string {
  const ultimo = ultimoDiaMes(fecha);
  // Formatear en Santiago
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ultimo);
}

/**
 * Obtiene la fecha del lunes de la semana que contiene `fecha` en zona Santiago.
 */
function lunesDeSemana(fecha: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha).split('-');
  // Construir fecha local
  const local = new Date(`${partes[0]}-${partes[1]}-${partes[2]}T12:00:00`);
  const diaSemana = local.getDay(); // 0=domingo, 1=lunes...
  const diasDesdelunes = (diaSemana === 0) ? 6 : diaSemana - 1;
  const lunes = new Date(local);
  lunes.setDate(local.getDate() - diasDesdelunes);
  return lunes.toISOString().split('T')[0];
}

/**
 * Obtiene la fecha del domingo de la semana que contiene `fecha` en zona Santiago.
 */
function domingoDeSemanaSiguiente(inicio: string): string {
  const lunes = new Date(`${inicio}T12:00:00`);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  return domingo.toISOString().split('T')[0];
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
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fechaEntrega).split('-');
  const diaLocal = parseInt(partes[2], 10);
  const anioStr = partes[0];
  const mesStr = partes[1];

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
    const fin = domingoDeSemanaSiguiente(inicio);
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
