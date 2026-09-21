"use client";

/**
 * La invitación aceptada: el formulario passwordless.
 * =============================================================================
 *
 * Pantallas C (primer login del dueño) y J (aceptación de invitación interna /
 * seller) — comparten estructura porque usan el MISMO mecanismo de token
 * (`aceptarInvitacion`). Google o código de 6 dígitos, igual que `/login` y
 * `/registro` de F1 (F3, 2026-09). La distinción persona_nueva/persona_existente
 * no gobierna esta UI: Google y código sirven para las dos por igual, y quién
 * exista o no lo resuelve el backend.
 *
 * -----------------------------------------------------------------------------
 * LOS CINCO FINALES DE ERROR YA NO ESTÁN ACÁ
 * -----------------------------------------------------------------------------
 * Vivían en este archivo, dentro del componente de cliente, así que **todo el
 * que iba a ver un mensaje de tres líneas se bajaba igual este formulario
 * entero**. Ahora son `estados-finales.tsx`, servidor puro, y la página elige
 * antes de mandar nada al navegador.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL CONDUCTOR YA NO PASA POR ACÁ (F4, 2026-09-15)
 * -----------------------------------------------------------------------------
 * Hasta F4 el conductor era el único rol que seguía definiendo una contraseña
 * acá —un PIN de 6 dígitos que **era** su contraseña de Supabase—, porque entra
 * a la app con guantes, de pie, en una bodega. F4 lo cambió por WhatsApp OTP
 * desde la app nativa: el conductor se invita por TELÉFONO
 * (`crearInvitacion` con `tipoUsuario: 'conductor'` exige `telefono`, no
 * `email`) y nunca recibe este enlace. La página (`page.tsx`) intercepta
 * cualquier fila `valida` con `rol === 'conductor'` —solo puede ser una
 * invitación vieja, de antes del 15-sep— y muestra un final sin formulario
 * (`FinalInvitacionConductorPorApp`, en `estados-finales.tsx`) en vez de
 * llegar hasta aquí. Los dos formularios de contraseña/PIN que vivían en este
 * archivo (`FormularioDefinirContrasena`, `FormularioConfirmarAceptacion`) se
 * retiraron con ellos.
 */

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { createClient } from "@/lib/supabase/client";
import { IconoGoogle } from "@/components/identidad/icono-google";
import { IngresaCodigo } from "@/components/identidad/ingresa-codigo";
import type { Rol } from "@/modules/identidad/roles";
import { iniciarLoginConGoogle } from "@/lib/supabase/iniciar-login-google";

import {
  enviarCodigoInvitacion,
  guardarBorradorInvitacion,
  verificarCodigoInvitacion,
  type EstadoInvitacionPublica,
} from "./actions";

type InvitacionValida = Extract<EstadoInvitacionPublica, { estado: "valida" }>;

const NOMBRES_ROL: Record<Rol, string> = {
  dueno: "dueño",
  supervisor: "supervisor",
  coordinador: "coordinador de tráfico",
  administracion: "administración",
  conductor: "conductor",
  seller: "seller",
  super_admin: "administrador de plataforma",
};

export function FormularioAceptacion({
  token,
  info,
  esPrimerDueno,
  errorInicial,
}: {
  token: string;
  info: InvitacionValida;
  /** La invitación es la del primer dueño de un tenant recién creado (Pantalla C). */
  esPrimerDueno: boolean;
  /** `?error=` — de esta pantalla (Google) o del callback de F3. */
  errorInicial?: string;
}) {
  // El CONDUCTOR nunca llega hasta acá: `page.tsx` lo intercepta antes (ver la
  // cabecera de este archivo). Cualquier otro rol pasa por el mismo camino
  // passwordless.
  return (
    <FormularioPasswordless
      token={token}
      info={info}
      esPrimerDueno={esPrimerDueno}
      errorInicial={errorInicial}
    />
  );
}

/** El marco de los dos formularios. Sin sombra y con el radio del sistema (regla 4). */
function Tarjeta({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-sm border border-line bg-bg-raised p-6">{children}</div>;
}

// -----------------------------------------------------------------------------
// F3 — Variante PASSWORDLESS: seller y equipo interno (Pantallas C y J, sin
// contraseña). Google o código de 6 dígitos, cualquiera de los dos vale sin
// importar si ya existe cuenta o no — esa distinción la resuelve el backend
// (`aplicarAceptacionInvitacionPasswordless`), no esta pantalla.
// -----------------------------------------------------------------------------

/**
 * Traduce `?error=` — regla 45: ni confirma ni niega más de lo que el propio
 * backend ya decidió. `email_no_calza` viene del callback de Google
 * (`/auth/callback`); los otros dos, de cualquiera de los dos caminos.
 */
function errorPasswordlessDesdeUrl(codigo: string | undefined): string | null {
  switch (codigo) {
    case "email_no_calza":
      return "Esa invitación es para otro correo. Entra con el correo al que te la enviaron, o pide un código.";
    case "invitacion_invalida":
      return "Este enlace ya no es válido. Recarga la página para ver el estado real de tu invitación.";
    case "error_sistema":
      return "No pudimos completar la activación por un problema de nuestro sistema. Intenta de nuevo en unos minutos.";
    default:
      return null;
  }
}

function FormularioPasswordless({
  token,
  info,
  esPrimerDueno,
  errorInicial,
}: {
  token: string;
  info: InvitacionValida;
  esPrimerDueno: boolean;
  errorInicial?: string;
}) {
  const router = useRouter();
  const idBase = useId();

  // El rol viene de la INVITACIÓN, resuelta en el servidor: solo un seller
  // representa a alguien a quien Rutax le manda avisos de retiro.
  const esSeller = info.rol === "seller";

  const [paso, setPaso] = useState<"inicio" | "codigo">("inicio");
  const [telefonoWhatsApp, setTelefonoWhatsApp] = useState("");
  const [aceptaWhatsApp, setAceptaWhatsApp] = useState(false);
  const [enviandoGoogle, setEnviandoGoogle] = useState(false);
  const [enviandoCodigo, setEnviandoCodigo] = useState(false);
  const [error, setError] = useState<string | null>(() => errorPasswordlessDesdeUrl(errorInicial));
  // El `destino` real (`/portal/conectar-ml` o `/`) lo devuelve
  // `verificarCodigoInvitacion` recién al verificar — `IngresaCodigo` solo
  // avisa "ok", así que se guarda acá para usarlo en `onExito`.
  const destinoTrasCodigo = useRef<string>("/");

  const cargando = enviandoGoogle || enviandoCodigo;

  const opcionesWhatsApp = esSeller
    ? { telefonoWhatsApp: telefonoWhatsApp.trim() || undefined, optInWhatsApp: aceptaWhatsApp }
    : undefined;

  async function manejarGoogle() {
    setError(null);
    setEnviandoGoogle(true);
    try {
      // El TOKEN (y el opt-in de WhatsApp, si aplica) tienen que sobrevivir el
      // viaje a Google — se guardan en la cookie firmada ANTES de salir del
      // sitio; `/auth/callback` la lee de vuelta.
      const borrador = await guardarBorradorInvitacion(token, opcionesWhatsApp);
      if (!borrador.ok) {
        setError(borrador.mensaje);
        setEnviandoGoogle(false);
        return;
      }

      const supabase = createClient();
      const { error: errorOauth } = await iniciarLoginConGoogle(
        supabase,
        `${window.location.origin}/auth/callback`,
      );

      if (errorOauth) {
        setError("No pudimos conectar con Google. Intenta de nuevo.");
        setEnviandoGoogle(false);
        return;
      }
      // Sin error: el navegador ya está redirigiendo a Google. El estado de
      // carga se queda encendido a propósito — no hay a qué volver acá.
    } catch {
      setError("No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.");
      setEnviandoGoogle(false);
    }
  }

  async function manejarEnviarCodigo() {
    setError(null);
    setEnviandoCodigo(true);
    const resultado = await enviarCodigoInvitacion(token);
    setEnviandoCodigo(false);

    if (!resultado.ok) {
      setError(resultado.mensaje);
      return;
    }
    setPaso("codigo");
  }

  if (paso === "codigo") {
    return (
      <Tarjeta>
        <IngresaCodigo
          email={info.email}
          onVerificar={async (codigo) => {
            const resultado = await verificarCodigoInvitacion(token, codigo, opcionesWhatsApp);
            if (!resultado.ok) {
              return { ok: false, mensaje: resultado.mensaje };
            }
            destinoTrasCodigo.current = resultado.destino;
            return { ok: true };
          }}
          onReenviar={() => enviarCodigoInvitacion(token)}
          onExito={() => {
            router.push(destinoTrasCodigo.current);
            router.refresh();
          }}
        />
      </Tarjeta>
    );
  }

  return (
    <Tarjeta>
      <h1 className="font-heading text-xl leading-tight font-semibold">
        {esPrimerDueno ? `Activa ${info.nombreTenant}` : "Acepta tu invitación"}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
        {esPrimerDueno ? (
          <>Estás a un paso. Continúa con Google o con un código y la cuenta queda operativa.</>
        ) : (
          <>
            <span className="font-medium text-fg">{info.nombreTenant}</span> te invitó como{" "}
            {NOMBRES_ROL[info.rol]}. Continúa con Google o con un código para entrar.
          </>
        )}
      </p>
      {/* El correo se muestra y NO se puede editar: es a quien se invitó. */}
      <p className="rx-num mt-3 border border-line-subtle bg-bg-inset px-3 py-2 text-sm text-fg-muted">
        {info.email}
      </p>

      {/*
        El WhatsApp del seller, y su consentimiento — mismo criterio que
        `guardarWhatsAppInvitado` (opcional, y sin la casilla marcada no se
        guarda nada). Va acá porque el permiso lo tiene que dar el interesado.
      */}
      {esSeller ? (
        <div className="mt-4 space-y-3 rounded-md border border-border bg-bg-subtle p-3">
          <div className="space-y-2">
            <Label htmlFor={`${idBase}-whatsapp`}>
              Tu WhatsApp <span className="font-normal text-fg-muted">(opcional)</span>
            </Label>
            <Input
              id={`${idBase}-whatsapp`}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+56 9 1234 5678"
              value={telefonoWhatsApp}
              onChange={(e) => setTelefonoWhatsApp(e.target.value)}
              readOnly={cargando}
            />
            <p className="text-sm text-fg-muted">
              Para avisarte cuando retiremos pedidos desde tu bodega.
            </p>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id={`${idBase}-acepta-whatsapp`}
              checked={aceptaWhatsApp}
              onCheckedChange={(v) => setAceptaWhatsApp(v === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor={`${idBase}-acepta-whatsapp`}
              className="cursor-pointer text-sm font-normal leading-relaxed"
            >
              Acepto recibir avisos de mis entregas por WhatsApp. Puedo darme de baja
              respondiendo <span className="font-medium">BAJA</span> en cualquier momento.
            </Label>
          </div>
        </div>
      ) : null}

      {/* Embebido y persistente: si se va sola, la persona no alcanza a leerlo. */}
      {error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-5 space-y-4">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={manejarGoogle}
          disabled={cargando}
        >
          {enviandoGoogle ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <IconoGoogle className="size-4" />
          )}
          {enviandoGoogle ? "Conectando con Google…" : "Continuar con Google"}
        </Button>

        <div className="flex items-center gap-3 text-xs text-fg-subtle">
          <span className="h-px flex-1 bg-line" />
          o con un código
          <span className="h-px flex-1 bg-line" />
        </div>

        <Button type="button" className="w-full" onClick={manejarEnviarCodigo} disabled={cargando}>
          {enviandoCodigo ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {enviandoCodigo ? "Enviando código…" : "Enviar código a mi correo"}
        </Button>
      </div>
    </Tarjeta>
  );
}
