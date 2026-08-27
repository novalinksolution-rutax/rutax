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
import { normalizarTelefonoE164, type MotivoTelefonoInvalido } from "@/lib/telefono-cl";
import { createClient } from "@/lib/supabase/server";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  puedeAsignarYReasignarPedidos,
  puedeGestionarLiquidacionesConductores,
} from "@/modules/identidad/capacidades";
import {
  listarConductores,
  listarZonasConductor,
  actualizarCapacidadConductor,
  actualizarZonasConductor,
  actualizarDatosBancariosConductor,
  actualizarTelefonoConductor,
  actualizarVehiculoConductor,
  esVehiculoConductor,
  type VehiculoConductor,
  crearConductor,
  type DatosAltaConductor,
} from "@/modules/operacion/conductores";
import {
  desactivarConductor,
  reactivarConductor,
  type ConductorEnNomina,
} from "@/modules/operacion/conductores-nomina";
import { listarZonas } from "@/modules/operacion/zonas";
import { ahoraEnSantiago } from "@/lib/fecha-santiago";
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
// Actualizar disponibilidad — RETIRADA el 24-08-2026
// =============================================================================
//
// `actionToggleDisponibilidadConductor` vivía acá. Se retiró junto con su
// interruptor: `conductores.disponible` pasa a ser **solo del conductor**, que
// se marca desde su app (`PUT /api/conductor/disponibilidad`).
//
// No basta con sacar el botón. Una Server Action sin llamador sigue siendo un
// endpoint: cualquiera con el identificador de la acción puede invocarla, y el
// gate que tenía —`asignar_y_reasignar_pedidos`— la habría dejado disponible
// para todo coordinador. Quitar un control de la interfaz y dejar su acción
// viva es no haberlo quitado.
//
// Lo que la reemplaza, si un conductor no se marca: llamarlo. Está dicho en la
// pantalla, donde estaba el interruptor.

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

// =============================================================================
// Alta de conductor (F2 "Ola 1", ítem G) — chokepoint del gate `conductores_max`
// =============================================================================

/**
 * Resultado tipado del alta — distingue el bloqueo BLANDO de límite de plan
 * (accionable: CTA a `/configuracion/plan`) de cualquier otro error (RBAC,
 * formato, RUT duplicado). El dominio (`crearConductor`, `operacion/conductores.ts`)
 * ya hace esta distinción devolviendo `{ok:false, motivo:'limite_alcanzado'}` en
 * vez de lanzar — aquí solo se propaga tal cual y se homogeniza el resto de
 * errores (que SÍ llegan como excepción, p. ej. `ErrorValidacion`) al mismo shape.
 */
export type RespuestaCrearConductor =
  | { ok: true; conductor: Conductor }
  | { ok: false; motivo: "limite_alcanzado"; mensaje: string; usoActual: number; limite: number }
  | { ok: false; motivo: "error"; mensaje: string };

/**
 * Da de alta un conductor nuevo en el tenant. Pasa el cliente RLS de la sesión
 * (NO service_role) a propósito: `crearConductor` (operacion/conductores.ts)
 * documenta que el aislamiento de tenant en el INSERT lo impone la policy
 * `conductores_insert_interno` de la base de datos, no esta capa — coherente
 * con el resto de altas de `(tenant)` que pasan por RLS. Es la diferencia
 * deliberada con las otras acciones de este archivo, que van con service_role.
 *
 * OJO al "simplificar": la bitácora de esa alta NO se escribe con este cliente
 * —`crearConductor` trae el suyo de service_role—, porque `bitacora_auditoria`
 * es append-only y ningún rol de cliente tiene INSERT sobre ella. Pasar la
 * sesión también para auditar fue el bug de producción del 2026-08-11
 * ("permission denied for view bitacora_auditoria").
 */
export async function actionCrearConductor(formData: FormData): Promise<RespuestaCrearConductor> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, motivo: "error", mensaje: "No hay sesión activa." };
  }

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return {
      ok: false,
      motivo: "error",
      mensaje: "No tienes permiso para dar de alta conductores.",
    };
  }

  const nombreCompleto = String(formData.get("nombre_completo") ?? "").trim();
  const rut = String(formData.get("rut") ?? "").trim();
  const tipoRelacionRaw = String(formData.get("tipo_relacion") ?? "");
  const tipoRelacion: DatosAltaConductor["tipoRelacion"] =
    tipoRelacionRaw === "independiente" ? "independiente" : "dependiente";

  try {
    const cliente = await createClient();
    const resultado = await crearConductor(
      cliente,
      sesion.usuario.tenantId,
      { nombreCompleto, rut, tipoRelacion },
      sesion.usuarioId,
      sesion.usuario,
    );

    if (!resultado.ok) {
      return {
        ok: false,
        motivo: "limite_alcanzado",
        mensaje: resultado.mensaje,
        usoActual: resultado.usoActual,
        limite: resultado.limite,
      };
    }

    revalidatePath("/conductores");
    return { ok: true, conductor: resultado.conductor };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al crear el conductor.";
    return { ok: false, motivo: "error", mensaje };
  }
}

// =============================================================================
// Nómina — sacar y reincorporar
// =============================================================================

/**
 * Saca a un conductor de la nómina.
 *
 * ⚠️ Gate DISTINTO al del resto de esta pantalla: `gestionar_liquidaciones_
 * conductores` (dueño y administración), no `asignar_y_reasignar_pedidos`.
 * Decisión del usuario (23-08-2026): la baja tiene consecuencia de dinero y de
 * acceso, no es una decisión de terreno. El coordinador conserva «no disponible
 * hoy» y la redistribución, que es lo que necesita en la bodega.
 */
export async function actionSacarDeNomina(
  conductorId: string,
  motivo: string,
): Promise<Respuesta<ConductorEnNomina>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  if (!puedeGestionarLiquidacionesConductores(sesion.usuario)) {
    return {
      ok: false,
      mensaje: "Solo el dueño o administración pueden sacar a alguien de la nómina.",
    };
  }

  try {
    const conductor = await desactivarConductor(
      crearClienteServiceRole(),
      sesion.usuario.tenantId,
      conductorId,
      motivo,
      ahoraEnSantiago().fecha,
      sesion.usuarioId,
      sesion.usuario,
    );
    revalidatePath("/conductores");
    revalidatePath("/manifiestos");
    return { ok: true, datos: conductor };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al sacar de la nómina.",
    };
  }
}

/** Devuelve a un conductor a la nómina, no disponible. Mismo gate que la baja. */
export async function actionReincorporarANomina(
  conductorId: string,
): Promise<Respuesta<ConductorEnNomina>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  if (!puedeGestionarLiquidacionesConductores(sesion.usuario)) {
    return {
      ok: false,
      mensaje: "Solo el dueño o administración pueden reincorporar a alguien.",
    };
  }

  try {
    const conductor = await reactivarConductor(
      crearClienteServiceRole(),
      sesion.usuario.tenantId,
      conductorId,
      sesion.usuarioId,
      sesion.usuario,
    );
    revalidatePath("/conductores");
    return { ok: true, datos: conductor };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al reincorporar.",
    };
  }
}

// =============================================================================
// Teléfono de contacto
// =============================================================================

/** Textos propios: los de WhatsApp nombran a WhatsApp y acá no viene al caso. */
const MENSAJE_TELEFONO_CONDUCTOR: Record<MotivoTelefonoInvalido, string> = {
  vacio: "Escribe un teléfono, o deja el campo en blanco para quitarlo.",
  sin_digitos: "Eso no tiene ningún número.",
  demasiado_corto: "Faltan dígitos. Un móvil chileno son 9: 9 1234 5678.",
  demasiado_largo: "Sobran dígitos. Revisa si quedó repetido el código de país.",
  formato: "Revisa el número: no parece un teléfono válido.",
};

/**
 * Guarda el teléfono del conductor. Un campo vacío **lo borra**, a propósito:
 * es la única forma de corregir un número que ya no es de esa persona, y dejar
 * un teléfono ajeno guardado es peor que no tener ninguno.
 *
 * RBAC: `asignar_y_reasignar_pedidos` — el gate operativo, no el financiero.
 * El razonamiento está en `actualizarTelefonoConductor`.
 */
export async function actionActualizarTelefonoConductor(
  conductorId: string,
  telefonoCrudo: string,
): Promise<Respuesta<{ telefono: string | null }>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para editar los datos del conductor." };
  }

  // Vacío = borrar. No es un error de validación: es una intención.
  const crudo = telefonoCrudo.trim();
  let telefonoE164: string | null = null;

  if (crudo.length > 0) {
    const normalizado = normalizarTelefonoE164(crudo);
    if (!normalizado.valido) {
      return { ok: false, mensaje: MENSAJE_TELEFONO_CONDUCTOR[normalizado.motivo] };
    }
    telefonoE164 = normalizado.telefonoE164;
  }

  try {
    const cliente = crearClienteServiceRole();
    await actualizarTelefonoConductor(
      cliente,
      sesion.usuario.tenantId,
      conductorId,
      telefonoE164,
      sesion.usuarioId,
      sesion.usuario,
    );
    revalidatePath("/conductores");
    revalidatePath(`/conductores/${conductorId}`);
    return { ok: true, datos: { telefono: telefonoE164 } };
  } catch (err) {
    // El mensaje del dominio ya viene saneado (nunca trae el número).
    const mensaje = err instanceof Error ? err.message : "Error al guardar el teléfono.";
    return { ok: false, mensaje };
  }
}

/**
 * Guarda en qué anda el conductor: moto o auto.
 *
 * Vacío **lo borra** y vuelve a «Sin declarar», que es un estado legítimo y no
 * un error: el courier tiene que poder deshacer un dato puesto por equivocación,
 * y dejar «auto» en alguien que anda en moto es peor que no saberlo.
 *
 * RBAC: `asignar_y_reasignar_pedidos` — el gate operativo, el mismo que el
 * teléfono y la capacidad. No el financiero: quién anda en qué lo administra
 * quien reparte, no quien paga.
 */
export async function actionActualizarVehiculoConductor(
  conductorId: string,
  vehiculoCrudo: string,
): Promise<Respuesta<{ vehiculo: VehiculoConductor | null }>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }
  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para editar los datos del conductor." };
  }

  const crudo = vehiculoCrudo.trim();
  let vehiculo: VehiculoConductor | null = null;
  if (crudo.length > 0) {
    if (!esVehiculoConductor(crudo)) {
      return { ok: false, mensaje: "Elige moto o auto." };
    }
    vehiculo = crudo;
  }

  try {
    await actualizarVehiculoConductor(
      crearClienteServiceRole(),
      sesion.usuario.tenantId,
      conductorId,
      vehiculo,
      sesion.usuarioId,
      sesion.usuario,
    );
    revalidatePath("/conductores");
    revalidatePath(`/conductores/${conductorId}`);
    return { ok: true, datos: { vehiculo } };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al guardar el vehículo.";
    return { ok: false, mensaje };
  }
}
