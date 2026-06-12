/**
 * Webhook de Fintoc — endpoint BASE (sin tenant).
 * =====================================================================
 * POST /api/webhooks/fintoc
 *
 * La cobranza usa una URL de webhook POR-TENANT
 * (`/api/webhooks/fintoc/{tenantId}`, ver el handler en `[tenantId]/route.ts`)
 * para resolver el tenant de forma determinista antes de validar la firma
 * `Fintoc-Signature` con el secreto de ESE tenant. El secreto del Webhook
 * Endpoint de Fintoc es por-tenant, y el payload no trae un identificador de
 * tenant estable y no-secreto → el tenant viaja en el path.
 *
 * Este endpoint base existe solo para devolver un error claro si alguien
 * registra la URL sin el segmento de tenant. NO procesa pagos.
 */

import { NextResponse } from 'next/server';

export function POST(): NextResponse {
  return NextResponse.json(
    {
      error: 'tenant_requerido',
      detalle:
        'Configura el webhook de Fintoc con la URL por-tenant: /api/webhooks/fintoc/{tenantId}.',
    },
    { status: 404 },
  );
}
