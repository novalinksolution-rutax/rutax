"use client";

/**
 * Pantalla I — Formulario de invitación (panel lateral, no página completa).
 *
 * Captura email + rol en el menor número de pasos (§2.2: "esta es una acción
 * que el dueño repetirá varias veces — cada fricción se multiplica"). Sin
 * selector de `tipo_usuario`/`seller_id`/`driver_id` — esta pantalla es
 * EXCLUSIVA del equipo interno (`tipo_usuario = 'interno'` inferido).
 *
 * Importante (§2.2): "Frontend no debe intentar 'verificar si el correo
 * existe' antes de invitar" — se envía directo. El backend (`crearInvitacion`,
 * vía `aceptarInvitacion`) ya contempla re-invitar a alguien existente.
 */

import { useId, useState, type FormEvent } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ROLES_INTERNOS, type RolInterno } from "@/modules/identidad/roles";
import { DESCRIPCIONES_ROLES_INTERNOS } from "./descripciones-roles";
import { invitarPersona, type InvitacionEnviada } from "./actions";

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  onInvitada: (invitacion: InvitacionEnviada) => void;
}

export function FormularioInvitacion({ abierto, onCerrar, onInvitada }: Props) {
  const idBase = useId();
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<RolInterno | null>(null);
  const [errorEmail, setErrorEmail] = useState<string | null>(null);
  const [errorRol, setErrorRol] = useState<string | null>(null);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Estado limpio cada vez que se abre — evita arrastrar datos de la
  // invitación anterior (criterio transversal: cada apertura es una acción
  // nueva). Se "ajusta durante el render" (patrón recomendado por React para
  // resetear estado cuando cambia una prop) en vez de un useEffect — evita el
  // doble render que produce llamar a setState sincrónicamente en un efecto.
  const [abiertoAnterior, setAbiertoAnterior] = useState(abierto);
  if (abierto !== abiertoAnterior) {
    setAbiertoAnterior(abierto);
    if (abierto) {
      setEmail("");
      setRol(null);
      setErrorEmail(null);
      setErrorRol(null);
      setErrorServidor(null);
      setEnviando(false);
    }
  }

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;

    setErrorServidor(null);
    let valido = true;

    const correo = email.trim().toLowerCase();
    if (!correo || !correo.includes("@")) {
      setErrorEmail("Ingresa un correo válido.");
      valido = false;
    } else {
      setErrorEmail(null);
    }

    if (!rol) {
      setErrorRol("Elige el rol que tendrá esta persona.");
      valido = false;
    } else {
      setErrorRol(null);
    }

    if (!valido || !rol) return;

    setEnviando(true);
    const resultado = await invitarPersona({ email: correo, rol });
    setEnviando(false);

    if (!resultado.ok) {
      if (resultado.tipo === "validacion" && resultado.mensaje.toLowerCase().includes("correo")) {
        setErrorEmail(resultado.mensaje);
      } else if (resultado.tipo === "validacion" && resultado.mensaje.toLowerCase().includes("rol")) {
        setErrorRol(resultado.mensaje);
      } else {
        setErrorServidor(resultado.mensaje);
      }
      return;
    }

    toast.success(`Invitación enviada a ${resultado.invitacion.email}`);
    onInvitada(resultado.invitacion);
  }

  return (
    <Sheet open={abierto} onOpenChange={(siguiente) => { if (!siguiente) onCerrar(); }}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Invitar a una persona</SheetTitle>
          <SheetDescription>
            Le enviaremos un correo con un enlace para que defina su contraseña y empiece a usar la cuenta con el rol
            que elijas.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={manejarEnvio} className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-2">
          <div className="space-y-2">
            <Label htmlFor={`${idBase}-email`}>Correo electrónico</Label>
            <Input
              id={`${idBase}-email`}
              type="email"
              autoFocus
              autoComplete="off"
              placeholder="persona@ejemplo.cl"
              value={email}
              onChange={(evento) => { setEmail(evento.target.value); setErrorEmail(null); setErrorServidor(null); }}
              aria-invalid={errorEmail ? true : undefined}
            />
            {errorEmail ? <p className="text-sm text-destructive">{errorEmail}</p> : null}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Rol</legend>
            <div className="space-y-2">
              {ROLES_INTERNOS.map((opcion) => {
                const info = DESCRIPCIONES_ROLES_INTERNOS[opcion];
                const seleccionado = rol === opcion;
                return (
                  <label
                    key={opcion}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      seleccionado ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${idBase}-rol`}
                      value={opcion}
                      checked={seleccionado}
                      onChange={() => { setRol(opcion); setErrorRol(null); setErrorServidor(null); }}
                      className="mt-1 size-4 accent-primary"
                    />
                    <span className="space-y-0.5">
                      <span className="block text-sm font-medium text-foreground">{info.etiqueta}</span>
                      <span className="block text-xs text-muted-foreground">{info.descripcion}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {errorRol ? <p className="text-sm text-destructive">{errorRol}</p> : null}
          </fieldset>

          {errorServidor ? (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertDescription>{errorServidor}</AlertDescription>
            </Alert>
          ) : null}

          <SheetFooter className="mt-auto px-0">
            <Button type="submit" disabled={enviando} className="w-full">
              {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {enviando ? "Enviando…" : "Enviar invitación"}
            </Button>
            <SheetClose asChild>
              <Button type="button" variant="ghost" className="w-full" disabled={enviando}>
                Cancelar
              </Button>
            </SheetClose>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
