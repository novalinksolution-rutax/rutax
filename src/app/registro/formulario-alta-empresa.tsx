"use client";

/**
 * Pantalla A — Alta de la empresa (RF-006), F1 (login sin contraseña).
 * =============================================================================
 * Arranque MÍNIMO: 4 campos (`nombreFantasia`, `rut`, `nombreDueno`,
 * `emailDueno`) y el checkbox de consentimiento bloqueante (Ley 21.719). La
 * razón social no se pide aquí: se difiere a «Antes de facturar». El tenant
 * nace con `razon_social = null`.
 *
 * Misma puerta que `/login` (`MarcoPuerta`, columna de 400 px). Hay DOS
 * caminos, y los dos arrancan guardando el mismo borrador
 * (`guardarBorradorTenant`) porque sin identidad resuelta todavía no hay a
 * quién asignarle el tenant:
 *
 *   1. **"Continuar con Google"** — el navegador redirige a Google; el resto
 *      (crear el tenant, activar el dueño) lo resuelve `/auth/callback`.
 *   2. **"Enviar código por correo"** — `enviarCodigoRegistro` y de ahí a
 *      `/registro/revisa-tu-correo`, donde se ingresa el código de 6 dígitos
 *      con el componente compartido `IngresaCodigo` (el mismo que usa `/login`).
 */

import { useId, useRef, useState, type FormEvent, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { esRutValido } from "@/modules/identidad/rut";
import { enmascararRut, limpiarMascaraRut } from "@/lib/formato-cl";
import { createClient } from "@/lib/supabase/client";
import { IconoGoogle } from "@/components/identidad/icono-google";
import { enviarCodigoRegistro, guardarBorradorTenant } from "./actions";
import { iniciarLoginConGoogle } from "@/lib/supabase/iniciar-login-google";

const MENSAJE_RUT_INVALIDO = "El dígito verificador no coincide.";
const MENSAJE_RUT_FORMATO = "Usa el formato 12.345.678-9.";
const MENSAJE_OBLIGATORIO = "Obligatorio.";

interface CamposFormulario {
  nombreFantasia: string;
  rut: string;
  nombreDueno: string;
  emailDueno: string;
}

interface ErroresFormulario {
  nombreFantasia?: string;
  rut?: string;
  nombreDueno?: string;
  emailDueno?: string;
}

const CAMPOS_INICIALES: CamposFormulario = {
  nombreFantasia: "",
  rut: "",
  nombreDueno: "",
  emailDueno: "",
};

const CLASE_ERROR_CAMPO = "text-sm text-fault-fg";

/** Traduce `?error=` de `/auth/callback` (o de un `router.push` propio). */
function errorGeneralDesdeUrl(codigo: string | undefined): { tipo: string; mensaje: string } | null {
  switch (codigo) {
    case "correo_ocupado":
      return { tipo: "correo_ocupado", mensaje: "Ese correo ya tiene una cuenta." };
    case "conflicto_rut":
      return { tipo: "conflicto_rut", mensaje: "Ya existe un courier con este RUT." };
    case "error_sistema":
    case "oauth_invalido":
      return {
        tipo: "desconocido",
        mensaje: "No pudimos crear tu cuenta por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
      };
    default:
      return null;
  }
}

export function FormularioAltaEmpresa({ errorInicial }: { errorInicial?: string }) {
  const router = useRouter();
  const idBase = useId();

  const [campos, setCampos] = useState<CamposFormulario>(CAMPOS_INICIALES);
  const [errores, setErrores] = useState<ErroresFormulario>({});
  const [enviandoGoogle, setEnviandoGoogle] = useState(false);
  const [enviandoCodigo, setEnviandoCodigo] = useState(false);
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<{ tipo: string; mensaje: string } | null>(
    () => errorGeneralDesdeUrl(errorInicial),
  );

  const enviando = enviandoGoogle || enviandoCodigo;

  // Un ref por campo, cada uno como identificador propio: `react-hooks/refs`
  // rechaza pasarle a `ref=` un acceso a miembro de un objeto armado en cada
  // render (`refs.rut`), aunque cada valor venga de un `useRef` legítimo.
  const refNombreFantasia = useRef<HTMLInputElement>(null);
  const refRut = useRef<HTMLInputElement>(null);
  const refNombreDueno = useRef<HTMLInputElement>(null);
  const refEmailDueno = useRef<HTMLInputElement>(null);

  /** Solo para uso FUERA de render (manejadores): dónde enfocar según el campo con error. */
  function refDeCampo(campo: keyof CamposFormulario): RefObject<HTMLInputElement | null> {
    const mapa: Record<keyof CamposFormulario, RefObject<HTMLInputElement | null>> = {
      nombreFantasia: refNombreFantasia,
      rut: refRut,
      nombreDueno: refNombreDueno,
      emailDueno: refEmailDueno,
    };
    return mapa[campo];
  }

  function actualizarCampo<K extends keyof CamposFormulario>(campo: K, valor: string) {
    setCampos((anterior) => ({ ...anterior, [campo]: valor }));
    setErrores((anterior) => ({ ...anterior, [campo]: undefined }));
    setErrorGeneral(null);
  }

  function manejarCambioRut(valor: string) {
    actualizarCampo("rut", enmascararRut(valor));
  }

  function validarRutAlPerderFoco() {
    const limpio = limpiarMascaraRut(campos.rut);
    if (!limpio) return;

    const formatoOk = /^[0-9]{1,8}-[0-9kK]$/.test(limpio);
    if (!formatoOk) {
      setErrores((anterior) => ({ ...anterior, rut: MENSAJE_RUT_FORMATO }));
      return;
    }
    if (!esRutValido(limpio)) {
      setErrores((anterior) => ({ ...anterior, rut: MENSAJE_RUT_INVALIDO }));
    }
  }

  function validarFormulario(): boolean {
    const nuevosErrores: ErroresFormulario = {};

    if (!campos.nombreFantasia.trim()) {
      nuevosErrores.nombreFantasia = MENSAJE_OBLIGATORIO;
    }

    const rutLimpio = limpiarMascaraRut(campos.rut);
    if (!rutLimpio) {
      nuevosErrores.rut = MENSAJE_OBLIGATORIO;
    } else if (!/^[0-9]{1,8}-[0-9kK]$/.test(rutLimpio)) {
      nuevosErrores.rut = MENSAJE_RUT_FORMATO;
    } else if (!esRutValido(rutLimpio)) {
      nuevosErrores.rut = MENSAJE_RUT_INVALIDO;
    }

    if (!campos.nombreDueno.trim()) {
      nuevosErrores.nombreDueno = MENSAJE_OBLIGATORIO;
    }
    if (!campos.emailDueno.trim()) {
      nuevosErrores.emailDueno = MENSAJE_OBLIGATORIO;
    } else if (!campos.emailDueno.includes("@")) {
      nuevosErrores.emailDueno = "Correo inválido.";
    }

    setErrores(nuevosErrores);

    const primerCampoConError = (Object.keys(nuevosErrores)[0] as keyof CamposFormulario) || null;
    if (primerCampoConError) {
      refDeCampo(primerCampoConError).current?.focus();
    }

    return Object.keys(nuevosErrores).length === 0;
  }

  /** `guardarBorradorTenant` es el primer paso de LOS DOS caminos: sin identidad resuelta, no hay a quién asignarle el tenant. */
  async function guardarBorrador(): Promise<boolean> {
    const resultado = await guardarBorradorTenant({
      nombreFantasia: campos.nombreFantasia,
      rut: limpiarMascaraRut(campos.rut),
      nombreDueno: campos.nombreDueno,
      emailDueno: campos.emailDueno,
      aceptaTerminos,
    });

    if (resultado.ok) return true;

    if (resultado.campo && resultado.campo !== "aceptaTerminos" && resultado.campo in CAMPOS_INICIALES) {
      const campo = resultado.campo as keyof CamposFormulario;
      setErrores((anterior) => ({ ...anterior, [campo]: resultado.mensaje }));
      refDeCampo(campo).current?.focus();
    } else {
      setErrorGeneral({ tipo: resultado.campo ?? "validacion", mensaje: resultado.mensaje });
    }
    return false;
  }

  async function manejarGoogle(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setErrorGeneral(null);
    if (!validarFormulario()) return;

    setEnviandoGoogle(true);
    try {
      const ok = await guardarBorrador();
      if (!ok) {
        setEnviandoGoogle(false);
        return;
      }

      const supabase = createClient();
      const { error } = await iniciarLoginConGoogle(
        supabase,
        `${window.location.origin}/auth/callback`,
      );

      if (error) {
        setErrorGeneral({ tipo: "oauth", mensaje: "No pudimos conectar con Google. Intenta de nuevo." });
        setEnviandoGoogle(false);
      }
      // Sin error: el navegador ya está redirigiendo a Google.
    } catch {
      setErrorGeneral({
        tipo: "oauth",
        mensaje: "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.",
      });
      setEnviandoGoogle(false);
    }
  }

  async function manejarEnviarCodigo(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setErrorGeneral(null);
    if (!validarFormulario()) return;

    setEnviandoCodigo(true);
    try {
      const ok = await guardarBorrador();
      if (!ok) return;

      const correo = campos.emailDueno.trim().toLowerCase();
      const envio = await enviarCodigoRegistro(correo);
      if (!envio.ok) {
        setErrorGeneral({ tipo: "envio_codigo", mensaje: envio.mensaje });
        return;
      }

      router.push(`/registro/revisa-tu-correo?email=${encodeURIComponent(correo)}`);
    } finally {
      setEnviandoCodigo(false);
    }
  }

  return (
    <div className="w-full max-w-[400px]">
      <h1 className="font-heading text-2xl font-semibold text-fg">Crea tu cuenta</h1>

      <form
        noValidate
        className="mt-7 space-y-4"
        aria-busy={enviando}
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-nombreFantasia`}>Nombre de fantasía</Label>
          <Input
            id={`${idBase}-nombreFantasia`}
            ref={refNombreFantasia}
            autoFocus
            autoComplete="organization"
            value={campos.nombreFantasia}
            onChange={(e) => actualizarCampo("nombreFantasia", e.target.value)}
            readOnly={enviando}
            aria-invalid={Boolean(errores.nombreFantasia)}
            aria-describedby={errores.nombreFantasia ? `${idBase}-nombreFantasia-error` : undefined}
            className="pointer-coarse:h-12"
          />
          {errores.nombreFantasia ? (
            <p id={`${idBase}-nombreFantasia-error`} role="alert" className={CLASE_ERROR_CAMPO}>
              {errores.nombreFantasia}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-rut`}>RUT de la empresa</Label>
          <Input
            id={`${idBase}-rut`}
            ref={refRut}
            inputMode="text"
            autoComplete="off"
            placeholder="12.345.678-9"
            value={campos.rut}
            onChange={(e) => manejarCambioRut(e.target.value)}
            onBlur={validarRutAlPerderFoco}
            readOnly={enviando}
            aria-invalid={Boolean(errores.rut)}
            aria-describedby={errores.rut ? `${idBase}-rut-error` : undefined}
            className="pointer-coarse:h-12"
          />
          {errores.rut ? (
            <p id={`${idBase}-rut-error`} role="alert" className={CLASE_ERROR_CAMPO}>
              {errores.rut}
            </p>
          ) : null}
        </div>

        <hr className="border-line" />

        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-nombreDueno`}>Tu nombre</Label>
          <Input
            id={`${idBase}-nombreDueno`}
            ref={refNombreDueno}
            autoComplete="name"
            value={campos.nombreDueno}
            onChange={(e) => actualizarCampo("nombreDueno", e.target.value)}
            readOnly={enviando}
            aria-invalid={Boolean(errores.nombreDueno)}
            aria-describedby={errores.nombreDueno ? `${idBase}-nombreDueno-error` : undefined}
            className="pointer-coarse:h-12"
          />
          {errores.nombreDueno ? (
            <p id={`${idBase}-nombreDueno-error`} role="alert" className={CLASE_ERROR_CAMPO}>
              {errores.nombreDueno}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-emailDueno`}>Tu correo</Label>
          <Input
            id={`${idBase}-emailDueno`}
            ref={refEmailDueno}
            type="email"
            autoComplete="email"
            value={campos.emailDueno}
            onChange={(e) => actualizarCampo("emailDueno", e.target.value)}
            readOnly={enviando}
            aria-invalid={Boolean(errores.emailDueno)}
            aria-describedby={errores.emailDueno ? `${idBase}-emailDueno-error` : undefined}
            className="pointer-coarse:h-12"
          />
          {errores.emailDueno ? (
            <p id={`${idBase}-emailDueno-error`} role="alert" className={CLASE_ERROR_CAMPO}>
              {errores.emailDueno}
            </p>
          ) : null}
        </div>

        {errorGeneral ? (
          <div
            role="alert"
            className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg"
          >
            <span className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{errorGeneral.mensaje}</span>
            </span>
            {errorGeneral.tipo === "correo_ocupado" ? (
              <Link href="/login" className="mt-1.5 block font-medium underline underline-offset-4">
                Iniciar sesión ›
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* Consentimiento explícito. Va con casilla SIN marcar y bloqueando el
            envío a propósito: un consentimiento premarcado no es consentimiento
            (Ley 21.719 exige que sea inequívoco). */}
        <label className="flex items-start gap-2.5 text-sm pointer-coarse:py-2">
          <input
            type="checkbox"
            checked={aceptaTerminos}
            onChange={(e) => setAceptaTerminos(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
          />
          <span>
            Acepto los{" "}
            <a
              href="/terminos"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4"
            >
              términos
            </a>{" "}
            y la{" "}
            <a
              href="/privacidad"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4"
            >
              política de privacidad
            </a>
            .
          </span>
        </label>
        {/* PENDIENTE seguridad-cumplimiento (Q8): se conserva hasta que decidan
            si el párrafo es exigencia legal en el registro o basta la política. */}
        <p className="text-xs text-fg-muted">
          Rutax trata los datos de tus conductores y destinatarios por encargo tuyo: tú decides
          qué se recoge y para qué.
        </p>

        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            className="w-full pointer-coarse:h-12"
            disabled={enviando || !aceptaTerminos}
            onClick={manejarGoogle}
          >
            {enviandoGoogle ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <IconoGoogle className="size-4" />
            )}
            {enviandoGoogle ? "Conectando con Google…" : "Continuar con Google"}
          </Button>

          <Button
            type="button"
            className="w-full pointer-coarse:h-12"
            disabled={enviando || !aceptaTerminos}
            onClick={manejarEnviarCodigo}
          >
            {enviandoCodigo ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Enviando código…
              </>
            ) : (
              "Enviar código por correo"
            )}
          </Button>
        </div>
      </form>

      <p className="mt-8 text-center text-sm text-fg-subtle">
        <Link
          href="/login"
          className="underline underline-offset-4 hover:text-fg pointer-coarse:py-3"
        >
          Ya tengo cuenta
        </Link>
      </p>
    </div>
  );
}
