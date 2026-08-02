/**
 * Webhook de Fintoc — confirmación de AUTO-COBRO RECURRENTE de suscripción
 * (Rutax→courier vía mandato, F1-E). Molde de
 * `api/webhooks/fintoc-suscripcion/route.ts` (org-level), adaptado a los 5
 * tipos de evento normalizados por `normalizarEventoRecurrente`.
 * =====================================================================
 * POST /api/webhooks/fintoc-suscripcion-recurrente
 *
 * Org-level (NO per-tenant): una sola cuenta Fintoc de la plataforma cobra a
 * todos los couriers, así que el secreto del Webhook Endpoint es de
 * ORGANIZACIÓN (`FINTOC_SUSCRIPCION_RECURRENTE_WEBHOOK_SECRET`) — distinto del
 * secreto del webhook de LINK (`FINTOC_SUSCRIPCION_WEBHOOK_SECRET`), aunque
 * ambos sean de la misma cuenta Fintoc de organización: endpoints distintos,
 * secretos de Webhook Endpoint distintos (Fintoc firma por endpoint).
 *
 * FLUJO:
 * 1. Rate limit (clave fija — el tenant aún no se conoce).
 * 2. RAW body (la firma se calcula sobre los bytes crudos).
 * 3. Header `Fintoc-Signature` ausente → 401.
 * 4. Validar firma con el secreto de ORG (fail-closed si falta). Inválida → 401.
 * 5. Parsear JSON solo tras validar la firma.
 * 6. `normalizarEventoRecurrente` — despacha por `tipo`:
 *    - `mandato_activado`  → `activarMandatoRecurrente` (cifra el mandatoToken).
 *    - `mandato_fallido`   → `marcarMandatoFallido`.
 *    - `cobro_exitoso`     → `confirmarCobroRecurrente` (reconciliación H-4,
 *      publica `plataforma/pago.confirmado`).
 *    - `cobro_fallido`     → `confirmarCobroRecurrente` (marca fallido).
 *    - `ignorado`          → 200 no-op.
 * 7. Responder 200 en todo caso no-error (Fintoc no debe reintentar por un
 *    no-match — ni de correlación ni de monto).
 */

import { NextRequest, NextResponse } from 'next/server';
import { consumirRateLimit } from '@/lib/rate-limit';
import { capturarMensaje } from '@/lib/observabilidad';
import { verificarFirmaWebhookFintoc } from '@/modules/integraciones/pagos/firma-webhook-fintoc';
import { normalizarEventoRecurrente } from '@/modules/integraciones/pagos/suscripcion-recurrente';
import { confirmarCobroRecurrente } from '@/modules/plataforma/cobro';
import { activarMandatoRecurrente, marcarMandatoFallido } from '@/modules/plataforma/mandato';

const LLAVE_RATE_LIMIT = 'fintoc-suscripcion-recurrente:global';
const LIMITE = 60;
const VENTANA_SEGUNDOS = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Rate limit ANTES de leer body/validar firma.
  const limite = await consumirRateLimit(LLAVE_RATE_LIMIT, LIMITE, VENTANA_SEGUNDOS);
  if (!limite.permitido) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limite.reintentarEnSegundos) } },
    );
  }

  // 2. RAW body.
  const cuerpoCrudo = await request.text();

  // 3. Header de firma obligatorio.
  const firmaHeader = request.headers.get('Fintoc-Signature') ?? '';
  if (!firmaHeader) {
    return NextResponse.json({ error: 'firma_ausente' }, { status: 401 });
  }

  // 4. Secreto de ORG — fail-closed si falta (nunca se procesa lo no autenticable).
  const secreto = process.env.FINTOC_SUSCRIPCION_RECURRENTE_WEBHOOK_SECRET ?? '';
  if (!secreto) {
    await capturarMensaje(
      'Webhook de auto-cobro recibido pero FINTOC_SUSCRIPCION_RECURRENTE_WEBHOOK_SECRET no está configurado.',
      'error',
      { origen: 'webhook:fintoc-suscripcion-recurrente' },
    );
    return NextResponse.json({ error: 'webhook_no_configurado' }, { status: 401 });
  }

  const firmaValida = verificarFirmaWebhookFintoc({ cuerpoCrudo, firmaHeader, secreto });
  if (!firmaValida) {
    await capturarMensaje(
      'Webhook de auto-cobro con firma inválida o fuera de tolerancia anti-replay.',
      'warning',
      { origen: 'webhook:fintoc-suscripcion-recurrente' },
    );
    return NextResponse.json({ error: 'firma_invalida' }, { status: 401 });
  }

  // 5. Parsear el payload SOLO tras validar la firma.
  let payload: unknown;
  try {
    payload = JSON.parse(cuerpoCrudo);
  } catch {
    return NextResponse.json({ error: 'body_malformado' }, { status: 400 });
  }

  // 6. Normalizar y despachar por tipo. Nunca lanza — `ignorado` cubre lo no
  // reconocido, así que el `try` de abajo es solo para los efectos (BD/cifrado).
  const evento = normalizarEventoRecurrente(payload);

  try {
    switch (evento.tipo) {
      case 'ignorado': {
        return NextResponse.json({ ok: true, ignorado: true, razon: evento.razon }, { status: 200 });
      }

      case 'mandato_activado': {
        const resultado = await activarMandatoRecurrente({
          mandatoExternoId: evento.mandatoExternoId,
          suscripcionId: evento.suscripcionId,
        });
        if (resultado === 'sin_suscripcion') {
          await capturarMensaje(
            `Webhook de auto-cobro: mandato_activado sin suscripcionId correlacionable (mandato ${evento.mandatoExternoId}).`,
            'warning',
            { origen: 'webhook:fintoc-suscripcion-recurrente', etiquetas: { tipo: evento.tipo } },
          );
        }
        return NextResponse.json({ ok: true, resultado }, { status: 200 });
      }

      case 'mandato_fallido': {
        const resultado = await marcarMandatoFallido({ suscripcionId: evento.suscripcionId });
        if (resultado === 'sin_suscripcion') {
          await capturarMensaje(
            `Webhook de auto-cobro: mandato_fallido sin suscripcionId correlacionable (mandato ${evento.mandatoExternoId}).`,
            'warning',
            { origen: 'webhook:fintoc-suscripcion-recurrente', etiquetas: { tipo: evento.tipo } },
          );
        }
        return NextResponse.json({ ok: true, resultado }, { status: 200 });
      }

      case 'cobro_exitoso':
      case 'cobro_fallido': {
        const { resultado, periodoId } = await confirmarCobroRecurrente(evento);
        if (resultado === 'sin_periodo') {
          await capturarMensaje(
            `Webhook de auto-cobro: el cargo ${evento.cobroExternoId} no corresponde a ningún período conocido.`,
            'warning',
            { origen: 'webhook:fintoc-suscripcion-recurrente', etiquetas: { cobro_externo_id: evento.cobroExternoId } },
          );
        }
        if (resultado === 'monto_discrepante') {
          await capturarMensaje(
            `Webhook de auto-cobro: monto discrepante en el período ${periodoId} (cargo ${evento.cobroExternoId}).`,
            'warning',
            { origen: 'webhook:fintoc-suscripcion-recurrente', etiquetas: { periodo_id: periodoId ?? 'null' } },
          );
        }
        return NextResponse.json({ ok: true, resultado, periodoId }, { status: 200 });
      }

      default: {
        // Exhaustividad de TS: no debería alcanzarse.
        return NextResponse.json({ ok: true, ignorado: true }, { status: 200 });
      }
    }
  } catch (err) {
    console.error(`[webhook fintoc-suscripcion-recurrente] error al procesar: ${(err as Error).message}`);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }
}
