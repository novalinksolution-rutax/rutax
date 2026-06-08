"use client";

/**
 * Pantalla K — Formulario de alta + invitación de seller (§3.2).
 *
 * "Estados análogos a la Pantalla I": validación en vivo, envío, éxito con
 * toast + limpieza para seguir invitando, error de email/RUT duplicado. RUT
 * validado igual que el del courier (módulo 11) — mismo mensaje cliente↔servidor
 * (criterio transversal #3).
 */

import { useId, useState, type FormEvent } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { esRutValido } from "@/modules/identidad/rut";
import { enmascararRut, limpiarMascaraRut } from "@/lib/formato-cl";
import { invitarSeller } from "./actions";

const MENSAJE_RUT_INVALIDO = "El dígito verificador no corresponde a este RUT.";
const MENSAJE_RUT_FORMATO = "Ingresa el RUT con el formato 12.345.678-9.";

interface CamposFormulario {
  razonSocial: string;
  rut: string;
  nombreContacto: string;
  emailContacto: string;
}

interface ErroresFormulario {
  razonSocial?: string;
  rut?: string;
  nombreContacto?: string;
  emailContacto?: string;
}

const CAMPOS_INICIALES: CamposFormulario = {
  razonSocial: "",
  rut: "",
  nombreContacto: "",
  emailContacto: "",
};

export function FormularioInvitarSeller() {
  const idBase = useId();
  const [campos, setCampos] = useState<CamposFormulario>(CAMPOS_INICIALES);
  const [errores, setErrores] = useState<ErroresFormulario>({});
  const [enviando, setEnviando] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);

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

    if (!campos.razonSocial.trim()) {
      nuevosErrores.razonSocial = "La razón social del seller es obligatoria.";
    }

    const rutLimpio = limpiarMascaraRut(campos.rut);
    if (!rutLimpio) {
      nuevosErrores.rut = "El RUT del seller es obligatorio.";
    } else if (!/^[0-9]{1,8}-[0-9kK]$/.test(rutLimpio)) {
      nuevosErrores.rut = MENSAJE_RUT_FORMATO;
    } else if (!esRutValido(rutLimpio)) {
      nuevosErrores.rut = MENSAJE_RUT_INVALIDO;
    }

    if (!campos.nombreContacto.trim()) {
      nuevosErrores.nombreContacto = "Ingresa el nombre de la persona de contacto.";
    }

    const email = campos.emailContacto.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      nuevosErrores.emailContacto = "Ingresa un correo de contacto válido.";
    }

    setErrores(nuevosErrores);
    return Object.keys(nuevosErrores).length === 0;
  }

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;

    setErrorServidor(null);
    if (!validarFormulario()) return;

    setEnviando(true);
    const resultado = await invitarSeller({
      razonSocial: campos.razonSocial.trim(),
      rut: limpiarMascaraRut(campos.rut),
      nombreContacto: campos.nombreContacto.trim(),
      emailContacto: campos.emailContacto.trim().toLowerCase(),
    });
    setEnviando(false);

    if (!resultado.ok) {
      if (resultado.tipo === "validacion" && resultado.mensaje.toLowerCase().includes("rut")) {
        setErrores((anterior) => ({ ...anterior, rut: resultado.mensaje }));
      } else if (resultado.tipo === "validacion" && resultado.mensaje.toLowerCase().includes("correo")) {
        setErrores((anterior) => ({ ...anterior, emailContacto: resultado.mensaje }));
      } else if (resultado.tipo === "validacion" && resultado.mensaje.toLowerCase().includes("razón")) {
        setErrores((anterior) => ({ ...anterior, razonSocial: resultado.mensaje }));
      } else {
        setErrorServidor(resultado.mensaje);
      }
      return;
    }

    toast.success(`Invitamos a ${resultado.seller.razonSocial} — le llegará un correo a ${resultado.seller.emailContacto}.`);
    // Limpia el formulario para seguir invitando sin recargar — "esta es una
    // acción que el courier repetirá varias veces" (mismo principio que la I).
    setCampos(CAMPOS_INICIALES);
    setErrores({});
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={manejarEnvio} noValidate className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={`${idBase}-razon-social`}>Razón social</Label>
            <Input
              id={`${idBase}-razon-social`}
              autoFocus
              placeholder="Ej: Comercial Andes Limitada"
              value={campos.razonSocial}
              onChange={(e) => actualizarCampo("razonSocial", e.target.value)}
              aria-invalid={Boolean(errores.razonSocial)}
              aria-describedby={errores.razonSocial ? `${idBase}-razon-social-error` : undefined}
            />
            {errores.razonSocial ? (
              <p id={`${idBase}-razon-social-error`} className="text-sm text-destructive">
                {errores.razonSocial}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idBase}-rut`}>RUT del seller</Label>
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

          <div className="space-y-2">
            <Label htmlFor={`${idBase}-nombre-contacto`}>Nombre de contacto</Label>
            <Input
              id={`${idBase}-nombre-contacto`}
              placeholder="Ej: María Pérez"
              value={campos.nombreContacto}
              onChange={(e) => actualizarCampo("nombreContacto", e.target.value)}
              aria-invalid={Boolean(errores.nombreContacto)}
              aria-describedby={errores.nombreContacto ? `${idBase}-nombre-contacto-error` : undefined}
            />
            {errores.nombreContacto ? (
              <p id={`${idBase}-nombre-contacto-error`} className="text-sm text-destructive">
                {errores.nombreContacto}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idBase}-email-contacto`}>Correo de contacto</Label>
            <Input
              id={`${idBase}-email-contacto`}
              type="email"
              autoComplete="off"
              placeholder="contacto@empresa.cl"
              value={campos.emailContacto}
              onChange={(e) => actualizarCampo("emailContacto", e.target.value)}
              aria-invalid={Boolean(errores.emailContacto)}
              aria-describedby={errores.emailContacto ? `${idBase}-email-contacto-error` : undefined}
            />
            {errores.emailContacto ? (
              <p id={`${idBase}-email-contacto-error`} className="text-sm text-destructive">
                {errores.emailContacto}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              A este correo le enviaremos el enlace para que el seller entre a su portal y conecte su cuenta de
              Mercado Libre.
            </p>
          </div>

          {errorServidor ? (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertDescription>{errorServidor}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={enviando} className="w-full sm:w-auto">
            {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {enviando ? "Invitando…" : "Invitar a este seller"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
