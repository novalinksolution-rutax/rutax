import Link from "next/link";
import { Shield } from "lucide-react";
import { tieneSesionAdmin } from "./sesion-admin";
import { FormularioLoginAdmin } from "./formulario-login-admin";

/**
 * Layout del backstage de plataforma (super-admin de Rutax).
 *
 * Protección: la sesión vive en una cookie httpOnly con un token derivado del
 * `SUPER_ADMIN_SECRET` (ver `sesion-admin.ts`). NO se usa un secreto en la URL.
 * Si no hay sesión válida, este layout renderiza el formulario de login en vez
 * del contenido — así CUALQUIER ruta `/admin/*` queda protegida por igual y se
 * evita el loop de redirect que tenía el esquema anterior (`?secret=`).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await tieneSesionAdmin())) {
    return <FormularioLoginAdmin />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-3 flex items-center gap-4">
        <Shield className="size-4 text-primary" aria-hidden="true" />
        <span className="font-semibold text-sm">Rutax · Admin</span>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/admin/suscripciones" className="text-muted-foreground hover:text-foreground transition-colors">
            Suscripciones
          </Link>
          <Link href="/admin/salud" className="text-muted-foreground hover:text-foreground transition-colors">
            Salud
          </Link>
        </nav>
        <span className="text-xs text-muted-foreground ml-auto">Panel interno</span>
      </header>
      <main className="container mx-auto px-6 py-8 max-w-5xl">{children}</main>
    </div>
  );
}
