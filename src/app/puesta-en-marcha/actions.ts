"use server";

/**
 * Server Actions de la puesta en marcha v2 (docs/ux/puesta-en-marcha-v2.md §3, §6).
 * =============================================================================
 *
 * Solo el DUEÑO ejecuta estas acciones (§8: otro rol interno no puede completar
 * la puesta en marcha). La UI ya lo esconde; ESTO es lo que lo impone.
 *
 * Reglas que se cumplen aquí y no hay que perder:
 *
 *   · **Bitácora con autor.** Cada acción deja su entrada con `actorUsuarioId`.
 *     La de completar se escribe ANTES de marcar la fila (CLAUDE.md: la
 *     auditoría queda completa aunque el paso siguiente falle).
 *
 *   · **La fila de `courier_config_operacion` se escribe con la SESIÓN del
 *     usuario**, no con service_role, a propósito: así las políticas RLS y el
 *     trigger que solo deja completar al dueño son una segunda pared. Con
 *     service_role ese trigger se saltaría.
 *
 *   · **La fila nace en el paso 3** (migración 20260928000003): un courier nuevo
 *     no tiene fila, y los pasos 1 y 2 se derivan de sus propios datos, no de un
 *     contador. Por eso `puesta_en_marcha_paso` solo se persiste desde el paso 3.
 *
 *   · **Geocodificar para previsualizar NO escribe** (H8). El caché global de
 *     geocoding es de referencia, sin datos del courier.
 */

import { revalidatePath } from "next/cache";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import { registrarLegadasPorCerrar } from "@/modules/identidad/tarifas-legadas";
import { leerEstadoPuestaEnMarcha } from "@/modules/identidad/puesta-en-marcha";
import {
  resolverCoordenadaConCache,
  TIMEOUT_GEOCODING_SINCRONO_MS,
} from "@/modules/integraciones/geocoding";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import {
  accionCrearBodegaCourier,
  accionEditarBodegaCourier,
} from "@/app/(tenant)/configuracion/bodegas/actions";
import { dentroDeLaRegion } from "./region";
import { normalizarHoraSantiago, validarHorario } from "./horario";
import { validarTelefonoCl } from "./telefono";
import {
  plataformasEncendidas,
  validarEntradaServidor,
  type EntradaGuardarPaso4,
} from "./zonas-tarifas";

export type Resultado = { ok: true } | { ok: false; mensaje: string; campo?: string };

export type ResultadoCompletar =
  | { ok: true }
  | { ok: false; mensaje: string; paso?: number };

async function exigirDueno(): Promise<
  { ok: true; tenantId: string; usuarioId: string } | { ok: false; mensaje: string }
> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No hay una sesión activa." };
  const u = sesion.usuario;
  if (u.tipoUsuario !== "interno" || u.estado !== "activo" || u.rol !== "dueno") {
    return { ok: false, mensaje: "Solo el dueño puede configurar la cuenta." };
  }
  return { ok: true, tenantId: u.tenantId as string, usuarioId: sesion.usuarioId };
}

function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === "string" ? valor.trim() : "";
}

// =============================================================================
// Paso 1 — Tu empresa
// =============================================================================

export async function guardarPasoEmpresa(formData: FormData): Promise<Resultado> {
  const g = await exigirDueno();
  if (!g.ok) return g;

  const nombre = texto(formData.get("nombre_comercial"));
  const email = texto(formData.get("email_contacto")).toLowerCase();
  const telefono = validarTelefonoCl(texto(formData.get("telefono_contacto")));

  if (!nombre) return { ok: false, mensaje: "Obligatorio.", campo: "nombre_comercial" };
  if (!telefono) return { ok: false, mensaje: "Ingresa 9 dígitos.", campo: "telefono_contacto" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, mensaje: "Correo inválido.", campo: "email_contacto" };
  }

  try {
    const cliente = crearClienteServiceRole();
    const { error } = await cliente
      .schema("identidad")
      .from("tenants")
      .update({ nombre_fantasia: nombre, telefono_contacto: telefono, email_contacto: email })
      .eq("id", g.tenantId);
    if (error) throw new Error(error.message);

    await registrarEnBitacora(cliente, {
      tenantId: g.tenantId,
      actorUsuarioId: g.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.contacto_publico_actualizado",
      entidadTipo: "tenant",
      entidadId: g.tenantId,
      detalle: { nombre_fantasia: nombre, telefono_contacto: telefono, email_contacto: email },
    });
    return { ok: true };
  } catch {
    return { ok: false, mensaje: "No pudimos guardar. Reintenta." };
  }
}

// =============================================================================
// Paso 2 — Tu bodega
// =============================================================================

export type ResultadoUbicacion =
  | { estado: "resuelto"; lat: number; long: number }
  | { estado: "no_resuelto" }
  | { estado: "fuera_de_region" }
  | { estado: "error" };

/** Previsualiza la ubicación de una dirección. NO escribe nada del courier. */
export async function previsualizarUbicacion(
  direccion: string,
  comuna: string,
): Promise<ResultadoUbicacion> {
  const g = await exigirDueno();
  if (!g.ok) return { estado: "error" };

  const dir = String(direccion ?? "").trim();
  if (!dir || dir.length > 200 || !(COMUNAS_RM as readonly string[]).includes(comuna)) {
    return { estado: "no_resuelto" };
  }

  try {
    const r = await resolverCoordenadaConCache({
      direccion: dir,
      comuna,
      timeoutMs: TIMEOUT_GEOCODING_SINCRONO_MS,
    });
    if (!r.resuelto || r.lat == null || r.long == null) return { estado: "no_resuelto" };
    if (!dentroDeLaRegion(r.lat, r.long)) return { estado: "fuera_de_region" };
    return { estado: "resuelto", lat: r.lat, long: r.long };
  } catch (err) {
    console.error("[puesta-en-marcha] previsualizar ubicación falló:", err);
    return { estado: "error" };
  }
}

/**
 * Confirma la bodega principal. La coordenada viene SIEMPRE del pin (el que
 * devolvió `previsualizarUbicacion`, o el que la persona puso a mano): por eso
 * queda `resuelto` con confianza 1 y el paso 2 exige `geo_estado = 'resuelto'`.
 *
 * Reusa `accionCrearBodegaCourier` / `accionEditarBodegaCourier`: comparten
 * guardia RBAC, geocoding y bitácora con `/configuracion/bodegas`. Si ya hay
 * una principal activa (el dueño volvió al paso 2), la edita en vez de crear una
 * segunda.
 */
export async function guardarPasoBodega(entrada: {
  direccion: string;
  comuna: string;
  lat: number;
  long: number;
}): Promise<Resultado> {
  const g = await exigirDueno();
  if (!g.ok) return g;

  const direccion = String(entrada.direccion ?? "").trim();
  const comuna = String(entrada.comuna ?? "");
  if (!direccion) return { ok: false, mensaje: "Obligatorio.", campo: "direccion" };
  if (!(COMUNAS_RM as readonly string[]).includes(comuna)) {
    return { ok: false, mensaje: "Obligatorio.", campo: "comuna" };
  }
  if (!Number.isFinite(entrada.lat) || !Number.isFinite(entrada.long)) {
    return { ok: false, mensaje: "No pudimos ubicarla. Reintenta o toca el mapa." };
  }
  if (!dentroDeLaRegion(entrada.lat, entrada.long)) {
    return { ok: false, mensaje: "Esa dirección está fuera de la Región Metropolitana." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const { data: existente, error } = await cliente
      .schema("identidad")
      .from("courier_bodegas")
      .select("id, nombre")
      .eq("tenant_id", g.tenantId)
      .eq("activa", true)
      .eq("es_principal", true)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const fd = new FormData();
    fd.set("nombre", (existente?.nombre as string | undefined) ?? "Bodega principal");
    fd.set("direccion", direccion);
    fd.set("comuna", comuna);
    fd.set("es_principal", "true");
    fd.set("lat", String(entrada.lat));
    fd.set("long", String(entrada.long));

    const r = existente
      ? await accionEditarBodegaCourier(existente.id as string, fd)
      : await accionCrearBodegaCourier(fd);
    if (!r.ok) return { ok: false, mensaje: "No pudimos guardar. Reintenta." };
    return { ok: true };
  } catch {
    return { ok: false, mensaje: "No pudimos guardar. Reintenta." };
  }
}

// =============================================================================
// Paso 3 — Tu operación
// =============================================================================

export async function guardarPasoOperacion(entrada: {
  ofreceFlex: boolean;
  ofreceShopify: boolean;
  horaSalida: string;
  horaCorte: string;
}): Promise<Resultado> {
  const g = await exigirDueno();
  if (!g.ok) return g;

  const salida = normalizarHoraSantiago(entrada.horaSalida);
  const corte = normalizarHoraSantiago(entrada.horaCorte);
  const horario = validarHorario(salida, corte);
  if (!horario.ok) return { ok: false, mensaje: horario.mensaje, campo: horario.campo };

  try {
    const sesionDb = await createClient();

    // El paso guardado nunca retrocede: volver al 3 desde el 4 no borra que el
    // 4 se alcanzó.
    const { data: previa, error: errorLectura } = await sesionDb
      .schema("identidad")
      .from("courier_config_operacion")
      .select("puesta_en_marcha_paso")
      .eq("tenant_id", g.tenantId)
      .maybeSingle();
    if (errorLectura) throw new Error(errorLectura.message);
    const paso = Math.max(3, (previa?.puesta_en_marcha_paso as number | null) ?? 0);

    // SELECT → INSERT o UPDATE, nunca upsert: PostgREST escribe TODAS las
    // columnas del payload también en el UPDATE, y `tenant_id` está fuera del
    // grant de UPDATE a propósito (42501 "permission denied").
    const valores = {
      ofrece_flex: entrada.ofreceFlex === true,
      ofrece_shopify: entrada.ofreceShopify === true,
      hora_salida_reparto: salida,
      hora_corte_reparto: corte,
      puesta_en_marcha_paso: paso,
    };
    const { error } = previa
      ? await sesionDb
          .schema("identidad")
          .from("courier_config_operacion")
          .update(valores)
          .eq("tenant_id", g.tenantId)
      : await sesionDb
          .schema("identidad")
          .from("courier_config_operacion")
          .insert({ tenant_id: g.tenantId, ...valores });
    if (error) throw new Error(error.message);

    await registrarEnBitacora(crearClienteServiceRole(), {
      tenantId: g.tenantId,
      actorUsuarioId: g.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.operacion_configurada",
      entidadTipo: "tenant",
      entidadId: g.tenantId,
      detalle: {
        ofrece_flex: entrada.ofreceFlex === true,
        ofrece_shopify: entrada.ofreceShopify === true,
        hora_salida_reparto: salida,
        hora_corte_reparto: corte,
      },
    });
    return { ok: true };
  } catch (err) {
    console.error("[puesta-en-marcha] guardar operación falló:", err);
    return { ok: false, mensaje: "No pudimos guardar. Reintenta." };
  }
}

// =============================================================================
// Paso 4 — Zonas y tarifas
// =============================================================================

/**
 * `Continuar` del paso 4: guarda zonas, comunas y tarifas y avanza el paso, todo
 * en UNA transacción (`identidad.guardar_zonas_y_tarifas_puesta_en_marcha`,
 * migración 20260928000004). La regla de re-guardado (nunca editar montos de una
 * tarifa existente; se versionan) vive en esa función y está explicada en su
 * cabecera.
 *
 * Orden (no negociable): 1) validar, 2) BITÁCORA con autor, 3) escribir. Los
 * montos son NETOS, sin IVA (§14 Q3).
 *
 * ⚠️ La RPC corre con service_role a propósito (decidir si una tarifa ya fue
 * usada exige leer dinero.lineas_cobro, vedada a `authenticated`): por eso el
 * guardia de dueño de arriba es lo que impone el permiso, y por eso el tenant y
 * las plataformas permitidas salen del servidor, nunca del cliente.
 */
export async function guardarPasoTarifas(entrada: EntradaGuardarPaso4): Promise<Resultado> {
  const g = await exigirDueno();
  if (!g.ok) return g;

  const servicio = crearClienteServiceRole();

  try {
    const { data: config, error: errorConfig } = await servicio
      .schema("identidad")
      .from("courier_config_operacion")
      .select("ofrece_flex, ofrece_shopify")
      .eq("tenant_id", g.tenantId)
      .maybeSingle();
    if (errorConfig || !config) throw new Error(errorConfig?.message ?? "Sin configuración de operación.");

    const permitidas = plataformasEncendidas({
      ofreceFlex: config.ofrece_flex === true,
      ofreceShopify: config.ofrece_shopify === true,
    });
    const invalido = validarEntradaServidor(entrada, permitidas);
    if (invalido) return { ok: false, mensaje: invalido.mensaje, campo: invalido.campo };

    const hoy = hoyEnSantiago();
    const zonas = [
      { ...entrada.zona1, esRespaldo: false },
      { ...entrada.zona2, esRespaldo: true },
    ];

    await registrarEnBitacora(servicio, {
      tenantId: g.tenantId,
      actorUsuarioId: g.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.zonas_y_tarifas_configuradas",
      entidadTipo: "tenant",
      entidadId: g.tenantId,
      detalle: {
        vigente_desde: hoy,
        base_montos: "neto_sin_iva",
        zonas: zonas.map((z) => ({
          zona_id: z.id,
          nombre: z.nombre,
          es_respaldo: z.esRespaldo,
          comunas: z.comunas.length,
          cobro_clp: z.cobro,
          pago_conductor_clp: z.pago,
          excepciones: z.excepciones.map((e) => ({
            fuente: e.fuente,
            cobro_clp: e.cobro,
            pago_conductor_clp: e.pago,
          })),
        })),
      },
    });

    // Las legadas del tenant las cierra la propia RPC (misma transacción); su
    // bitácora, con los ids candidatos, va antes del efecto igual que la anterior.
    await registrarLegadasPorCerrar(servicio, {
      tenantId: g.tenantId,
      actorUsuarioId: g.usuarioId,
      hoy,
    });

    const { error } = await servicio.schema("identidad").rpc("guardar_zonas_y_tarifas_puesta_en_marcha", {
      p_tenant_id: g.tenantId,
      p_hoy: hoy,
      p_zonas: zonas.map((z) => ({
        id: z.id,
        nombre: z.nombre,
        es_respaldo: z.esRespaldo,
        comunas: z.comunas,
        cobro_clp: z.cobro,
        pago_clp: z.pago,
        excepciones: z.excepciones.map((e) => ({
          fuente: e.fuente,
          cobro_clp: e.cobro,
          pago_clp: e.pago,
        })),
      })),
    });
    if (error) throw new Error(`${error.code ?? ""} ${error.message}`);
    return { ok: true };
  } catch (err) {
    console.error("[puesta-en-marcha] guardar zonas y tarifas falló:", err);
    return { ok: false, mensaje: "No pudimos guardar. Reintenta." };
  }
}

// =============================================================================
// Cierre — Entrar
// =============================================================================

/**
 * Valida los cuatro pasos y marca la puesta en marcha como completada.
 *
 * Orden (no negociable): 1) leer y validar, 2) BITÁCORA con autor, 3) marcar. El
 * trigger de la base fija el instante y el autor (`now()`, `auth.uid()`) e
 * ignora lo que mande el cliente; solo deja pasar al dueño.
 */
export async function completarPuestaEnMarcha(): Promise<ResultadoCompletar> {
  const g = await exigirDueno();
  if (!g.ok) return g;

  const servicio = crearClienteServiceRole();
  const estado = await leerEstadoPuestaEnMarcha(servicio, g.tenantId);
  if (!estado.leido) return { ok: false, mensaje: "No pudimos guardar. Reintenta." };
  if (estado.completada) return { ok: true };
  if (!estado.todosLosPasosCompletos) {
    return {
      ok: false,
      mensaje: "Falta completar un paso.",
      paso: estado.primerPasoIncompleto ?? 1,
    };
  }

  try {
    await registrarEnBitacora(servicio, {
      tenantId: g.tenantId,
      actorUsuarioId: g.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.puesta_en_marcha_completada",
      entidadTipo: "tenant",
      entidadId: g.tenantId,
      detalle: { pasos: estado.pasos },
    });

    const sesionDb = await createClient();
    const { data, error } = await sesionDb
      .schema("identidad")
      .from("courier_config_operacion")
      .update({
        puesta_en_marcha_paso: 4,
        // El trigger las reescribe (now(), auth.uid()); van para que el UPDATE
        // las declare como cambiadas.
        puesta_en_marcha_completada_en: new Date().toISOString(),
        puesta_en_marcha_completada_por: g.usuarioId,
      })
      .eq("tenant_id", g.tenantId)
      .is("puesta_en_marcha_completada_en", null)
      .select("tenant_id");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("La fila no se actualizó.");

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("[puesta-en-marcha] completar falló:", err);
    return { ok: false, mensaje: "No pudimos guardar. Reintenta." };
  }
}
