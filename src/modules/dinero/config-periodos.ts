/**
 * La periodicidad de facturación del courier — el ÚNICO lector.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTO ES UN ARCHIVO Y NO DOS CONSULTAS SUELTAS
 * -----------------------------------------------------------------------------
 * `dinero.config_periodos` la leían dos funciones de `periodos.ts` —una para el
 * período de cobro del seller, otra para la liquidación del conductor— cada una
 * con su propia consulta y **su propio `?? 'mensual'` escrito a mano**. Mientras
 * nadie escribía la tabla eso daba igual: las dos caían siempre en el mismo
 * respaldo. Con una pantalla que ya la escribe, dos definiciones del respaldo
 * son dos formas de responder «¿cada cuánto factura este courier?», y la que
 * usa la pantalla para MOSTRARLO sería una tercera.
 *
 * El fallo de esa divergencia es del peor tipo: la pantalla diría «quincenal»,
 * el motor cerraría mensual, y no hay ninguna superficie donde las dos cifras se
 * miren de frente. Acá hay una sola.
 *
 * -----------------------------------------------------------------------------
 * LOS DOS ALCANCES NO SON EL MISMO, Y LA DIFERENCIA ES REAL
 * -----------------------------------------------------------------------------
 * · **Cobro al seller** — puede tener override por seller. Un courier factura
 *   quincenal a casi todos y mensual al grande que se lo negoció.
 * · **Liquidación al conductor** — sigue SIEMPRE la del tenant. Un conductor
 *   reparte pedidos de varios sellers en el mismo día; hacer que su liquidación
 *   dependiera del seller no tendría a cuál mirar.
 *
 * Por eso `sellerId` es opcional y no un parámetro que se pueda olvidar: pasarlo
 * significa «resuélvelo con override», omitirlo significa «el del tenant».
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL RESPALDO ES `mensual` Y NO ES UNA ELECCIÓN DE PRODUCTO
 * -----------------------------------------------------------------------------
 * Es el valor que el motor lleva usando desde que existe, y cambiarlo movería de
 * período las líneas de todo courier que aún no configuró nada. Se conserva tal
 * cual y se le pone nombre para que se pueda distinguir «eligió mensual» de
 * «nadie ha elegido» — que es justo lo que la pantalla necesita decir.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TipoPeriodoFacturacion } from './tipos';

/** Los tres valores del CHECK `config_periodos_tipo_periodo_valido`. */
export const TIPOS_PERIODO_FACTURACION = ['semanal', 'quincenal', 'mensual'] as const;

/**
 * Lo que usa el motor cuando el courier no configuró nada. No es un default de
 * producto: es el comportamiento histórico, y se nombra para poder decir en la
 * pantalla que está heredado y no elegido.
 */
export const PERIODICIDAD_POR_DEFECTO: TipoPeriodoFacturacion = 'mensual';

export function esTipoPeriodoFacturacion(valor: unknown): valor is TipoPeriodoFacturacion {
  return (
    typeof valor === 'string' &&
    (TIPOS_PERIODO_FACTURACION as readonly string[]).includes(valor)
  );
}

/**
 * Resuelve la periodicidad efectiva.
 *
 * Con `sellerId`: el override del seller gana sobre el default del tenant. La
 * consulta pide las dos filas posibles y ordena `seller_id` descendente con los
 * nulos al final, así que la fila del seller —si existe— queda primera. Es la
 * consulta que ya usaba `obtenerOCrearPeriodoCobroAbierto`, movida entera.
 *
 * Sin `sellerId`: solo la fila del tenant (`seller_id is null`).
 *
 * Nunca lanza por ausencia de configuración: devuelve `PERIODICIDAD_POR_DEFECTO`.
 * Sí deja pasar los errores de transporte del cliente, igual que antes.
 */
export async function leerPeriodicidadFacturacion(
  cliente: SupabaseClient,
  params: { tenantId: string; sellerId?: string },
): Promise<TipoPeriodoFacturacion> {
  const consulta = cliente
    .schema('dinero')
    .from('config_periodos')
    .select('tipo_periodo, seller_id')
    .eq('tenant_id', params.tenantId)
    .eq('activa', true);

  const { data } = params.sellerId
    ? await consulta
        .or(`seller_id.eq.${params.sellerId},seller_id.is.null`)
        // seller-específico primero; el default del tenant queda de respaldo.
        .order('seller_id', { ascending: false, nullsFirst: false })
        .limit(2)
    : await consulta.is('seller_id', null).limit(1);

  const valor = data?.[0]?.tipo_periodo;
  return esTipoPeriodoFacturacion(valor) ? valor : PERIODICIDAD_POR_DEFECTO;
}

/**
 * Lo mismo, pero distinguiendo «lo eligió» de «lo heredó».
 *
 * Solo para pantallas de configuración: el motor no tiene por qué saber la
 * diferencia —opera igual— pero quien configura sí, porque «mensual» heredado y
 * «mensual» elegido se ven idénticos y solo uno de los dos es una decisión.
 */
export async function leerPeriodicidadTenant(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<{ tipoPeriodo: TipoPeriodoFacturacion; explicita: boolean; fijadaEn: string | null }> {
  const { data } = await cliente
    .schema('dinero')
    .from('config_periodos')
    .select('tipo_periodo, creado_en')
    .eq('tenant_id', tenantId)
    .is('seller_id', null)
    .eq('activa', true)
    .limit(1);

  const fila = data?.[0];
  if (!fila || !esTipoPeriodoFacturacion(fila.tipo_periodo)) {
    return { tipoPeriodo: PERIODICIDAD_POR_DEFECTO, explicita: false, fijadaEn: null };
  }

  return {
    tipoPeriodo: fila.tipo_periodo,
    explicita: true,
    fijadaEn: (fila.creado_en as string | null) ?? null,
  };
}

/**
 * Cuántos períodos de cobro abiertos del tenant ya tienen líneas.
 *
 * Es el mismo candado que impone `dinero.fijar_periodicidad_facturacion`, leído
 * desde la pantalla para poder AVISAR antes de que la persona pulse Guardar en
 * vez de solo rechazarla después. La autoridad sigue siendo la función: acá se
 * lee para explicar, allá se comprueba para decidir.
 *
 * ⚠️ Cuenta líneas de verdad y no `periodos_cobro.total_lineas`: esa columna se
 * rellena al cerrar y vale 0 durante todo el período.
 */
export async function contarPeriodosAbiertosConLineas(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { data: periodos } = await cliente
    .schema('dinero')
    .from('periodos_cobro')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('estado', 'abierto');

  const ids = (periodos ?? []).map((p) => p.id as string);
  if (ids.length === 0) return 0;

  // Se piden solo los `periodo_cobro_id` DISTINTOS que aparecen en líneas, y se
  // cuentan acá. Un `count` por período serían N viajes; un `.in()` con los ids
  // es uno solo, y la cantidad de períodos abiertos de un tenant es del orden de
  // sus sellers — no del orden de sus pedidos, que es donde `.in()` se rompe.
  const { data: lineas } = await cliente
    .schema('dinero')
    .from('lineas_cobro')
    .select('periodo_cobro_id')
    .eq('tenant_id', tenantId)
    .in('periodo_cobro_id', ids);

  return new Set((lineas ?? []).map((l) => l.periodo_cobro_id as string)).size;
}
