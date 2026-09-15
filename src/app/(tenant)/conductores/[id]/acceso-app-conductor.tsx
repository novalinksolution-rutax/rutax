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
 * ⚠️ F4.a (2026-09-15): el conductor ya NO entra por correo. Se le invita por
 * su TELÉFONO y recibe un código por WhatsApp en la app nativa — sin correo,
 * sin PIN, sin enlace web que copiar. El diálogo deja de pedir nada: es una
 * confirmación sobre el teléfono que ya vive en la ficha (sección de arriba,
 * `DatosContactoConductor` / `EditorTelefonoConductor`). Si el conductor no
 * tiene teléfono todavía, no se ofrece el botón de invitar — se pide cargarlo
 * primero, porque ocultar sin más deja al courier sin saber qué hacer.
 */

import { useState } from "react";
import { Smartphone, TriangleAlert, UserPlus } from "lucide-react";
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
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { formatearFecha } from "@/lib/formato-cl";
import { enmascararTelefono } from "@/lib/telefono-cl";
import { invitarConductor } from "./actions";

export type EstadoAccesoAppConductor =
  | { tipo: "cuenta_activa" }
  | { tipo: "cuenta_suspendida" }
  | {
      tipo: "invitacion_pendiente";
      /** Últimos 4 dígitos, ya enmascarado (`+56 9 **** 5571`). Nunca el número entero. */
      telefonoMascara: string;
      expiraEn: string;
    }
  | { tipo: "sin_acceso"; ultimaInvitacionVencida: string | null };

interface Props {
  driverId: string;
  nombreConductor: string;
  /** E.164 sin `+`, o `null` si el conductor todavía no tiene teléfono cargado. */
  telefonoConductor: string | null;
  puedeInvitar: boolean;
  estadoInicial: EstadoAccesoAppConductor;
}

export function AccesoAppConductor({
  driverId,
  nombreConductor,
  telefonoConductor,
  puedeInvitar,
  estadoInicial,
}: Props) {
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
              Le llega por WhatsApp al {estado.telefonoMascara} · vence el{" "}
              {formatearFecha(estado.expiraEn)}
            </span>
          </div>
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
            <>
              {telefonoConductor ? (
                <DialogInvitarConductor
                  driverId={driverId}
                  nombreConductor={nombreConductor}
                  telefonoConductor={telefonoConductor}
                  onInvitado={(invitacion) =>
                    setEstado({
                      tipo: "invitacion_pendiente",
                      telefonoMascara: invitacion.telefonoMascara,
                      expiraEn: invitacion.expiraEn,
                    })
                  }
                />
              ) : (
                <div className="flex items-start gap-2 border border-attention-line bg-attention-bg px-3 py-2.5 text-sm text-attention-fg">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <p className="leading-relaxed">
                    Primero registra el teléfono del conductor para poder invitarlo por WhatsApp — usa
                    el campo de teléfono en la sección de arriba.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Dialog — Invitar a la app
// -----------------------------------------------------------------------------

function DialogInvitarConductor({
  driverId,
  nombreConductor,
  telefonoConductor,
  onInvitado,
}: {
  driverId: string;
  nombreConductor: string;
  telefonoConductor: string;
  onInvitado: (invitacion: { telefonoMascara: string; expiraEn: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function manejarInvitar() {
    if (enviando) return;
    setError(null);
    setEnviando(true);

    // El 2º parámetro es vestigial (ver `actions.ts`): la acción ignora
    // cualquier valor y lee el teléfono directo de la fila del conductor.
    const resultado = await invitarConductor(driverId, "");
    setEnviando(false);

    if (!resultado.ok) {
      setError(resultado.mensaje);
      return;
    }

    toast.success(`Invitamos a ${nombreConductor}.`, {
      description: `Le llegará un código por WhatsApp al ${resultado.invitacion.telefonoMascara}.`,
    });

    onInvitado(resultado.invitacion);
    setOpen(false);
    setError(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setError(null);
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
            Le enviaremos un código por WhatsApp al número{" "}
            <span className="font-medium text-foreground">{enmascararTelefono(telefonoConductor)}</span>{" "}
            para que entre a la app del conductor. No necesita correo ni contraseña.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={enviando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button type="button" loading={enviando} onClick={manejarInvitar}>
            {enviando ? "Invitando…" : "Invitar a la app"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
