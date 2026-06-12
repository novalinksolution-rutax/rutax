/**
 * Resolución de "estado de onboarding del courier" — Pantalla D (RF-006..009)
 * y la vista consolidada de §1.3 del documento de UX.
 *
 * Decisión de arquitectura de esta pantalla (§0 del documento UX): NO es un
 * wizard bloqueante — es un panel/checklist persistente donde cada paso se
 * resuelve de forma independiente. Esta función centraliza esa resolución
 * para que tanto la Pantalla D como el banner persistente (criterio §1.3,
 * "banner en la barra superior... + Pantalla D accesible en cualquier
 * momento") lean exactamente el mismo cómputo — nunca diverge.
 *
 * Solo lectura: usa el cliente con sesión del usuario (RLS activa) — estas
 * tablas (`courier_config_dte`, `folios_caf`, `tarifas`) son P1 estricta,
 * visibles solo a roles internos del propio tenant (migraciones 0003/0004).
 * No se requiere `service_role` aquí.
 */

import { createClient } from "@/lib/supabase/server";

export type EstadoPasoDte = "pendiente" | "en_proceso" | "activo" | "con_problemas";
export type EstadoPasoFolios = "no_aplica" | "pendiente" | "vigente";
export type EstadoPasoTarifas = "sin_tarifas" | "configuradas";
export type EstadoPasoCobranza = "pendiente" | "conectado" | "con_problemas";

export interface EstadoOnboardingCourier {
  nombreFantasia: string;
  /** `true` cuando DTE activo + al menos una tarifa vigente — "onboarding completo" (§1.3). */
  completo: boolean;
  pasosCompletados: number;
  totalPasos: number;
  dte: {
    estado: EstadoPasoDte;
    proveedorElegido: string | null;
    certificadoVenceEn: string | null;
  };
  folios: {
    estado: EstadoPasoFolios;
    /** `true` si el proveedor gestiona los folios directo con el SII (Caso A, §1.2 Pantalla F). */
    gestionadoPorProveedor: boolean;
    cantidadVigentes: number;
  };
  tarifas: {
    estado: EstadoPasoTarifas;
    cantidad: number;
  };
  cobranza: {
    estado: EstadoPasoCobranza;
    /** `true` si el courier ya conectó su banco (link_token guardado). */
    bancoConectado: boolean;
    /** Alias legible de la cuenta conectada, o null. */
    cuentaBancoAlias: string | null;
  };
}

/**
 * Proveedores DTE que gestionan folios directo con el SII (Caso A de la
 * Pantalla F) — decisión documentada en `integraciones/dte/NOTAS-FOLIOS.md`:
 * SimpleFactura/SimpleAPI delega la solicitud/anulación/consulta de CAF al
 * proveedor; Openfactura, en cambio, exige carga manual (Caso B). Esta lista
 * cierra el conjunto que el cimiento conoce — `frontend` la usa para decidir
 * qué variante de la Pantalla F renderizar (§1.2: "se decide en tiempo de
 * ejecución según el proveedor elegido").
 */
const PROVEEDORES_QUE_GESTIONAN_FOLIOS = new Set(["simplefactura"]);

export function proveedorGestionaFolios(proveedorDte: string | null): boolean {
  if (!proveedorDte) return false;
  return PROVEEDORES_QUE_GESTIONAN_FOLIOS.has(proveedorDte);
}

/**
 * Lee el estado de los tres pasos críticos del onboarding del courier para el
 * tenant del usuario en sesión. Devuelve `null` si no hay tenant (no debería
 * ocurrir tras pasar el guard del layout, pero se modela explícito).
 */
export async function resolverEstadoOnboarding(tenantId: string): Promise<EstadoOnboardingCourier> {
  const supabase = await createClient();

  const [tenantRes, dteRes, foliosRes, tarifasRes, cobranzaRes] = await Promise.all([
    supabase.from("tenants").select("nombre_fantasia").eq("id", tenantId).maybeSingle(),
    supabase
      .from("courier_config_dte")
      .select("proveedor_dte, estado_certificacion, certificado_vence_en")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase.from("folios_caf").select("id, estado").eq("tenant_id", tenantId),
    supabase.from("tarifas").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("estado", "activa"),
    supabase
      .from("courier_config_cobranza")
      .select("estado_conexion, cuenta_banco_alias, link_token_ref")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const nombreFantasia = (tenantRes.data?.nombre_fantasia as string | undefined) ?? "tu courier";

  const proveedorDte = (dteRes.data?.proveedor_dte as string | undefined) ?? null;
  const estadoCertificacion = (dteRes.data?.estado_certificacion as EstadoPasoDte | undefined) ?? null;
  const certificadoVenceEn = (dteRes.data?.certificado_vence_en as string | undefined) ?? null;

  const estadoDte: EstadoPasoDte = !proveedorDte ? "pendiente" : (estadoCertificacion ?? "pendiente");

  const gestionadoPorProveedor = proveedorGestionaFolios(proveedorDte);
  const filasFolios = (foliosRes.data ?? []) as Array<{ id: string; estado: string }>;
  const cantidadVigentes = filasFolios.filter((f) => f.estado === "vigente").length;

  let estadoFolios: EstadoPasoFolios;
  if (!proveedorDte) {
    estadoFolios = "pendiente";
  } else if (gestionadoPorProveedor) {
    estadoFolios = "no_aplica";
  } else {
    estadoFolios = filasFolios.length > 0 ? "vigente" : "pendiente";
  }

  const cantidadTarifas = tarifasRes.count ?? 0;
  const estadoTarifas: EstadoPasoTarifas = cantidadTarifas > 0 ? "configuradas" : "sin_tarifas";

  // Cobranza (paso informativo/no bloqueante, como Folios): el banco conectado
  // habilita la conciliación automática de pagos, pero no bloquea operar.
  const estadoConexionCobranza = (cobranzaRes.data?.estado_conexion as string | undefined) ?? null;
  const bancoConectado = Boolean(cobranzaRes.data?.link_token_ref);
  const cuentaBancoAlias = (cobranzaRes.data?.cuenta_banco_alias as string | undefined) ?? null;
  let estadoCobranza: EstadoPasoCobranza;
  if (estadoConexionCobranza === "error" || estadoConexionCobranza === "revocado") {
    estadoCobranza = "con_problemas";
  } else if (bancoConectado) {
    estadoCobranza = "conectado";
  } else {
    estadoCobranza = "pendiente";
  }

  // "Completo" (§1.3): DTE activo + al menos una tarifa vigente. Folios CAF
  // NUNCA bloquea — puede depender 100% del proveedor (§1.2, decisión "qué
  // bloquea qué").
  const dteListo = estadoDte === "activo";
  const tarifasListas = estadoTarifas === "configuradas";
  const completo = dteListo && tarifasListas;

  const pasosCompletados = [dteListo, tarifasListas].filter(Boolean).length;

  return {
    nombreFantasia,
    completo,
    pasosCompletados,
    totalPasos: 2, // pasos CRÍTICOS para "completo" — folios es informativo/no-bloqueante
    dte: {
      estado: estadoDte,
      proveedorElegido: proveedorDte,
      certificadoVenceEn,
    },
    folios: {
      estado: estadoFolios,
      gestionadoPorProveedor,
      cantidadVigentes,
    },
    tarifas: {
      estado: estadoTarifas,
      cantidad: cantidadTarifas,
    },
    cobranza: {
      estado: estadoCobranza,
      bancoConectado,
      cuentaBancoAlias,
    },
  };
}
