"use server";

/**
 * Server Actions para gestión de tarifas (F14).
 * RBAC: solo roles con `gestionar_tarifas` (dueño / administración).
 */

import { revalidatePath } from "next/cache";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";

type ResultadoAccion = { ok: true } | { ok: false; mensaje: string };

// =============================================================================
// Helpers
// =============================================================================

function validarMonto(val: unknown, campo: string): number {
  const n = Number(val);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${campo} debe ser un entero CLP mayor o igual a cero.`);
  }
  return n;
}

function validarFecha(val: unknown, campo: string): string {
  const s = String(val ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`${campo} debe estar en formato YYYY-MM-DD.`);
  }
  return s;
}

// =============================================================================
// crearTarifa
// =============================================================================

export async function accionCrearTarifa(formData: FormData): Promise<ResultadoAccion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  if (!puedeGestionarTarifas(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para gestionar tarifas." };
  }

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  try {
    const sellerId = (formData.get("seller_id") as string | null) || null;
    const tipoEntrega = formData.get("tipo_entrega") as string;
    const modoCalculo = formData.get("modo_calculo") as string;
    const zona = (formData.get("zona") as string | null)?.trim() || null;
    const montoClp = validarMonto(formData.get("monto_clp"), "Monto base");
    const vigenteDesdeFecha = validarFecha(formData.get("vigente_desde"), "Vigente desde");
    const vigenteHastaRaw = (formData.get("vigente_hasta") as string | null)?.trim() || null;
    const vigenteHasta = vigenteHastaRaw ? validarFecha(vigenteHastaRaw, "Vigente hasta") : null;

    const minimoFacturacion = formData.get("minimo_facturacion_clp")
      ? validarMonto(formData.get("minimo_facturacion_clp"), "Mínimo facturación")
      : null;
    const minimoRetiro = formData.get("minimo_retiro_clp")
      ? validarMonto(formData.get("minimo_retiro_clp"), "Mínimo retiro")
      : null;
    const recargoReprogramacion = formData.get("recargo_reprogramacion_clp")
      ? validarMonto(formData.get("recargo_reprogramacion_clp"), "Recargo reprogramación")
      : null;

    if (!["flex", "same_day"].includes(tipoEntrega)) {
      return { ok: false, mensaje: "Tipo de entrega inválido." };
    }
    if (!["monto_fijo", "por_zona"].includes(modoCalculo)) {
      return { ok: false, mensaje: "Modo de cálculo inválido." };
    }
    if (vigenteHasta && vigenteHasta < vigenteDesdeFecha) {
      return { ok: false, mensaje: "La fecha 'vigente hasta' debe ser posterior a 'vigente desde'." };
    }

    const { data: tarifa, error } = await supabase
      .schema("identidad")
      .from("tarifas")
      .insert({
        tenant_id: tenantId,
        seller_id: sellerId,
        tipo_entrega: tipoEntrega,
        modo_calculo: modoCalculo,
        zona,
        monto_clp: montoClp,
        vigente_desde: vigenteDesdeFecha,
        vigente_hasta: vigenteHasta,
        estado: "activa",
        minimo_facturacion_clp: minimoFacturacion,
        minimo_retiro_clp: minimoRetiro,
        recargo_reprogramacion_clp: recargoReprogramacion,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.tarifa_creada",
      entidadTipo: "tarifa",
      entidadId: tarifa.id as string,
      detalle: { seller_id: sellerId, tipo_entrega: tipoEntrega, monto_clp: montoClp },
    });

    revalidatePath("/configuracion/tarifas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al crear la tarifa." };
  }
}

// =============================================================================
// editarTarifa
// =============================================================================

export async function accionEditarTarifa(
  tarifaId: string,
  formData: FormData,
): Promise<ResultadoAccion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  if (!puedeGestionarTarifas(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para gestionar tarifas." };
  }

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  try {
    const modoCalculo = formData.get("modo_calculo") as string;
    const zona = (formData.get("zona") as string | null)?.trim() || null;
    const montoClp = validarMonto(formData.get("monto_clp"), "Monto base");
    const vigenteDesdeFecha = validarFecha(formData.get("vigente_desde"), "Vigente desde");
    const vigenteHastaRaw = (formData.get("vigente_hasta") as string | null)?.trim() || null;
    const vigenteHasta = vigenteHastaRaw ? validarFecha(vigenteHastaRaw, "Vigente hasta") : null;

    const minimoFacturacion = formData.get("minimo_facturacion_clp")
      ? validarMonto(formData.get("minimo_facturacion_clp"), "Mínimo facturación")
      : null;
    const minimoRetiro = formData.get("minimo_retiro_clp")
      ? validarMonto(formData.get("minimo_retiro_clp"), "Mínimo retiro")
      : null;
    const recargoReprogramacion = formData.get("recargo_reprogramacion_clp")
      ? validarMonto(formData.get("recargo_reprogramacion_clp"), "Recargo reprogramación")
      : null;

    if (!["monto_fijo", "por_zona"].includes(modoCalculo)) {
      return { ok: false, mensaje: "Modo de cálculo inválido." };
    }
    if (vigenteHasta && vigenteHasta < vigenteDesdeFecha) {
      return { ok: false, mensaje: "La fecha 'vigente hasta' debe ser posterior a 'vigente desde'." };
    }

    const { error } = await supabase
      .schema("identidad")
      .from("tarifas")
      .update({
        modo_calculo: modoCalculo,
        zona,
        monto_clp: montoClp,
        vigente_desde: vigenteDesdeFecha,
        vigente_hasta: vigenteHasta,
        minimo_facturacion_clp: minimoFacturacion,
        minimo_retiro_clp: minimoRetiro,
        recargo_reprogramacion_clp: recargoReprogramacion,
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", tarifaId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);

    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.tarifa_editada",
      entidadTipo: "tarifa",
      entidadId: tarifaId,
      detalle: { monto_clp: montoClp },
    });

    revalidatePath("/configuracion/tarifas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al editar la tarifa." };
  }
}

// =============================================================================
// inactivarTarifa
// =============================================================================

export async function accionInactivarTarifa(tarifaId: string): Promise<ResultadoAccion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  if (!puedeGestionarTarifas(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para gestionar tarifas." };
  }

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  try {
    const { error } = await supabase
      .schema("identidad")
      .from("tarifas")
      .update({ estado: "inactiva", actualizado_en: new Date().toISOString() })
      .eq("id", tarifaId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);

    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.tarifa_inactivada",
      entidadTipo: "tarifa",
      entidadId: tarifaId,
      detalle: {},
    });

    revalidatePath("/configuracion/tarifas");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al inactivar la tarifa.",
    };
  }
}
