
import { exigirSuperAdmin, type ActorSuperAdmin } from "@/modules/plataforma/autorizacion-admin";
import { Badge } from "@/components/ui/badge";
import { AppShell, type GrupoNav } from "@/components/app-shell/app-shell";
import { BannerSuplantacion } from "@/components/app-shell/banner-suplantacion";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { leerSoporteActivo } from "@/modules/plataforma/soporte";
import { cerrarSesionAdmin } from "./acciones-sesion";
import { FormularioLoginAdmin } from "./formulario-login-admin";
import { DistintivoBackstage } from "./distintivo-backstage";
import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";
import { PanelEnrolamientoTotp } from "./seguridad/panel-enrolamiento-totp";
import { PanelStepUpTotp } from "./seguridad/panel-step-up-totp";

/**
 * Navegación del backstage (Fase 3 · IA Blueprint §2): consola densa en sidebar
 * — Overview raíz + grupos NEGOCIO / PLATAFORMA + Seguridad al pie. El gating
 * fino por `rolAdmin` (soporte = solo lectura) vive en cada página; el nav es
 * visible para ambos roles porque ver está permitido a los dos.
 */
const GRUPOS_ADMIN: GrupoNav[] = [
  { titulo: null, items: [{ href: "/admin", etiqueta: "Overview", icono: "dashboard" }] },
  {
    titulo: "Negocio",
    items: [
      { href: "/admin/couriers", etiqueta: "Couriers", icono: "couriers" },
      { href: "/admin/suscripciones", etiqueta: "Suscripciones", icono: "plan" },
      { href: "/admin/planes", etiqueta: "Planes", icono: "tarifas" },
    ],
  },
  {
    titulo: "Plataforma",
    items: [
      { href: "/admin/metricas", etiqueta: "Métricas", icono: "metricas" },
      { href: "/admin/salud", etiqueta: "Salud", icono: "salud" },
      // La otra salud: la de las conexiones de los sellers de todos los
      // couriers. Va aparte de la de jobs porque responde otra pregunta —
      // «¿a quién hay que llamar hoy?» y no «¿anda el sistema?».
      {
        href: "/admin/salud-integraciones",
        etiqueta: "Integraciones",
        icono: "salud",
      },
      { href: "/admin/bitacora", etiqueta: "Bitácora", icono: "bitacora" },
      // Quién puede entrar a Rutax, en todos los couriers -- y lo que está mal.
      // Nace del incidente del 2026-08-25: una invitación sobrescribió el perfil
      // de una cuenta de seller y nadie se enteró.
      { href: "/admin/cuentas", etiqueta: "Cuentas", icono: "equipo" },
      { href: "/admin/comunicaciones", etiqueta: "Comunicaciones", icono: "comunicaciones" },
      // WhatsApp lo administra Rutax y no el courier: el emisor es nuestro
      // número y la calidad que Meta le asigna la comparten todos los tenants.
      { href: "/admin/whatsapp", etiqueta: "WhatsApp", icono: "contactos-whatsapp" },
    ],
  },
];

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
    // ⚠️ **La cifra se cuenta, no se escribe a mano.** El tablero dice «tu
    // credencial vale por 27 empresas», y 27 era el dato del día en que se
    // dibujó. Un número puesto a mano en una advertencia de seguridad envejece
    // solo, y el día que deje de coincidir la advertencia deja de tener peso.
    // Si la consulta falla, la frase se dice sin número: sigue siendo cierta.
    let couriers: number | null = null;
    try {
      const { count } = await crearClienteServiceRole()
        .from("tenants")
        .select("id", { count: "exact", head: true });
      couriers = count ?? null;
    } catch {
      couriers = null;
    }
    return <PromptMfa actor={actor} couriers={couriers} />;
  }

  const esAdminTotal = actor.rolAdmin === "admin_total";

  // El banner de sesión suplantada se pinta en el MARCO, no en la pantalla de
  // soporte: la regla 7 del sistema pide que no se pueda perder de vista, y
  // mientras vivía dentro de la página desaparecía en su propia rama de error.
  // Lectura pasiva: no escribe bitácora ni toca la cookie (ver `leerSoporteActivo`).
  const soporte = await leerSoporteActivo();
  let nombreCourierSoporte: string | null = null;
  if (soporte) {
    const { data } = await crearClienteServiceRole()
      .from("tenants")
      .select("nombre_fantasia")
      .eq("id", soporte.tenantId)
      .maybeSingle();
    nombreCourierSoporte = (data?.nombre_fantasia as string | undefined) ?? soporte.tenantId;
  }

  return (
    <AppShell
      nombreFantasia="Rutax"
      etiquetaMarca="Plataforma"
      nombreCompleto={actor.email}
      subtituloCuenta={esAdminTotal ? "Administrador" : "Soporte (solo lectura)"}
      grupos={GRUPOS_ADMIN}
      itemsInferiores={[{ href: "/admin/seguridad", etiqueta: "Seguridad", icono: "seguridad" }]}
      adornoCuenta={
        <Badge variant={esAdminTotal ? "outline" : "neutral"}>{esAdminTotal ? "Total" : "Soporte"}</Badge>
      }
      accionSalir={cerrarSesionAdmin}
      mostrarAvisos={false}
      // El buscador global sigue apagado en el backstage a propósito: encenderlo
      // sin backend propio repetiría el error que acaba de corregirse en el
      // portal — `/api/buscar` corta por `tipoUsuario !== "interno"` y el
      // super-admin no lo es, así que devolvería "sin resultados" siempre.
      // Necesita su propia búsqueda por courier. Va con el bloque 9.
      mostrarBusqueda={false}
      banner={
        soporte && nombreCourierSoporte ? (
          <BannerSuplantacion
            tenantId={soporte.tenantId}
            nombreCourier={nombreCourierSoporte}
            expiraEn={soporte.expiraEn}
          />
        ) : null
      }
    >
      {children}
    </AppShell>
  );
}

/**
 * Gate de MFA — bloquea TODO `/admin/*` mientras la sesión no llegue a AAL2,
 * mostrando inline el paso que corresponda (enrolamiento o step-up, ver
 * cabecera del archivo). Es una superficie de seguridad: sobria, sin nav ni
 * distracciones, con una única salida siempre visible (cerrar sesión).
 */
function PromptMfa({ actor, couriers }: { actor: ActorSuperAdmin; couriers: number | null }) {
  // `aalSiguiente === 'aal1'` (igual al actual) ⇒ no hay NINGÚN factor
  // enrolado todavía (falta enrolar). `aalSiguiente === 'aal2'` ⇒ ya hay un
  // factor verificado de una sesión anterior, falta el step-up de ESTA sesión.
  const sinFactorEnrolado = actor.aalSiguiente !== "aal2";

  const alcance =
    couriers && couriers > 0
      ? `Tu credencial vale por ${couriers.toLocaleString("es-CL")} ${couriers === 1 ? "empresa" : "empresas"}.`
      : "Tu credencial vale por todas las empresas del sistema.";

  return (
    <PantallaSinSesion marca={{ tipo: "rutax" }} distintivo={<DistintivoBackstage />}>
      <div className="w-full max-w-sm space-y-5 border border-line bg-card p-8">
        <div className="space-y-2 text-center">
          {/* «Confirma que eres tú», no «Verificación en dos pasos requerida»:
              lo segundo nombra el mecanismo, lo primero dice qué se va a hacer.
              Quien llega acá ya sabe que hay un segundo paso — lo tiene delante. */}
          <h1 className="font-heading text-lg font-semibold text-fg">
            {sinFactorEnrolado ? "Configura tu segundo factor" : "Confirma que eres tú"}
          </h1>
          <p className="text-sm text-fg-muted">
            {sinFactorEnrolado
              ? "Antes de entrar necesitas una aplicación de autenticación. No se puede saltar ni desactivar."
              : "Escribe el código de 6 dígitos de tu aplicación de autenticación."}
          </p>
        </div>

        {/* ⚠️ El aviso explica **por qué** se pide, no que se pide. Es el único
            perfil del producto cuya credencial abre la puerta de todos los
            couriers a la vez, y eso es lo que justifica un paso más. */}
        <p className="border border-attention-line bg-attention-bg px-3 py-2 text-xs leading-relaxed text-attention-fg">
          {alcance} El segundo factor no se puede desactivar, y te lo vamos a volver a pedir antes
          de entrar a la cuenta de un courier.
        </p>

        {sinFactorEnrolado ? <PanelEnrolamientoTotp /> : <PanelStepUpTotp />}

        {/* ⚠️ **No se ofrece «usa un código de respaldo»**, que es lo que dibuja
            el tablero: los códigos de respaldo NO EXISTEN en el producto. Un
            enlace ahí sería un botón muerto en la pantalla donde alguien ya está
            bloqueado — el mismo defecto que se acaba de quitar de
            `revisa-tu-correo`.
            Lo que se dice es lo único cierto, y es una limitación real que hay
            que resolver: hoy un administrador que pierde su teléfono no tiene
            camino de vuelta por sí solo. */}
        <p className="text-center text-xs leading-relaxed text-fg-subtle">
          ¿Perdiste tu aplicación de autenticación? Todavía no hay códigos de respaldo: pídele a
          otro administrador total que reponga tu segundo factor.
        </p>

        <form action={cerrarSesionAdmin} className="text-center">
          <button
            type="submit"
            className="text-xs text-fg-muted transition-colors hover:text-fg"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </PantallaSinSesion>
  );
}
