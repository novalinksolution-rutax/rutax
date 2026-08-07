/**
 * Verificaciones de integridad estructural del motor entrega→dinero (QW6).
 * =============================================================================
 * Completa la cobertura de la bandeja de excepciones: C6 (`conciliar-periodo`)
 * ya detecta, al cerrar cada período, los pedidos entregados SIN línea y las
 * líneas sueltas; C7 (`conciliar-tres-fuentes`) cruza cobro↔liquidación↔tarifa.
 * Lo único que ningún detector emitía es el caso INVERSO y permanente:
 *
 *   `linea_cobro_sin_pedido_entregado` — una línea de cobro ACTIVA cuyo pedido
 *   NO está en un estado que deba generar cobro. Ocurre si un pedido revierte a
 *   un estado operativo, o se devuelve/cancela tras cerrarse su período (la
 *   anulación pre-cierre del motor solo actúa con período `abierto`), o si el
 *   pedido desaparece. Es dinero fantasma que debe revisarse.
 *
 * A diferencia de C6/C7 (atados al cierre de un período), este barrido es
 * PERMANENTE: lo corre el watchdog horario sobre todas las líneas activas.
 *
 * Reutiliza la infraestructura de la bandeja (`conciliacion-insercion`): misma
 * idempotencia y clasificación. Detective puro — solo LEE e INSERTA en
 * `eventos_conciliacion`, nunca muta líneas ni pedidos.
 */

import type { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { existeEventoConciliacion, insertarEventoConciliacion } from './conciliacion-insercion';

type ClienteServiceRole = ReturnType<typeof crearClienteServiceRole>;

/**
 * Estados de pedido en los que una línea de cobro ACTIVA es inconsistente:
 * - `devuelto` / `cancelado`: la línea debió anularse (no ocurrió, o el período
 *   ya estaba cerrado cuando el pedido cambió de estado).
 * - `pendiente_asignacion` / `asignado` / `en_ruta`: el pedido revirtió a un
 *   estado operativo pero la línea de cobro quedó viva.
 *
 * Se EXCLUYEN a propósito `entregado`/`entregado_manual` (generan cobro) y
 * `fallido`/`fallido_manual` (pueden generar cobro si la incidencia lo afecta):
 * en esos estados la línea puede ser legítima — incluirlos daría falsos positivos.
 */
/**
 * Tamaño de página al leer líneas. Debe quedar por DEBAJO del `max_rows` de
 * PostgREST (1000 en `supabase/config.toml`): si la página fuera mayor, el
 * servidor la recortaría en silencio y el bucle creería haber llegado al final.
 */
const PAGINA_LECTURA = 500;

/**
 * Cuántos ids caben en un `.in(...)` sin acercarse al límite de largo de URL.
 * 200 UUIDs ≈ 7 KB de query string, holgado frente al techo típico de 8-16 KB.
 */
const LOTE_IDS_EN_FILTRO = 200;

const ESTADOS_PEDIDO_SIN_COBRO_LEGITIMO: ReadonlySet<string> = new Set([
  'devuelto',
  'cancelado',
  'pendiente_asignacion',
  'asignado',
  'en_ruta',
]);

/**
 * Predicado puro: ¿una línea de cobro ACTIVA cuyo pedido está en `estadoPedido`
 * es huérfana/inconsistente? `undefined` = el pedido ya no existe → huérfana.
 * Extraído para poder testear la regla sin BD.
 */
export function esLineaCobroHuerfana(estadoPedido: string | undefined): boolean {
  if (estadoPedido === undefined) return true; // pedido ausente
  return ESTADOS_PEDIDO_SIN_COBRO_LEGITIMO.has(estadoPedido);
}

/**
 * Barre las líneas de cobro ACTIVAS de un tenant en una sola pasada y registra
 * dos inconsistencias distintas en la bandeja de excepciones:
 *
 *   - `linea_cobro_sin_pedido_entregado` — el pedido está en un estado que no
 *     debe generar cobro (ver `esLineaCobroHuerfana`).
 *   - `linea_cobro_sin_periodo` — la línea nunca quedó colgada de un período, y
 *     por lo tanto no entrará en ninguna factura.
 *
 * Son ortogonales: una misma línea puede disparar las dos, y de hecho el caso más
 * común de la segunda (pedido `fallido`) queda fuera de la primera a propósito.
 *
 * Devuelve cuántas excepciones NUEVAS insertó de cada tipo (0 si todo está
 * consistente o si ya estaban reportadas).
 */
export async function detectarLineasCobroHuerfanas(
  supabase: ClienteServiceRole,
  tenantId: string,
  runId: string,
): Promise<{ huerfanas: number; sinPeriodo: number }> {
  // Líneas de cobro vigentes (no anuladas) del tenant. Paginado a propósito:
  // PostgREST corta en `max_rows` (1000 en config.toml) SIN avisar, y un tenant
  // con operación real pasa ese techo rápido. Truncar acá no da un error, da un
  // barrido incompleto que informa "0 huérfanas" — la peor forma de fallar en un
  // detector de integridad.
  const lineas: Record<string, unknown>[] = [];
  for (let desde = 0; ; desde += PAGINA_LECTURA) {
    const { data, error } = await supabase
      .schema('dinero')
      .from('lineas_cobro')
      .select('id, pedido_id, seller_id, periodo_cobro_id, monto_final_clp')
      .eq('tenant_id', tenantId)
      .eq('anulada', false)
      .order('id')
      .range(desde, desde + PAGINA_LECTURA - 1);

    if (error) throw new Error(`Integridad · Error al leer lineas_cobro: ${error.message}`);
    if (!data || data.length === 0) break;
    lineas.push(...data);
    if (data.length < PAGINA_LECTURA) break;
  }

  if (lineas.length === 0) return { huerfanas: 0, sinPeriodo: 0 };

  // Estado actual de los pedidos referenciados por esas líneas.
  //
  // En LOTES, y no por gusto: `.in('id', [...])` viaja en el query string, así que
  // una lista que crece con el volumen del tenant revienta el largo de URL y
  // PostgREST responde `URI too long`. Pasó de verdad — con 715 líneas el detector
  // fallaba entero, el watchdog se comía el error por-tenant y reportaba
  // `lineas_huerfanas=0`, que se lee como "todo limpio" cuando significa "nunca
  // corrió". Nunca construir un `.in()` cuyo tamaño dependa del tamaño del tenant.
  const pedidoIds = [...new Set(lineas.map((l) => l.pedido_id as string))];
  const estadoPorPedido = new Map<string, string>();

  for (let desde = 0; desde < pedidoIds.length; desde += LOTE_IDS_EN_FILTRO) {
    const lote = pedidoIds.slice(desde, desde + LOTE_IDS_EN_FILTRO);
    const { data, error } = await supabase
      .schema('operacion')
      .from('pedidos')
      .select('id, estado')
      .eq('tenant_id', tenantId)
      .in('id', lote);

    if (error) throw new Error(`Integridad · Error al leer pedidos: ${error.message}`);
    for (const p of data ?? []) {
      estadoPorPedido.set(p.id as string, p.estado as string);
    }
  }

  let insertados = 0;
  let sinPeriodo = 0;

  for (const linea of lineas) {
    const pedidoId = linea.pedido_id as string;
    const estado = estadoPorPedido.get(pedidoId);
    const pedidoAusente = estado === undefined;

    // --- Línea activa sin período asignado ---------------------------------
    // Condición independiente del estado del pedido, y por eso va ANTES del
    // `continue` de abajo: el caso típico es un pedido `fallido` con incidencia
    // que sí cobra, y `fallido` está excluido a propósito del set de huérfanas.
    // Sin esta rama, esas líneas no las ve nadie.
    if (!linea.periodo_cobro_id) {
      const yaReportada = await existeEventoConciliacion(
        supabase,
        tenantId,
        'linea_cobro_sin_periodo',
        { pedidoId },
      );
      if (!yaReportada) {
        const monto = Math.round(Number(linea.monto_final_clp ?? 0));
        await insertarEventoConciliacion(supabase, {
          tenant_id: tenantId,
          seller_id: (linea.seller_id as string | null) ?? null,
          periodo_cobro_id: null,
          pedido_id: pedidoId,
          tipo_diferencia: 'linea_cobro_sin_periodo',
          descripcion:
            `Línea de cobro activa (${monto} CLP) del pedido ${pedidoId} sin período asignado. ` +
            'No entrará en ninguna factura mientras siga así. Causa habitual: el período ' +
            'destino ya estaba cerrado o facturado cuando llegó la transición del pedido.',
          monto_diferencia_clp: monto,
          estado: 'pendiente',
          job_run_id: runId,
        });
        sinPeriodo++;
      }
    }

    if (!esLineaCobroHuerfana(estado)) continue;

    // Idempotencia: una excepción de este tipo por pedido.
    const yaExiste = await existeEventoConciliacion(
      supabase,
      tenantId,
      'linea_cobro_sin_pedido_entregado',
      { pedidoId },
    );
    if (yaExiste) continue;

    const monto = Math.round(Number(linea.monto_final_clp ?? 0));
    const descripcion = pedidoAusente
      ? `Línea de cobro activa (${monto} CLP) para el pedido ${pedidoId}, que ya no existe. ` +
        'Revisar: la línea no debería seguir viva.'
      : `Línea de cobro activa (${monto} CLP) para el pedido ${pedidoId} en estado '${estado}', ` +
        'que no debe generar cobro. Probable anulación no aplicada o reversión post-cierre.';

    await insertarEventoConciliacion(supabase, {
      tenant_id: tenantId,
      seller_id: (linea.seller_id as string | null) ?? null,
      periodo_cobro_id: (linea.periodo_cobro_id as string | null) ?? null,
      pedido_id: pedidoId,
      tipo_diferencia: 'linea_cobro_sin_pedido_entregado',
      descripcion,
      monto_diferencia_clp: monto,
      estado: 'pendiente',
      job_run_id: runId,
    });
    insertados++;
  }

  return { huerfanas: insertados, sinPeriodo };
}
