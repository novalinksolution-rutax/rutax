"use client";

/**
 * Acceso a la app — sección de la ficha del conductor (`/conductores/[id]`).
 *
 * Antes de invitar, la ficha DEBE decir si el conductor ya tiene cuenta, si
 * tiene una invitación pendiente, o si no tiene nada — invitar dos veces al
 * mismo conductor (o no saber si ya se invitó) es exactamente la fricción que
 * este botón viene a quitar (encargo). Por eso el estado inicial se calcula
 * SIEMPRE en el servidor (`page.tsx` → `resolverEstadoAccesoApp`) y el botón
 * "Invitar a la app" solo aparece cuando de verdad no hay nada pendiente; el
 * backend (`actions.ts`) repite el mismo chequeo antes de crear la invitación
 * — ocultar el botón en la UI no basta (CLAUDE.md).
 *
 * "Copiar enlace" es obligatorio, no opcional (el correo puede no llegar —
 * sandbox, rebote): mismo patrón que `sellers/boton-copiar-invitacion.tsx`,
 * el token se pide bajo demanda (nunca viaja en el HTML de la página) y cada
 * entrega queda auditada (`obtenerInvitacionPendienteConductor`).
 */

import { useId, useState, type FormEvent } from "react";
import { Check, Copy, Loader2, ShieldAlert, Smartphone, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { formatearFecha } from "@/lib/formato-cl";
import { invitarConductor, obtenerInvitacionPendienteConductor } from "./actions";

export type EstadoAccesoAppConductor =
  | { tipo: "cuenta_activa" }
  | { tipo: "cuenta_suspendida" }
  | {
      tipo: "invitacion_pendiente";
      email: string;
      expiraEn: string;
      emailEstado: string | null;
      emailMotivo: string | null;
    }
  | { tipo: "sin_acceso"; ultimaInvitacionVencida: string | null };

interface Props {
  driverId: string;
  nombreConductor: string;
  puedeInvitar: boolean;
  estadoInicial: EstadoAccesoAppConductor;
}

export function AccesoAppConductor({ driverId, nombreConductor, puedeInvitar, estadoInicial }: Props) {
  const [estado, setEstado] = useState<EstadoAccesoAppConductor>(estadoInicial);

  return (
    <div className="rounded-lg border bg-card px-5 py-4 space-y-3">
      <div className="flex items-center gap-2">
        <Smartphone className="size-4 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">Acceso a la app del conductor</p>
      </div>

      {estado.tipo === "cuenta_activa" && (
        <div className="flex flex-wrap items-center gap-2">
          <DistintivoEstado tono="neutral" etiqueta="Tiene cuenta activa" />
          <span className="text-sm text-muted-foreground">
            Puede iniciar sesión en la app y ver su manifiesto del día.
          </span>
        </div>
      )}

      {estado.tipo === "cuenta_suspendida" && (
        <div className="flex flex-wrap items-center gap-2">
          <DistintivoEstado tono="inert" etiqueta="Cuenta suspendida" />
          <span className="text-sm text-muted-foreground">
            Tiene una cuenta creada, pero no puede iniciar sesión mientras esté suspendida.
          </span>
        </div>
      )}

      {estado.tipo === "invitacion_pendiente" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <DistintivoEstado tono="neutral" etiqueta="Invitación pendiente" />
            <span className="text-sm text-muted-foreground">
              Enviada a {estado.email} · vence el {formatearFecha(estado.expiraEn)}
            </span>
          </div>
          {avisoEntrega(estado.emailEstado, estado.emailMotivo)}
          <BotonCopiarInvitacion driverId={driverId} nombreConductor={nombreConductor} />
        </div>
      )}

      {estado.tipo === "sin_acceso" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Sin acceso a la app</Badge>
            <span className="text-sm text-muted-foreground">
              Todavía no puede iniciar sesión en la app del conductor.
            </span>
          </div>
          {estado.ultimaInvitacionVencida && (
            <p className="text-xs text-muted-foreground">
              La invitación anterior venció el {formatearFecha(estado.ultimaInvitacionVencida)}.
            </p>
          )}
          {puedeInvitar && (
            <DialogInvitarConductor
              driverId={driverId}
              nombreConductor={nombreConductor}
              onInvitado={(invitacion) =>
                setEstado({
                  tipo: "invitacion_pendiente",
                  email: invitacion.email,
                  expiraEn: invitacion.expiraEn,
                  emailEstado: null,
                  emailMotivo: null,
                })
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Mismo criterio que `sellers/page.tsx` → `avisoEntrega`: solo dice algo cuando hay algo que hacer. */
function avisoEntrega(estado: string | null, motivo: string | null) {
  if (estado === "rebotado") {
    return (
      <p className="text-xs font-medium text-destructive">
        El correo rebotó — no llegó
        {motivo ? <span className="block font-normal text-muted-foreground">{motivo}</span> : null}
      </p>
    );
  }
  if (estado === "marcado_spam") {
    return <p className="text-xs font-medium text-warning">Llegó, pero lo marcaron como spam</p>;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Dialog — Invitar a la app
// -----------------------------------------------------------------------------

function DialogInvitarConductor({
  driverId,
  nombreConductor,
  onInvitado,
}: {
  driverId: string;
  nombreConductor: string;
  onInvitado: (invitacion: { email: string; expiraEn: string; emailEnviado: boolean }) => void;
}) {
  const idBase = useId();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetear() {
    setEmail("");
    setError(null);
    setEnviando(false);
  }

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setError(null);

    const correo = email.trim().toLowerCase();
    if (!correo || !correo.includes("@")) {
      setError("Ingresa un correo válido.");
      return;
    }

    setEnviando(true);
    const resultado = await invitarConductor(driverId, correo);
    setEnviando(false);

    if (!resultado.ok) {
      setError(resultado.mensaje);
      return;
    }

    // El mensaje refleja lo que REALMENTE pasó con el correo — prometer un
    // envío que no ocurrió deja al conductor esperando y al courier sin saber
    // por qué nunca entró (mismo criterio que `formulario-invitar-seller.tsx`).
    if (resultado.invitacion.emailEnviado) {
      toast.success(`Invitamos a ${nombreConductor}.`, {
        description: `Enviamos el correo a ${resultado.invitacion.email}. Si no le llega, usa "Copiar enlace" aquí mismo.`,
      });
    } else {
      toast.success(`Creamos la invitación de ${nombreConductor}.`, {
        description: 'No pudimos enviar el correo. Usa "Copiar enlace" para mandárselo tú.',
      });
    }

    onInvitado(resultado.invitacion);
    setOpen(false);
    resetear();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetear();
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="size-4" aria-hidden="true" />
          Invitar a la app
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invitar a {nombreConductor} a la app</DialogTitle>
          <DialogDescription>
            Le enviaremos un correo con un enlace para que defina su contraseña y entre a ver su manifiesto del día.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={manejarEnvio} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${idBase}-email`}>Correo del conductor</Label>
            <Input
              id={`${idBase}-email`}
              type="email"
              autoFocus
              autoComplete="off"
              placeholder="conductor@ejemplo.cl"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              disabled={enviando}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${idBase}-email-error` : undefined}
            />
          </div>

          {error && (
            <Alert variant="destructive" id={`${idBase}-email-error`}>
              <ShieldAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={enviando}>
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" loading={enviando}>
              {enviando ? "Invitando…" : "Enviar invitación"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Botón "Copiar enlace" — mismo patrón que `sellers/boton-copiar-invitacion.tsx`,
// adaptado a conductor. No se reusa el componente de sellers directamente: vive
// en la carpeta de `sellers/` y su acción está atada a `sellerId`; duplicar
// esta pieza pequeña evita acoplar dos módulos que hoy no comparten frontera.
// -----------------------------------------------------------------------------

function BotonCopiarInvitacion({ driverId, nombreConductor }: { driverId: string; nombreConductor: string }) {
  const [cargando, setCargando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  /** Solo se llena si el portapapeles falló — es el plan B visible. */
  const [enlaceVisible, setEnlaceVisible] = useState<string | null>(null);

  async function manejarClic() {
    if (cargando) return;
    setCargando(true);
    setEnlaceVisible(null);

    const resultado = await obtenerInvitacionPendienteConductor(driverId);
    setCargando(false);

    if (!resultado.ok) {
      toast.error(resultado.mensaje);
      return;
    }

    const enlace = `${window.location.origin}/invitacion/${resultado.token}`;

    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
      toast.success(`Enlace de ${nombreConductor} copiado — mándaselo a ${resultado.email}.`, {
        description: "Es de un solo uso: quien lo abra entra como este conductor.",
      });
    } catch {
      setEnlaceVisible(enlace);
      toast.warning("No pudimos copiarlo solo — cópialo del campo de abajo.");
    }
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        onClick={manejarClic}
        disabled={cargando}
        aria-label={`Copiar enlace de invitación de ${nombreConductor}`}
      >
        {cargando ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : copiado ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
        {copiado ? "Copiado" : "Copiar enlace"}
      </Button>

      {enlaceVisible ? (
        <input
          readOnly
          autoFocus
          value={enlaceVisible}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full min-w-0 rounded-md border border-input bg-background px-2 py-1 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
          aria-label={`Enlace de invitación de ${nombreConductor}`}
        />
      ) : null}
    </div>
  );
}
