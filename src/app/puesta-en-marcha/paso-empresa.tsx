"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guardarPasoEmpresa } from "./actions";
import { PieDePaso } from "./pie-de-paso";
import { enmascararTelefono } from "./telefono";

const CLASE_ERROR = "text-sm text-fault-fg";

export function PasoEmpresa({
  inicial,
  rutVisible,
}: {
  inicial: { nombre: string; telefono: string; email: string };
  rutVisible: string;
}) {
  const router = useRouter();
  const id = useId();
  const [nombre, setNombre] = useState(inicial.nombre);
  const [telefono, setTelefono] = useState(inicial.telefono);
  const [email, setEmail] = useState(inicial.email);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (pendiente) return;
    const nuevos: Record<string, string> = {};
    if (!nombre.trim()) nuevos.nombre_comercial = "Obligatorio.";
    if (telefono.replace(/\D/g, "").length !== 9) nuevos.telefono_contacto = "Ingresa 9 dígitos.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) nuevos.email_contacto = "Correo inválido.";
    setErrores(nuevos);
    setErrorGeneral(null);
    if (Object.keys(nuevos).length) {
      document.getElementById(`${id}-${Object.keys(nuevos)[0]}`)?.focus();
      return;
    }

    const fd = new FormData();
    fd.set("nombre_comercial", nombre);
    fd.set("telefono_contacto", telefono);
    fd.set("email_contacto", email);
    iniciar(async () => {
      const r = await guardarPasoEmpresa(fd);
      if (!r.ok) {
        if (r.campo) setErrores({ [r.campo]: r.mensaje });
        else setErrorGeneral(r.mensaje);
        return;
      }
      router.push("/puesta-en-marcha?paso=2");
    });
  }

  function campoError(campo: string) {
    return errores[campo] ? (
      <p id={`${id}-${campo}-error`} role="alert" className={CLASE_ERROR}>
        {errores[campo]}
      </p>
    ) : null;
  }

  return (
    <>
      <h1 className="font-heading text-2xl font-semibold">Tu empresa</h1>
      <form id={`${id}-form`} noValidate onSubmit={enviar} className="mt-7 space-y-4" aria-busy={pendiente}>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-nombre_comercial`}>Nombre comercial</Label>
          <Input
            id={`${id}-nombre_comercial`}
            autoFocus
            autoComplete="organization"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            readOnly={pendiente}
            aria-invalid={Boolean(errores.nombre_comercial)}
            aria-describedby={errores.nombre_comercial ? `${id}-nombre_comercial-error` : undefined}
            className="pointer-coarse:h-12"
          />
          {campoError("nombre_comercial")}
        </div>

        <p className="text-sm text-fg-muted tabular-nums">RUT {rutVisible}</p>

        <hr className="border-line" />

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-telefono_contacto`}>Teléfono</Label>
          <div className="flex gap-2">
            <span className="inline-flex h-8 items-center rounded-lg border border-line bg-bg-sunken px-2.5 text-sm text-fg-muted pointer-coarse:h-12">
              +56
            </span>
            <Input
              id={`${id}-telefono_contacto`}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="9 1234 5678"
              value={telefono}
              onChange={(e) => setTelefono(enmascararTelefono(e.target.value))}
              readOnly={pendiente}
              aria-invalid={Boolean(errores.telefono_contacto)}
              aria-describedby={errores.telefono_contacto ? `${id}-telefono_contacto-error` : undefined}
              className="tabular-nums pointer-coarse:h-12"
            />
          </div>
          {campoError("telefono_contacto")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-email_contacto`}>Correo</Label>
          <Input
            id={`${id}-email_contacto`}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={pendiente}
            aria-invalid={Boolean(errores.email_contacto)}
            aria-describedby={errores.email_contacto ? `${id}-email_contacto-error` : undefined}
            className="pointer-coarse:h-12"
          />
          {campoError("email_contacto")}
        </div>

        <p className="text-sm text-fg-muted">Lo ven quienes esperan un paquete.</p>

        {errorGeneral ? (
          <p role="alert" className={CLASE_ERROR}>
            {errorGeneral}
          </p>
        ) : null}
      </form>
      <PieDePaso etiqueta="Continuar" formId={`${id}-form`} cargando={pendiente} />
    </>
  );
}
