import { type NextRequest, NextResponse } from "next/server";

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarDispositivo, olvidarDispositivo } from "@/modules/integraciones/push/notificar";

/**
 * El teléfono del conductor, para poder avisarle.
 * =============================================================================
 * `PUT | DELETE /api/conductor/dispositivo`
 *
 * `PUT` registra o refresca el token de esta instalación; `DELETE` lo olvida
 * —el conductor apagó las notificaciones o cerró sesión.
 *
 * ## El token no se loguea, nunca
 *
 * Con el token de alguien se le puede mandar una notificación falsa. No abre su
 * cuenta ni lee sus datos, así que no va cifrado como los de OAuth, pero **no
 * aparece en un `console.error` ni en una URL**: los mensajes de error de esta
 * ruta hablan de lo que pasó, no de con qué.
 *
 * ## El conductor sale del JWT
 *
 * Igual que el resto de las rutas Bearer. Un `conductorId` en el cuerpo dejaría
 * que alguien registre su teléfono a nombre de otro y reciba sus paradas.
 */
export async function PUT(request: NextRequest) {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (!usuario || usuario.tipoUsuario !== "conductor" || !usuario.driverId || !usuario.tenantId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (usuario.estado !== "activo") {
    return NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 });
  }

  let cuerpo: { token?: unknown; plataforma?: unknown };
  try {
    cuerpo = (await request.json()) as typeof cuerpo;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const token = typeof cuerpo.token === "string" ? cuerpo.token.trim() : "";
  const plataforma = cuerpo.plataforma;

  // El formato se valida acá y en el CHECK de la tabla. Acá para devolver un
  // 400 legible; allá porque una ruta futura podría olvidarse de validar.
  if (!/^Expo(nent)?PushToken\[[^\]]+\]$/.test(token)) {
    return NextResponse.json({ error: "Token de notificación inválido" }, { status: 400 });
  }
  if (plataforma !== "ios" && plataforma !== "android") {
    return NextResponse.json({ error: "Plataforma inválida" }, { status: 400 });
  }

  try {
    const cliente = crearClienteServiceRole();
    await registrarDispositivo(cliente, {
      tenantId: usuario.tenantId,
      conductorId: usuario.driverId,
      token,
      plataforma,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Sin el token en el mensaje: es lo que se manda a los logs.
    console.error(
      "[api/conductor/dispositivo PUT]",
      err instanceof Error ? err.message : "error desconocido",
    );
    return NextResponse.json({ error: "No se pudo registrar el dispositivo" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (!usuario || usuario.tipoUsuario !== "conductor" || !usuario.tenantId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let cuerpo: { token?: unknown };
  try {
    cuerpo = (await request.json()) as typeof cuerpo;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const token = typeof cuerpo.token === "string" ? cuerpo.token.trim() : "";
  if (!token) return NextResponse.json({ error: "Falta el token" }, { status: 400 });

  try {
    const cliente = crearClienteServiceRole();
    await olvidarDispositivo(cliente, { tenantId: usuario.tenantId, token });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "[api/conductor/dispositivo DELETE]",
      err instanceof Error ? err.message : "error desconocido",
    );
    return NextResponse.json({ error: "No se pudo olvidar el dispositivo" }, { status: 500 });
  }
}
