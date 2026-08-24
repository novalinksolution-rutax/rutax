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
import { obtenerMiPlan } from "@/modules/plataforma/superficie-courier";

export type EstadoPasoDte = "pendiente" | "en_proceso" | "activo" | "con_problemas";
export type EstadoPasoFolios = "no_aplica" | "pendiente" | "vigente";
export type EstadoPasoTarifas = "sin_tarifas" | "configuradas";
export type EstadoPasoCobranza = "pendiente" | "conectado" | "con_problemas";
/**
 * Estado de la 5ª tarjeta (suscripción SaaS de Rutax) — informativa, NUNCA
 * bloqueante (mismo trato que Folios/Cobranza: no cuenta para `totalPasos`).
 * `sin_suscripcion` = el tenant aún no dio de alta su plan (self-serve).
 */
export type EstadoPasoPlan = "sin_suscripcion" | "trial" | "activa" | "suspendida" | "cancelada";

export interface EstadoOnboardingCourier {
  nombreFantasia: string;
  /** `true` cuando el certificado está cargado + hay al menos una tarifa vigente. */
  completo: boolean;
  pasosCompletados: number;
  totalPasos: number;
  /**
   * Qué falta para operar, nombrado. `null` cuando no falta nada.
   *
   * Existe porque el aviso del marco tiene que nombrar el paso que falta y no
   * un conteo: «te falta configurar la facturación» se puede accionar; «tienes
   * 2 pasos pendientes» obliga a ir a buscar cuáles.
   */
  faltaParaOperar: string | null;
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
  /** Suscripción SaaS del courier a Rutax (backstage `plataforma`) — informativa. */
  plan: {
    estado: EstadoPasoPlan;
    nombrePlan: string | null;
    trialHasta: string | null;
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

  const [tenantRes, dteRes, foliosRes, tarifasRes, cobranzaRes, miPlan] = await Promise.all([
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
    // Suscripción SaaS del courier — courier-safe vía `superficie-courier.ts`
    // (NUNCA se lee `plataforma` directo). No crítica: un fallo aquí no debe
    // tumbar el resto del checklist de onboarding.
    obtenerMiPlan(tenantId).catch(() => null),
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

  // "Completo": el certificado cargado + al menos una tarifa vigente.
  //
  // ⚠️ ANTES ESTO EXIGÍA `estado_certificacion = 'activo'`, Y NADIE ESCRIBE ESE
  // VALOR. Los únicos escritores ponen `pendiente` (al elegir proveedor) y
  // `en_proceso` (al cargar el certificado); no existe el job ni el endpoint que
  // confirme con el proveedor. O sea: `completo` era `false` para siempre y **el
  // aviso de configuración pendiente no desaparecía nunca, para ningún
  // courier**, por muy configurado que estuviera.
  //
  // `en_proceso` cuenta como listo porque es verdad operativa: con el
  // certificado cargado Rutax puede firmar. `activo` queda reservado para
  // cuando exista la confirmación del proveedor, y mientras tanto no bloquea a
  // nadie. Decisión del usuario, 23-08.
  const dteListo = estadoDte === "activo" || estadoDte === "en_proceso";
  const tarifasListas = estadoTarifas === "configuradas";
  const completo = dteListo && tarifasListas;

  // Folios CAF NUNCA bloquea — puede depender 100% del proveedor (§1.2,
  // decisión "qué bloquea qué"). Cobranza y Plan, igual.
  const foliosListo = estadoFolios === "vigente" || estadoFolios === "no_aplica";
  const cobranzaListo = estadoCobranza === "conectado";

  // Plan (paso informativo/no bloqueante, como Folios/Cobranza): la suscripción
  // de Rutax es independiente de si el courier ya puede operar/facturar.
  const estadoPlan: EstadoPasoPlan = miPlan ? miPlan.estado : "sin_suscripcion";
  const planListo = estadoPlan === "activa" || estadoPlan === "trial";

  // ⚠️ UN SOLO CONTEO, Y ES SOBRE LOS CINCO PASOS QUE SE VEN.
  //
  // Antes había DOS en la misma pantalla, a 25 px de distancia: `totalPasos: 2`
  // alimentaba la barra de progreso y el aviso del marco, mientras el grid
  // renderizaba cinco tarjetas. «1 de 2 pasos críticos» encima de cinco pasos.
  //
  // El conteo cuenta lo que se ve. Lo que decide si el courier puede operar es
  // `completo`, que es OTRA pregunta y se dice con otras palabras — nunca con
  // un número que compita con éste.
  const pasosCompletados = [dteListo, foliosListo, tarifasListas, cobranzaListo, planListo].filter(
    Boolean,
  ).length;

  return {
    nombreFantasia,
    completo,
    pasosCompletados,
    totalPasos: 5,
    // Qué falta para poder operar, con NOMBRE. El aviso del marco decía «tienes
    // 2 pasos pendientes», que no dice cuáles ni por qué importan.
    faltaParaOperar: completo ? null : !dteListo ? "facturación" : "tarifas",
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
    plan: {
      estado: estadoPlan,
      nombrePlan: miPlan ? miPlan.plan.nombre : null,
      trialHasta: miPlan ? miPlan.trialHasta : null,
    },
  };
}
