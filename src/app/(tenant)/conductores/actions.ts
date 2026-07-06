"use server";

/**
 * Server Actions — Configuración de conductores (F6, ítem 1.3).
 *
 * Permite al coordinador/supervisor gestionar:
 *   - Disponibilidad (toggle disponible/no-disponible).
 *   - Capacidad de paradas (cupo máximo del turno).
 *   - Zonas preferentes (multiselect contra listarZonas del tenant).
 *
 * RBAC: `asignar_y_reasignar_pedidos` (misma capacidad que el auto-assign,
 * ya que configurar el pool es la preparación previa a esa operación).
 *
 * `actorUsuarioId` siempre se obtiene de la sesión (UUID de auth) — RNF-04.
 */

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  puedeAsignarYReasignarPedidos,
  puedeGestionarLiquidacionesConductores,
} from "@/modules/identidad/capacidades";
import {
  listarConductores,
  listarZonasConductor,
  actualizarDisponibilidadConductor,
  actualizarCapacidadConductor,
  actualizarZonasConductor,
  actualizarDatosBancariosConductor,
} from "@/modules/operacion/conductores";
import { listarZonas } from "@/modules/operacion/zonas";
import type { Conductor, ConductorZona, Zona } from "@/modules/operacion/tipos";

// =============================================================================
// Tipos de respuesta
// =============================================================================

type RespuestaOk<T> = { ok: true; datos: T };
type RespuestaError = { ok: false; mensaje: string };
type Respuesta<T> = RespuestaOk<T> | RespuestaError;

// =============================================================================
// Estado inicial de la pantalla de conductores
// =============================================================================

export interface EstadoConductores {
  conductores: Conductor[];
  zonas: Zona[];
}

/** Carga el estado inicial: lista de conductores y zonas del tenant. */
export async function obtenerEstadoConductores(): Promise<Respuesta<EstadoConductores>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para ver la configuración de conductores." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const tenantId = sesion.usuario.tenantId;

    const [conductores, zonas] = await Promise.all([
      listarConductores(cliente, tenantId),
      listarZonas(cliente, tenantId),
    ]);

    return { ok: true, datos: { conductores, zonas } };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error al cargar los conductores.";
    return { ok: false, mensaje };
  }
}

// =============================================================================
// Zonas del conductor
// =============================================================================

/** Devuelve las zonas preferentes actuales de un conductor. */
export async function obtenerZonasConductor(
  conductorId: string,
): Promise<Respuesta<ConductorZona[]>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const zonas = await listarZonasConductor(
      cliente,
      sesion.usuario.tenantId,
      conductorId,
    );
    return { ok: true, datos: zonas };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error al obtener las zonas del conductor.";
    return { ok: false, mensaje };
  }
}

// =============================================================================
// Actualizar disponibilidad
// =============================================================================

export async function actionToggleDisponibilidadConductor(
  conductorId: string,
  disponible: boolean,
): Promise<Respuesta<Conductor>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return {
      ok: false,
      mensaje: "No tienes permiso para modificar la disponibilidad de conductores.",
    };
  }

  try {
    const cliente = crearClienteServiceRole();
    const conductor = await actualizarDisponibilidadConductor(
      cliente,
      sesion.usuario.tenantId,
      conductorId,
      disponible,
      sesion.usuarioId,
      sesion.usuario,
    );
    revalidatePath("/conductores");
    revalidatePath("/manifiestos");
    return { ok: true, datos: conductor };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error al actualizar la disponibilidad.";
    return { ok: false, mensaje };
  }
}

// =============================================================================
// Actualizar capacidad
// =============================================================================

export async function actionActualizarCapacidadConductor(
  conductorId: string,
  capacidadParadas: number,
): Promise<Respuesta<Conductor>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return {
      ok: false,
      mensaje: "No tienes permiso para modificar la capacidad de conductores.",
    };
  }

  try {
    const cliente = crearClienteServiceRole();
    const conductor = await actualizarCapacidadConductor(
      cliente,
      sesion.usuario.tenantId,
      conductorId,
      capacidadParadas,
      sesion.usuarioId,
      sesion.usuario,
    );
    revalidatePath("/conductores");
    return { ok: true, datos: conductor };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error al actualizar la capacidad.";
    return { ok: false, mensaje };
  }
}

// =============================================================================
// Actualizar zonas preferentes
// =============================================================================

export async function actionActualizarZonasConductor(
  conductorId: string,
  zonaIds: string[],
): Promise<Respuesta<ConductorZona[]>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return {
      ok: false,
      mensaje: "No tienes permiso para modificar las zonas de conductores.",
    };
  }

  try {
    const cliente = crearClienteServiceRole();
    const zonas = await actualizarZonasConductor(
      cliente,
      sesion.usuario.tenantId,
      conductorId,
      zonaIds,
      sesion.usuarioId,
      sesion.usuario,
    );
    revalidatePath("/conductores");
    return { ok: true, datos: zonas };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error al actualizar las zonas del conductor.";
    return { ok: false, mensaje };
  }
}

// =============================================================================
// Actualizar datos bancarios
// =============================================================================

const TIPOS_CUENTA_VALIDOS = ["corriente", "vista", "ahorro"] as const;
type TipoCuentaValido = (typeof TIPOS_CUENTA_VALIDOS)[number];

/**
 * Guarda los datos bancarios del conductor (banco, tipo_cuenta, numero_cuenta).
 *
 * RBAC: `gestionar_liquidaciones_conductores` — gate financiero, DISTINTO
 * del gate operativo `asignar_y_reasignar_pedidos` que protege el resto del panel.
 */
export async function actionActualizarDatosBancarios(
  conductorId: string,
  datos: { banco: string; tipoCuenta: string; numeroCuenta: string },
): Promise<Respuesta<Conductor>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  if (!puedeGestionarLiquidacionesConductores(sesion.usuario)) {
    return {
      ok: false,
      mensaje: "No tienes permiso para modificar los datos bancarios de conductores.",
    };
  }

  // Validación de campos
  const banco = datos.banco.trim();
  const numeroCuenta = datos.numeroCuenta.trim();
  const tipoCuenta = datos.tipoCuenta.trim();

  if (!banco || banco.length < 2) {
    return { ok: false, mensaje: "El nombre del banco debe tener al menos 2 caracteres." };
  }

  if (!TIPOS_CUENTA_VALIDOS.includes(tipoCuenta as TipoCuentaValido)) {
    return { ok: false, mensaje: "Tipo de cuenta no válido. Use: corriente, vista o ahorro." };
  }

  if (!numeroCuenta || numeroCuenta.length < 4) {
    return { ok: false, mensaje: "El número de cuenta debe tener al menos 4 caracteres." };
  }

  if (!/^\d+$/.test(numeroCuenta)) {
    return { ok: false, mensaje: "El número de cuenta debe contener solo dígitos." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const conductor = await actualizarDatosBancariosConductor(
      cliente,
      sesion.usuario.tenantId,
      conductorId,
      {
        banco,
        tipo_cuenta: tipoCuenta as TipoCuentaValido,
        numero_cuenta: numeroCuenta,
      },
      sesion.usuarioId,
      sesion.usuario,
    );
    revalidatePath("/conductores");
    return { ok: true, datos: conductor };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error al actualizar los datos bancarios.";
    return { ok: false, mensaje };
  }
}
