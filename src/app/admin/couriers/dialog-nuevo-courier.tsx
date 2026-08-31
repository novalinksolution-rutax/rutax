"use client";

/**
 * Alta de un courier nuevo desde el backstage — solo el correo.
 * =============================================================================
 *
 * Decisión del usuario (2026-08-30): el alta es un correo. Se invita al dueño;
 * él define su contraseña al aceptar y completa TODOS los datos de la empresa
 * (razón social, RUT, giro, dirección, sellers, conductores, tarifas) en su
 * puesta en marcha. Rutax no teclea nada de eso.
 *
 * Por eso este formulario no pide razón social, RUT ni plan. El nombre del
 * courier y el del dueño son OPCIONALES: sirven para que el admin reconozca a
 * quién invitó en el panel; si no los da, se derivan del correo y el dueño los
 * corrige después.
 */

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { accionCrearCourier } from "./alta-actions";

export function DialogNuevoCourier() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acuse, setAcuse] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reiniciar() {
    setError(null);
    setAcuse(null);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setAcuse(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const r = await accionCrearCourier(formData);
      if (!r.ok) {
        setError(r.mensaje ?? "No se pudo crear el courier.");
        return;
      }
      router.refresh();
      // No se cierra: se muestra el acuse para que el admin sepa que el correo
      // salió y que el resto lo completa el dueño. El courier ya aparece en el
      // panel (marcado «sin suscripción», a la espera de plan).
      setAcuse(
        `Invitación enviada a ${r.emailInvitado}. Cuando la acepte, el dueño define su contraseña y completa los datos de su empresa. Asígnale un plan desde Suscripciones.`,
      );
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reiniciar();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Building2 className="size-4" aria-hidden="true" />
          Nuevo courier
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dar de alta un courier</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Escribe el correo del dueño y le enviamos una invitación. Al aceptarla
          define su contraseña y completa los datos de su empresa —razón social,
          RUT y el resto— en su puesta en marcha. El plan se lo asignas después
          desde Suscripciones.
        </p>

        {acuse ? (
          <Alert>
            <AlertTitle>Invitación enviada</AlertTitle>
            <AlertDescription>{acuse}</AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <fieldset className="space-y-3" disabled={isPending}>
              <div className="space-y-1.5">
                <Label htmlFor="nc-email">Correo del dueño</Label>
                <Input id="nc-email" name="email_dueno" type="email" required placeholder="dueno@courier.cl" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nc-ref">
                  Nombre del courier <span className="text-muted-foreground">(opcional)</span>
                </Label>
                <Input id="nc-ref" name="nombre_referencia" maxLength={120} placeholder="Despachos del Centro" />
                <p className="text-xs text-muted-foreground">
                  Solo para reconocerlo en el panel. Si lo dejas en blanco, usamos el
                  correo; el dueño pone el nombre real en su puesta en marcha.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nc-dueno">
                  Nombre del dueño <span className="text-muted-foreground">(opcional)</span>
                </Label>
                <Input id="nc-dueno" name="nombre_dueno" maxLength={120} placeholder="María Pérez" />
              </div>
            </fieldset>

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>No se pudo crear el courier</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isPending}>
                  Cancelar
                </Button>
              </DialogClose>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Enviando…
                  </>
                ) : (
                  "Enviar invitación"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}

        {acuse ? (
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">Listo</Button>
            </DialogClose>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
