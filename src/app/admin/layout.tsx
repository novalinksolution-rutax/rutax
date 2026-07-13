import Link from "next/link";
import { Shield, ShieldAlert } from "lucide-react";
import { exigirSuperAdmin, type ActorSuperAdmin } from "@/modules/plataforma/autorizacion-admin";
import { Badge } from "@/components/ui/badge";
import { cerrarSesionAdmin } from "./acciones-sesion";
import { FormularioLoginAdmin } from "./formulario-login-admin";
import { PanelEnrolamientoTotp } from "./seguridad/panel-enrolamiento-totp";
import { PanelStepUpTotp } from "./seguridad/panel-step-up-totp";

/**
 * Layout del backstage de plataforma (super-admin de Rutax) — F3-A.
 *
 * Gate REAL (dual-gate, `@/modules/plataforma/autorizacion-admin`):
 * `exigirSuperAdmin()` exige sesión Supabase Auth real + identidad
 * `tipo_usuario='super_admin'` + fila ACTIVA en `plataforma.super_admins`
 * (leída fresca en cada request — revocación inmediata si se desactiva al
 * admin). NO exige AAL2 por sí sola: este layout decide qué renderizar según
 * el AAL resuelto de la sesión:
 *
 *   - Sin sesión de super-admin (`exigirSuperAdmin` lanza) → formulario de
 *     login (`FormularioLoginAdmin`).
 *   - Sesión válida, SIN ningún factor TOTP enrolado
 *     (`aal==='aal1' && aalSiguiente==='aal1'`) → pantalla de enrolamiento
 *     INLINE (`PanelEnrolamientoTotp`, `./seguridad/panel-enrolamiento-totp.tsx`,
 *     `autoIniciar` por defecto: genera el QR apenas se monta, sin un clic
 *     extra ni depender de recordar una URL).
 *   - Sesión válida, CON factor enrolado pero sin verificar en ESTA sesión
 *     (`aal==='aal1' && aalSiguiente==='aal2'`) → pantalla de step-up INLINE
 *     (`PanelStepUpTotp`, `./seguridad/panel-step-up-totp.tsx`), sobre las
 *     Server Actions de `./acciones-mfa.ts`.
 *   - Sesión con AAL2 (MFA verificado en esta sesión) → contenido normal del
 *     backstage, con el header mostrando `rolAdmin` y `email` del actor real.
 *
 * `/admin/seguridad/page.tsx` reutiliza EXACTAMENTE los mismos dos componentes
 * (mismo código, no una copia) para la gestión voluntaria de MFA de un admin
 * ya en AAL2 (agregar/reconfigurar un factor, p. ej. si perdió el teléfono) —
 * ver el link "Seguridad" del nav de abajo. Como el layout intercepta TODO
 * `/admin/*` en AAL1 antes de llegar a `children`, esa página en la práctica
 * solo se alcanza en AAL2; su propio branching AAL1 es defensa en profundidad,
 * no el camino principal.
 *
 * Política de AAL (documentada aquí — única fuente): se exige AAL2 para TODO
 * `/admin/*`. La ÚNICA superficie que un super-admin en AAL1 puede alcanzar es
 * este mismo layout resolviendo su propio estado de MFA — ningún `children`
 * (ninguna página hija) se renderiza sin AAL2.
 *
 * NOTA de implementación: este layout NO llama `redirect()` — solo cambia qué
 * árbol renderiza según el estado del actor. Ojo si se copia este patrón a
 * una página que sí redirija: Next.js implementa `redirect()` lanzando un
 * error especial (`NEXT_REDIRECT`) que un `catch` genérico atraparía por error
 * si ambos conviven en el mismo `try` (gotcha ya conocido en este repo —
 * ver `login/page.tsx`, que resuelve el booleano DENTRO del `try` pero llama
 * `redirect()` fuera de él).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let actor: ActorSuperAdmin | null = null;
  try {
    actor = await exigirSuperAdmin();
  } catch {
    actor = null;
  }

  if (!actor) {
    return <FormularioLoginAdmin />;
  }

  if (actor.aal !== "aal2") {
    return <PromptMfa actor={actor} />;
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
          <Link href="/admin/metricas" className="text-muted-foreground hover:text-foreground transition-colors">
            Métricas
          </Link>
          <Link href="/admin/planes" className="text-muted-foreground hover:text-foreground transition-colors">
            Planes
          </Link>
          <Link href="/admin/couriers" className="text-muted-foreground hover:text-foreground transition-colors">
            Couriers
          </Link>
          <Link href="/admin/salud" className="text-muted-foreground hover:text-foreground transition-colors">
            Salud
          </Link>
          <Link href="/admin/comunicaciones" className="text-muted-foreground hover:text-foreground transition-colors">
            Comunicaciones
          </Link>
          <Link href="/admin/bitacora" className="text-muted-foreground hover:text-foreground transition-colors">
            Bitácora
          </Link>
          <Link href="/admin/seguridad" className="text-muted-foreground hover:text-foreground transition-colors">
            Seguridad
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span>{actor.email}</span>
          <Badge variant={actor.rolAdmin === "admin_total" ? "outline" : "neutral"}>
            {actor.rolAdmin === "admin_total" ? "Administrador" : "Soporte (solo lectura)"}
          </Badge>
          <form action={cerrarSesionAdmin}>
            <button type="submit" className="text-muted-foreground hover:text-foreground transition-colors">
              Cerrar sesión
            </button>
          </form>
        </div>
      </header>
      <main className="container mx-auto px-6 py-8 max-w-5xl">{children}</main>
    </div>
  );
}

/**
 * Gate de MFA — bloquea TODO `/admin/*` mientras la sesión no llegue a AAL2,
 * mostrando inline el paso que corresponda (enrolamiento o step-up, ver
 * cabecera del archivo). Es una superficie de seguridad: sobria, sin nav ni
 * distracciones, con una única salida siempre visible (cerrar sesión).
 */
function PromptMfa({ actor }: { actor: ActorSuperAdmin }) {
  // `aalSiguiente === 'aal1'` (igual al actual) ⇒ no hay NINGÚN factor
  // enrolado todavía (falta enrolar). `aalSiguiente === 'aal2'` ⇒ ya hay un
  // factor verificado de una sesión anterior, falta el step-up de ESTA sesión.
  const sinFactorEnrolado = actor.aalSiguiente !== "aal2";

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-sm space-y-5 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <ShieldAlert className="mx-auto size-9 text-primary" aria-hidden="true" />
          <h1 className="font-semibold">Verificación en dos pasos requerida</h1>
          <p className="text-sm text-muted-foreground">
            {sinFactorEnrolado
              ? "El backstage de Rutax exige un segundo factor (MFA) para todas las cuentas de administrador. Configúralo para continuar."
              : `${actor.email} tiene MFA configurado, pero esta sesión todavía no lo verificó.`}
          </p>
        </div>

        {sinFactorEnrolado ? <PanelEnrolamientoTotp /> : <PanelStepUpTotp />}

        <form action={cerrarSesionAdmin} className="text-center">
          <button type="submit" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}
