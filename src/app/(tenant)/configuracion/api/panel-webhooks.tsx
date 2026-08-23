"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Webhook } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BotonConfirmado } from "@/components/ui/boton-confirmado";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  accionCrearWebhookEndpoint,
  accionToggleWebhookEndpoint,
  accionEliminarWebhookEndpoint,
} from "./acciones";
import { formatearFecha } from "@/lib/formato-cl";

export interface WebhookEndpointRow {
  id: string;
  url: string;
  eventos: string[];
  activo: boolean;
  reintentoMax: number;
  creadoEn: string;
}

const EVENTOS_DISPONIBLES: { valor: string; etiqueta: string }[] = [
  { valor: "pedido.entregado", etiqueta: "Pedido entregado" },
  { valor: "pedido.no_entregado", etiqueta: "Pedido no entregado" },
  { valor: "liquidacion.emitida", etiqueta: "Liquidación emitida" },
  { valor: "periodo.cerrado", etiqueta: "Período cerrado" },
];

function DialogCrearEndpoint({ onCreado }: { onCreado: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function validarUrl(url: string): string | null {
    if (!url.startsWith("https://")) return "La URL debe comenzar con https://";
    return null;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const url = (formData.get("url") as string).trim();
    const urlErr = validarUrl(url);
    if (urlErr) {
      setUrlError(urlErr);
      return;
    }
    setUrlError(null);

    startTransition(async () => {
      const resultado = await accionCrearWebhookEndpoint(formData);
      if (!resultado.ok) {
        setError(resultado.mensaje ?? "Error al crear el endpoint.");
        return;
      }
      formRef.current?.reset();
      setOpen(false);
      onCreado();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setError(null); setUrlError(null); } setOpen(v); }}>
      <DialogTrigger asChild>
        <Button size="sm">Añadir endpoint</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo endpoint de webhook</DialogTitle>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="webhook-url">URL del endpoint</Label>
            <Input
              id="webhook-url"
              name="url"
              type="url"
              required
              placeholder="https://tu-servidor.com/webhook"
              onChange={(e) => {
                if (urlError) setUrlError(validarUrl(e.target.value));
              }}
              aria-describedby={urlError ? "url-error" : undefined}
              aria-invalid={!!urlError}
            />
            {urlError && (
              <p id="url-error" role="alert" className="text-xs text-destructive">
                {urlError}
              </p>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Eventos a escuchar</legend>
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              {EVENTOS_DISPONIBLES.map((ev) => (
                <label key={ev.valor} className="flex items-center gap-2.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    name={ev.valor}
                    className="size-4 rounded border-border accent-primary"
                  />
                  <span className="font-mono text-xs">{ev.valor}</span>
                  <span className="text-muted-foreground">— {ev.etiqueta}</span>
                </label>
              ))}
            </div>
          </fieldset>

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
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creando..." : "Crear endpoint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CardEndpoint({ endpoint }: { endpoint: WebhookEndpointRow }) {
  const router = useRouter();
  const [isTogglePending, startToggle] = useTransition();
  const [isDeletePending, startDelete] = useTransition();

  function handleToggle() {
    startToggle(async () => {
      await accionToggleWebhookEndpoint(endpoint.id, !endpoint.activo);
      router.refresh();
    });
  }

  function handleEliminar() {
    startDelete(async () => {
      await accionEliminarWebhookEndpoint(endpoint.id);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-sm break-all">{endpoint.url}</p>
        <Badge
          variant="outline"
          className={endpoint.activo
            ? "shrink-0 border-success/30 bg-success-subtle text-success-subtle-foreground"
            : "shrink-0 text-muted-foreground"
          }
        >
          {endpoint.activo ? "Activo" : "Inactivo"}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1">
        {endpoint.eventos.map((ev) => (
          <Badge key={ev} variant="secondary" className="font-mono text-xs">
            {ev}
          </Badge>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
        <span className="text-xs text-muted-foreground">
          Reintentos: {endpoint.reintentoMax} · Creado {formatearFecha(endpoint.creadoEn)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isTogglePending || isDeletePending}
            onClick={handleToggle}
          >
            {isTogglePending ? "..." : endpoint.activo ? "Desactivar" : "Activar"}
          </Button>
          {/* Regla 37. Y la consecuencia real no es «se borra un endpoint»:
              es que los avisos dejan de llegar sin que nadie se entere, que es
              distinto de desactivarlo —eso sí es reversible en un clic—. */}
          <BotonConfirmado
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            deshabilitado={isTogglePending || isDeletePending}
            cargando={isDeletePending}
            etiqueta="Eliminar"
            titulo="Vas a eliminar este endpoint de webhooks"
            consecuencia={
              <>
                Rutax <strong>deja de enviarle eventos</strong> y no queda registro del
                endpoint. Si solo quieres cortar el envío por un rato,
                <strong> desactívalo</strong>: eso se revierte en un clic.
              </>
            }
            resumen={[{ etiqueta: "URL", valor: endpoint.url, mono: true }]}
            textoConfirmar="Eliminar el endpoint"
            varianteModal="destructive"
            onConfirmar={handleEliminar}
          />
        </div>
      </div>
    </div>
  );
}

export function PanelWebhooks({ endpoints }: { endpoints: WebhookEndpointRow[] }) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Endpoints de Webhook</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Rutax enviará un POST a estas URLs cuando ocurran los eventos seleccionados.
          </p>
        </div>
        <DialogCrearEndpoint onCreado={() => router.refresh()} />
      </div>

      {endpoints.length === 0 ? (
        <EmptyState
          icon={Webhook}
          tono="arranque"
          titulo="Sin endpoints configurados"
          descripcion="Añade un endpoint para que Rutax notifique a tus sistemas en tiempo real."
          accion={<DialogCrearEndpoint onCreado={() => router.refresh()} />}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
          {endpoints.map((ep) => (
            <CardEndpoint key={ep.id} endpoint={ep} />
          ))}
        </div>
      )}
    </div>
  );
}
