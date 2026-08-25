"use server";

/**
 * Server Actions — Configuración de zonas, comunas y ventanas de corte (F7, ítem 1.2).
 *
 * RBAC: misma capacidad que tarifas (`gestionar_tarifas`), ya que zonas y
 * ventanas de corte son configuración operativa-tarifaria del courier.
 * Esta pantalla vive en (tenant)/configuracion/zonas/ y NO en onboarding
 * porque zonas y cortes son configuración permanente (pueden modificarse en
 * cualquier momento, no solo al arrancar), a diferencia de las tarifas iniciales
 * del onboarding que tienen su flujo de activación propio.
 *
 * Auditoría: cada mutación registra en bitácora antes del efecto (invariante CLAUDE.md).
 */

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import {
  listarZonas,
  activarDesactivarZona,
  listarComunasDeZona,
  listarComunasDelTenant,
  guardarZonaConComunas,
} from "@/modules/operacion/zonas";
import {
  guardarVentanaCorte,
  listarVentanasPorSeller,
  cambiarActivaVentanaCorte,
} from "@/modules/operacion/ventanas-corte";
import type { Zona, ZonaComuna, VentanaCorte } from "@/modules/operacion/tipos";

// =============================================================================
// Tipos de respuesta
// =============================================================================

type RespuestaOk<T> = { ok: true; datos: T };
type RespuestaError = { ok: false; mensaje: string };
type Respuesta<T> = RespuestaOk<T> | RespuestaError;

// =============================================================================
// Estado inicial de la pantalla
// =============================================================================

export interface Seller {
  id: string;
  nombre: string;
}

export interface EstadoZonas {
  zonas: Zona[];
  sellers: Seller[];
}

export async function obtenerEstadoZonas(): Promise<Respuesta<EstadoZonas>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  if (!puedeGestionarTarifas(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para configurar zonas." };
  }

  const cliente = crearClienteServiceRole();
  const tenantId = sesion.usuario.tenantId;

  const [zonas, sellersFila] = await Promise.all([
    listarZonas(cliente, tenantId),
    cliente
      .schema("identidad")
      .from("sellers")
      // 🔴 Decía `nombre_empresa`, **una columna que no existe**. La tabla tiene
      // `razon_social` (y `nombre_contacto`), así que PostgREST devolvía 42703,
      // `data` venía `null`, el `?? []` lo tragaba y `sellers` quedaba SIEMPRE
      // vacío. Con la lista vacía `SeccionVentanasCorte` hace `return null`:
      // **toda la sección de horario de corte y objetivo de SLA no se
      // renderizaba nunca**, en ninguna cuenta. Ni un error en pantalla ni una
      // línea en el log — solo una sección que no estaba.
      .select("id, razon_social")
      .eq("tenant_id", tenantId)
      .order("razon_social"),
  ]);

  // ⚠️ Y el error se propaga, que es la mitad que faltaba. Tragarse el fallo de
  // una lectura y seguir con una lista vacía convierte cualquier typo futuro en
  // una pantalla que se encoge en silencio, que es exactamente lo que pasó acá.
  if (sellersFila.error) {
    return { ok: false, mensaje: `No pudimos cargar tus sellers: ${sellersFila.error.message}` };
  }

  const sellers: Seller[] = (sellersFila.data ?? []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    nombre: (s.razon_social as string) ?? "Seller",
  }));

  return { ok: true, datos: { zonas, sellers } };
}

// =============================================================================
// Zonas
// =============================================================================

export async function actionToggleZona(
  zonaId: string,
  activa: boolean,
): Promise<Respuesta<Zona>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const zona = await activarDesactivarZona(
      cliente,
      sesion.usuario.tenantId,
      zonaId,
      activa,
      sesion.usuarioId,
      sesion.usuario,
    );
    revalidatePath("/configuracion/zonas");
    return { ok: true, datos: zona };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al actualizar la zona.";
    return { ok: false, mensaje };
  }
}

// =============================================================================
// Comunas de una zona
// =============================================================================

export async function actionObtenerComunasDeZona(
  zonaId: string,
): Promise<Respuesta<ZonaComuna[]>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const comunas = await listarComunasDeZona(
      cliente,
      sesion.usuario.tenantId,
      zonaId,
    );
    return { ok: true, datos: comunas };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al obtener comunas.";
    return { ok: false, mensaje };
  }
}

/**
 * Todas las comunas asignadas del tenant, con su zona.
 *
 * 🔴 Sin esto el alta de zona no sabe cuáles ya tienen dueño: las dibuja libres,
 * alguien las marca, y o se mueven de zona sin que nadie lo pidiera o el
 * guardado entero falla por el `unique (tenant_id, comuna)`. Ver
 * `cobertura-comunas.ts`.
 */
export async function actionObtenerCoberturaComunas(): Promise<
  Respuesta<{ comuna: string; zonaId: string }[]>
> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const comunas = await listarComunasDelTenant(cliente, sesion.usuario.tenantId);
    return { ok: true, datos: comunas.map((c) => ({ comuna: c.comuna, zonaId: c.zonaId })) };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al obtener la cobertura de comunas.",
    };
  }
}

/**
 * 🔴 Guarda la zona y sus comunas de una sola vez, en una transacción.
 *
 * Reemplaza la secuencia `actionCrearZona` → `actionAsignarComunas` que hacía
 * el panel, y que dejaba la zona creada y vacía si la segunda fallaba. El
 * porqué completo está en `guardarZonaConComunas`.
 */
export async function actionGuardarZona(entrada: {
  /** `null` = crear. */
  zonaId: string | null;
  nombre: string;
  comunas: string[];
}): Promise<Respuesta<Zona>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const zona = await guardarZonaConComunas(
      cliente,
      {
        tenantId: sesion.usuario.tenantId,
        zonaId: entrada.zonaId,
        nombre: entrada.nombre,
        comunas: entrada.comunas,
        actorUsuarioId: sesion.usuarioId,
      },
      sesion.usuario,
    );
    return { ok: true, datos: zona };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al guardar la zona.",
    };
  }
}

// =============================================================================
// Ventanas de corte
// =============================================================================

export async function actionObtenerVentanasSeller(
  sellerId: string,
): Promise<Respuesta<VentanaCorte[]>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const ventanas = await listarVentanasPorSeller(
      cliente,
      sesion.usuario.tenantId,
      sellerId,
    );
    return { ok: true, datos: ventanas };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al obtener ventanas de corte.";
    return { ok: false, mensaje };
  }
}

export async function actionGuardarVentanaCorte(
  formData: FormData,
): Promise<Respuesta<VentanaCorte>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  const sellerId = String(formData.get("sellerId") ?? "").trim();
  const tipoEntrega = String(formData.get("tipoEntrega") ?? "").trim();
  const horaCorte = String(formData.get("horaCorte") ?? "").trim();
  const minutosPreparacion = parseInt(String(formData.get("minutosPreparacion") ?? "0"), 10);
  const minutosRutaEstimado = parseInt(String(formData.get("minutosRutaEstimado") ?? "0"), 10);
  const slaObjetivoPct = parseInt(String(formData.get("slaObjetivoPct") ?? "97"), 10);
  const zonaId = String(formData.get("zonaId") ?? "").trim() || null;

  if (!sellerId) return { ok: false, mensaje: "Debes seleccionar un seller." };
  if (!tipoEntrega || !["flex", "same_day"].includes(tipoEntrega)) {
    return { ok: false, mensaje: "Tipo de entrega inválido." };
  }
  if (!horaCorte) return { ok: false, mensaje: "La hora de corte es obligatoria." };
  if (isNaN(slaObjetivoPct) || slaObjetivoPct < 0 || slaObjetivoPct > 100) {
    return { ok: false, mensaje: "El objetivo de SLA debe estar entre 0 y 100." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const ventana = await guardarVentanaCorte(
      cliente,
      {
        tenantId: sesion.usuario.tenantId,
        sellerId,
        zonaId,
        tipoEntrega: tipoEntrega as "flex" | "same_day",
        horaCorte,
        minutosPreparacion: isNaN(minutosPreparacion) ? 0 : minutosPreparacion,
        minutosRutaEstimado: isNaN(minutosRutaEstimado) ? 0 : minutosRutaEstimado,
        slaObjetivoPct,
        actorUsuarioId: sesion.usuarioId,
      },
      sesion.usuario,
    );
    revalidatePath("/configuracion/zonas");
    return { ok: true, datos: ventana };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al guardar la ventana de corte.";
    return { ok: false, mensaje };
  }
}

// =============================================================================
// Activar / desactivar ventana de corte
// =============================================================================

/**
 * La transición que le faltaba al estado «Inactiva», que se dibujaba sin tener
 * ni entrada ni salida.
 */
export async function actionToggleVentanaCorte(
  ventanaId: string,
  activa: boolean,
): Promise<Respuesta<VentanaCorte>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { ok: false, mensaje: "No hay sesión activa." };
  if (!puedeGestionarTarifas(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para gestionar ventanas de corte." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const ventana = await cambiarActivaVentanaCorte(
      cliente,
      {
        tenantId: sesion.usuario.tenantId,
        ventanaId,
        activa,
        actorUsuarioId: sesion.usuarioId,
      },
      sesion.usuario,
    );
    revalidatePath("/configuracion/zonas");
    return { ok: true, datos: ventana };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al cambiar el estado de la ventana.",
    };
  }
}
