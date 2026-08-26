"use server";

/**
 * Lo que CUALQUIER persona puede cambiar de sí misma.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * UNA SOLA, PARA TODAS LAS SUPERFICIES
 * -----------------------------------------------------------------------------
 * La usan «Mi perfil» del equipo del courier (`(tenant)/perfil`) y la del seller
 * (`portal/perfil`), y sirve igual al conductor. No es casualidad: los tres
 * viven en la MISMA tabla, `identidad.usuarios_perfil`, y la acción no pregunta
 * de qué tipo es nadie — solo escribe la fila de quien tiene la sesión.
 *
 * Que sea una sola es lo que impide que dentro de seis meses el seller pueda
 * poner un nombre de 300 caracteres porque su copia se quedó sin el tope.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ SIEMPRE SOBRE SÍ MISMA — NO RECIBE UN `usuarioId`
 * -----------------------------------------------------------------------------
 * Ninguna de estas acciones acepta a quién modificar: el sujeto sale de la
 * sesión, siempre. Es lo único que impide que «Mi perfil» se convierta en una
 * puerta lateral para editar a otro — y no hay que confiar en que nadie mande el
 * id de un compañero, porque el parámetro sencillamente no existe.
 *
 * Cambiarle el nombre o el rol a OTRO es `/equipo`, con su capacidad
 * (`gestionar_usuarios_y_roles`) y su bitácora.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL CORREO NO SE CAMBIA ACÁ, Y ES UNA DECISIÓN
 * -----------------------------------------------------------------------------
 * El correo **es la identidad**: es la llave de entrada, es lo que reciben las
 * invitaciones y es lo que sostiene la regla «un correo, una cuenta»
 * (`identidad/cuenta-por-email.ts`). Cambiarlo exige re-verificación por
 * Supabase Auth y un estado intermedio en que la persona puede quedarse fuera de
 * su propia cuenta. Se muestra, no se edita (decisión del usuario, 2026-08-26).
 *
 * -----------------------------------------------------------------------------
 * NO HAY BITÁCORA ACÁ, Y TAMBIÉN ES UNA DECISIÓN
 * -----------------------------------------------------------------------------
 * La regla del proyecto exige bitácora para acciones **financieras y de acceso**.
 * Corregirse el propio nombre o el propio teléfono no es ninguna de las dos: no
 * mueve plata y no cambia lo que la persona puede hacer. El cambio de contraseña
 * sí toca el acceso, y por eso **no pasa por acá**: se delega en el flujo de
 * recuperación de Supabase, que tiene su propio rastro.
 */

import { revalidatePath } from "next/cache";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { normalizarTelefonoE164, type MotivoTelefonoInvalido } from "@/lib/telefono-cl";

export type RespuestaPerfil = { ok: true } | { ok: false; mensaje: string };

/** Tope del nombre: el mismo criterio que el alta de una persona. */
const LARGO_MAXIMO_NOMBRE = 120;

/**
 * Los mismos textos que el teléfono del conductor.
 *
 * ⚠️ El normalizador **nunca devuelve el número en el motivo** —el teléfono es
 * dato personal y el motivo termina en logs—, así que estas frases tampoco lo
 * repiten.
 */
const MENSAJE_TELEFONO: Record<MotivoTelefonoInvalido, string> = {
  vacio: "Escribe un teléfono, o deja el campo en blanco para quitarlo.",
  sin_digitos: "Eso no tiene ningún número.",
  demasiado_corto: "Faltan dígitos. Un móvil chileno son 9: 9 1234 5678.",
  demasiado_largo: "Sobran dígitos. Revisa si quedó repetido el código de país.",
  formato: "Revisa el número: no parece un teléfono válido.",
};

export async function accionGuardarMiPerfil(
  nombreCompleto: string,
  telefono: string,
): Promise<RespuestaPerfil> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario?.tenantId) return { ok: false, mensaje: "No autenticado." };

  const nombre = nombreCompleto.trim().replace(/\s+/g, " ");
  if (nombre.length < 2) {
    return { ok: false, mensaje: "Escribe tu nombre." };
  }
  if (nombre.length > LARGO_MAXIMO_NOMBRE) {
    return { ok: false, mensaje: `El nombre no puede pasar de ${LARGO_MAXIMO_NOMBRE} caracteres.` };
  }

  // Vacío es válido: el teléfono es opcional y borrarlo es una acción legítima.
  let telefonoE164: string | null = null;
  if (telefono.trim().length > 0) {
    const r = normalizarTelefonoE164(telefono);
    if (!r.valido) return { ok: false, mensaje: MENSAJE_TELEFONO[r.motivo] };
    telefonoE164 = r.telefonoE164;
  }

  const cliente = crearClienteServiceRole();
  const { error } = await cliente
    .schema("identidad")
    .from("usuarios_perfil")
    .update({ nombre_completo: nombre, telefono: telefonoE164 })
    // ⚠️ Las dos condiciones. `id` ya identifica la fila; `tenant_id` es la
    // barrera que sobrevive a que alguien se equivoque de id — y acá se corre
    // con `service_role`, así que RLS no está de respaldo.
    .eq("id", sesion.usuarioId)
    .eq("tenant_id", sesion.usuario.tenantId);

  if (error) {
    return { ok: false, mensaje: "No pudimos guardar tus datos. Vuelve a intentarlo." };
  }

  // El nombre viaja en el bloque de cuenta del sidebar, que vive en el layout:
  // sin esto, la persona guarda y sigue viendo el nombre viejo abajo a la
  // izquierda — y eso se lee como que no se guardó. Se invalida desde la raíz
  // justamente porque hay más de un layout con ese bloque.
  revalidatePath("/", "layout");
  return { ok: true };
}
