/**
 * Resolución de "estado de onboarding del courier" — Pantalla D (RF-006..009)
 * y la vista consolidada de §1.3 del documento de UX.
 *
 * Decisión de arquitectura de esta pantalla (§0 del documento UX): NO es un
 * wizard bloqueante — es un panel/checklist persistente donde cada paso se
 * resuelve de forma independiente.
 *
 * -----------------------------------------------------------------------------
 * 🔴 DOS FUNCIONES, Y LA RAZÓN ES EL COSTE POR PÁGINA
 * -----------------------------------------------------------------------------
 * `(tenant)/layout.tsx` resuelve esto en **cada carga de página** para el dueño
 * y administración, y el banner que alimenta usa UN solo campo:
 * `faltaParaOperar`. Cuando el asistente pasó de 5 a 14 pasos, seguir con una
 * sola función habría puesto trece consultas en cada navegación de toda el área
 * autenticada para pagar un aviso de una línea.
 *
 *   · `resolverBloqueoOperativo` — cuatro consultas `head: true`. Es lo que
 *     llama el layout.
 *   · `resolverEstadoOnboarding`  — el estado completo de los catorce pasos. Solo
 *     lo llama la pantalla del asistente.
 *
 * ⚠️ La segunda **deriva** su `faltaParaOperar` de la primera en vez de
 * recalcularlo: dos definiciones de "puede operar" son dos respuestas distintas
 * a la misma pregunta, en dos sitios que nadie compara.
 *
 * Solo lectura y con el cliente de sesión (RLS activa): todas estas tablas son
 * P1 estricta, visibles solo a roles internos del propio tenant.
 */

import { createClient } from "@/lib/supabase/server";
import { obtenerMiPlan } from "@/modules/plataforma/superficie-courier";
import {
  PERIODICIDAD_POR_DEFECTO,
  leerPeriodicidadTenant,
} from "@/modules/dinero/config-periodos";
import type { TipoPeriodoFacturacion } from "@/modules/dinero/tipos";

export type EstadoPasoDte = "pendiente" | "en_proceso" | "activo" | "con_problemas";
export type EstadoPasoFolios = "no_aplica" | "pendiente" | "vigente";
export type EstadoPasoTarifas = "sin_tarifas" | "configuradas";
export type EstadoPasoCobranza = "pendiente" | "conectado" | "con_problemas";
export type EstadoPasoPlan = "sin_suscripcion" | "trial" | "activa" | "suspendida" | "cancelada";

/**
 * Los campos del bloque Emisor que el courier tiene que completar.
 *
 * `razon_social` y `rut` van primero: con el alta por correo el courier nace sin
 * ellos (NULL) y son la base de todo (identifican al emisor, van en cada DTE).
 * `nombre_fantasia` NO entra: siempre tiene un valor —al menos el provisional
 * del alta— así que como «campo faltante» daría siempre completo; su edición se
 * ofrece en el formulario, no se exige por esta lista.
 */
export const CAMPOS_EMISOR = [
  { columna: "razon_social", etiqueta: "razón social" },
  { columna: "rut", etiqueta: "RUT" },
  { columna: "giro", etiqueta: "giro" },
  { columna: "direccion", etiqueta: "dirección" },
  { columna: "comuna", etiqueta: "comuna" },
  { columna: "actividad_economica", etiqueta: "actividad económica" },
] as const;

export interface EstadoOnboardingCourier {
  nombreFantasia: string;
  /** `true` cuando no falta nada para operar. Ver `resolverBloqueoOperativo`. */
  completo: boolean;
  /**
   * Qué falta para operar, como FRASE CON VERBO («cargar tus conductores»).
   * `null` cuando no falta nada.
   *
   * Lleva el verbo dentro porque los pasos ya no son todos «configurar algo»:
   * un conductor se carga y un seller se invita. «Te falta configurar tus
   * conductores» describe mal lo que hay que ir a hacer.
   */
  faltaParaOperar: string | null;
  dte: {
    estado: EstadoPasoDte;
    proveedorElegido: string | null;
    certificadoVenceEn: string | null;
    /** Los cuatro campos del bloque Emisor que falten, por su etiqueta legible. */
    camposEmisorFaltantes: string[];
  };
  folios: {
    estado: EstadoPasoFolios;
    gestionadoPorProveedor: boolean;
    cantidadVigentes: number;
  };
  tarifas: {
    estado: EstadoPasoTarifas;
    cantidad: number;
  };
  cobranza: {
    estado: EstadoPasoCobranza;
    bancoConectado: boolean;
    cuentaBancoAlias: string | null;
  };
  plan: {
    estado: EstadoPasoPlan;
    nombrePlan: string | null;
    trialHasta: string | null;
  };
  bodegas: {
    cantidad: number;
    /** Sin una principal resuelta, el ruteo no tiene punto de partida. */
    hayPrincipal: boolean;
  };
  conductores: { cantidad: number };
  sellers: { cantidad: number };
  periodos: {
    tipoPeriodo: TipoPeriodoFacturacion;
    /** `false` = nadie lo eligió; el motor está usando su respaldo. */
    explicita: boolean;
  };
  datosCobro: {
    configurado: boolean;
    banco: string | null;
  };
  retencion: {
    /** La AUSENCIA de fila en `courier_config_payout` es "sin configurar". */
    configurada: boolean;
    porcentaje: number | null;
  };
  retiro: {
    /** `null` = sin fila; las visitas a bodega no generan pago propio. */
    montoVisitaClp: number | null;
  };
  zonas: { cantidad: number };
  contacto: {
    telefono: string | null;
    email: string | null;
  };
}

const PROVEEDORES_QUE_GESTIONAN_FOLIOS = new Set(["simplefactura"]);

export function proveedorGestionaFolios(proveedorDte: string | null): boolean {
  if (!proveedorDte) return false;
  return PROVEEDORES_QUE_GESTIONAN_FOLIOS.has(proveedorDte);
}

/**
 * Qué le falta al courier para PODER OPERAR, como frase con verbo, o `null`.
 *
 * -----------------------------------------------------------------------------
 * QUÉ CUENTA COMO "PODER OPERAR", Y POR QUÉ CAMBIÓ
 * -----------------------------------------------------------------------------
 * Antes eran dos cosas: certificado DTE cargado y una tarifa vigente. Eso
 * respondía «¿puede facturar?», no «¿puede operar?». Un courier sin un solo
 * seller no recibe ni un pedido, y uno sin conductores no tiene a quién
 * asignárselos: los dos casos daban `completo` y el aviso no salía.
 *
 * El orden de la respuesta es el del día real y no el de las tablas: sin
 * sellers no hay pedidos, sin conductores no hay quién los lleve, sin tarifa la
 * entrega se hace y no se puede cobrar, y sin facturación no se emite.
 *
 * ⚠️ **La bodega NO entra acá.** Sin ella el ruteo no tiene punto de partida,
 * pero la asignación y el manifiesto funcionan igual: es «necesario para
 * rutear», que es otra frase, y meterla acá encendería el aviso de «no puedes
 * operar» a couriers que están operando.
 */
export async function resolverBloqueoOperativo(tenantId: string): Promise<string | null> {
  const supabase = await createClient();

  const [empresaRes, sellersRes, conductoresRes, tarifasRes, dteRes] = await Promise.all([
    // 🔴 La identidad de la empresa va PRIMERO. Con el alta por correo el courier
    // nace sin razón social ni RUT (los dos NULL), y esos dos son la base de
    // todo: van en cada DTE y el RUT identifica al courier. Es el primer dato que
    // el dueño tiene que poner, antes que sellers o conductores.
    supabase
      .from("tenants")
      .select("razon_social, rut")
      .eq("id", tenantId)
      .maybeSingle(),
    supabase
      .from("sellers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      // ⚠️ `suspendido`, no `inactivo`: el enum `identidad.estado_seller` es
      // `invitado | activo | suspendido`. Filtrar por un valor que no está en el
      // enum hace que Postgres rechace la consulta entera y el conteo caiga a 0
      // — o sea, «no tienes sellers» teniendo tres. Falla cerrado y en silencio.
      .neq("estado", "suspendido"),
    supabase
      .from("conductores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("estado", "activo"),
    supabase
      .from("tarifas")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("estado", "activa"),
    supabase
      .from("courier_config_dte")
      .select("proveedor_dte, estado_certificacion")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  // Sin razón social O sin RUT, el courier no puede facturar ni ser identificado:
  // es el bloqueo más fundamental. Un string vacío cuenta como falta —la columna
  // guarda NULL, pero por si acaso.
  const empresa = empresaRes.data as { razon_social: string | null; rut: string | null } | null;
  if (!empresa?.razon_social?.trim() || !empresa?.rut?.trim()) {
    return "completar los datos de tu empresa";
  }

  if ((sellersRes.count ?? 0) === 0) return "invitar a tu primer seller";
  if ((conductoresRes.count ?? 0) === 0) return "cargar tus conductores";
  if ((tarifasRes.count ?? 0) === 0) return "definir tus tarifas";

  if (!dteEstaListo(dteRes.data)) return "configurar la facturación electrónica";

  return null;
}

/**
 * `true` si el certificado está cargado.
 *
 * ⚠️ ANTES ESTO EXIGÍA `estado_certificacion = 'activo'`, Y NADIE ESCRIBE ESE
 * VALOR. Los únicos escritores ponen `pendiente` (al elegir proveedor) y
 * `en_proceso` (al cargar el certificado); no existe el job que confirme con el
 * proveedor. O sea: el aviso de configuración pendiente no desaparecía nunca,
 * para ningún courier. `en_proceso` cuenta como listo porque es verdad
 * operativa: con el certificado cargado Rutax puede firmar. Decisión del
 * usuario, 23-08.
 */
function dteEstaListo(fila: { estado_certificacion?: unknown; proveedor_dte?: unknown } | null): boolean {
  if (!fila?.proveedor_dte) return false;
  const estado = fila.estado_certificacion as EstadoPasoDte | undefined;
  return estado === "activo" || estado === "en_proceso";
}

/**
 * Lee el estado de los catorce pasos del asistente. Solo la pantalla del
 * asistente debería llamar esto — el layout usa `resolverBloqueoOperativo`.
 */
export async function resolverEstadoOnboarding(tenantId: string): Promise<EstadoOnboardingCourier> {
  const supabase = await createClient();

  const [
    tenantRes,
    dteRes,
    foliosRes,
    tarifasRes,
    cobranzaRes,
    miPlan,
    bodegasRes,
    conductoresRes,
    sellersRes,
    periodicidad,
    datosCobroRes,
    payoutRes,
    retiroRes,
    zonasRes,
    bloqueo,
  ] = await Promise.all([
    supabase
      .from("tenants")
      .select(
        "nombre_fantasia, razon_social, rut, giro, direccion, comuna, actividad_economica, telefono_contacto, email_contacto",
      )
      .eq("id", tenantId)
      .maybeSingle(),
    supabase
      .from("courier_config_dte")
      .select("proveedor_dte, estado_certificacion, certificado_vence_en")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase.from("folios_caf").select("id, estado").eq("tenant_id", tenantId),
    supabase
      .from("tarifas")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("estado", "activa"),
    supabase
      .from("courier_config_cobranza")
      .select("estado_conexion, cuenta_banco_alias, link_token_ref")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    // Suscripción SaaS del courier — courier-safe vía `superficie-courier.ts`
    // (NUNCA se lee `plataforma` directo). No crítica: un fallo aquí no debe
    // tumbar el resto del checklist.
    obtenerMiPlan(tenantId).catch(() => null),
    supabase
      .from("courier_bodegas")
      .select("id, es_principal")
      .eq("tenant_id", tenantId)
      .eq("activa", true),
    supabase
      .from("conductores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("estado", "activo"),
    supabase
      .from("sellers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      // ⚠️ `suspendido`, no `inactivo`: el enum `identidad.estado_seller` es
      // `invitado | activo | suspendido`. Filtrar por un valor que no está en el
      // enum hace que Postgres rechace la consulta entera y el conteo caiga a 0
      // — o sea, «no tienes sellers» teniendo tres. Falla cerrado y en silencio.
      .neq("estado", "suspendido"),
    // El MISMO lector que usa el motor de dinero y la pantalla de Períodos: la
    // periodicidad se responde en un solo sitio.
    leerPeriodicidadTenant(supabase, tenantId).catch(() => ({
      tipoPeriodo: PERIODICIDAD_POR_DEFECTO,
      explicita: false,
      fijadaEn: null,
    })),
    supabase
      .from("courier_datos_cobro")
      .select("banco, numero_cuenta")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("courier_config_payout")
      .select("porcentaje_retencion")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("courier_config_retiro")
      .select("monto_visita_bodega_clp")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("zonas")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("activa", true),
    resolverBloqueoOperativo(tenantId),
  ]);

  const tenant = tenantRes.data ?? null;
  const nombreFantasia = (tenant?.nombre_fantasia as string | undefined) ?? "tu courier";

  const proveedorDte = (dteRes.data?.proveedor_dte as string | undefined) ?? null;
  const estadoCertificacion = (dteRes.data?.estado_certificacion as EstadoPasoDte | undefined) ?? null;
  const certificadoVenceEn = (dteRes.data?.certificado_vence_en as string | undefined) ?? null;
  const estadoDte: EstadoPasoDte = !proveedorDte ? "pendiente" : (estadoCertificacion ?? "pendiente");

  // Los campos del Emisor que faltan, nombrados. Una lista vacía es "completo";
  // decir «faltan 2» obligaría a abrir el paso para saber cuáles.
  const camposEmisorFaltantes = CAMPOS_EMISOR.filter((c) => {
    const valor = tenant?.[c.columna as keyof typeof tenant];
    return typeof valor !== "string" || valor.trim() === "";
  }).map((c) => c.etiqueta);

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

  const estadoPlan: EstadoPasoPlan = miPlan ? miPlan.estado : "sin_suscripcion";

  const filasBodegas = (bodegasRes.data ?? []) as Array<{ id: string; es_principal: boolean }>;

  // ⚠️ La ausencia de FILA es "sin configurar"; un 0 guardado es una decisión
  // legítima (un courier con solo conductores dependientes no retiene nada).
  // Se pueden distinguir porque hoy NADIE más escribe `courier_config_payout`:
  // todas sus otras referencias en `src/` son lecturas.
  const filaPayout = payoutRes.data ?? null;
  const porcentajeRetencion =
    filaPayout && typeof filaPayout.porcentaje_retencion !== "undefined"
      ? Number(filaPayout.porcentaje_retencion)
      : null;

  // ⚠️ Acá había cinco booleanos («dteListo», «foliosListo»…) que alimentaban un
  // conteo propio de esta función. Se retiraron con él: quién está listo lo
  // decide `pasosDelAsistente`, sobre la lista YA filtrada por las áreas que
  // Rutax tiene encendidas. Dos sitios calculándolo eran dos respuestas a la
  // misma pregunta, y una de ellas contaba pasos que la pantalla no muestra.

  const cantidadBodegas = filasBodegas.length;
  const hayPrincipal = filasBodegas.some((b) => b.es_principal);
  const cantidadConductores = conductoresRes.count ?? 0;
  const cantidadSellers = sellersRes.count ?? 0;
  const cantidadZonas = zonasRes.count ?? 0;
  const datosCobroConfigurado = Boolean(datosCobroRes.data?.numero_cuenta);
  const montoVisitaClp = retiroRes.data
    ? Number(retiroRes.data.monto_visita_bodega_clp)
    : null;
  const telefonoContacto = (tenant?.telefono_contacto as string | undefined) ?? null;
  const emailContacto = (tenant?.email_contacto as string | undefined) ?? null;


  return {
    nombreFantasia,
    // Derivado, NUNCA recalculado: una segunda definición de "puede operar"
    // sería una segunda respuesta a la misma pregunta.
    completo: bloqueo === null,
    faltaParaOperar: bloqueo,
    dte: {
      estado: estadoDte,
      proveedorElegido: proveedorDte,
      certificadoVenceEn,
      camposEmisorFaltantes,
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
    bodegas: { cantidad: cantidadBodegas, hayPrincipal },
    conductores: { cantidad: cantidadConductores },
    sellers: { cantidad: cantidadSellers },
    periodos: {
      tipoPeriodo: periodicidad.tipoPeriodo,
      explicita: periodicidad.explicita,
    },
    datosCobro: {
      configurado: datosCobroConfigurado,
      banco: (datosCobroRes.data?.banco as string | undefined) ?? null,
    },
    retencion: {
      configurada: porcentajeRetencion !== null,
      porcentaje: porcentajeRetencion,
    },
    retiro: { montoVisitaClp },
    zonas: { cantidad: cantidadZonas },
    contacto: { telefono: telefonoContacto, email: emailContacto },
  };
}
