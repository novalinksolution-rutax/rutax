/**
 * Núcleo de aplicación de un pago YA persistido a su período (capa "pagado").
 * =============================================================================
 *
 * Vive APARTE del job (`jobs/conciliar-pago.ts`) a propósito: lo consumen tanto
 * el job (tras el UPSERT del webhook) como la acción manual
 * `atribuirPagoManualmente` (`acciones.ts`). Si viviera en el archivo del job,
 * importarlo arrastraría `inngest.createFunction` al cargar el módulo —
 * rompiendo cualquier consumidor que mockee Inngest (p. ej. los tests de
 * acciones). Aquí NO se importa Inngest; solo Supabase service-role y la cascada
 * pura de `matching-pago`.
 *
 * Idempotente: nunca re-imputa un pago en estado terminal, y solo proyecta al
 * período cuando imputa.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import {
  decidirConciliacion,
  esEstadoTerminal,
  estadoMatchDesdeResultado,
  atribuirSellerPorRut,
  type PeriodoCandidato,
} from './matching-pago';

export type ResultadoConciliarPago =
  | { resultado: 'terminal' }
  | { resultado: 'sin_atribuir' }
  | { resultado: 'atribuido' }
  | { resultado: 'sobrante' }
  | { resultado: 'conciliado' | 'parcial'; periodoId: string; montoClp: number; sellerId: string };

/**
 * Concilia un pago YA persistido (su fila en `pagos_recibidos`).
 *
 * @param sellerIdForzado si viene (atribución manual), se usa ese seller y se
 *   omite la atribución por RUT.
 */
export async function conciliarPagoPersistido(
  pagoId: string,
  tenantId: string,
  opts: { sellerIdForzado?: string; jobRunId?: string } = {},
): Promise<ResultadoConciliarPago> {
  const supabase = crearClienteServiceRole();

  // Leer la fila del pago (fuente de verdad).
  const { data: pago, error: errPago } = await supabase
    .schema('dinero')
    .from('pagos_recibidos')
    .select(
      'id, tenant_id, seller_id, periodo_cobro_id, monto_clp, contraparte_rut_normalizado, estado_match',
    )
    .eq('id', pagoId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errPago) throw new Error(`Error al leer pago: ${errPago.message}`);
  if (!pago) throw new Error('Pago no encontrado en el tenant.');

  // Idempotencia: un pago en estado terminal ya no se re-procesa.
  if (esEstadoTerminal(pago.estado_match as string)) {
    return { resultado: 'terminal' };
  }

  // Idempotencia de imputación: un pago YA imputado a un período (estado
  // `parcial` con `periodo_cobro_id` fijado) NO debe volver a sumar su monto al
  // período. `parcial` no es terminal (puede re-atribuirse manualmente a OTRO
  // seller), pero la re-atribución manual debe reversar la imputación previa
  // antes de re-conciliar; mientras eso no ocurra, re-correr la cascada sobre el
  // mismo (pago, período) duplicaría `monto_pagado_clp` (cobro doble). Un
  // reintento del job o un re-disparo del webhook sobre un parcial ya imputado
  // cae aquí y no re-imputa. La re-atribución a un seller DISTINTO entra por la
  // acción manual, que limpia `periodo_cobro_id` antes de llamar a este flujo.
  if (
    (pago.estado_match as string) === 'parcial' &&
    (pago.periodo_cobro_id as string | null) !== null &&
    !opts.sellerIdForzado
  ) {
    return { resultado: 'terminal' };
  }

  const montoClp = Math.round(Number(pago.monto_clp));

  // --- Paso 2: atribuir seller ------------------------------------------------
  let sellerId: string | null = opts.sellerIdForzado ?? (pago.seller_id as string | null);

  if (!sellerId) {
    const { data: sellers, error: errSellers } = await supabase
      .schema('identidad')
      .from('sellers')
      .select('id, rut')
      .eq('tenant_id', tenantId);
    if (errSellers) throw new Error(`Error al leer sellers: ${errSellers.message}`);

    sellerId = atribuirSellerPorRut(
      pago.contraparte_rut_normalizado as string | null,
      (sellers ?? []) as Array<{ id: string; rut: string | null }>,
    );
  }

  if (!sellerId) {
    // Sin RUT atribuible / sin seller → queda sin_atribuir (no se toca período).
    await actualizarEstadoPago(supabase, pagoId, tenantId, {
      estado_match: 'sin_atribuir',
      job_run_id: opts.jobRunId ?? null,
    });
    return { resultado: 'sin_atribuir' };
  }

  // --- Paso 3: buscar períodos candidatos del seller -------------------------
  const { data: periodos, error: errPeriodos } = await supabase
    .schema('dinero')
    .from('periodos_cobro')
    .select('id, monto_total_clp, monto_pagado_clp, estado_cobro')
    .eq('tenant_id', tenantId)
    .eq('seller_id', sellerId)
    .eq('estado', 'facturado')
    .in('estado_cobro', ['pendiente', 'parcial']);

  if (errPeriodos) throw new Error(`Error al leer períodos: ${errPeriodos.message}`);

  const candidatos: PeriodoCandidato[] = (periodos ?? []).map((p) => ({
    id: p.id as string,
    saldoClp:
      Math.round(Number(p.monto_total_clp ?? 0)) - Math.round(Number(p.monto_pagado_clp ?? 0)),
  }));

  const decision = decidirConciliacion(montoClp, candidatos);
  const estadoMatch = estadoMatchDesdeResultado(decision, true);

  // --- Paso 4: imputar al período (solo este flujo escribe la proyección) ----
  if (decision.tipo === 'pagado_total' || decision.tipo === 'pagado_parcial') {
    const periodoElegido = (periodos ?? []).find((p) => p.id === decision.periodoId);
    const montoPagadoActual = Math.round(Number(periodoElegido?.monto_pagado_clp ?? 0));
    const nuevoMontoPagado = montoPagadoActual + decision.montoImputadoClp;
    const esTotal = decision.tipo === 'pagado_total';

    const { error: errPeriodo } = await supabase
      .schema('dinero')
      .from('periodos_cobro')
      .update({
        estado_cobro: esTotal ? 'pagado' : 'parcial',
        monto_pagado_clp: nuevoMontoPagado,
        ...(esTotal ? { pagado_en: new Date().toISOString() } : {}),
        actualizado_en: new Date().toISOString(),
      })
      .eq('id', decision.periodoId)
      .eq('tenant_id', tenantId);
    if (errPeriodo) throw new Error(`Error al imputar período: ${errPeriodo.message}`);

    await actualizarEstadoPago(supabase, pagoId, tenantId, {
      estado_match: estadoMatch,
      seller_id: sellerId,
      periodo_cobro_id: decision.periodoId,
      job_run_id: opts.jobRunId ?? null,
    });

    return {
      resultado: esTotal ? 'conciliado' : 'parcial',
      periodoId: decision.periodoId,
      montoClp: decision.montoImputadoClp,
      sellerId,
    };
  }

  // sobrante | sin_candidato (atribuido) → fija seller y estado, sin tocar período.
  await actualizarEstadoPago(supabase, pagoId, tenantId, {
    estado_match: estadoMatch,
    seller_id: sellerId,
    job_run_id: opts.jobRunId ?? null,
  });

  return { resultado: estadoMatch === 'sobrante' ? 'sobrante' : 'atribuido' };
}

/** Actualiza la fila del pago acotada por tenant (idempotente). */
async function actualizarEstadoPago(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  pagoId: string,
  tenantId: string,
  campos: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .schema('dinero')
    .from('pagos_recibidos')
    .update({ ...campos, actualizado_en: new Date().toISOString() })
    .eq('id', pagoId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`Error al actualizar pago: ${error.message}`);
}
