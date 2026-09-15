/**
 * Send SMS Hook de Supabase — ENTREGA del OTP del conductor por WhatsApp (F4.b).
 * =============================================================================
 * `POST /api/hooks/send-sms`
 *
 * Supabase genera y valida el OTP del login por teléfono del conductor
 * (`signInWithOtp({phone})` / `verifyOtp`). Lo ÚNICO que delega en nosotros es la
 * ENTREGA: en vez de mandar un SMS, invoca este hook y nosotros mandamos el
 * código por WhatsApp con la plantilla de autenticación `codigo_acceso_conductor`.
 *
 * Doc oficial del hook (payload + firma + respuesta esperada):
 *   https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook
 *
 * -----------------------------------------------------------------------------
 * DECISIÓN: SIN BOOKKEEPING TENANT-SCOPED (idempotencia / `whatsapp_contactos`)
 * -----------------------------------------------------------------------------
 * El adaptador de NOTIFICACIONES reserva una fila
 * `(tenant_id, contacto_id, clave_idempotencia)` ANTES de llamar a Meta, y exige
 * `referencia`. Nada de eso aplica acá y NO se debe forzar:
 *
 *  · El OTP del conductor NO tiene tenant ni contacto todavía — el perfil se
 *    provisiona DESPUÉS, al canjear la invitación (`aceptar-invitacion`). No hay
 *    `tenant_id` con el que scopear una fila.
 *  · La idempotencia y el rate-limiting del OTP ya los hace Supabase (genera el
 *    código, controla la frecuencia, lo invalida al usarlo). Duplicar esa
 *    maquinaria acá no agrega garantía y sí acoplaría un mensaje de auth
 *    transitorio a tablas de negocio con RLS por tenant.
 *
 * Por eso se envía por el camino de BAJO NIVEL —el puerto `enviarPlantilla`
 * directo— SIN registrar contacto ni consumir la idempotencia de notificaciones.
 * Es el mismo puerto que usan los avisos; lo que se salta es el servicio
 * `enviarNotificacionWhatsApp` (que es el que hace el bookkeeping).
 *
 * -----------------------------------------------------------------------------
 * SEGURIDAD
 * -----------------------------------------------------------------------------
 *  1. Firma Standard Webhooks OBLIGATORIA (headers `webhook-*`). Fail-closed:
 *     sin `SUPABASE_SEND_SMS_HOOK_SECRET` o con firma inválida NO se manda nada.
 *  2. El TELÉFONO nunca sale entero a logs (dato personal) y el CÓDIGO jamás se
 *     loguea (credencial de un solo uso).
 *  3. El teléfono y el código salen del PAYLOAD FIRMADO por Supabase, no de un
 *     input sin verificar.
 *
 * RESPUESTA (según la doc): 200 vacío = éxito. Un status ≥400 hace que Supabase
 * trate la entrega como fallida (y falle el login o reintente). Fail-closed en
 * cada rama de error.
 */

import { NextRequest, NextResponse } from "next/server";

import { capturarMensaje } from "@/lib/observabilidad";
import { consumirRateLimit } from "@/lib/rate-limit";
import { enmascararTelefono, normalizarTelefonoE164 } from "@/lib/telefono-cl";
import { verificarFirmaHookSupabase } from "@/lib/supabase/verificar-hook-standard-webhooks";
import {
  obtenerPlantilla,
  obtenerPuertoWhatsApp,
} from "@/modules/integraciones/notificaciones/whatsapp";

/** Node runtime: se usa `node:crypto` para verificar la firma HMAC. */
export const runtime = "nodejs";

/**
 * Rate limit FIJO: el hook es org-level (un solo número de Rutax). 120/min
 * absorbe una ráfaga de logins sin abrir la puerta a un flood que gaste cuota de
 * WhatsApp. Antes de leer el body: un flood no paga ni parseo ni HMAC.
 */
const LLAVE_RATE_LIMIT = "send-sms-hook:global";
const LIMITE = 120;
const VENTANA_SEGUNDOS = 60;

/** El evento de auth del conductor. Debe existir en el catálogo. */
const CLAVE_PLANTILLA = "acceso_conductor";

interface PayloadSendSms {
  user?: { phone?: unknown };
  sms?: { otp?: unknown };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Rate limit antes de tocar el body.
  const limite = await consumirRateLimit(LLAVE_RATE_LIMIT, LIMITE, VENTANA_SEGUNDOS);
  if (!limite.permitido) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limite.reintentarEnSegundos) } },
    );
  }

  // 2. RAW body — la firma se calcula sobre los bytes exactos.
  const cuerpoCrudo = await request.text();

  // 3. Fail-closed sin secreto: jamás se procesa un hook que no se autentica.
  const secreto = process.env.SUPABASE_SEND_SMS_HOOK_SECRET ?? "";
  if (!secreto) {
    await capturarMensaje(
      "Send SMS hook recibido pero SUPABASE_SEND_SMS_HOOK_SECRET no está configurado.",
      "error",
      { origen: "hook:send-sms" },
    );
    return NextResponse.json({ error: "no_configurado" }, { status: 500 });
  }

  // 4. Verificar la firma ANTES de parsear.
  const firmaValida = verificarFirmaHookSupabase({
    cuerpoCrudo,
    webhookId: request.headers.get("webhook-id"),
    webhookTimestamp: request.headers.get("webhook-timestamp"),
    webhookSignature: request.headers.get("webhook-signature"),
    secreto,
  });
  if (!firmaValida) {
    return NextResponse.json({ error: "firma_invalida" }, { status: 401 });
  }

  // 5. Parsear y extraer teléfono + código.
  let payload: PayloadSendSms;
  try {
    payload = JSON.parse(cuerpoCrudo) as PayloadSendSms;
  } catch {
    return NextResponse.json({ error: "cuerpo_invalido" }, { status: 400 });
  }

  const telefonoCrudo = typeof payload.user?.phone === "string" ? payload.user.phone : "";
  const codigo = typeof payload.sms?.otp === "string" ? payload.sms.otp : "";
  if (!telefonoCrudo || !codigo) {
    // Falta lo esencial. No se loguea ni el teléfono ni el código.
    return NextResponse.json({ error: "payload_incompleto" }, { status: 400 });
  }

  const normalizado = normalizarTelefonoE164(telefonoCrudo);
  if (!normalizado.valido) {
    return NextResponse.json({ error: "telefono_invalido" }, { status: 400 });
  }

  // 6. Enviar por el camino de BAJO NIVEL (sin bookkeeping — ver cabecera).
  const plantilla = obtenerPlantilla(CLAVE_PLANTILLA);
  if (!plantilla) {
    // Error de programación: el catálogo perdió la plantilla. No filtra nada.
    await capturarMensaje(
      `Send SMS hook: falta la plantilla '${CLAVE_PLANTILLA}' en el catálogo.`,
      "error",
      { origen: "hook:send-sms" },
    );
    return NextResponse.json({ error: "plantilla_ausente" }, { status: 500 });
  }

  const puerto = obtenerPuertoWhatsApp();
  const resultado = await puerto.enviarPlantilla({
    telefonoE164: normalizado.telefonoE164,
    nombrePlantilla: plantilla.nombre,
    idioma: plantilla.idioma,
    variables: [codigo], // el código va en el cuerpo y —vía el flag— en el botón
    esPlantillaAutenticacion: plantilla.esAutenticacion,
  });

  if (!resultado.enviado) {
    // El teléfono va ENMASCARADO; el código y el token nunca aparecen.
    await capturarMensaje(
      `Send SMS hook: no se entregó el código por WhatsApp (${enmascararTelefono(normalizado.telefonoE164)}). ` +
        `${resultado.errorDescripcion ?? "sin detalle"}`,
      "warning",
      { origen: "hook:send-sms" },
    );
    // ≥400 para que Supabase falle la entrega. 502 si vale la pena reintentar
    // (Supabase reintenta), 422 si es permanente (número/plantilla) — no tiene
    // sentido reintentar y el login fallará limpio.
    return NextResponse.json(
      { error: "no_entregado" },
      { status: resultado.reintentable ? 502 : 422 },
    );
  }

  // 200 vacío = éxito, tal como espera Supabase.
  return NextResponse.json({});
}
