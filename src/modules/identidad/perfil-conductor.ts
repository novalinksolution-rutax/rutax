/**
 * «Mi perfil» del conductor — lo que ve y lo que puede corregir de sí mismo.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NO ES `mi-perfil.acciones.ts`
 * -----------------------------------------------------------------------------
 * Aquélla es una Server Action del navegador y escribe `usuarios_perfil`. El
 * conductor no tiene navegador: su superficie se retiró el 24-08-2026 y trabaja
 * en la app nativa, que habla por HTTP con Bearer. Así que esto es un módulo de
 * dominio puro y la ruta (`api/conductor/perfil`) es su única puerta.
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL CONDUCTOR TIENE **DOS** NOMBRES, Y ESTABAN DIVERGIENDO
 * -----------------------------------------------------------------------------
 * Encontrado el 26-08-2026 mirando los datos de demo: para una misma persona,
 * `usuarios_perfil.nombre_completo` decía «Carlos Vera» y
 * `conductores.nombre_completo` decía «Juan Pablo Pérez Rojas».
 *
 * No es un dato duplicado por descuido, son dos registros distintos que existen
 * por razones distintas —uno es la cuenta con la que entra, otro es la persona
 * que el courier despacha— y hasta hoy los escribían dos formularios que no se
 * hablaban: el alta del conductor (`(tenant)/conductores`) y el canje de la
 * invitación. Cada pantalla muestra el que tiene más a mano, así que la misma
 * persona aparece con dos nombres según dónde se la mire.
 *
 * **Guardar el nombre acá escribe los DOS.** Es lo único que hace converger la
 * divergencia sin una migración, y es lo que cualquiera espera al corregirse el
 * nombre: no hay dos nombres desde el punto de vista de quien lo escribe.
 *
 * ⚠️ El que manda para leer es `conductores.nombre_completo`: es el que ven el
 * manifiesto, la Torre y la liquidación. Si algún día hay que elegir uno solo,
 * ése es el que sobrevive.
 *
 * -----------------------------------------------------------------------------
 * QUÉ SE MIRA Y NO SE TOCA
 * -----------------------------------------------------------------------------
 * · **El RUT y la relación** (dependiente/honorarios): son del contrato, no del
 *   perfil. Cambiarlos desde el teléfono sería cambiar en qué régimen se le
 *   paga a alguien.
 * · **La cuenta de pago**, y va enmascarada. Que la vea responde la pregunta que
 *   sí se hace —«¿a qué cuenta me van a pagar?»— sin dejar el número completo a
 *   la vista en una pantalla que se mira en la calle. Cambiarla es una acción
 *   financiera: pasa por el coordinador, con su bitácora.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizarTelefonoE164, type MotivoTelefonoInvalido } from "@/lib/telefono-cl";

export interface CuentaDePagoConductor {
  banco: string;
  tipoCuenta: string;
  /** Solo los últimos cuatro dígitos, ya enmascarado. Nunca el número entero. */
  numeroEnmascarado: string;
}

export interface MiPerfilConductor {
  nombre: string;
  /**
   * Solo dígitos con código de país (`56912345678`), **sin el «+»** — es lo que
   * exige el CHECK de la columna (`^[1-9][0-9]{7,14}$`). La app lo formatea para
   * mostrarlo; el dominio no presenta.
   */
  telefono: string | null;
  rut: string;
  tipoRelacion: string;
  estado: string;
  desdeCuando: string | null;
  cuentaDePago: CuentaDePagoConductor | null;
}

/**
 * Deja a la vista lo justo para reconocer la cuenta propia: los últimos cuatro.
 *
 * Una cuenta muy corta se enmascara ENTERA en vez de mostrar casi todo: con
 * cinco dígitos, «revelar los últimos cuatro» es revelar la cuenta.
 */
export function enmascararNumeroCuenta(numero: string): string {
  const limpio = numero.replace(/\D/g, "");
  if (limpio.length <= 4) return "•".repeat(limpio.length || 4);
  return `••••${limpio.slice(-4)}`;
}

const LARGO_MAXIMO_NOMBRE = 120;

export const MENSAJE_TELEFONO_CONDUCTOR: Record<MotivoTelefonoInvalido, string> = {
  vacio: "Escribe un teléfono, o deja el campo en blanco para quitarlo.",
  sin_digitos: "Eso no tiene ningún número.",
  demasiado_corto: "Faltan dígitos. Un móvil chileno son 9: 9 1234 5678.",
  demasiado_largo: "Sobran dígitos. Revisa si quedó repetido el código de país.",
  formato: "Revisa el número: no parece un teléfono válido.",
};

export async function leerMiPerfilConductor(
  cliente: Pick<SupabaseClient, "schema">,
  entrada: { tenantId: string; conductorId: string },
): Promise<MiPerfilConductor | null> {
  const { data, error } = await cliente
    .schema("identidad")
    .from("conductores")
    .select(
      "nombre_completo, telefono, rut, tipo_relacion, estado, creado_en, banco, tipo_cuenta, numero_cuenta",
    )
    .eq("id", entrada.conductorId)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  if (error) throw new Error(`No se pudo leer el perfil del conductor: ${error.message}`);
  if (!data) return null;

  const banco = data.banco as string | null;
  const tipoCuenta = data.tipo_cuenta as string | null;
  const numeroCuenta = data.numero_cuenta as string | null;

  return {
    nombre: (data.nombre_completo as string) ?? "",
    telefono: (data.telefono as string | null) ?? null,
    rut: (data.rut as string) ?? "",
    tipoRelacion: (data.tipo_relacion as string) ?? "",
    estado: (data.estado as string) ?? "",
    desdeCuando: (data.creado_en as string | null) ?? null,
    // Los tres o ninguno: media cuenta bancaria no le sirve a nadie y sugeriría
    // que está configurada cuando el payout va a fallar por incompleta.
    cuentaDePago:
      banco && tipoCuenta && numeroCuenta
        ? { banco, tipoCuenta, numeroEnmascarado: enmascararNumeroCuenta(numeroCuenta) }
        : null,
  };
}

export type ResultadoGuardarPerfilConductor =
  | { ok: true }
  | { ok: false; mensaje: string };

/**
 * Guarda nombre y teléfono del propio conductor.
 *
 * ⚠️ **No recibe a quién modificar.** El conductor sale del token verificado en
 * la ruta y llega acá ya resuelto. Un `conductorId` en el cuerpo dejaría a un
 * conductor renombrar a otro — y el nombre es lo que aparece en el manifiesto y
 * en la liquidación de esa otra persona.
 */
export async function guardarMiPerfilConductor(
  cliente: Pick<SupabaseClient, "schema">,
  entrada: {
    tenantId: string;
    conductorId: string;
    usuarioId: string;
    nombre: string;
    telefono: string;
  },
): Promise<ResultadoGuardarPerfilConductor> {
  const nombre = entrada.nombre.trim().replace(/\s+/g, " ");
  if (nombre.length < 2) return { ok: false, mensaje: "Escribe tu nombre." };
  if (nombre.length > LARGO_MAXIMO_NOMBRE) {
    return { ok: false, mensaje: `El nombre no puede pasar de ${LARGO_MAXIMO_NOMBRE} caracteres.` };
  }

  // Vacío es válido: el teléfono es opcional y borrarlo es legítimo.
  let telefonoE164: string | null = null;
  if (entrada.telefono.trim().length > 0) {
    const r = normalizarTelefonoE164(entrada.telefono);
    if (!r.valido) return { ok: false, mensaje: MENSAJE_TELEFONO_CONDUCTOR[r.motivo] };
    telefonoE164 = r.telefonoE164;
  }

  const { error } = await cliente
    .schema("identidad")
    .from("conductores")
    .update({ nombre_completo: nombre, telefono: telefonoE164 })
    // ⚠️ Las dos condiciones. `id` ya identifica la fila; `tenant_id` es la
    // barrera que sobrevive a un id equivocado — acá se corre con
    // `service_role`, así que RLS no está de respaldo.
    .eq("id", entrada.conductorId)
    .eq("tenant_id", entrada.tenantId);

  if (error) {
    return { ok: false, mensaje: "No pudimos guardar tus datos. Intenta de nuevo." };
  }

  // El segundo nombre. Ver el bloque de arriba: se escribe para que la misma
  // persona deje de aparecer con dos nombres según qué pantalla la mire.
  //
  // Si esto falla NO se devuelve error: lo que el courier ve —el manifiesto, la
  // liquidación, la Torre— ya quedó corregido, que es lo que el conductor pidió.
  // Fallar acá lo mandaría a reintentar algo que en la práctica ya funcionó.
  const { error: errorPerfil } = await cliente
    .schema("identidad")
    .from("usuarios_perfil")
    .update({ nombre_completo: nombre })
    .eq("id", entrada.usuarioId)
    .eq("tenant_id", entrada.tenantId);

  if (errorPerfil) {
    console.error("[perfil-conductor] no se pudo espejar el nombre en usuarios_perfil");
  }

  return { ok: true };
}
