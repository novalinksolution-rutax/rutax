"use server";

/**
 * Server Action — encender/apagar un área de producto para un courier.
 * =============================================================================
 * Delgada a propósito: la autorización (`admin_total` + AAL2) y la bitácora
 * viven en `fijarAreaDelCourier` (`@/modules/plataforma/areas-courier`). Acá
 * solo se traduce el `FormData` del panel y se revalida la pantalla.
 *
 * ⚠️ `revalidatePath` sobre el detalle del courier NO alcanza al courier: su
 * sesión lee las áreas en cada request (`obtenerSesionActual`), así que el
 * cambio le llega en su siguiente navegación sin que nadie invalide nada. Esto
 * es solo para que el propio panel del backstage se repinte.
 */

import { revalidatePath } from "next/cache";

import { esAreaProducto } from "@/modules/identidad/areas-producto";
import { fijarAreaDelCourier } from "@/modules/plataforma/areas-courier";

export type ResultadoArea = { ok: true } | { ok: false; mensaje: string };

export async function accionFijarArea(formData: FormData): Promise<ResultadoArea> {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const area = formData.get("area");
  const habilitar = String(formData.get("habilitar") ?? "") === "true";
  const nota = String(formData.get("nota") ?? "").trim();

  if (!tenantId) return { ok: false, mensaje: "Falta el courier." };
  if (!esAreaProducto(area)) return { ok: false, mensaje: "Área desconocida." };

  try {
    await fijarAreaDelCourier({ tenantId, area, habilitar, nota: nota || null });
    revalidatePath(`/admin/couriers/${tenantId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje:
        err instanceof Error
          ? err.message
          : "No se pudo cambiar el área. Intenta de nuevo en unos minutos.",
    };
  }
}
