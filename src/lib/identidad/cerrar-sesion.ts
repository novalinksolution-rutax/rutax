"use server";

/**
 * Cerrar sesión, DE VERDAD.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL BOTÓN NO HACÍA NADA, Y BLOQUEABA MÁS DE LO QUE PARECÍA
 * -----------------------------------------------------------------------------
 * Reportado por el usuario (25-08-2026): se pulsa «Cerrar sesión» y no pasa
 * nada. No es solo una molestia — **sin cerrar sesión no se puede entrar como
 * seller**, porque `/portal/login` rebota a `/dashboard` mientras haya sesión de
 * courier. Para probar el portal había que borrar la cookie a mano desde la
 * consola.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ FALLABA: SE CERRABA DESDE EL NAVEGADOR Y NADIE MIRABA EL RESULTADO
 * -----------------------------------------------------------------------------
 * El menú llamaba a `createClient().auth.signOut()` del cliente del navegador y
 * **descartaba su respuesta**. Si esa llamada falla —red, sesión ya vencida, el
 * servidor de auth caído— no queda rastro: ni error en pantalla ni en consola.
 * El usuario ve exactamente lo mismo que si no hubiera pulsado.
 *
 * Acá se cierra **en el servidor**, con el cliente atado a las cookies de la
 * petición, que es quien de verdad puede borrarlas. Y si falla, se dice.
 *
 * ⚠️ **`redirect` NO va dentro del `try`.** `redirect()` de Next funciona
 * lanzando una excepción, así que un `catch` alrededor se la come y la
 * navegación no ocurre — el mismo error que ya mordió en este repo con
 * `trazabilidad_pedido_dinero`. Va después, fuera.
 */

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Cierra la sesión y manda al login que corresponda.
 *
 * `destino` lo pone cada superficie: el portal del seller vuelve a
 * `/portal/login` y el courier a `/login`. Mandar a todos al mismo sitio haría
 * que un seller terminara en la puerta del courier.
 */
export async function cerrarSesion(destino: string = "/login"): Promise<void> {
  let fallo: string | null = null;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error) fallo = error.message;
  } catch (err) {
    fallo = err instanceof Error ? err.message : "error desconocido";
  }

  if (fallo) {
    // No se traga el fallo en silencio, que es justo lo que rompía el botón.
    // Se registra y **se sigue igual** hasta el login: la sesión del navegador
    // puede haber quedado a medias, y dejar a la persona en una pantalla que
    // cree suya es peor que mandarla a la puerta.
    console.error("[sesion] no se pudo cerrar sesión en el servidor:", fallo);
  }

  redirect(destino);
}
