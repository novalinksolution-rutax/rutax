"use server";

/**
 * Server Actions — los cuatro datos del courier que el alta nunca pidió.
 * =============================================================================
 *
 * Cada uno cierra una columna que el sistema YA usaba y ninguna pantalla
 * escribía:
 *
 *   · `datosEmisor`  — giro, dirección, comuna y actividad económica. Son parte
 *     obligatoria del bloque `Emisor` de un DTE 33 y no existían en `tenants`.
 *   · `datosCobro`   — a qué cuenta le transfiere el seller. No existía.
 *   · `retencion`    — `courier_config_payout.porcentaje_retencion`, que
 *     `calculo-payout.ts` lee para descontarle al conductor independiente. La
 *     tabla NO tenía un solo escritor en todo el repo: todos retenían 0%.
 *   · `contacto`     — el teléfono y el correo que ve quien espera un paquete
 *     en `/tracking/[token]`, que hoy solo muestra el nombre de fantasía.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ UN MÓDULO `"use server"` SOLO EXPORTA FUNCIONES ASYNC
 * -----------------------------------------------------------------------------
 * Nada de constantes acá dentro: una constante exportada desde un módulo con
 * esta directiva tumba el build de producción, y ni el typecheck ni las pruebas
 * lo ven. Los catálogos de texto viven en `datos-courier-catalogo.ts`.
 *
 * -----------------------------------------------------------------------------
 * RBAC, uno por acción y por su propia razón
 * -----------------------------------------------------------------------------
 * · Emisor y contacto → `gestionar_perfil_empresa`. Son columnas de
 *   `identidad.tenants`: el registro de la empresa. Capacidad nueva, porque
 *   ninguna existente significaba eso (ver su nota en `capacidades.ts`).
 * · Cuenta de cobro   → `gestionar_cobranza`. Es cómo le pagan al courier.
 * · Retención         → `gestionar_liquidaciones_conductores`. Es lo que se le
 *   descuenta al conductor, y sale de su liquidación.
 *
 * -----------------------------------------------------------------------------
 * BITÁCORA DESPUÉS DE LA ESCRITURA, ANTES DEL `revalidatePath`
 * -----------------------------------------------------------------------------
 * El invariante del proyecto es bitácora ANTES de un evento Inngest o de una
 * integración externa; acá no hay ninguno de los dos. Y registrarla antes
 * dejaría un asiento fantasma si el UPDATE fallara. Mismo orden que
 * `configuracion/retiro/actions.ts` y `configuracion/tarifas/actions.ts`.
 */

import { revalidatePath } from "next/cache";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import {
  puedeGestionarCobranza,
  puedeGestionarLiquidacionesConductores,
  puedeGestionarPerfilEmpresa,
} from "@/modules/identidad/capacidades";
import { normalizarYValidarRut } from "@/modules/identidad/rut";

type Resultado = { ok: true; acuse: string } | { ok: false; mensaje: string };

const RUTA_ASISTENTE = "/onboarding";

// =============================================================================
// 1. Datos del emisor (bloque Emisor del SII)
// =============================================================================

export async function accionGuardarDatosEmisor(formData: FormData): Promise<Resultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  if (!puedeGestionarPerfilEmpresa(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para editar los datos de la empresa." };
  }

  const giro = texto(formData.get("giro"));
  const direccion = texto(formData.get("direccion"));
  const comuna = texto(formData.get("comuna"));
  const actividad = texto(formData.get("actividad_economica"));

  if (!giro) return { ok: false, mensaje: "El giro es obligatorio: va impreso en cada factura." };
  if (giro.length > 80) {
    // El SII trunca GiroEmis a 80. Mejor rechazarlo acá que emitir un documento
    // con el giro cortado a la mitad.
    return { ok: false, mensaje: "El giro no puede pasar de 80 caracteres — es el máximo del SII." };
  }
  if (!direccion) return { ok: false, mensaje: "La dirección de tu casa matriz es obligatoria." };
  if (!comuna) return { ok: false, mensaje: "La comuna de tu casa matriz es obligatoria." };
  if (!actividad || !/^[0-9]{6}$/.test(actividad)) {
    return {
      ok: false,
      mensaje:
        "La actividad económica son los 6 dígitos del código del SII (por ejemplo 492300). " +
        "Lo encuentras en tu inicio de actividades.",
    };
  }

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  try {
    const { error } = await supabase
      .schema("identidad")
      .from("tenants")
      .update({ giro, direccion, comuna, actividad_economica: actividad })
      .eq("id", tenantId);
    if (error) throw new Error(error.message);

    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.datos_emisor_actualizados",
      entidadTipo: "tenant",
      entidadId: tenantId,
      detalle: { giro, direccion, comuna, actividad_economica: actividad },
    });

    revalidatePath(RUTA_ASISTENTE);
    return {
      ok: true,
      acuse: "Listo: tus facturas ya salen con el giro, la dirección y la actividad de tu empresa.",
    };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "los datos de tu empresa") };
  }
}

// =============================================================================
// 2. Dónde te pagan
// =============================================================================

export async function accionGuardarDatosCobro(formData: FormData): Promise<Resultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  if (!puedeGestionarCobranza(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para configurar dónde te pagan." };
  }

  const banco = texto(formData.get("banco"));
  const tipoCuenta = texto(formData.get("tipo_cuenta"));
  const numeroCuenta = texto(formData.get("numero_cuenta"));
  const nombreTitular = texto(formData.get("nombre_titular"));
  const rutTitularCrudo = texto(formData.get("rut_titular"));
  const emailAviso = texto(formData.get("email_aviso"));

  if (!banco) return { ok: false, mensaje: "Elige el banco." };
  if (!["corriente", "vista", "ahorro"].includes(tipoCuenta)) {
    return { ok: false, mensaje: "Elige el tipo de cuenta." };
  }
  if (!numeroCuenta) return { ok: false, mensaje: "El número de cuenta es obligatorio." };
  if (!nombreTitular) return { ok: false, mensaje: "El nombre del titular es obligatorio." };

  const rutTitular = normalizarYValidarRut(rutTitularCrudo);
  if (!rutTitular) {
    return {
      ok: false,
      mensaje: "El RUT del titular no es válido. Revisa el dígito verificador.",
    };
  }
  if (emailAviso && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAviso)) {
    return { ok: false, mensaje: "El correo de aviso no parece válido." };
  }

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  try {
    const { error } = await supabase
      .schema("identidad")
      .from("courier_datos_cobro")
      .upsert(
        {
          tenant_id: tenantId,
          banco,
          tipo_cuenta: tipoCuenta,
          numero_cuenta: numeroCuenta,
          rut_titular: rutTitular,
          nombre_titular: nombreTitular,
          email_aviso: emailAviso || null,
        },
        { onConflict: "tenant_id" },
      );
    if (error) throw new Error(error.message);

    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.datos_cobro_actualizados",
      entidadTipo: "courier_datos_cobro",
      entidadId: tenantId,
      // ⚠️ El número de cuenta NO va a la bitácora. No es un secreto —se imprime
      // en la factura— pero la bitácora se exporta y se consulta a granel, y no
      // hay ninguna pregunta de auditoría que necesite el número: basta con
      // saber que cambió y a qué banco.
      detalle: { banco, tipo_cuenta: tipoCuenta, rut_titular: rutTitular },
    });

    revalidatePath(RUTA_ASISTENTE);
    return { ok: true, acuse: `Listo: tus sellers ya saben que te transfieren a ${banco}.` };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "tus datos de cobro") };
  }
}

// =============================================================================
// 3. Retención de boleta de terceros
// =============================================================================

export async function accionGuardarRetencion(formData: FormData): Promise<Resultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  if (!puedeGestionarLiquidacionesConductores(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para configurar la retención." };
  }

  const crudo = texto(formData.get("porcentaje_retencion"));
  if (crudo === "") {
    return {
      ok: false,
      mensaje:
        "Escribe el porcentaje que te corresponde retener. Si tus conductores son todos " +
        "dependientes, pon 0 — pero ponlo tú, para que quede como decisión y no como olvido.",
    };
  }

  // Se acepta coma decimal: es como se escribe un porcentaje en Chile.
  const porcentaje = Number(crudo.replace(",", "."));
  if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) {
    return { ok: false, mensaje: "El porcentaje tiene que estar entre 0 y 100." };
  }

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  try {
    // ⚠️ El payload lleva SOLO `tenant_id` y `porcentaje_retencion`. En un upsert
    // de PostgREST toda columna del payload se escribe también en el UPDATE, así
    // que mandar `payout_real_habilitado` o `metodo_default` acá los pisaría con
    // su default y apagaría el opt-in de pagos reales de un courier que ya lo
    // tenía encendido.
    const { error } = await supabase
      .schema("identidad")
      .from("courier_config_payout")
      .upsert(
        { tenant_id: tenantId, porcentaje_retencion: porcentaje },
        { onConflict: "tenant_id" },
      );
    if (error) throw new Error(error.message);

    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.retencion_conductores_actualizada",
      entidadTipo: "courier_config_payout",
      entidadId: tenantId,
      detalle: { porcentaje_retencion: porcentaje },
    });

    revalidatePath(RUTA_ASISTENTE);
    revalidatePath("/dinero/liquidaciones");
    return {
      ok: true,
      acuse:
        porcentaje === 0
          ? "Guardado: no se le retiene nada a tus conductores independientes."
          : `Guardado: a cada conductor independiente se le retiene ${crudo.replace(".", ",")}% de su liquidación.`,
    };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "la retención") };
  }
}

// =============================================================================
// 4. Contacto público
// =============================================================================

export async function accionGuardarContacto(formData: FormData): Promise<Resultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  if (!puedeGestionarPerfilEmpresa(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para editar los datos de la empresa." };
  }

  const telefonoCrudo = texto(formData.get("telefono_contacto"));
  const email = texto(formData.get("email_contacto"));

  const telefono = telefonoCrudo ? normalizarTelefonoCl(telefonoCrudo) : null;
  if (telefonoCrudo && !telefono) {
    return {
      ok: false,
      mensaje: "El teléfono no parece válido. Escríbelo como +56 9 1234 5678 o como 912345678.",
    };
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, mensaje: "El correo no parece válido." };
  }
  if (!telefono && !email) {
    return {
      ok: false,
      mensaje: "Deja al menos uno de los dos: es lo que verá quien esté esperando un paquete.",
    };
  }

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  try {
    const { error } = await supabase
      .schema("identidad")
      .from("tenants")
      .update({ telefono_contacto: telefono, email_contacto: email || null })
      .eq("id", tenantId);
    if (error) throw new Error(error.message);

    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.contacto_publico_actualizado",
      entidadTipo: "tenant",
      entidadId: tenantId,
      detalle: { telefono_contacto: telefono, email_contacto: email || null },
    });

    revalidatePath(RUTA_ASISTENTE);
    return {
      ok: true,
      acuse: "Listo: quien esté esperando un paquete ya tiene a quién escribirte.",
    };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "tu contacto público") };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * Teléfono chileno a E.164, que es el formato que impone el CHECK de la columna
 * (el mismo del teléfono del conductor: una sola forma de guardar un número en
 * todo el proyecto).
 *
 * Acepta lo que la gente escribe de verdad —«+56 9 1234 5678», «912345678»,
 * «22 345 6789»— y devuelve `null` si no puede resolverlo, en vez de guardar
 * algo que el CHECK rechazaría con un error de Postgres en la cara.
 */
function normalizarTelefonoCl(crudo: string): string | null {
  const soloDigitos = crudo.replace(/[^\d+]/g, "");

  if (soloDigitos.startsWith("+")) {
    return /^\+[1-9]\d{7,14}$/.test(soloDigitos) ? soloDigitos : null;
  }
  // Sin prefijo: se asume Chile. 9 dígitos es un móvil o un fijo con su código
  // de área; 56 delante es el país escrito sin el «+».
  if (/^56\d{9}$/.test(soloDigitos)) return `+${soloDigitos}`;
  if (/^\d{9}$/.test(soloDigitos)) return `+56${soloDigitos}`;
  return null;
}

function mensajeDeError(err: unknown, que: string): string {
  return err instanceof Error && err.message
    ? err.message
    : `No se pudo guardar ${que}. Intenta de nuevo en unos minutos.`;
}
