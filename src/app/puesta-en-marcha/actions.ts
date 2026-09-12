"use server";

/**
 * Server Actions del wizard de puesta en marcha (2026-09-12).
 * =============================================================================
 *
 * El wizard REUSA las acciones que ya validan y auditan cada dato
 * (`acciones-datos-courier.ts`, periodicidad, retiro). Acá viven solo las TRES
 * que no existían:
 *
 *   · `accionGuardarTarifaPlana`    — una tarifa base para todo (el usuario pidió
 *     tarifa plana, no matriz). La crea para los dos regímenes de POD que el
 *     courier pueda operar, con el mismo monto.
 *   · `accionGuardarZonaCobertura`  — las comunas donde el courier trabaja, como
 *     UNA zona "Cobertura". Envuelve la RPC `identidad.guardar_zona_con_comunas`.
 *   · `accionCompletarPuestaEnMarcha` — cierra el wizard: re-verifica lo mínimo
 *     en el servidor (no confía en el cliente) y estampa la marca en el tenant.
 *
 * RBAC: el wizard lo hace el dueño. Cada acción reusada ya tiene su propio gate;
 * las tres de acá piden la capacidad que corresponde a su dato.
 */

import { revalidatePath } from "next/cache";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import {
  puedeGestionarTarifas,
  puedeGestionarPerfilEmpresa,
} from "@/modules/identidad/capacidades";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { resolverEstadoPuestaEnMarcha } from "./estado";

type Resultado = { ok: true } | { ok: false; mensaje: string };

// El nombre de la única zona que el wizard crea: la cobertura del courier. NO se
// exporta: un módulo "use server" solo puede exportar funciones async (exportar
// una constante rompe el build de producción, y ni typecheck ni tests lo ven).
const NOMBRE_ZONA_COBERTURA = "Cobertura";

// =============================================================================
// 1. Tarifa plana
// =============================================================================

/**
 * Una tarifa base para todo. El usuario decidió "tarifa plana": un monto que le
 * cobra al seller y un monto que le paga al conductor, por entrega. Se crea para
 * los DOS regímenes (`same_day` y `flex`) con el mismo valor, así el motor
 * entrega→dinero tiene tarifa cualquiera sea la fuente del pedido; el courier
 * afina la diferencia después en Configuración → Tarifas si la necesita.
 *
 * Idempotente: si ya hay una tarifa base activa (seller y zona nulos) para un
 * régimen, no la duplica —`crearTarifa` la rechazaría por solapamiento—; solo
 * inserta la que falte. Re-entrar al paso no rompe nada.
 */
export async function accionGuardarTarifaPlana(
  cobroClp: number,
  pagoConductorClp: number,
): Promise<Resultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  if (!puedeGestionarTarifas(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para definir tarifas." };
  }

  if (!Number.isFinite(cobroClp) || cobroClp <= 0) {
    return { ok: false, mensaje: "Ingresa cuánto le cobras al seller por entrega (mayor a cero)." };
  }
  if (!Number.isFinite(pagoConductorClp) || pagoConductorClp <= 0) {
    return { ok: false, mensaje: "Ingresa cuánto le pagas al conductor por entrega (mayor a cero)." };
  }
  if (pagoConductorClp > cobroClp) {
    return {
      ok: false,
      mensaje: "Le pagarías al conductor más de lo que le cobras al seller. Revisa los dos montos.",
    };
  }

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

  try {
    // Qué tarifas base activas ya existen, para no duplicar al re-entrar.
    const { data: existentes, error: errorLectura } = await supabase
      .schema("dinero")
      .from("tarifas")
      .select("tipo_entrega")
      .eq("tenant_id", tenantId)
      .eq("estado", "activa")
      .is("seller_id", null)
      .is("zona", null)
      .is("vigente_hasta", null);
    if (errorLectura) throw new Error(errorLectura.message);

    const yaTiene = new Set((existentes ?? []).map((f) => f.tipo_entrega as string));
    const filasNuevas = (["same_day", "flex"] as const)
      .filter((tipo) => !yaTiene.has(tipo))
      .map((tipo) => ({
        tenant_id: tenantId,
        seller_id: null,
        tipo_entrega: tipo,
        zona: null,
        monto_clp: Math.round(cobroClp),
        monto_conductor_clp: Math.round(pagoConductorClp),
        vigente_desde: hoy,
        estado: "activa" as const,
      }));

    if (filasNuevas.length > 0) {
      const { error } = await supabase.schema("dinero").from("tarifas").insert(filasNuevas);
      if (error) throw new Error(error.message);

      await registrarEnBitacora(supabase, {
        tenantId,
        actorUsuarioId: sesion.usuarioId,
        actorTipo: "usuario",
        accion: "tarifa.creada",
        entidadTipo: "tarifa",
        entidadId: null,
        detalle: {
          origen: "puesta_en_marcha",
          monto_clp: Math.round(cobroClp),
          monto_conductor_clp: Math.round(pagoConductorClp),
          tipos: filasNuevas.map((f) => f.tipo_entrega),
        },
      });
    }

    revalidatePath("/puesta-en-marcha");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No se pudo guardar tu tarifa. Intenta de nuevo.",
    };
  }
}

// =============================================================================
// 2. Zona de cobertura (las comunas donde trabaja)
// =============================================================================

/**
 * Las comunas donde el courier reparte, como una sola zona "Cobertura". No hay
 * sub-sectores (decisión del usuario): al courier le importa "trabajo con estas
 * comunas", nada más. Envuelve la RPC transaccional que ya existe.
 */
export async function accionGuardarZonaCobertura(comunas: string[]): Promise<Resultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  if (!puedeGestionarTarifas(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para definir tus zonas de cobertura." };
  }

  // Solo comunas del catálogo de la RM, sin repetidas. Un valor fuera de catálogo
  // sería un dato inventado desde el cliente.
  const catalogo = new Set<string>(COMUNAS_RM);
  const limpias = [...new Set(comunas)].filter((c) => catalogo.has(c));
  if (limpias.length === 0) {
    return { ok: false, mensaje: "Elige al menos una comuna donde trabajas." };
  }

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  try {
    // ¿Ya existe la zona "Cobertura"? La RPC actualiza si le paso su id, o crea si
    // le paso null. Re-entrar al paso reemplaza las comunas, no duplica la zona.
    const { data: zonaExistente } = await supabase
      .schema("identidad")
      .from("zonas")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("nombre", NOMBRE_ZONA_COBERTURA)
      .maybeSingle();

    const { error } = await supabase.schema("identidad").rpc("guardar_zona_con_comunas", {
      p_tenant_id: tenantId,
      p_zona_id: zonaExistente?.id ?? null,
      p_nombre: NOMBRE_ZONA_COBERTURA,
      p_comunas: limpias,
    });
    if (error) throw new Error(error.message);

    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.zona_cobertura_actualizada",
      entidadTipo: "zona",
      entidadId: (zonaExistente?.id as string | undefined) ?? null,
      detalle: { origen: "puesta_en_marcha", comunas: limpias },
    });

    revalidatePath("/puesta-en-marcha");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No se pudieron guardar tus comunas. Intenta de nuevo.",
    };
  }
}

// =============================================================================
// 3. Completar la puesta en marcha
// =============================================================================

/**
 * Cierra el wizard. Re-verifica en el SERVIDOR que los pasos obligatorios estén
 * completos —el cliente no decide esto— y recién ahí estampa la marca. Sin la
 * marca, el layout (tenant) sigue redirigiendo al wizard.
 */
export async function accionCompletarPuestaEnMarcha(): Promise<Resultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  // El dueño es quien hace la puesta en marcha. `gestionar_perfil_empresa` es su
  // capacidad de arranque (el primer paso la pide).
  if (!puedeGestionarPerfilEmpresa(sesion.usuario)) {
    return { ok: false, mensaje: "Solo el dueño de la cuenta puede terminar la puesta en marcha." };
  }

  const tenantId = sesion.usuario.tenantId;
  const estado = await resolverEstadoPuestaEnMarcha(tenantId);
  if (!estado.puedeCompletar) {
    return {
      ok: false,
      mensaje: "Aún faltan pasos obligatorios. Complétalos antes de terminar.",
    };
  }

  const supabase = crearClienteServiceRole();
  try {
    const { error } = await supabase
      .schema("identidad")
      .from("tenants")
      .update({ puesta_en_marcha_completada_en: new Date().toISOString() })
      .eq("id", tenantId)
      .is("puesta_en_marcha_completada_en", null); // idempotente: no repisa una fecha ya puesta
    if (error) throw new Error(error.message);

    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.puesta_en_marcha_completada",
      entidadTipo: "tenant",
      entidadId: tenantId,
      detalle: {},
    });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No se pudo terminar la puesta en marcha.",
    };
  }
}
