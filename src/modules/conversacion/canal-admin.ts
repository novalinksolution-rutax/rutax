/**
 * Superficie de lectura/escritura del canal de consulta por WhatsApp, PARA EL
 * BACKSTAGE (`/admin/whatsapp`). La consume `super_admin`, nunca el courier —
 * misma administración que el resto de WhatsApp (CLAUDE.md, sección WhatsApp).
 * =============================================================================
 * Migración: `20260920000002_integraciones_whatsapp_canal_consulta_config.sql`.
 * Doc de alcance: `docs/arquitectura/conversacion-whatsapp.md`.
 *
 * No crea tablas nuevas (§4 del doc de alcance: la v1 no las necesita). Los
 * contadores de este archivo se leen de `integraciones.whatsapp_mensajes_entrantes`.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { leerConfigCanalConsulta, type ConfigCanalConsulta } from "./canal";
import type { MotivoNoRespondido } from "./motivo-no-respondido";

// =============================================================================
// 1. Leer
// =============================================================================

/** Espejo de `ConfigCanalConsulta` más los campos de conveniencia del backstage. */
export interface ConfigCanalConsultaAdmin extends ConfigCanalConsulta {
  actualizadoPor: string | null;
  actualizadoEn: string | null;
  nota: string | null;
}

/**
 * Lee la config vía la misma función fail-closed que usa el job — no se lee
 * la tabla directo para no duplicar la lógica de "sin fila = apagado". Los
 * campos de conveniencia (`actualizado_por/en`, `nota`) SÍ requieren tocar la
 * tabla, porque la función RPC no los expone.
 */
export async function obtenerConfigCanalConsulta(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<ConfigCanalConsultaAdmin> {
  const base = await leerConfigCanalConsulta(cliente, tenantId);

  const { data, error } = await cliente
    .schema("integraciones")
    .from("whatsapp_canal_consulta_config")
    .select("actualizado_por, actualizado_en, nota")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ actualizado_por: string | null; actualizado_en: string | null; nota: string | null }>();

  if (error) {
    throw new Error(`No se pudo leer los metadatos del canal de WhatsApp: ${error.message}`);
  }

  return {
    ...base,
    actualizadoPor: data?.actualizado_por ?? null,
    actualizadoEn: data?.actualizado_en ?? null,
    nota: data?.nota ?? null,
  };
}

// =============================================================================
// 2. Guardar
// =============================================================================

export interface GuardarConfigCanalConsultaEntrada {
  tenantId: string;
  actorUsuarioId: string;
  canalActivo: boolean;
  topeConsultasHora: number;
  topeIntentosSinMatchHora: number;
  nota: string | null;
}

export type ResultadoGuardarConfigCanal = { ok: true } | { ok: false; mensaje: string };

/**
 * Escribe la configuración del canal, con bitácora ANTES del efecto (regla
 * dura del proyecto): si el UPSERT falla después, sobra una entrada de
 * bitácora; al revés faltaría constancia de que un super_admin encendió o
 * apagó el canal de un courier.
 *
 * ⚠️ Los rangos de los topes los impone el CHECK de la migración (1–200 y
 * 1–100, y el segundo no puede superar al primero): un valor fuera de rango
 * se rechaza acá con el mismo mensaje que produciría el 23514, para no
 * depender de leer el error de Postgres en la pantalla.
 */
export async function guardarConfigCanalConsulta(
  cliente: SupabaseClient,
  entrada: GuardarConfigCanalConsultaEntrada,
): Promise<ResultadoGuardarConfigCanal> {
  if (entrada.topeConsultasHora < 1 || entrada.topeConsultasHora > 200) {
    return { ok: false, mensaje: "El tope de consultas por hora debe estar entre 1 y 200." };
  }
  if (entrada.topeIntentosSinMatchHora < 1 || entrada.topeIntentosSinMatchHora > 100) {
    return { ok: false, mensaje: "El tope de intentos sin match debe estar entre 1 y 100." };
  }
  if (entrada.topeIntentosSinMatchHora > entrada.topeConsultasHora) {
    return { ok: false, mensaje: "El tope de intentos sin match no puede superar al tope general." };
  }
  if (entrada.nota !== null && entrada.nota.length > 500) {
    return { ok: false, mensaje: "La nota no puede pasar de 500 caracteres." };
  }

  const anterior = await obtenerConfigCanalConsulta(cliente, entrada.tenantId);

  await registrarEnBitacora(cliente, {
    tenantId: entrada.tenantId,
    actorUsuarioId: entrada.actorUsuarioId,
    actorTipo: "super_admin",
    accion: "conversacion.canal_config_actualizado",
    entidadTipo: "whatsapp_canal_consulta_config",
    entidadId: entrada.tenantId,
    detalle: {
      canal_activo_anterior: anterior.canalActivo,
      canal_activo_nuevo: entrada.canalActivo,
      tope_consultas_hora_anterior: anterior.topeConsultasHora,
      tope_consultas_hora_nuevo: entrada.topeConsultasHora,
      tope_intentos_sin_match_hora_anterior: anterior.topeIntentosSinMatchHora,
      tope_intentos_sin_match_hora_nuevo: entrada.topeIntentosSinMatchHora,
    },
  });

  const ahora = new Date().toISOString();

  // Upsert manual (no `.upsert()`): `tenant_id` es la PK y el patrón del
  // resto del backstage de WhatsApp es "insert si no existe, update si sí",
  // para que quede explícito cuál de los dos ocurrió si algo falla.
  const { error } = await cliente
    .schema("integraciones")
    .from("whatsapp_canal_consulta_config")
    .upsert(
      {
        tenant_id: entrada.tenantId,
        canal_activo: entrada.canalActivo,
        tope_consultas_hora: entrada.topeConsultasHora,
        tope_intentos_sin_match_hora: entrada.topeIntentosSinMatchHora,
        actualizado_por: entrada.actorUsuarioId,
        actualizado_en: ahora,
        nota: entrada.nota,
      },
      { onConflict: "tenant_id" },
    );

  if (error) {
    return { ok: false, mensaje: "No se pudo guardar la configuración del canal." };
  }

  return { ok: true };
}

// =============================================================================
// 3. Contadores del canal, por courier y por día
// =============================================================================
//
// Basados en `motivo_no_respondido` (migración `20260920000003`): cada
// compuerta escribe el suyo, así que "canal apagado", "tope de consultas" y
// "barrido de códigos" son tres números exactos, no un total mezclado ni un
// techo. `pendientes` (`motivo_no_respondido is null` en una fila ya con
// `resolucion`) es el job caído a mitad de camino — no debería crecer.

export interface ContadoresCanalConsultaPorCourier {
  /** `motivo_no_respondido = 'respondido'` — se armó y se despachó una respuesta. */
  respondidas: number;
  /** `motivo_no_respondido = 'canal_apagado'` (§3). */
  cortadasPorCanalApagado: number;
  /** `motivo_no_respondido = 'tope_consultas'` (§9). */
  cortadasPorTopeConsultas: number;
  /** `motivo_no_respondido = 'barrido_codigos'` (§6.1) — número exacto, no techo. */
  cortadasPorBarrido: number;
  /**
   * Señal de presión, distinta del corte: TODO intento `flex_manual` sin
   * match, haya cortado el canal o no. Antes se llamaba
   * `intentosFlexManualSinMatch` y hacía de techo de "cortes"; ahora que el
   * corte tiene su propio número exacto (`cortadasPorBarrido`), esta cifra
   * mide otra cosa — cuánto sondeo numérico está llegando.
   */
  sondeosNumericosSinMatch: number;
  /** `motivo_no_respondido is null` en una fila ya resuelta — el job murió a mitad. */
  pendientes: number;
}

/**
 * Cuenta los mensajes entrantes de un courier resuelto, en `[desde, hasta)`.
 * El llamador decide el rango en la zona horaria que corresponda (Santiago),
 * igual que el resto de contadores del repo — acá no se asume "hoy".
 */
export async function contadoresCanalConsultaPorCourier(
  cliente: SupabaseClient,
  tenantId: string,
  desde: Date,
  hasta: Date,
): Promise<ContadoresCanalConsultaPorCourier> {
  const base = () =>
    cliente
      .schema("integraciones")
      .from("whatsapp_mensajes_entrantes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("recibido_en", desde.toISOString())
      .lt("recibido_en", hasta.toISOString());

  const porMotivo = (motivo: MotivoNoRespondido) => base().eq("motivo_no_respondido", motivo);

  const [respondidas, canalApagado, topeConsultas, barrido, sondeos, pendientes] = await Promise.all([
    porMotivo("respondido"),
    porMotivo("canal_apagado"),
    porMotivo("tope_consultas"),
    porMotivo("barrido_codigos"),
    base().eq("clasificacion", "flex_manual").eq("hubo_match", false),
    base().eq("resolucion", "resuelto").is("motivo_no_respondido", null),
  ]);

  return {
    respondidas: contarSeguro(respondidas),
    cortadasPorCanalApagado: contarSeguro(canalApagado),
    cortadasPorTopeConsultas: contarSeguro(topeConsultas),
    cortadasPorBarrido: contarSeguro(barrido),
    sondeosNumericosSinMatch: contarSeguro(sondeos),
    pendientes: contarSeguro(pendientes),
  };
}

export interface ContadoresCanalConsultaGlobales {
  /** `resolucion = 'ambiguo'` — §5.1: más de un contacto, ninguna quedó sin contar. */
  contactosAmbiguos: number;
  /** `resolucion = 'sin_contacto'`. */
  sinContacto: number;
  /** `resolucion = 'ilegible'`. */
  ilegibles: number;
  /** `motivo_no_respondido = 'sin_alcance'` — sin tenant, no atribuible a un courier. */
  sinAlcance: number;
  /** `motivo_no_respondido = 'aviso_neutro_omitido'` — ya se avisó en las últimas 24 h. */
  avisoNeutroOmitido: number;
  /** `motivo_no_respondido = 'respondido'` en filas sin tenant — el aviso neutro sí salió. */
  respondidasSinTenant: number;
}

/**
 * `ambiguo`, `sin_contacto` e `ilegible` se guardan SIEMPRE SIN `tenant_id`
 * (el CHECK `whatsapp_entrantes_tenant_segun_resolucion` lo exige: no hay
 * tenant hasta que la identidad se resuelve). No se pueden atribuir a UN
 * courier — son del número de Rutax en su conjunto — así que estos contadores
 * son GLOBALES, no por courier, y por eso viven en una función aparte que NO
 * recibe `tenantId`. §5.1 pide explícitamente que la anomalía "ambiguo" quede
 * contada en algún lado del backstage; el resto acompaña por consistencia de
 * la pantalla. El desglose por `motivo_no_respondido` de las filas sin tenant
 * usa el índice `idx_whatsapp_entrantes_motivo_global`.
 */
export async function contadoresCanalConsultaGlobales(
  cliente: SupabaseClient,
  desde: Date,
  hasta: Date,
): Promise<ContadoresCanalConsultaGlobales> {
  const contar = (resolucion: "ambiguo" | "sin_contacto" | "ilegible") =>
    cliente
      .schema("integraciones")
      .from("whatsapp_mensajes_entrantes")
      .select("id", { count: "exact", head: true })
      .eq("resolucion", resolucion)
      .gte("recibido_en", desde.toISOString())
      .lt("recibido_en", hasta.toISOString());

  const porMotivoSinTenant = (motivo: MotivoNoRespondido) =>
    cliente
      .schema("integraciones")
      .from("whatsapp_mensajes_entrantes")
      .select("id", { count: "exact", head: true })
      .is("tenant_id", null)
      .eq("motivo_no_respondido", motivo)
      .gte("recibido_en", desde.toISOString())
      .lt("recibido_en", hasta.toISOString());

  const [ambiguos, sinContacto, ilegibles, sinAlcance, avisoOmitido, respondidasSinTenant] = await Promise.all([
    contar("ambiguo"),
    contar("sin_contacto"),
    contar("ilegible"),
    porMotivoSinTenant("sin_alcance"),
    porMotivoSinTenant("aviso_neutro_omitido"),
    porMotivoSinTenant("respondido"),
  ]);

  return {
    contactosAmbiguos: contarSeguro(ambiguos),
    sinContacto: contarSeguro(sinContacto),
    ilegibles: contarSeguro(ilegibles),
    sinAlcance: contarSeguro(sinAlcance),
    avisoNeutroOmitido: contarSeguro(avisoOmitido),
    respondidasSinTenant: contarSeguro(respondidasSinTenant),
  };
}

function contarSeguro(resultado: { count: number | null; error: { message: string } | null }): number {
  if (resultado.error) {
    throw new Error(`No se pudieron contar los mensajes de WhatsApp: ${resultado.error.message}`);
  }
  return resultado.count ?? 0;
}

// =============================================================================
// 4. Panel — composición para `/admin/whatsapp`
// =============================================================================

export interface FilaCanalConsultaCourier {
  tenantId: string;
  nombreCourier: string;
  config: ConfigCanalConsultaAdmin;
  contadores: ContadoresCanalConsultaPorCourier;
}

export interface PanelCanalConsulta {
  couriers: FilaCanalConsultaCourier[];
  globales: ContadoresCanalConsultaGlobales;
}

/**
 * Compone la config + los contadores de cada courier, más los tres contadores
 * globales, en las llamadas mínimas necesarias.
 *
 * Recibe la lista de couriers ya armada (tenantId + nombre) en vez de leerla
 * de `plataforma` acá adentro: este módulo no depende de `plataforma`, y el
 * catálogo de couriers-con-suscripción ya lo arma `obtenerTodasSuscripciones`
 * — quien llama (la página del backstage) hace esa composición.
 */
export async function obtenerPanelCanalConsulta(
  cliente: SupabaseClient,
  couriers: Array<{ tenantId: string; nombreCourier: string }>,
  desde: Date,
  hasta: Date,
): Promise<PanelCanalConsulta> {
  const [filas, globales] = await Promise.all([
    Promise.all(
      couriers.map(async (c) => {
        const [config, contadores] = await Promise.all([
          obtenerConfigCanalConsulta(cliente, c.tenantId),
          contadoresCanalConsultaPorCourier(cliente, c.tenantId, desde, hasta),
        ]);
        return { tenantId: c.tenantId, nombreCourier: c.nombreCourier, config, contadores };
      }),
    ),
    contadoresCanalConsultaGlobales(cliente, desde, hasta),
  ]);

  return { couriers: filas, globales };
}
