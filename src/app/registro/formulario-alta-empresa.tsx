"use client";

/**
 * Pantalla A — Alta de la empresa (RF-006).
 *
 * Un solo formulario en dos bloques visuales ("Tu empresa" / "Tú, como
 * dueño"), sin pedir contraseña (el dueño la define al aceptar la invitación
 * — comunicado explícitamente bajo el botón). Validación de RUT en vivo en el
 * cliente con el MISMO mensaje que produce el backend (`normalizarYValidarRut`)
 * — criterio transversal #3.
 */

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { esRutValido } from "@/modules/identidad/rut";
import { enmascararRut, limpiarMascaraRut } from "@/lib/formato-cl";
import { altaDeEmpresa } from "./actions";

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

export function FormularioAltaEmpresa() {
  const router = useRouter();
  const idBase = useId();

  const [campos, setCampos] = useState<CamposFormulario>(CAMPOS_INICIALES);
  const [errores, setErrores] = useState<ErroresFormulario>({});
  const [enviando, setEnviando] = useState(false);
  const [errorServidor, setErrorServidor] = useState<{ tipo: string; mensaje: string } | null>(null);

  function actualizarCampo<K extends keyof CamposFormulario>(campo: K, valor: string) {
    setCampos((anterior) => ({ ...anterior, [campo]: valor }));
    setErrores((anterior) => ({ ...anterior, [campo]: undefined }));
    setErrorServidor(null);
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
      nuevosErrores.nombreFantasia = "El nombre de fantasía del courier es obligatorio.";
    }
    if (!campos.razonSocial.trim()) {
      nuevosErrores.razonSocial = "La razón social del courier es obligatoria.";
    }

    const rutLimpio = limpiarMascaraRut(campos.rut);
    if (!rutLimpio) {
      nuevosErrores.rut = "El RUT del courier es obligatorio.";
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
    return Object.keys(nuevosErrores).length === 0;
  }

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return; // evitar doble submit por doble clic

    setErrorServidor(null);
    if (!validarFormulario()) return;

    setEnviando(true);
    try {
      const resultado = await altaDeEmpresa({
        nombreFantasia: campos.nombreFantasia,
        razonSocial: campos.razonSocial,
        rut: limpiarMascaraRut(campos.rut),
        nombreDueno: campos.nombreDueno,
        emailDueno: campos.emailDueno,
      });

      if (resultado.ok) {
        router.push(`/registro/revisa-tu-correo?email=${encodeURIComponent(resultado.email)}`);
        return;
      }

      setErrorServidor({ tipo: resultado.tipo, mensaje: resultado.mensaje });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-2xl">Crea tu cuenta de courier</CardTitle>
        <CardDescription>
          Registra tu empresa en un solo paso. Te enviaremos un correo para activar tu cuenta y crear tu contraseña.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={manejarEnvio} noValidate className="space-y-8">
          <fieldset className="space-y-4">
            <legend className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Building2 className="size-4" aria-hidden="true" />
              Tu empresa
            </legend>

            <div className="space-y-2">
              <Label htmlFor={`${idBase}-nombreFantasia`}>Nombre de fantasía</Label>
              <Input
                id={`${idBase}-nombreFantasia`}
                autoFocus
                placeholder="Ej: Despachos Rápidos SpA"
                value={campos.nombreFantasia}
                onChange={(e) => actualizarCampo("nombreFantasia", e.target.value)}
                aria-invalid={Boolean(errores.nombreFantasia)}
                aria-describedby={errores.nombreFantasia ? `${idBase}-nombreFantasia-error` : undefined}
              />
              {errores.nombreFantasia ? (
                <p id={`${idBase}-nombreFantasia-error`} className="text-sm text-destructive">
                  {errores.nombreFantasia}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idBase}-razonSocial`}>Razón social</Label>
              <Input
                id={`${idBase}-razonSocial`}
                placeholder="Ej: Despachos Rápidos Sociedad por Acciones"
                value={campos.razonSocial}
                onChange={(e) => actualizarCampo("razonSocial", e.target.value)}
                aria-invalid={Boolean(errores.razonSocial)}
                aria-describedby={errores.razonSocial ? `${idBase}-razonSocial-error` : undefined}
              />
              {errores.razonSocial ? (
                <p id={`${idBase}-razonSocial-error`} className="text-sm text-destructive">
                  {errores.razonSocial}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idBase}-rut`}>RUT de la empresa</Label>
              <Input
                id={`${idBase}-rut`}
                inputMode="text"
                placeholder="12.345.678-9"
                value={campos.rut}
                onChange={(e) => manejarCambioRut(e.target.value)}
                onBlur={validarRutAlPerderFoco}
                aria-invalid={Boolean(errores.rut)}
                aria-describedby={errores.rut ? `${idBase}-rut-error` : undefined}
              />
              {errores.rut ? (
                <p id={`${idBase}-rut-error`} className="text-sm text-destructive">
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
                placeholder="Ej: María Pérez Soto"
                value={campos.nombreDueno}
                onChange={(e) => actualizarCampo("nombreDueno", e.target.value)}
                aria-invalid={Boolean(errores.nombreDueno)}
                aria-describedby={errores.nombreDueno ? `${idBase}-nombreDueno-error` : undefined}
              />
              {errores.nombreDueno ? (
                <p id={`${idBase}-nombreDueno-error`} className="text-sm text-destructive">
                  {errores.nombreDueno}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idBase}-emailDueno`}>Correo electrónico</Label>
              <Input
                id={`${idBase}-emailDueno`}
                type="email"
                placeholder="tu@empresa.cl"
                value={campos.emailDueno}
                onChange={(e) => actualizarCampo("emailDueno", e.target.value)}
                aria-invalid={Boolean(errores.emailDueno)}
                aria-describedby={errores.emailDueno ? `${idBase}-emailDueno-error` : undefined}
              />
              {errores.emailDueno ? (
                <p id={`${idBase}-emailDueno-error`} className="text-sm text-destructive">
                  {errores.emailDueno}
                </p>
              ) : null}
            </div>
          </fieldset>

          {errorServidor ? (
            <Alert variant="destructive">
              <AlertTitle>
                {errorServidor.tipo === "conflicto_rut"
                  ? "Ya existe un courier registrado con este RUT"
                  : errorServidor.tipo === "conflicto_email"
                    ? "Ya existe una cuenta con este correo"
                    : errorServidor.tipo === "validacion"
                      ? "Revisa los datos ingresados"
                      : "No pudimos crear tu cuenta"}
              </AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{errorServidor.mensaje}</p>
                {errorServidor.tipo === "conflicto_rut" ? (
                  <p>
                    Si crees que esto es un error,{" "}
                    <a href="/soporte" className="font-medium underline underline-offset-4">
                      contacta a soporte
                    </a>
                    .
                  </p>
                ) : null}
                {errorServidor.tipo === "conflicto_email" ? (
                  <p>
                    <a href="/login" className="font-medium underline underline-offset-4">
                      ¿Ya tienes cuenta? Inicia sesión
                    </a>
                  </p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-3">
            <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={enviando}>
              {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {enviando ? "Creando tu cuenta…" : "Crear mi cuenta"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Te enviaremos un correo a {campos.emailDueno.trim() || "tu correo"} para que crees tu contraseña y
              actives tu cuenta.
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
