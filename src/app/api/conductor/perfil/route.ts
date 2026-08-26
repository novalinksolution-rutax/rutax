import { type NextRequest, NextResponse } from "next/server";

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  guardarMiPerfilConductor,
  leerMiPerfilConductor,
} from "@/modules/identidad/perfil-conductor";

/**
 * «Mi perfil» del conductor — superficie para la app nativa.
 * =============================================================================
 * `GET | PUT /api/conductor/perfil`
 *
 * El usuario pidió (26-08-2026) que «Mi perfil» valga para todos los roles. Las
 * otras tres son pantallas web; ésta es una ruta, porque la superficie web del
 * conductor se retiró el 24-08-2026 y su app es nativa.
 *
 * ## El conductor sale del JWT, nunca del cuerpo
 *
 * `usuario.driverId`, `usuario.usuarioId` y `usuario.tenantId` vienen del token
 * verificado. **No hay forma de nombrar a otro conductor acá**, y no debe
 * agregarse: el nombre que se escribe es el que aparece en el manifiesto y en la
 * liquidación de esa persona.
 *
 * ## Lo que NO se puede cambiar por acá
 *
 * RUT, tipo de relación y cuenta bancaria. Los tres se muestran —el conductor
 * tiene derecho a ver con qué datos lo tienen registrado, y la cuenta va
 * enmascarada— pero cambiarlos es del contrato o del dinero, y eso pasa por el
 * coordinador con su bitácora. La regla del módulo: acá se corrige lo propio,
 * no se negocia lo pactado.
 */

function noAutorizado() {
  return NextResponse.json({ error: "No autorizado" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (!usuario || usuario.tipoUsuario !== "conductor" || !usuario.driverId || !usuario.tenantId) {
    return noAutorizado();
  }
  if (usuario.estado !== "activo") {
    return NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 });
  }

  try {
    const cliente = crearClienteServiceRole();
    const perfil = await leerMiPerfilConductor(cliente, {
      tenantId: usuario.tenantId,
      conductorId: usuario.driverId,
    });
    if (!perfil) {
      return NextResponse.json({ error: "Conductor no encontrado" }, { status: 404 });
    }

    // El correo NO está en `conductores` ni en el token resuelto: vive en
    // `auth.users`, y leerlo exige `service_role`. Se agrega acá y no en el
    // módulo de dominio porque el dominio no debería depender del cliente de
    // Auth para responder «cómo se llama este conductor».
    //
    // Si falla, el perfil sale igual SIN correo: no ver con qué correo entras es
    // una molestia, no ver tu perfil es quedarte sin pantalla.
    let email: string | null = null;
    try {
      const { data } = await cliente.auth.admin.getUserById(usuario.usuarioId);
      email = data?.user?.email ?? null;
    } catch {
      email = null;
    }

    return NextResponse.json({ ...perfil, email });
  } catch (err) {
    console.error(
      "[api/conductor/perfil GET]",
      err instanceof Error ? err.message : "error desconocido",
    );
    return NextResponse.json({ error: "Error al leer tu perfil" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (!usuario || usuario.tipoUsuario !== "conductor" || !usuario.driverId || !usuario.tenantId) {
    return noAutorizado();
  }
  if (usuario.estado !== "activo") {
    return NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const datos = cuerpo as { nombre?: unknown; telefono?: unknown };
  if (typeof datos?.nombre !== "string") {
    return NextResponse.json({ error: "Falta tu nombre" }, { status: 400 });
  }
  // El teléfono ausente y el teléfono vacío significan lo mismo: sin número. La
  // app manda `""` para borrarlo, y eso es una acción legítima.
  const telefono = typeof datos.telefono === "string" ? datos.telefono : "";

  try {
    const r = await guardarMiPerfilConductor(crearClienteServiceRole(), {
      tenantId: usuario.tenantId,
      conductorId: usuario.driverId,
      usuarioId: usuario.usuarioId,
      nombre: datos.nombre,
      telefono,
    });
    if (!r.ok) {
      // 422 y no 400: el cuerpo tenía la forma correcta, el contenido no pasó la
      // validación. El mensaje es para mostrárselo tal cual al conductor.
      return NextResponse.json({ error: r.mensaje }, { status: 422 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "[api/conductor/perfil PUT]",
      err instanceof Error ? err.message : "error desconocido",
    );
    return NextResponse.json({ error: "Error al guardar tu perfil" }, { status: 500 });
  }
}
