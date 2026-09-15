"use client";

/**
 * Pantalla A — Alta de la empresa (RF-006), F1 (login sin contraseña).
 * =============================================================================
 * Mismo formulario de 5 campos de siempre (`nombreFantasia`, `razonSocial`,
 * `rut`, `nombreDueno`, `emailDueno`) y el mismo checkbox de consentimiento
 * bloqueante (Ley 21.719) — eso NO cambia en F1.
 *
 * Lo que cambia es el desenlace. Antes el botón llamaba a `altaDeEmpresa`
 * (creaba el tenant de un golpe y mandaba un correo para "crear tu
 * contraseña"). Ahora no hay contraseña que crear: hay DOS caminos, y los
 * dos arrancan guardando el mismo borrador (`guardarBorradorTenant`) porque
 * sin identidad resuelta todavía no hay a quién asignarle el tenant:
 *
 *   1. **"Continuar con Google"** — el navegador redirige a Google; el resto
 *      (crear el tenant, activar el dueño) lo resuelve `/auth/callback`.
 *   2. **"Enviar código por correo"** — `enviarCodigoRegistro` y de ahí a
 *      `/registro/revisa-tu-correo`, donde se ingresa el código de 6 dígitos
 *      con el componente compartido `IngresaCodigo` (el mismo que usa
 *      `/login`).
 */

import { useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, TriangleAlert, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { esRutValido } from "@/modules/identidad/rut";
import { enmascararRut, limpiarMascaraRut } from "@/lib/formato-cl";
import { createClient } from "@/lib/supabase/client";
import { IconoGoogle } from "@/components/identidad/icono-google";
import { enviarCodigoRegistro, guardarBorradorTenant } from "./actions";

const MENSAJE_RUT_INVALIDO = "El dígito verificador no corresponde a este RUT.";
const MENSAJE_RUT_FORMATO = "Ingresa el RUT con el formato 12.345.678-9.";

interface CamposFormulario {
  nombreFantasia: string;
  razonSocial: string;
  rut: string;
  nombreDueno: string;
  emailDueno: string;
}

interface ErroresFormulario {
  nombreFantasia?: string;
  razonSocial?: string;
  rut?: string;
  nombreDueno?: string;
  emailDueno?: string;
}

const CAMPOS_INICIALES: CamposFormulario = {
  nombreFantasia: "",
  razonSocial: "",
  rut: "",
  nombreDueno: "",
  emailDueno: "",
};

/** Traduce `?error=` de `/auth/callback` (o de un `router.push` propio). */
function errorGeneralDesdeUrl(codigo: string | undefined): { tipo: string; mensaje: string } | null {
  switch (codigo) {
    case "correo_ocupado":
      return { tipo: "correo_ocupado", mensaje: "Ese correo ya tiene una cuenta en Rutax. Usa otro o inicia sesión." };
    case "conflicto_rut":
      return { tipo: "conflicto_rut", mensaje: "Ya existe un courier registrado con este RUT." };
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
  const idAyudaTerminos = `${idBase}-ayuda-terminos`;

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
  const refRazonSocial = useRef<HTMLInputElement>(null);
  const refRut = useRef<HTMLInputElement>(null);
  const refNombreDueno = useRef<HTMLInputElement>(null);
  const refEmailDueno = useRef<HTMLInputElement>(null);

  /** Solo para uso FUERA de render (manejadores): dónde enfocar según el campo con error. */
  function refDeCampo(campo: keyof CamposFormulario): RefObject<HTMLInputElement | null> {
    const mapa: Record<keyof CamposFormulario, RefObject<HTMLInputElement | null>> = {
      nombreFantasia: refNombreFantasia,
      razonSocial: refRazonSocial,
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
      nuevosErrores.nombreFantasia = "El nombre de fantasía de tu empresa es obligatorio.";
    }
    if (!campos.razonSocial.trim()) {
      nuevosErrores.razonSocial = "La razón social de tu empresa es obligatoria.";
    }

    const rutLimpio = limpiarMascaraRut(campos.rut);
    if (!rutLimpio) {
      nuevosErrores.rut = "El RUT de tu empresa es obligatorio.";
    } else if (!/^[0-9]{1,8}-[0-9kK]$/.test(rutLimpio)) {
      nuevosErrores.rut = MENSAJE_RUT_FORMATO;
    } else if (!esRutValido(rutLimpio)) {
      nuevosErrores.rut = MENSAJE_RUT_INVALIDO;
    }

    if (!campos.nombreDueno.trim()) {
      nuevosErrores.nombreDueno = "El nombre completo del dueño es obligatorio.";
    }
    if (!campos.emailDueno.trim() || !campos.emailDueno.includes("@")) {
      nuevosErrores.emailDueno = "El email del dueño es obligatorio y debe ser un correo válido.";
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
      razonSocial: campos.razonSocial,
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
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });

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
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold">Crea tu cuenta de courier</CardTitle>
        <CardDescription>
          Registra tu empresa en un solo paso. Sin contraseña: entras con Google o con un código
          que te enviamos por correo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate className="space-y-8" onSubmit={(e) => e.preventDefault()}>
          <fieldset className="space-y-4">
            <legend className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Building2 className="size-4" aria-hidden="true" />
              Tu empresa
            </legend>

            <div className="space-y-2">
              <Label htmlFor={`${idBase}-nombreFantasia`}>Nombre de fantasía</Label>
              <Input
                id={`${idBase}-nombreFantasia`}
                ref={refNombreFantasia}
                autoFocus
                autoComplete="organization"
                placeholder="Ej: Despachos Rápidos SpA"
                value={campos.nombreFantasia}
                onChange={(e) => actualizarCampo("nombreFantasia", e.target.value)}
                readOnly={enviando}
                aria-invalid={Boolean(errores.nombreFantasia)}
                aria-describedby={errores.nombreFantasia ? `${idBase}-nombreFantasia-error` : undefined}
              />
              {errores.nombreFantasia ? (
                <p id={`${idBase}-nombreFantasia-error`} role="alert" className="text-sm text-destructive">
                  {errores.nombreFantasia}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idBase}-razonSocial`}>Razón social</Label>
              <Input
                id={`${idBase}-razonSocial`}
                ref={refRazonSocial}
                autoComplete="off"
                placeholder="Ej: Despachos Rápidos Sociedad por Acciones"
                value={campos.razonSocial}
                onChange={(e) => actualizarCampo("razonSocial", e.target.value)}
                readOnly={enviando}
                aria-invalid={Boolean(errores.razonSocial)}
                aria-describedby={errores.razonSocial ? `${idBase}-razonSocial-error` : undefined}
              />
              {errores.razonSocial ? (
                <p id={`${idBase}-razonSocial-error`} role="alert" className="text-sm text-destructive">
                  {errores.razonSocial}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
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
              />
              {errores.rut ? (
                <p id={`${idBase}-rut-error`} role="alert" className="text-sm text-destructive">
                  {errores.rut}
                </p>
              ) : null}
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <User className="size-4" aria-hidden="true" />
              Tú, como dueño
            </legend>

            <div className="space-y-2">
              <Label htmlFor={`${idBase}-nombreDueno`}>Nombre completo</Label>
              <Input
                id={`${idBase}-nombreDueno`}
                ref={refNombreDueno}
                autoComplete="name"
                placeholder="Ej: María Pérez Soto"
                value={campos.nombreDueno}
                onChange={(e) => actualizarCampo("nombreDueno", e.target.value)}
                readOnly={enviando}
                aria-invalid={Boolean(errores.nombreDueno)}
                aria-describedby={errores.nombreDueno ? `${idBase}-nombreDueno-error` : undefined}
              />
              {errores.nombreDueno ? (
                <p id={`${idBase}-nombreDueno-error`} role="alert" className="text-sm text-destructive">
                  {errores.nombreDueno}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idBase}-emailDueno`}>Correo electrónico</Label>
              <Input
                id={`${idBase}-emailDueno`}
                ref={refEmailDueno}
                type="email"
                autoComplete="email"
                placeholder="tu@empresa.cl"
                value={campos.emailDueno}
                onChange={(e) => actualizarCampo("emailDueno", e.target.value)}
                readOnly={enviando}
                aria-invalid={Boolean(errores.emailDueno)}
                aria-describedby={errores.emailDueno ? `${idBase}-emailDueno-error` : undefined}
              />
              {errores.emailDueno ? (
                <p id={`${idBase}-emailDueno-error`} role="alert" className="text-sm text-destructive">
                  {errores.emailDueno}
                </p>
              ) : null}
            </div>
          </fieldset>

          {errorGeneral ? (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" aria-hidden="true" />
              <AlertTitle>
                {errorGeneral.tipo === "conflicto_rut"
                  ? "Ya existe un courier registrado con este RUT"
                  : errorGeneral.tipo === "correo_ocupado"
                    ? "Ese correo ya tiene una cuenta"
                    : "No pudimos continuar"}
              </AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{errorGeneral.mensaje}</p>
                {errorGeneral.tipo === "correo_ocupado" ? (
                  <p>
                    <a href="/login" className="font-medium underline underline-offset-4">
                      ¿Ya tienes cuenta? Inicia sesión
                    </a>
                  </p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {/* Consentimiento explícito. Va con casilla SIN marcar y bloqueando el
              envío a propósito: un consentimiento premarcado no es consentimiento
              (Ley 21.719 exige que sea inequívoco), y un "al continuar aceptas"
              al pie no deja constancia de que alguien decidió nada. */}
          <div className="space-y-3">
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={aceptaTerminos}
                onChange={(e) => setAceptaTerminos(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                aria-describedby={idAyudaTerminos}
              />
              <span>
                He leído y acepto los{" "}
                <a
                  href="/terminos"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline underline-offset-4"
                >
                  términos y condiciones
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
            <p id={idAyudaTerminos} className="pl-6.5 text-xs text-muted-foreground">
              Rutax trata los datos de tus conductores y destinatarios por encargo tuyo: tú
              decides qué se recoge y para qué.
            </p>
          </div>

          <div className="space-y-3">
            <Button
              type="button"
              size="lg"
              className="w-full sm:w-auto"
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
              size="lg"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={enviando || !aceptaTerminos}
              onClick={manejarEnviarCodigo}
            >
              {enviandoCodigo ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {enviandoCodigo ? "Enviando código…" : "Enviar código por correo"}
            </Button>

            <p className="text-sm text-muted-foreground">
              Con Google entras al tiro. Con el código, te lo enviamos a{" "}
              {campos.emailDueno.trim() || "tu correo"} y dura 10 minutos.
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
