"use server";

/**
 * Lo que un super-admin puede cambiar de sí mismo en el backstage.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NO REUSA `accionGuardarMiPerfil`
 * -----------------------------------------------------------------------------
 * La del resto del producto escribe `identidad.usuarios_perfil`, y el super-admin
 * NO vive ahí: su identidad de plataforma está en `plataforma.super_admins`, que
 * es una tabla de gobernanza aparte y a propósito —desactivar a alguien ahí le
 * corta el acceso a TODOS los couriers de inmediato—. Tampoco tiene teléfono:
 * esa columna no existe y no se inventa una para que la pantalla calce.
 *
 * -----------------------------------------------------------------------------
 * 🔴 SOPORTE (SOLO LECTURA) TAMBIÉN PUEDE CORREGIRSE EL NOMBRE
 * -----------------------------------------------------------------------------
 * No pasa por `exigirSuperAdminEscritura`, que exige `admin_total`. Es
 * deliberado: ese gate protege las escrituras que tocan a un COURIER —cobrar,
 * cambiar un plan, suspender una cuenta—, y «solo lectura» describe su poder
 * sobre el negocio ajeno, no sobre su propio nombre mal escrito.
 *
 * Lo que sí se exige, sin excepción, es **AAL2**: el backstage entero corre con
 * el segundo factor verificado, y una Server Action no está cubierta por el
 * gate del layout. Sin esta línea, el único camino sin MFA del backstage sería
 * justo el que escribe en la tabla de gobernanza.
 *
 * -----------------------------------------------------------------------------
 * 🔴 Y SÍ LLEVA BITÁCORA — a diferencia de `/perfil`
 * -----------------------------------------------------------------------------
 * En el producto, corregirse el nombre no se audita: no mueve plata ni cambia
 * permisos (ver `identidad/mi-perfil.acciones.ts`). Acá sí, y por una razón que
 * solo aplica al backstage: **la bitácora resuelve el nombre del actor leyendo
 * esta misma columna** (`plataforma/bitacora-consulta.ts`). Cambiarla re-rotula
 * cómo se leen las acciones pasadas de esa persona sobre couriers ajenos.
 *
 * No reescribe la historia —`actor_usuario_id` es inmutable y es lo que la fila
 * guarda—, pero cambia cómo se lee, así que el cambio deja su propia entrada con
 * el nombre anterior y el nuevo. Sin eso, el rastro se puede re-etiquetar sin
 * que quede constancia de que se re-etiquetó.
 */

import { revalidatePath } from "next/cache";

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { exigirSuperAdmin } from "@/modules/plataforma/autorizacion-admin";

export type RespuestaPerfilAdmin = { ok: true } | { ok: false; mensaje: string };

const LARGO_MAXIMO_NOMBRE = 120;

export async function accionGuardarMiNombreAdmin(
  nombreCompleto: string,
): Promise<RespuestaPerfilAdmin> {
  let actor;
  try {
    actor = await exigirSuperAdmin();
  } catch {
    return { ok: false, mensaje: "Tu sesión de administrador no está activa." };
  }

  if (actor.aal !== "aal2") {
    return {
      ok: false,
      mensaje: "Verifica tu segundo factor antes de cambiar tus datos.",
    };
  }

  const nombre = nombreCompleto.trim().replace(/\s+/g, " ");
  if (nombre.length < 2) return { ok: false, mensaje: "Escribe tu nombre." };
  if (nombre.length > LARGO_MAXIMO_NOMBRE) {
    return { ok: false, mensaje: `El nombre no puede pasar de ${LARGO_MAXIMO_NOMBRE} caracteres.` };
  }
  if (nombre === actor.nombre) return { ok: true };

  const cliente = crearClienteServiceRole();

  // Bitácora ANTES del efecto, con el nombre anterior: si falla el UPDATE, sobra
  // una entrada; si fallara al revés, faltaría la única constancia de que el
  // rastro se re-etiquetó.
  await registrarEnBitacora(cliente, {
    // `null` porque no es de ningún courier: es una acción de plataforma.
    tenantId: null,
    actorUsuarioId: actor.usuarioId,
    actorTipo: "super_admin",
    accion: "super_admin.nombre_cambiado",
    entidadTipo: "plataforma.super_admins",
    entidadId: actor.usuarioId,
    detalle: { nombre_anterior: actor.nombre, nombre_nuevo: nombre },
  });

  const { error } = await cliente
    .schema("plataforma")
    .from("super_admins")
    .update({ nombre })
    // ⚠️ SIEMPRE sobre sí mismo. La función no recibe a quién modificar: el
    // sujeto sale de la sesión. Es lo que impide que «Mi perfil» sea una puerta
    // lateral para renombrar a otro super-admin.
    .eq("usuario_id", actor.usuarioId);

  if (error) {
    return { ok: false, mensaje: "No pudimos guardar tu nombre. Vuelve a intentarlo." };
  }

  // El nombre viaja en el bloque de cuenta del sidebar, que vive en el layout.
  revalidatePath("/admin", "layout");
  return { ok: true };
}
