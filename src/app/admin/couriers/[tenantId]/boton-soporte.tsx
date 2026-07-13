"use client";

/**
 * Botón + modal "Ver como el courier (soporte)" — gap 4, F3-B.
 *
 * Pide el MOTIVO (obligatorio, mínimo `largoMinimoMotivo` caracteres) antes de
 * abrir la ventana de soporte, y deja clarísimo en el propio modal que:
 *   (a) la sesión queda AUDITADA con el usuario del admin,
 *   (b) es de SOLO LECTURA,
 *   (c) dura `duracionMinutos` minutos.
 * `duracionMinutos`/`largoMinimoMotivo` llegan por props desde el Server
 * Component (`page.tsx`) — este archivo es "use client" y NO puede importar
 * las constantes directo de `@/modules/plataforma/soporte` (ese módulo usa
 * `next/headers`, server-only; importarlo aquí rompería el bundle de cliente).
 */

import { useState, useTransition } from "react";
import { ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { accionIniciarSoporte } from "./soporte-actions";

interface Props {
  tenantId: string;
  nombreCourier: string;
  duracionMinutos: number;
  largoMinimoMotivo: number;
}

export function BotonSoporte({ tenantId, nombreCourier, duracionMinutos, largoMinimoMotivo }: Props) {
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const largo = motivo.trim().length;
  const motivoValido = largo >= largoMinimoMotivo;

  function alCambiarAbierto(siguienteAbierto: boolean) {
    setOpen(siguienteAbierto);
    if (!siguienteAbierto) {
      // Limpia el modal al cerrarlo (cancelar o Escape) — la próxima vez que
      // se abra empieza en blanco, no arrastra el motivo de un intento previo.
      setError(null);
      setMotivo("");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!motivoValido) {
      setError(`El motivo debe tener al menos ${largoMinimoMotivo} caracteres.`);
      return;
    }

    const formData = new FormData();
    formData.set("motivo", motivo.trim());

    startTransition(async () => {
      const resultado = await accionIniciarSoporte(tenantId, formData);
      if (resultado?.ok === false) {
        setError(resultado.mensaje);
      }
      // Si tuvo éxito, accionIniciarSoporte hace redirect — no hay que manejar nada más.
    });
  }

  return (
    <Dialog open={open} onOpenChange={alCambiarAbierto}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ShieldAlert className="size-3.5" aria-hidden="true" />
          Ver como el courier (soporte)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Entrar en modo soporte</DialogTitle>
          <DialogDescription>
            Vas a ver los datos de <strong className="text-foreground">{nombreCourier}</strong> como si
            fueras su cuenta, en modo <strong className="text-foreground">solo lectura</strong> durante{" "}
            {duracionMinutos} minutos. Esta acción queda registrada en la bitácora de auditoría con tu
            usuario.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="motivo-soporte">Motivo de la entrada (obligatorio)</Label>
            <Textarea
              id="motivo-soporte"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: Revisar por qué el seller no ve su factura del período de junio."
              rows={3}
              maxLength={500}
              disabled={isPending}
              aria-describedby="motivo-soporte-contador"
              aria-invalid={error ? true : undefined}
            />
            <p
              id="motivo-soporte-contador"
              className={motivoValido ? "text-xs text-muted-foreground" : "text-xs text-warning"}
            >
              {largo}/{largoMinimoMotivo} caracteres mínimos
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isPending}>
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isPending || !motivoValido} loading={isPending}>
              {isPending ? "Entrando…" : "Entrar en modo soporte"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
