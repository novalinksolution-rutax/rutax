import { type NextRequest, NextResponse } from "next/server";

import { autenticarBearerSoloAuth } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { normalizarTelefonoE164 } from "@/lib/telefono-cl";
import { aceptarInvitacionPorTelefono } from "@/modules/identidad/invitaciones";

/**
 * Canje de invitación del CONDUCTOR por TELÉFONO (F4.a) — superficie para la
 * app nativa, consumida justo después del `verifyOtp` de WhatsApp.
 * =============================================================================
 * `POST /api/conductor/aceptar-invitacion`
 *
 * ## Por qué esta ruta NO usa `autenticarBearer`
 *
 * `autenticarBearer` decodifica los custom claims que el
 * `custom_access_token_hook` inyecta a partir de `usuarios_perfil` — y en este
 * momento preciso ESE PERFIL TODAVÍA NO EXISTE: es justo lo que este canje va
 * a crear. Usarlo aquí resolvería `tenantId: null`, `driverId: null` y
 * `estado: 'invitado'` por defecto, que no sirven de nada. Por eso se usa
 * `autenticarBearerSoloAuth`, que solo valida el token contra Supabase Auth y
 * expone `user.phone` — el número que Supabase certificó con el WhatsApp OTP.
 *
 * ## El teléfono SIEMPRE sale del token, nunca del body
 *
 * Un teléfono que llegara por el cuerpo de la petición no estaría verificado
 * por nadie: cualquiera podría pedir el canje de la invitación de otro
 * conductor. El único teléfono de fiar es el que Supabase certificó al
 * validar el OTP y dejó en el JWT.
 *
 * ## El destino de la app NO es `resolverDestinoTrasAceptar`
 *
 * Esa función (F3) decide entre "conectar ML" (seller) y "raíz" (cualquier
 * interno) — un menú que no incluye al conductor. La app del conductor solo
 * tiene una pantalla de aterrizaje: su propia raíz.
 */

interface CuerpoAceptarInvitacion {
  nombreCompleto?: unknown;
  tenantId?: unknown;
}

export async function POST(request: NextRequest) {
  const usuario = await autenticarBearerSoloAuth(request.headers.get("authorization"));
  if (!usuario) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const normalizado = normalizarTelefonoE164(usuario.telefono);
  if (!normalizado.valido) {
    // El usuario de Auth no tiene un teléfono verificado utilizable — no hay
    // con qué buscar su invitación. No es un problema del cliente: es un
    // estado de cuenta que no debería llegar hasta acá (el login por
    // WhatsApp OTP siempre deja `user.phone` puesto).
    return NextResponse.json(
      { error: "No pudimos identificar tu teléfono verificado." },
      { status: 400 },
    );
  }

  let cuerpo: CuerpoAceptarInvitacion = {};
  try {
    const texto = await request.text();
    if (texto.trim()) cuerpo = JSON.parse(texto) as CuerpoAceptarInvitacion;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const nombreCompleto = typeof cuerpo.nombreCompleto === "string" ? cuerpo.nombreCompleto.trim() : "";
  if (!nombreCompleto) {
    return NextResponse.json({ error: "Falta tu nombre completo" }, { status: 400 });
  }
  const tenantId = typeof cuerpo.tenantId === "string" && cuerpo.tenantId.trim() ? cuerpo.tenantId.trim() : undefined;

  try {
    const resultado = await aceptarInvitacionPorTelefono(crearClienteServiceRole(), {
      telefonoE164: normalizado.telefonoE164,
      usuarioAuthId: usuario.usuarioId,
      nombreCompleto,
      tenantId,
    });

    if (!resultado.ok) {
      // 200 igual que el camino feliz: ambos son desenlaces normales del
      // canje que la app tiene que interpretar por `motivo`, no errores de
      // transporte.
      if (resultado.motivo === "seleccionar_courier") {
        return NextResponse.json({ ok: false, motivo: "seleccionar_courier", couriers: resultado.couriers });
      }
      return NextResponse.json({ ok: false, motivo: "sin_invitacion" });
    }

    // Sin destino alternativo: la app del conductor solo aterriza en su raíz.
    return NextResponse.json({ ok: true, destino: "/" });
  } catch (err) {
    console.error(
      "[api/conductor/aceptar-invitacion]",
      err instanceof Error ? err.message : "error desconocido",
    );
    return NextResponse.json(
      { error: "No pudimos completar el canje de tu invitación. Intenta de nuevo en unos minutos." },
      { status: 500 },
    );
  }
}
