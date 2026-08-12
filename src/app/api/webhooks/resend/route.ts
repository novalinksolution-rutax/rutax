/**
 * Webhook handler de Resend — entrega y rebote del correo de invitación
 * =====================================================================
 * POST /api/webhooks/resend
 *
 * POR QUÉ EXISTE: el proveedor ACEPTA el envío y devuelve un id; el rebote
 * ocurre después. Sin este endpoint, una invitación mandada a una dirección mal
 * escrita se ve exactamente igual que una que llegó: la pantalla confirma el
 * envío, el seller nunca entra, y nadie sabe por qué. Esto convierte ese
 * silencio en un estado visible en /sellers.
 *
 * SEGURIDAD:
 *  1. Rate limit ANTES de leer el body — un flood no paga ni parseo ni HMAC.
 *  2. Firma Svix obligatoria (Resend SÍ firma, a diferencia de ML). Fail-closed:
 *     sin `RESEND_WEBHOOK_SECRET` configurado NUNCA se acepta un evento.
 *  3. El JSON se parsea SOLO después de validar la firma.
 *  4. Anti-replay de ±5 min dentro del verificador.
 *
 * ALCANCE DEL EFECTO: este endpoint solo escribe cuatro columnas de estado de
 * entrega en `identidad.invitaciones`. No cambia `estado`, no revoca, no crea
 * usuarios. Un evento falso que sortee la firma, a lo sumo, pinta mal un rótulo.
 *
 * ES ORG-LEVEL, NO POR TENANT: la cuenta de Resend es una sola para todo Rutax,
 * igual que la de payouts. El tenant se descubre DESPUÉS, al resolver a qué
 * invitación pertenece el id del mensaje.
 */

import { NextRequest, NextResponse } from "next/server";
import { consumirRateLimit } from "@/lib/rate-limit";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { capturarMensaje } from "@/lib/observabilidad";
import {
  normalizarEventoWebhookResend,
  verificarFirmaWebhookResend,
} from "@/modules/integraciones/notificaciones/email/webhook-resend";

/**
 * Clave de rate limit FIJA: la cuenta de Resend es de organización y el tenant
 * no se conoce hasta resolver la invitación. Los correos de invitación son
 * decenas por día en todo el sistema; 120/min absorbe cualquier ráfaga legítima
 * (incluidos los reintentos de Resend) sin abrir la puerta a un flood.
 */
const LLAVE_RATE_LIMIT = "resend-webhook:global";
const LIMITE = 120;
const VENTANA_SEGUNDOS = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Rate limit.
  const limite = await consumirRateLimit(LLAVE_RATE_LIMIT, LIMITE, VENTANA_SEGUNDOS);
  if (!limite.permitido) {
    console.warn(`[webhook resend] rate limit excedido (límite ${LIMITE}/${VENTANA_SEGUNDOS}s).`);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limite.reintentarEnSegundos) } },
    );
  }

  // 2. RAW body — la firma se calcula sobre los bytes exactos.
  const cuerpoCrudo = await request.text();

  // 3. Headers de Svix: los tres son obligatorios.
  const svixId = request.headers.get("svix-id") ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
  const svixSignature = request.headers.get("svix-signature") ?? "";
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "firma_ausente" }, { status: 401 });
  }

  // 4. Fail-closed sin secreto: jamás se procesa un evento que no se autentica.
  const secreto = process.env.RESEND_WEBHOOK_SECRET ?? "";
  if (!secreto) {
    await capturarMensaje(
      "Webhook de Resend recibido pero RESEND_WEBHOOK_SECRET no está configurado.",
      "error",
      { origen: "webhook:resend" },
    );
    return NextResponse.json({ error: "webhook_no_configurado" }, { status: 401 });
  }

  const firmaValida = verificarFirmaWebhookResend({
    cuerpoCrudo,
    svixId,
    svixTimestamp,
    svixSignature,
    secreto,
  });
  if (!firmaValida) {
    await capturarMensaje(
      "Webhook de Resend con firma inválida o fuera de tolerancia anti-replay.",
      "warning",
      { origen: "webhook:resend" },
    );
    return NextResponse.json({ error: "firma_invalida" }, { status: 401 });
  }

  // 5. Parsear SOLO después de validar la firma.
  let payload: unknown;
  try {
    payload = JSON.parse(cuerpoCrudo);
  } catch {
    return NextResponse.json({ error: "body_malformado" }, { status: 400 });
  }

  // 6. Normalizar. `null` = evento que no nos interesa (`email.sent`,
  //    `email.opened`, …). Se responde 200: un 4xx haría que Resend reintente
  //    para siempre algo que nunca vamos a querer.
  const evento = normalizarEventoWebhookResend(payload);
  if (!evento) {
    return NextResponse.json({ ok: true, ignorado: true }, { status: 200 });
  }

  // 7. Resolver la invitación por el id del mensaje.
  const cliente = crearClienteServiceRole();
  const { data: invitacion, error: errorBuscar } = await cliente
    .from("invitaciones")
    .select("id, tenant_id, email, seller_id")
    .eq("email_proveedor_id", evento.proveedorId)
    .maybeSingle();

  if (errorBuscar) {
    // 500 a propósito: Resend reintenta y no perdemos el evento.
    await capturarMensaje("No se pudo resolver la invitación de un webhook de Resend.", "error", {
      origen: "webhook:resend",
    });
    return NextResponse.json({ error: "error_interno" }, { status: 500 });
  }
  if (!invitacion) {
    // El correo no era de una invitación (p. ej. una notificación de
    // plataforma) o es anterior a que guardáramos el id. No es un error.
    return NextResponse.json({ ok: true, sin_correlacion: true }, { status: 200 });
  }

  // 8. Registrar el estado de entrega.
  const { error: errorUpdate } = await cliente
    .from("invitaciones")
    .update({
      email_estado: evento.estado,
      email_estado_en: new Date().toISOString(),
      email_motivo: evento.motivo,
    })
    .eq("id", invitacion.id as string);

  if (errorUpdate) {
    await capturarMensaje("No se pudo registrar el estado de entrega del correo.", "error", {
      origen: "webhook:resend",
    });
    return NextResponse.json({ error: "error_interno" }, { status: 500 });
  }

  // 9. Bitácora SOLO de lo accionable. `entregado` es el caso feliz y ocurre en
  //    cada invitación: registrarlo llenaría la auditoría de ruido sin aportar
  //    nada que alguien vaya a consultar.
  if (evento.estado !== "entregado") {
    await registrarEnBitacora(cliente, {
      tenantId: invitacion.tenant_id as string,
      actorUsuarioId: null,
      actorTipo: "sistema",
      accion: evento.estado === "rebotado" ? "invitacion.email_rebotado" : "invitacion.email_marcado_spam",
      entidadTipo: "invitacion",
      entidadId: invitacion.id as string,
      detalle: {
        email: invitacion.email as string,
        seller_id: (invitacion.seller_id as string | null) ?? null,
        motivo: evento.motivo,
      },
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
