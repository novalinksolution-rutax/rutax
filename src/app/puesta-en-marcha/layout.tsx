import { redirect } from "next/navigation";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { cerrarSesion } from "@/lib/identidad/cerrar-sesion";
import { puedeGestionarPerfilEmpresa } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";

/**
 * Marco del wizard de puesta en marcha — pantalla INMERSIVA, sin el sidebar del
 * backoffice a propósito: el wizard es obligatorio y no debe ofrecer escapes de
 * navegación hasta terminarse. El gate del área autenticada (`(tenant)/layout`)
 * es el que redirige aquí cuando el courier aún no lo completó.
 *
 * Guards:
 *  · sin sesión → /login; invitado (sin contraseña) → /activar-cuenta.
 *  · conductor/seller → sus superficies; nunca hacen puesta en marcha.
 *  · ya completada → /; no se vuelve al wizard.
 *  · no-dueño de un courier a medio configurar → pantalla de espera (no puede
 *    completar la puesta en marcha; la hace el dueño).
 */
export default async function LayoutPuestaEnMarcha({
  children,
}: {
  children: React.ReactNode;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (sesion.usuario.estado === "invitado") redirect("/activar-cuenta");
  if (!sesion.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario === "conductor") redirect("/conductor");
  if (sesion.usuario.tipoUsuario === "seller") redirect("/portal");

  // El flag se lee con service-role directo sobre `identidad.tenants`: no depende
  // de qué columnas exponga la vista public.
  const svc = crearClienteServiceRole();
  const { data: tenant } = await svc
    .schema("identidad")
    .from("tenants")
    .select("puesta_en_marcha_completada_en")
    .eq("id", sesion.usuario.tenantId)
    .maybeSingle();

  if (tenant?.puesta_en_marcha_completada_en) redirect("/");

  const esDueno = puedeGestionarPerfilEmpresa(sesion.usuario);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <span className="font-heading text-lg font-semibold tracking-tight">Rutax</span>
          <form
            action={async () => {
              "use server";
              await cerrarSesion("/login");
            }}
          >
            <Button type="submit" variant="ghost" size="sm">
              Salir
            </Button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
        {esDueno ? (
          children
        ) : (
          <div className="space-y-3 text-center">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              Estamos preparando tu cuenta
            </h1>
            <p className="text-muted-foreground">
              El dueño de la cuenta está terminando la puesta en marcha. Cuando esté lista,
              vas a poder entrar y trabajar.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
