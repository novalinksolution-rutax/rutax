/**
 * Job · geocoding/geocodificarPedido
 * =====================================================================
 * Trigger: evento `operacion/pedido.ingestado`
 * (lo publicará `backend` al crear un pedido — ingesta Flex o same-day).
 *
 * Geocodifica la dirección del pedido, cacheando el resultado a nivel global,
 * y persiste lat/long + geo_estado + cobertura_estado en `operacion.pedidos`.
 *
 * IDEMPOTENCIA (varias capas):
 *  - `id` de dedupe de Inngest: `geocode-${pedidoId}` → un solo run por pedido
 *    aunque el evento se publique dos veces.
 *  - Paso 1: si `geo_estado != 'pendiente'` → no-op (ya geocodificado).
 *  - Paso 2: cache HIT por `clave_hash` → NO se llama al proveedor.
 *
 * RESILIENCIA:
 *  - `retries: 3`. Solo se reintentan errores transitorios (red/cuota →
 *    `ErrorGeocodingProveedor`). Una dirección que el proveedor no resuelve
 *    (`no_resuelto`) se persiste y el job TERMINA OK — no se reintenta lo
 *    irresoluble.
 *
 * AISLAMIENTO: el job vive en `integraciones` y escribe en `operacion.pedidos`
 * vía service_role con `.schema("operacion")`, igual que `procesar-shipment`.
 * El núcleo `operacion` NO importa de `integraciones`.
 *
 * SEGURIDAD: la API key de geocoding (en el adaptador google) nunca aparece en
 * logs, errores ni en el payload del evento.
 *
 * PASO 2 (cache + puerto): vive en `../resolver-coordenada.ts`
 * (`resolverCoordenadaConCache`), compartido con las Server Actions de
 * bodegas (etapas 2/2b de retiro-y-ruteo) — un solo comportamiento, dos
 * llamadores. Este job lo invoca SIN `timeoutMs`: sigue sin límite, protegido
 * solo por `retries: 3`, igual que antes de esa extracción.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import type { EventoPedidoIngestado } from '@/lib/inngest/eventos';
import { resolverComunaCanonica } from '../normalizacion';
import { resolverCoordenadaConCache } from '../resolver-coordenada';
import type { CoberturaEstado, ResultadoGeocoding } from '../tipos';
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";

// ---------------------------------------------------------------------------
// Inyección de dependencia del puerto (para tests sin red).
//
// El interruptor vive ahora en `../resolver-coordenada.ts` (compartido con
// las Server Actions de bodegas). Se re-exporta con el MISMO nombre para no
// romper los tests existentes de este job.
// ---------------------------------------------------------------------------
export { setPuertoGeocoding, resetPuertoGeocoding } from '../resolver-coordenada';

// ---------------------------------------------------------------------------
// Cálculo de cobertura (función pura, exportada para tests)
// ---------------------------------------------------------------------------

/**
 * Deriva el `cobertura_estado` del pedido a partir del resultado de geocoding
 * y la existencia de tarifa vigente:
 *   - comuna declarada NO está en `COMUNAS_RM` → `requiere_revision`.
 *   - no hay tarifa vigente para seller/tipo → `sin_tarifa_zona`.
 *   - la comuna resuelta difiere de la declarada → `requiere_revision`.
 *   - normal → `tarifada`.
 *
 * Nota: si el geocoding no resolvió (no_resuelto/fuera_cobertura), la comuna
 * declarada sigue mandando el chequeo de catálogo y tarifa — la cobertura no
 * depende de tener coordenadas, sino de comuna + tarifa.
 */
export function calcularCobertura(args: {
  comunaDeclarada: string;
  comunaResuelta: string | null;
  hayTarifaVigente: boolean;
}): CoberturaEstado {
  const canonicaDeclarada = resolverComunaCanonica(args.comunaDeclarada);

  // Comuna declarada fuera del catálogo RM → revisión humana.
  if (canonicaDeclarada === null) {
    return 'requiere_revision';
  }

  // Sin tarifa vigente para esta zona/seller/tipo → bandeja sin_tarifa_zona.
  if (!args.hayTarifaVigente) {
    return 'sin_tarifa_zona';
  }

  // La comuna que devolvió el proveedor difiere de la declarada → revisión.
  if (
    args.comunaResuelta !== null &&
    resolverComunaCanonica(args.comunaResuelta) !== canonicaDeclarada
  ) {
    return 'requiere_revision';
  }

  return 'tarifada';
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

export const jobGeocodificarPedido = inngest.createFunction(
  {
    id: 'geocoding/geocodificarPedido',
    name: 'Geocoding · Geocodificar pedido ingestado',
    triggers: [{ event: 'operacion/pedido.ingestado' }],
    retries: 3,
    // Dedupe: un solo run por pedido aunque el evento se reciba dos veces.
    idempotency: 'event.data.pedidoId',
  },
  async ({ event, step, logger }) => {
    const data = event.data as EventoPedidoIngestado['data'];
    const { pedidoId, sellerId, tenantId, direccion, comuna, tipoPedido } = data;

    // -----------------------------------------------------------------------
    // Paso 1 · Leer el pedido. Si ya no está pendiente → no-op idempotente.
    // -----------------------------------------------------------------------
    const pedido = await step.run('leer-pedido', async () => {
      const supabase = crearClienteServiceRole();
      const { data: fila, error } = await supabase
        .schema('operacion')
        .from('pedidos')
        .select('id, tenant_id, seller_id, geo_estado, destinatario_comuna')
        .eq('id', pedidoId)
        .maybeSingle();

      if (error) {
        throw new Error(`Error al leer el pedido ${pedidoId}: ${error.message}`);
      }
      return fila as
        | {
            id: string;
            tenant_id: string;
            seller_id: string;
            geo_estado: string;
            destinatario_comuna: string | null;
          }
        | null;
    });

    if (!pedido) {
      logger.info(`Pedido ${pedidoId} no encontrado. No-op.`);
      return { resultado: 'pedido_no_encontrado' };
    }

    if (pedido.geo_estado !== 'pendiente') {
      logger.info(
        `Pedido ${pedidoId} ya tiene geo_estado='${pedido.geo_estado}'. No-op idempotente.`,
      );
      return { resultado: 'ya_geocodificado', geoEstado: pedido.geo_estado };
    }

    // Comuna efectiva: la de la fila si existe, si no la del evento.
    const comunaEfectiva = pedido.destinatario_comuna ?? comuna;

    // -----------------------------------------------------------------------
    // Paso 2 · Resolver coordenadas con cache global. Compartido con las
    // Server Actions de bodegas vía `resolverCoordenadaConCache`: mismo
    // comportamiento (HIT por clave_hash → sin llamar al proveedor; MISS →
    // llamar al puerto y UPSERT en cache), un solo lugar que lo implementa.
    // Sin `timeoutMs`: este job no lo necesita (retries: 3, sin humano
    // esperando) — comportamiento idéntico al de antes de la extracción.
    // -----------------------------------------------------------------------
    const resultado: ResultadoGeocoding = await step.run('resolver-geocoding', () =>
      resolverCoordenadaConCache({
        direccion,
        comuna: comunaEfectiva,
        logger: { info: (mensaje) => logger.info(`Pedido ${pedidoId}: ${mensaje}`) },
      }),
    );

    // -----------------------------------------------------------------------
    // Paso 3 · Calcular cobertura y persistir en el pedido.
    // -----------------------------------------------------------------------
    await step.run('persistir-pedido', async () => {
      const supabase = crearClienteServiceRole();

      // ¿Hay tarifa vigente para este seller/tipo? MISMA query que
      // `crearPedidoSameDay` (operacion/pedidos.ts): tarifa activa, vigente,
      // del tipo del pedido, específica del seller o por defecto del tenant.
      // Las tarifas viven en `identidad.tarifas`; se consultan vía la vista
      // `public.tarifas` (schema por defecto del cliente), igual que en
      // `crearPedidoSameDay`.
      const hoy = fechaLocalEnSantiago(new Date());
      const { data: tarifas, error: errorTarifa } = await supabase
        .from('tarifas')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('tipo_entrega', tipoPedido)
        .eq('estado', 'activa')
        .lte('vigente_desde', hoy)
        .or(`vigente_hasta.is.null,vigente_hasta.gte.${hoy}`)
        .or(`seller_id.eq.${sellerId},seller_id.is.null`)
        .limit(1);

      if (errorTarifa) {
        throw new Error(`Error al buscar tarifa vigente: ${errorTarifa.message}`);
      }

      const hayTarifaVigente = (tarifas?.length ?? 0) > 0;

      const cobertura = calcularCobertura({
        comunaDeclarada: comunaEfectiva,
        comunaResuelta: resultado.comunaResuelta,
        hayTarifaVigente,
      });

      const { error: updateError } = await supabase
        .schema('operacion')
        .from('pedidos')
        .update({
          lat: resultado.lat,
          long: resultado.long,
          geo_estado: resultado.estado,
          geo_confianza: resultado.confianza,
          geocodificado_en: new Date().toISOString(),
          cobertura_estado: cobertura,
        })
        .eq('id', pedidoId);

      if (updateError) {
        throw new Error(
          `Error al persistir geocoding en pedido ${pedidoId}: ${updateError.message}`,
        );
      }

      logger.info(
        `Pedido ${pedidoId}: geo_estado=${resultado.estado}, cobertura=${cobertura}.`,
      );
    });

    return {
      resultado: 'geocodificado',
      pedidoId,
      geoEstado: resultado.estado,
    };
  },
);
