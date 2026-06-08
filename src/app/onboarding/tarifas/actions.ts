"use server";

/**
 * Server Actions — Pantalla G (tarifas iniciales, RF-009).
 *
 * Sin secretos que cifrar aquí — `tarifas` es una tabla de negocio común (P1
 * estricta, RLS interno del tenant). El cliente de sesión basta para
 * leer/escribir directamente; no se requiere `service_role` ni `integraciones`.
 *
 * "Lo simple primero, lo específico después" (§1.2): la tarifa por defecto
 * (`seller_id = null`) es la que completa este paso del checklist; las
 * específicas son opcionales y se agregan con el mismo formulario, solo que
 * con `seller_id`/`zona` presentes.
 */

import { createClient } from "@/lib/supabase/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";

export type TipoEntrega = "flex" | "same_day";

export interface TarifaListado {
  id: string;
  sellerId: string | null;
  sellerNombre: string | null;
  tipoEntrega: TipoEntrega;
  zona: string | null;
  montoClp: number;
  vigenteDesde: string;
  vigenteHasta: string | null;
  estado: "activa" | "inactiva";
}

export interface SellerOpcion {
  id: string;
  nombre: string;
}

export interface EstadoTarifas {
  tarifas: TarifaListado[];
  sellers: SellerOpcion[];
}

export async function obtenerEstadoTarifas(): Promise<
  { ok: true; estado: EstadoTarifas } | { ok: false; mensaje: string }
> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No hay una sesión activa." };
  }

  const supabase = await createClient();
  const [{ data: filasTarifas, error: errorTarifas }, { data: filasSellers, error: errorSellers }] = await Promise.all([
    supabase
      .from("tarifas")
      .select("id, seller_id, tipo_entrega, zona, monto_clp, vigente_desde, vigente_hasta, estado, sellers(razon_social)")
      .eq("tenant_id", sesion.usuario.tenantId)
      .order("estado", { ascending: true })
      .order("vigente_desde", { ascending: false }),
    supabase
      .from("sellers")
      .select("id, razon_social")
      .eq("tenant_id", sesion.usuario.tenantId)
      .order("razon_social", { ascending: true }),
  ]);

  if (errorTarifas || errorSellers) {
    return { ok: false, mensaje: "No pudimos cargar tus tarifas por un problema de nuestro sistema." };
  }

  type FilaTarifa = {
    id: string;
    seller_id: string | null;
    tipo_entrega: TipoEntrega;
    zona: string | null;
    monto_clp: number;
    vigente_desde: string;
    vigente_hasta: string | null;
    estado: "activa" | "inactiva";
    sellers: { razon_social: string } | { razon_social: string }[] | null;
  };

  const tarifas: TarifaListado[] = ((filasTarifas ?? []) as unknown as FilaTarifa[]).map((fila) => {
    const seller = Array.isArray(fila.sellers) ? fila.sellers[0] : fila.sellers;
    return {
      id: fila.id,
      sellerId: fila.seller_id,
      sellerNombre: seller?.razon_social ?? null,
      tipoEntrega: fila.tipo_entrega,
      zona: fila.zona,
      montoClp: Number(fila.monto_clp),
      vigenteDesde: fila.vigente_desde,
      vigenteHasta: fila.vigente_hasta,
      estado: fila.estado,
    };
  });

  const sellers: SellerOpcion[] = (filasSellers ?? []).map((fila) => ({
    id: fila.id as string,
    nombre: fila.razon_social as string,
  }));

  return { ok: true, estado: { tarifas, sellers } };
}

// -----------------------------------------------------------------------------
// Crear tarifa (por defecto o específica) — un único "puerto" de creación; el
// formulario decide si manda `sellerId`/`zona` (§1.2: "mismo formulario,
// secciones progresivas").
// -----------------------------------------------------------------------------

export interface CrearTarifaEntrada {
  sellerId: string | null;
  tipoEntrega: TipoEntrega;
  zona: string | null;
  montoClp: number;
  vigenteDesde: string;
}

export type AccionTarifaResultado = { ok: true } | { ok: false; tipo: "permiso" | "validacion" | "conflicto" | "desconocido"; mensaje: string };

export async function crearTarifa(entrada: CrearTarifaEntrada): Promise<AccionTarifaResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeGestionarTarifas(sesion.usuario)) {
    return {
      ok: false,
      tipo: "permiso",
      mensaje: "No tienes permiso para gestionar tarifas — contacta al dueño de la cuenta.",
    };
  }

  if (entrada.tipoEntrega !== "flex" && entrada.tipoEntrega !== "same_day") {
    return { ok: false, tipo: "validacion", mensaje: "Elige un tipo de entrega válido." };
  }
  if (!Number.isFinite(entrada.montoClp) || entrada.montoClp <= 0) {
    return { ok: false, tipo: "validacion", mensaje: "Ingresa un monto en pesos chilenos mayor a cero." };
  }
  if (!entrada.vigenteDesde || Number.isNaN(Date.parse(entrada.vigenteDesde))) {
    return { ok: false, tipo: "validacion", mensaje: "Ingresa la fecha desde la que esta tarifa empieza a regir." };
  }

  const supabase = await createClient();

  // Conflicto de solapamiento (§1.2): misma combinación seller/tipo/zona con
  // una tarifa activa que no tiene fecha de término — el backend (constraint o
  // trigger) podría rechazarlo igual, pero detectarlo aquí permite explicar
  // el motivo en términos de negocio, no como error de base de datos crudo.
  let consulta = supabase
    .from("tarifas")
    .select("id")
    .eq("tenant_id", sesion.usuario.tenantId)
    .eq("tipo_entrega", entrada.tipoEntrega)
    .eq("estado", "activa")
    .is("vigente_hasta", null);

  consulta = entrada.sellerId ? consulta.eq("seller_id", entrada.sellerId) : consulta.is("seller_id", null);
  consulta = entrada.zona ? consulta.eq("zona", entrada.zona) : consulta.is("zona", null);

  const { data: existentes, error: errorConsulta } = await consulta;
  if (errorConsulta) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos validar tus tarifas existentes por un problema de nuestro sistema. Intenta de nuevo.",
    };
  }
  if (existentes && existentes.length > 0) {
    return {
      ok: false,
      tipo: "conflicto",
      mensaje:
        "Ya existe una tarifa vigente para esta misma combinación (seller, tipo de entrega y zona). Para reemplazarla, primero desactívala en el listado.",
    };
  }

  const { error } = await supabase.from("tarifas").insert({
    tenant_id: sesion.usuario.tenantId,
    seller_id: entrada.sellerId,
    tipo_entrega: entrada.tipoEntrega,
    zona: entrada.zona,
    monto_clp: Math.round(entrada.montoClp),
    vigente_desde: entrada.vigenteDesde,
    estado: "activa",
  });

  if (error) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos guardar tu tarifa por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  await auditar(sesion.usuario.tenantId, sesion.usuarioId, "tarifa.creada", {
    seller_id: entrada.sellerId,
    tipo_entrega: entrada.tipoEntrega,
    zona: entrada.zona,
    monto_clp: Math.round(entrada.montoClp),
    vigente_desde: entrada.vigenteDesde,
  });

  return { ok: true };
}

// -----------------------------------------------------------------------------
// Desactivar una tarifa (no se sobrescribe — el modelo es versionado por
// vigencia; "desactivar" cierra su vigencia hoy, §1.2 "acciones: editar/desactivar")
// -----------------------------------------------------------------------------

export async function desactivarTarifa(tarifaId: string): Promise<AccionTarifaResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeGestionarTarifas(sesion.usuario)) {
    return {
      ok: false,
      tipo: "permiso",
      mensaje: "No tienes permiso para gestionar tarifas — contacta al dueño de la cuenta.",
    };
  }
  if (!tarifaId) {
    return { ok: false, tipo: "validacion", mensaje: "Falta indicar qué tarifa desactivar." };
  }

  const supabase = await createClient();
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }); // YYYY-MM-DD

  const { data, error } = await supabase
    .from("tarifas")
    .update({ estado: "inactiva", vigente_hasta: hoy })
    .eq("tenant_id", sesion.usuario.tenantId)
    .eq("id", tarifaId)
    .select("id")
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos desactivar esta tarifa por un problema de nuestro sistema. Intenta de nuevo.",
    };
  }
  if (!data) {
    return { ok: false, tipo: "validacion", mensaje: "Esta tarifa ya no existe o no pertenece a tu cuenta." };
  }

  await auditar(sesion.usuario.tenantId, sesion.usuarioId, "tarifa.desactivada", { tarifa_id: tarifaId });

  return { ok: true };
}

async function auditar(
  tenantId: string,
  actorUsuarioId: string,
  accion: string,
  detalle: Record<string, unknown>,
): Promise<void> {
  const cliente = crearClienteServiceRole();
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion,
    entidadTipo: "tarifa",
    entidadId: null,
    detalle,
  });
}
