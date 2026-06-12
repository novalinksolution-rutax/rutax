"use server";

/**
 * Server Actions — Bandeja de revisión de pagos (cobranza Fintoc).
 *
 * Capa delgada de "ruta de servidor": resuelve sesión + propaga al backend, que
 * YA hace el gating RBAC (`puedeVerConciliacion`, la misma capacidad financiera
 * que gobierna la conciliación) y la bitácora. Aquí NO se reimplementa la lógica
 * — solo se invocan `atribuirPagoManualmente` / `descartarPago` del módulo
 * `dinero` (patrón EXACTO de `dinero/conciliacion/actions.ts`).
 */

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { atribuirPagoManualmente, descartarPago } from "@/modules/dinero/acciones";
import { listarPeriodosCobro } from "@/modules/dinero/index";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeVerConciliacion } from "@/modules/identidad/capacidades";

export async function accionAtribuirPago(
  pagoId: string,
  sellerId: string,
  periodoCobroId?: string,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No autenticado." };
  }

  try {
    await atribuirPagoManualmente(
      sesion.usuario.tenantId,
      pagoId,
      sellerId,
      sesion.usuario,
      sesion.usuarioId,
      periodoCobroId || undefined,
    );
    return { ok: true };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al atribuir el pago.";
    return { ok: false, mensaje };
  }
}

export async function accionDescartarPago(
  pagoId: string,
  motivo: string,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No autenticado." };
  }

  try {
    await descartarPago(sesion.usuario.tenantId, pagoId, motivo, sesion.usuario, sesion.usuarioId);
    return { ok: true };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al descartar el pago.";
    return { ok: false, mensaje };
  }
}

/**
 * Lista los períodos facturados aún impagos (estado `facturado` y
 * `estado_cobro` ≠ `pagado`) de un seller — opciones para el diálogo de
 * atribución manual. Filtra por tenant + seller; la RLS lo refuerza en BD.
 */
export async function listarPeriodosImpagosDeSeller(
  sellerId: string,
): Promise<
  | { ok: true; periodos: Array<{ id: string; etiqueta: string; montoTotalClp: number | null }> }
  | { ok: false; mensaje: string }
> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No autenticado." };
  }
  if (!puedeVerConciliacion(sesion.usuario)) {
    return { ok: false, mensaje: "Sin permisos para ver los períodos de cobranza." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const periodos = await listarPeriodosCobro(cliente, sesion.usuario.tenantId, sellerId);
    const impagos = periodos
      .filter((p) => p.estado === "facturado" && p.estadoCobro !== "pagado")
      .map((p) => ({
        id: p.id,
        etiqueta: `${formatearFechaCorta(p.fechaInicio)} – ${formatearFechaCorta(p.fechaFin)}`,
        montoTotalClp: p.montoTotalClp,
      }));
    return { ok: true, periodos: impagos };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al listar períodos del seller.";
    return { ok: false, mensaje };
  }
}

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}
