/**
 * Webhook de Fintoc — confirmación del COBRO DE SUSCRIPCIÓN (Rutax→courier).
 * =====================================================================
 * POST /api/webhooks/fintoc-suscripcion
 *
 * Org-level (igual que `fintoc-payout`, NO per-tenant): una sola cuenta Fintoc
 * de la plataforma cobra a todos los couriers, así que el secreto del Webhook
 * Endpoint es de ORGANIZACIÓN (`FINTOC_SUSCRIPCION_WEBHOOK_SECRET`). El período
 * se resuelve DESPUÉS de validar la firma, por la metadata del evento.
 *
 * FLUJO:
 * 1. Rate limit (clave fija — el tenant aún no se conoce).
 * 2. RAW body (la firma se calcula sobre los bytes crudos).
 * 3. Header `Fintoc-Signature` ausente → 401.
 * 4. Validar firma con el secreto de ORG (fail-closed si falta). Inválida → 401.
 * 5. Parsear JSON solo tras validar la firma.
 * 6. Normalizar (`normalizarEventoPagoSuscripcion`). null → 200 (evento no relevante).
 * 7. `confirmarPagoSuscripcion`: marca período pagado / pago confirmado (idempotente).
 * 8. Responder 200 en todo caso no-error (Fintoc no debe reintentar por un no-match).
 */

import { NextRequest, NextResponse } from 'next/server';
import { consumirRateLimit } from '@/lib/rate-limit';
import { capturarMensaje } from '@/lib/observabilidad';
import { verificarFirmaWebhookFintoc } from '@/modules/integraciones/pagos/firma-webhook-fintoc';
import { normalizarEventoPagoSuscripcion } from '@/modules/integraciones/pagos';
import { confirmarPagoSuscripcion } from '@/modules/plataforma/cobro';

const LLAVE_RATE_LIMIT = 'fintoc-suscripcion:global';
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
  const secreto = process.env.FINTOC_SUSCRIPCION_WEBHOOK_SECRET ?? '';
  if (!secreto) {
    await capturarMensaje(
      'Webhook de suscripción recibido pero FINTOC_SUSCRIPCION_WEBHOOK_SECRET no está configurado.',
      'error',
      { origen: 'webhook:fintoc-suscripcion' },
    );
    return NextResponse.json({ error: 'webhook_no_configurado' }, { status: 401 });
  }

  const firmaValida = verificarFirmaWebhookFintoc({ cuerpoCrudo, firmaHeader, secreto });
  if (!firmaValida) {
    await capturarMensaje(
      'Webhook de suscripción con firma inválida o fuera de tolerancia anti-replay.',
      'warning',
      { origen: 'webhook:fintoc-suscripcion' },
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

  // 6. Normalizar. null = evento no relevante para el cobro de suscripción.
  const evento = normalizarEventoPagoSuscripcion(payload);
  if (!evento) {
    return NextResponse.json({ ok: true, ignorado: true }, { status: 200 });
  }

  // 7. Confirmar (o registrar fallo). Idempotente ante entregas duplicadas.
  try {
    const { resultado, periodoId } = await confirmarPagoSuscripcion(evento);

    if (resultado === 'sin_periodo') {
      await capturarMensaje(
        `Webhook de suscripción: el evento ${evento.eventoExternoId} no corresponde a ningún período conocido.`,
        'warning',
        {
          origen: 'webhook:fintoc-suscripcion',
          etiquetas: { evento_externo_id: evento.eventoExternoId, link_externo_id: evento.linkExternoId ?? 'null' },
        },
      );
    }

    if (resultado === 'monto_discrepante') {
      // Defensa en profundidad (H-4): el monto informado por Fintoc no calza
      // con el período — queda pendiente para revisión manual, no reintentos.
      await capturarMensaje(
        `Webhook de suscripción: monto discrepante en el período ${periodoId} (evento ${evento.eventoExternoId}).`,
        'warning',
        {
          origen: 'webhook:fintoc-suscripcion',
          etiquetas: { evento_externo_id: evento.eventoExternoId, periodo_id: periodoId ?? 'null' },
        },
      );
    }

    return NextResponse.json({ ok: true, resultado, periodoId }, { status: 200 });
  } catch (err) {
    console.error(`[webhook fintoc-suscripcion] error al confirmar: ${(err as Error).message}`);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }
}
