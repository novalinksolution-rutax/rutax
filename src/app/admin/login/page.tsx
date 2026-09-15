import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Iniciar sesión · Rutax Admin",
};

/**
 * Ruta de login del backstage — RETIRADA (F4.d, 2026-09-15).
 *
 * El backstage ya no tiene login propio: el super-admin entra por `/login`
 * como cualquier otro usuario (Google o código OTP), y `/` lo enruta de
 * vuelta a `/admin/suscripciones` según su `tipo_usuario` (ver
 * `src/app/page.tsx`). Esta ruta sigue existiendo solo para no romper
 * enlaces viejos y los `redirect("/admin/login")` que todavía usan varias
 * páginas de `/admin/*` como defensa en profundidad si `exigirSuperAdmin()`
 * falla — relaya a `/login` en vez de mostrar un formulario.
 */
export default function AdminLoginPage() {
  redirect("/login");
}
