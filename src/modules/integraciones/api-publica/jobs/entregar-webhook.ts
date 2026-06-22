// Job F23 · integraciones/entregarWebhook
// =====================================================================
// Trigger: cron cada 2 minutos (expresión: "*/2 * * * *").
//
// Responsabilidad:
// - Listar hasta 50 filas de `webhook_outbox` en estado 'pendiente' con
//   `proximo_intento_en <= now()`.
// - Para cada una: leer el endpoint, firmar el body con HMAC-SHA256 si
//   tiene secreto configurado, hacer el POST HTTP con timeout de 10 s.
// - 2xx  marcar 'enviado'.
// - Error: incrementar `intento_num`; si >= `reintentos_max` marcar
//   'descartado'; si no marcar 'fallido' con backoff exponencial (2^n * 30 s).
//
// Invariantes de seguridad:
// - NUNCA loguear el body del webhook (puede contener datos de negocio).
// - NUNCA loguear la URL completa (puede contener tokens en el path).
// - El secreto HMAC se descifra justo antes de firmar y no se asigna a
//   variables de mayor vida.
// - `descifrarSecreto` solo se invoca con service_role (ya implícito aquí).
//
// Idempotencia: cada fila tiene estado; si el job se reintenta, las filas
// ya enviadas están en estado 'enviado' y no se re-procesan (filtro por
// estado='pendiente').

import crypto from 'node:crypto';
import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { descifrarSecreto } from '@/modules/integraciones/secretos/cifrado';
import { validarUrlWebhook } from '@/modules/integraciones/api-publica/url-webhook';

export const jobEntregarWebhook = inngest.createFunction(
  {
    id: 'integraciones/entregarWebhook',
    name: 'Integraciones · Entregar webhooks salientes',
    triggers: [{ cron: '*/2 * * * *' }],
    retries: 1,
  },
  async ({ step, logger }) => {
    // -------------------------------------------------------------------------
    // Step 1 — Listar filas pendientes vencidas (hasta 50)
    // -------------------------------------------------------------------------
    const pendientes = await step.run('listar-pendientes', async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema('integraciones')
        .from('webhook_outbox')
        .select('id, tenant_id, endpoint_id, evento_tipo, payload, intento_num')
        .eq('estado', 'pendiente')
        .lte('proximo_intento_en', new Date().toISOString())
        .order('proximo_intento_en', { ascending: true })
        .limit(50);

      if (error) {
        throw new Error(`Error al listar webhook_outbox pendientes: ${error.message}`);
      }

      return data ?? [];
    });

    if (pendientes.length === 0) {
      return { resultado: 'sin_pendientes' };
    }

    logger.info(`[entregarWebhook] ${pendientes.length} webhooks pendientes a procesar.`);

    // -------------------------------------------------------------------------
    // Step 2 — Entregar lote
    // -------------------------------------------------------------------------
    const resultados = await step.run('entregar-lote', async () => {
      const supabase = crearClienteServiceRole();

      const entregas = pendientes.map(async (fila) => {
        const outboxId = fila.id as string;
        const endpointId = fila.endpoint_id as string;
        const eventoTipo = fila.evento_tipo as string;
        const payload = fila.payload as Record<string, unknown>;
        const intentoNum = (fila.intento_num as number) ?? 0;
        const tenantId = fila.tenant_id as string;

        try {
          // Leer endpoint (url, secreto_firma_ref, reintentos_max).
          const { data: endpoint, error: errEndpoint } = await supabase
            .schema('integraciones')
            .from('webhook_endpoints')
            .select('url, secreto_firma_ref, reintentos_max')
            .eq('id', endpointId)
            .maybeSingle();

          if (errEndpoint || !endpoint) {
            // Endpoint eliminado: descartar la fila de outbox.
            await supabase
              .schema('integraciones')
              .from('webhook_outbox')
              .update({ estado: 'descartado', ultimo_error: 'Endpoint no encontrado.' })
              .eq('id', outboxId);
            return { outboxId, resultado: 'descartado' };
          }

          const url = endpoint.url as string;
          const secretoRef = endpoint.secreto_firma_ref as string | null;
          const reintentosMax = (endpoint.reintentos_max as number) ?? 3;

          // Revalidación anti-SSRF en la ENTREGA (defensa en profundidad): aunque
          // la creación ya valida, una fila vieja o creada por otra vía podría
          // apuntar a un destino interno. URL no permitida → descartar, no fetch.
          const urlValida = validarUrlWebhook(url);
          if (!urlValida.ok) {
            await supabase
              .schema('integraciones')
              .from('webhook_outbox')
              .update({ estado: 'descartado', ultimo_error: `URL no permitida: ${urlValida.motivo}` })
              .eq('id', outboxId);
            return { outboxId, resultado: 'descartado' };
          }

          // Construir body del webhook.
          const body = JSON.stringify({
            evento: eventoTipo,
            tenant_id: tenantId,
            data: payload,
            timestamp: new Date().toISOString(),
          });

          // Preparar headers — NUNCA incluir la URL completa ni el secreto en logs.
          const requestHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Rutax-Event': eventoTipo,
          };

          // Firma HMAC-SHA256 si el endpoint tiene secreto configurado.
          if (secretoRef) {
            try {
              const descifrado = await descifrarSecreto(secretoRef);
              const secretoTexto =
                typeof descifrado.valor === 'string'
                  ? descifrado.valor
                  : Buffer.from(descifrado.valor as Uint8Array).toString('utf8');
              // Calcular firma y descartar el secreto inmediatamente.
              const firma =
                'sha256=' + crypto.createHmac('sha256', secretoTexto).update(body).digest('hex');
              requestHeaders['X-Rutax-Signature'] = firma;
            } catch {
              // Si no se puede descifrar el secreto, entregar sin firma (no bloquear).
              logger.info('[entregarWebhook] No se pudo leer secreto de firma; entregando sin firma.');
            }
          }

          // POST HTTP con timeout de 10 s.
          let response: Response;
          try {
            response = await fetch(url, {
              method: 'POST',
              headers: requestHeaders,
              body,
              signal: AbortSignal.timeout(10_000),
            });
          } catch (fetchErr) {
            // Error de red / timeout → reintentar si quedan intentos.
            const nuevoIntento = intentoNum + 1;
            const siguienteEstado = nuevoIntento >= reintentosMax ? 'descartado' : 'fallido';
            const proximoIntento = calcularProximoIntento(nuevoIntento);

            await supabase
              .schema('integraciones')
              .from('webhook_outbox')
              .update({
                estado: siguienteEstado,
                intento_num: nuevoIntento,
                ultimo_error: fetchErr instanceof Error ? fetchErr.message : 'Error de red.',
                proximo_intento_en: proximoIntento,
              })
              .eq('id', outboxId);

            return { outboxId, resultado: siguienteEstado };
          }

          if (response.ok) {
            // 2xx → éxito.
            await supabase
              .schema('integraciones')
              .from('webhook_outbox')
              .update({
                estado: 'enviado',
                enviado_en: new Date().toISOString(),
                ultimo_error: null,
              })
              .eq('id', outboxId);

            return { outboxId, resultado: 'enviado' };
          }

          // Respuesta no-2xx → contar como fallo y reintentar.
          const nuevoIntento = intentoNum + 1;
          const siguienteEstado = nuevoIntento >= reintentosMax ? 'descartado' : 'fallido';
          const proximoIntento = calcularProximoIntento(nuevoIntento);

          await supabase
            .schema('integraciones')
            .from('webhook_outbox')
            .update({
              estado: siguienteEstado,
              intento_num: nuevoIntento,
              // Solo loguear el código HTTP, no el body de la respuesta.
              ultimo_error: `HTTP ${response.status}`,
              proximo_intento_en: proximoIntento,
            })
            .eq('id', outboxId);

          return { outboxId, resultado: siguienteEstado };
        } catch (err) {
          // Error inesperado al procesar esta fila específica.
          const nuevoIntento = intentoNum + 1;
          try {
            await supabase
              .schema('integraciones')
              .from('webhook_outbox')
              .update({
                estado: 'fallido',
                intento_num: nuevoIntento,
                ultimo_error: err instanceof Error ? err.message : 'Error inesperado.',
                proximo_intento_en: calcularProximoIntento(nuevoIntento),
              })
              .eq('id', outboxId);
          } catch {
            // Ignorar error del UPDATE de recuperación.
          }
          return { outboxId, resultado: 'error' };
        }
      });

      return Promise.allSettled(entregas);
    });

    const enviados = resultados.filter(
      (r) => r.status === 'fulfilled' && (r.value as { resultado: string }).resultado === 'enviado',
    ).length;

    logger.info(`[entregarWebhook] Lote procesado: ${enviados}/${pendientes.length} enviados.`);

    return {
      resultado: 'procesado',
      total: pendientes.length,
      enviados,
    };
  },
);

/**
 * Calcula la fecha del próximo intento con backoff exponencial.
 * Fórmula: now + 2^intentoNum * 30 segundos.
 * Ejemplo: intento 1 → 30 s, intento 2 → 60 s, intento 3 → 120 s, …
 */
function calcularProximoIntento(intentoNum: number): string {
  const segundos = Math.pow(2, intentoNum) * 30;
  return new Date(Date.now() + segundos * 1_000).toISOString();
}
