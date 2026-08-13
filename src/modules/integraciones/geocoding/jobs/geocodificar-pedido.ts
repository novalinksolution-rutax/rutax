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
 * llamadores. Este job lo invoca con `timeoutMs` propio (15 s, más holgado que
 * los 8 s del camino síncrono de bodegas) y con `concurrency: 5` — ver el
 * porqué de ambos en la configuración de la función, más abajo.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import type { EventoPedidoIngestado } from '@/lib/inngest/eventos';
import { resolverComunaCanonica } from '../normalizacion';
import { resolverCoordenadaConCache } from '../resolver-coordenada';
import type { CoberturaEstado, ResultadoGeocoding } from '../tipos';
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";

/**
 * Techo de tiempo por llamada al geocoder desde el JOB. Más alto que el del
 * camino síncrono de bodegas (`TIMEOUT_GEOCODING_SINCRONO_MS`, 8 s) porque aquí
 * nadie espera en pantalla: el objetivo no es responder rápido, es no retener un
 * slot de concurrencia para siempre. Con `retries: 3`, el peor caso por pedido
 * son ~45 s antes de darse por vencido.
 */
const TIMEOUT_GEOCODING_JOB_MS = 15_000;

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
    // Un evento POR PEDIDO, publicado desde la ingesta de ML y desde same-day.
    // El cron de ingesta puede traer cientos de golpe, así que sin este límite
    // la ráfaga entra entera y a la vez.
    //
    // Ojo con el porqué, que no es el obvio: el adaptador YA clasifica 429 y
    // OVER_QUERY_LIMIT como reintentables, y hay `retries: 3`, así que Google
    // rechazando no rompe nada por sí solo. Lo que lo hace necesario es que si
    // una ráfaga agota esos tres reintentos, el pedido se queda en `pendiente`
    // PARA SIEMPRE — no existe ningún barrido que lo recupere (verificado
    // 2026-08-13; el único disparo es este evento) y solo se desatasca a mano,
    // pedido por pedido. Sin coordenada no hay ruta: el daño es silencioso y
    // aparece recién al rutear.
    //
    // 5 concurrentes contra ~200-500 ms por llamada son ~10-25 req/s, holgado
    // bajo el límite de Google, y 400 pedidos se resuelven en menos de un
    // minuto — irrelevante para algo asíncrono. Y de paso deja de competir con
    // los jobs de dinero por los slots de Inngest.
    //
    // Lo que este límite NO hace: ahorrar dinero. Se realizan exactamente las
    // mismas llamadas facturables, solo más espaciadas.
    concurrency: { limit: 5 },
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
        // Más holgado que el camino síncrono de bodegas (8 s), donde hay un
        // humano mirando el formulario: aquí solo importa no quedarse colgado.
        // Sin techo, un fetch que nunca responde retiene su slot de
        // concurrencia indefinidamente y bloquea a los pedidos que vienen
        // detrás — `retries: 3` no ayuda con eso, porque el intento jamás
        // termina. El resto del repo ya tiene la convención de timeout
        // explícito en todo fetch (`integraciones/contexto/http.ts`).
        timeoutMs: TIMEOUT_GEOCODING_JOB_MS,
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
