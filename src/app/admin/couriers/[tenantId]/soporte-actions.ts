"use server";

/**
 * Server Actions del modo soporte "ver como el courier" (gap 4, F3-B).
 * =============================================================================
 * Delgadas a propósito: TODA la autorización (AAL2, motivo obligatorio,
 * bitácora ANTES del efecto) vive en `iniciarSoporteTenant`/`terminarSoporteTenant`
 * (`@/modules/plataforma/soporte`) — este archivo solo adapta esas funciones al
 * contrato de Server Action (`FormData` desde el modal, `redirect()` hacia la
 * pantalla de soporte o de vuelta al drill-down).
 *
 * `iniciarSoporteTenant` YA exige `exigirSuperAdmin()` + AAL2 internamente
 * (ambos roles de backstage pueden iniciar soporte, es de solo lectura) — no
 * se repite ese gate aquí ni se usa `exigirActorAdmin()` (ese exige, además,
 * `rolAdmin==='admin_total'`, que NO aplica: `soporte_lectura` también puede
 * entrar en modo soporte).
 *
 * `redirect()` se llama SIEMPRE fuera del `try/catch` que envuelve la llamada
 * de negocio (mismo criterio documentado en `src/app/admin/layout.tsx` y
 * `src/app/login/page.tsx`) — así nunca corre el riesgo de que un `catch`
 * genérico atrape el error especial `NEXT_REDIRECT` de Next.js.
 */

import { redirect } from "next/navigation";
import { iniciarSoporteTenant, terminarSoporteTenant } from "@/modules/plataforma/soporte";

type ResultadoAccionSoporte = { ok: true } | { ok: false; mensaje: string };

/**
 * Abre la ventana de soporte para `tenantId` con el motivo capturado en el
 * modal (`campo "motivo"` del `formData`). Si `iniciarSoporteTenant` valida
 * bien (AAL2 + motivo ≥ `LARGO_MINIMO_MOTIVO`), audita y setea la cookie,
 * redirige a la pantalla de soporte de ese courier. Si falla, devuelve el
 * mensaje para que el modal lo muestre sin cerrar (el admin no pierde lo que
 * ya escribió — el modal es quien conserva el estado del textarea).
 */
export async function accionIniciarSoporte(
  tenantId: string,
  formData: FormData,
): Promise<ResultadoAccionSoporte> {
  const motivo = String(formData.get("motivo") ?? "");

  try {
    await iniciarSoporteTenant({ tenantId, motivo });
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No se pudo iniciar el modo soporte.",
    };
  }

  redirect(`/admin/couriers/${tenantId}/soporte`);
}

/**
 * Cierra la ventana de soporte activa (si la hay) y vuelve al drill-down
 * normal del courier. `terminarSoporteTenant` es best-effort por diseño (no
 * lanza si ya no hay sesión que cerrar) — igual se envuelve en `try/catch`
 * aquí para que un error inesperado (p. ej. de lectura a `service_role`)
 * jamás le impida al admin salir del modo soporte.
 */
export async function accionTerminarSoporte(tenantId: string): Promise<void> {
  try {
    await terminarSoporteTenant();
  } catch {
    // No-op deliberado: el objetivo — sacar al admin del modo soporte — se
    // cumple igual con el redirect de abajo, haya o no podido limpiarse la
    // cookie/bitácora.
  }

  redirect(`/admin/couriers/${tenantId}`);
}
