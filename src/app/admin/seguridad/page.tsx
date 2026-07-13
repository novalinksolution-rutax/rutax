import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck, ShieldQuestion } from "lucide-react";
import { exigirSuperAdmin, type ActorSuperAdmin } from "@/modules/plataforma/autorizacion-admin";
import { Badge } from "@/components/ui/badge";
import { PanelEnrolamientoTotp } from "./panel-enrolamiento-totp";
import { PanelStepUpTotp } from "./panel-step-up-totp";

export const metadata: Metadata = {
  title: "Seguridad · Rutax Admin",
};

// El AAL de la sesión puede cambiar entre requests (login nuevo, step-up); nunca cachear.
export const dynamic = "force-dynamic";

/**
 * Pantalla de seguridad del propio super-admin (F3-A). Gated con
 * `exigirSuperAdmin()` — a propósito NO exige AAL2: es la única superficie de
 * `/admin/*` donde un super-admin en AAL1 (sin factor, o con factor sin
 * verificar esta sesión) tiene algo legítimo que hacer.
 *
 * En la práctica, `layout.tsx` ya intercepta TODO `/admin/*` con su propia
 * pantalla inline cuando `actor.aal !== 'aal2'` (mismos dos componentes que
 * esta página, ver `PanelEnrolamientoTotp`/`PanelStepUpTotp`), así que esta
 * página normalmente solo se renderiza en AAL2 — el branching de abajo es
 * defensa en profundidad (por si el gate del layout cambia en el futuro), no
 * el camino principal.
 */
export default async function PaginaSeguridad() {
  let actor: ActorSuperAdmin;
  try {
    actor = await exigirSuperAdmin();
  } catch {
    redirect("/admin/login");
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Seguridad</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Verificación en dos pasos (MFA) de tu cuenta de administrador — {actor.email}.
        </p>
      </div>

      {actor.aal === "aal2" ? (
        <EstadoVerificado />
      ) : actor.aalSiguiente === "aal2" ? (
        <div className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
          <div className="text-center">
            <h2 className="font-semibold">Verifica tu identidad</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ya tienes MFA configurado. Ingresa el código de tu app authenticator para continuar.
            </p>
          </div>
          <PanelStepUpTotp />
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
          <div className="text-center">
            <h2 className="font-semibold">Configura tu segundo factor</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Escanea el código con Google Authenticator, Authy, 1Password o tu app authenticator
              preferida.
            </p>
          </div>
          <PanelEnrolamientoTotp />
        </div>
      )}
    </div>
  );
}

function EstadoVerificado() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-8 text-success" aria-hidden="true" />
          <div>
            <p className="font-medium">MFA activo</p>
            <p className="text-sm text-muted-foreground">Esta sesión ya verificó tu segundo factor.</p>
          </div>
        </div>
        <Badge variant="success">Verificado</Badge>
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldQuestion className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-semibold">¿Perdiste tu teléfono o cambiaste de app?</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Puedes configurar un factor nuevo en cualquier momento. El anterior sigue activo hasta
          que verifiques uno nuevo con éxito.
        </p>
        <PanelEnrolamientoTotp autoIniciar={false} />
      </div>
    </div>
  );
}
