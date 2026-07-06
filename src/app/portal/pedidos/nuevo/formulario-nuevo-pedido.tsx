"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, CheckCircle2, AlertTriangle } from "lucide-react";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BloqueEtiqueta } from "../bloque-etiqueta";
import { crearSameDayAction, type ResultadoCrearSameDay } from "./actions";

function campoError(estado: ResultadoCrearSameDay | null, campo: string) {
  if (!estado || estado.ok) return null;
  if (estado.campo !== campo) return null;
  return estado.mensaje;
}

export function FormularioNuevoPedido() {
  const [estado, accion, pendiente] = useActionState<ResultadoCrearSameDay | null, FormData>(
    crearSameDayAction,
    null,
  );

  const [instruccionesAbiertas, setInstruccionesAbiertas] = useState(false);
  const [contador, setContador] = useState(0);
  // Último resultado exitoso — se mantiene visible aunque `estado` conserve el
  // mismo valor tras el reset del formulario, hasta que se cree el siguiente.
  const [ultimoCreado, setUltimoCreado] = useState<Extract<ResultadoCrearSameDay, { ok: true }> | null>(
    null,
  );
  // Último `estado` ya procesado — patrón React "ajustar estado durante el
  // render" (evita el efecto con `setState` síncrono que dispara cascading
  // renders). Se guarda en estado, no en un ref, porque los refs no pueden
  // leerse/escribirse durante el render.
  const [estadoProcesado, setEstadoProcesado] = useState<ResultadoCrearSameDay | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const nombreRef = useRef<HTMLInputElement>(null);

  const hoy = new Date().toISOString().split("T")[0];

  if (estado?.ok && estadoProcesado !== estado) {
    setEstadoProcesado(estado);
    setUltimoCreado(estado);
    setContador((n) => n + 1);
    setInstruccionesAbiertas(false);
  }

  // Foco automático en "Nombre" al montar — modo ráfaga: minimiza clics entre envíos.
  useEffect(() => {
    nombreRef.current?.focus();
  }, []);

  // Tras un envío exitoso: limpiar el formulario (efecto de DOM, fuera del
  // alcance del estado de React) y devolver el foco a "Nombre" para el
  // siguiente pedido.
  useEffect(() => {
    if (estado?.ok) {
      formRef.current?.reset();
      nombreRef.current?.focus();
    }
  }, [estado]);

  return (
    <div className="space-y-5">
      {/* Confirmación inline del último pedido creado (modo ráfaga) */}
      {ultimoCreado && (
        <div
          role="status"
          className="space-y-3 rounded-xl border border-success-subtle bg-success-subtle/60 p-4"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-success-subtle-foreground">
                Envío creado: {ultimoCreado.destinatarioNombre} — {ultimoCreado.destinatarioComuna}
              </p>
              <p className="mt-0.5 text-xs text-success-subtle-foreground/80">
                Pendiente de asignación. Puedes imprimir la etiqueta o cargar el siguiente.
              </p>
            </div>
            {contador > 0 && (
              <span className="shrink-0 rounded-full bg-success px-2.5 py-1 text-xs font-semibold text-success-foreground tabular-nums">
                {contador} creado{contador !== 1 ? "s" : ""} hoy
              </span>
            )}
          </div>

          {/* Aviso de corte — tono ámbar, no es un error */}
          {ultimoCreado.avisoCorte && (
            <div className="flex items-start gap-2 rounded-lg bg-warning-subtle px-3 py-2.5 text-xs text-warning-subtle-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">{ultimoCreado.avisoCorte.mensaje}</p>
                <p className="mt-0.5">{ultimoCreado.avisoCorte.sugerencia}</p>
              </div>
            </div>
          )}

          {/* Etiqueta lista para imprimir */}
          <div className="border-t border-success-subtle pt-3">
            <p className="mb-2 text-xs font-medium text-success-subtle-foreground">
              Etiqueta con QR
            </p>
            <BloqueEtiqueta pedidoId={ultimoCreado.pedidoId} />
          </div>

          <div className="flex justify-end">
            <Link
              href={`/portal/pedidos/${ultimoCreado.pedidoId}`}
              className="text-xs font-medium text-primary hover:underline"
            >
              Ver detalle del pedido
            </Link>
          </div>
        </div>
      )}

      <form ref={formRef} action={accion} className="space-y-5">
        {/* Error general (sin campo) */}
        {estado && !estado.ok && !estado.campo && (
          <div role="alert" className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground">
            {estado.mensaje}
          </div>
        )}

        {/* Destinatario */}
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo
            id="nombre"
            label="Nombre del destinatario"
            requerido
            error={campoError(estado, "nombre")}
          >
            <Input
              ref={nombreRef}
              id="nombre"
              name="nombre"
              type="text"
              required
              maxLength={120}
              placeholder="Ej: Juan Pérez González"
              aria-invalid={!!campoError(estado, "nombre") || undefined}
              autoComplete="off"
              className="h-9"
            />
          </Campo>

          <Campo
            id="telefono"
            label="Teléfono de contacto"
            error={campoError(estado, "telefono")}
            descripcion="Opcional — útil para el conductor"
          >
            <Input
              id="telefono"
              name="telefono"
              type="tel"
              maxLength={20}
              placeholder="+56 9 1234 5678"
              aria-invalid={!!campoError(estado, "telefono") || undefined}
              autoComplete="off"
              className="h-9"
            />
          </Campo>
        </div>

        {/* Dirección */}
        <Campo
          id="direccion"
          label="Dirección de entrega"
          requerido
          error={campoError(estado, "direccion")}
          descripcion="Calle, número, depto/casa si aplica"
        >
          <Input
            id="direccion"
            name="direccion"
            type="text"
            required
            maxLength={200}
            placeholder="Ej: Av. Providencia 1234, Dpto 52"
            aria-invalid={!!campoError(estado, "direccion") || undefined}
            autoComplete="off"
            className="h-9"
          />
        </Campo>

        {/* Comuna */}
        <Campo
          id="comuna"
          label="Comuna"
          requerido
          error={campoError(estado, "comuna")}
        >
          <Select name="comuna" required>
            <SelectTrigger
              id="comuna"
              aria-invalid={!!campoError(estado, "comuna") || undefined}
              className="h-9 w-full"
            >
              <SelectValue placeholder="Selecciona una comuna" />
            </SelectTrigger>
            <SelectContent>
              {COMUNAS_RM.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>

        {/* Instrucciones — disclosure colapsado, cerrado por defecto */}
        <div>
          <button
            type="button"
            onClick={() => setInstruccionesAbiertas((v) => !v)}
            aria-expanded={instruccionesAbiertas}
            aria-controls="panel-instrucciones"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            <ChevronDown
              className={`size-4 transition-transform ${instruccionesAbiertas ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
            {instruccionesAbiertas ? "Ocultar instrucciones" : "Agregar instrucciones para el conductor"}
          </button>

          {instruccionesAbiertas && (
            <div id="panel-instrucciones" className="mt-3 space-y-4">
              <Campo
                id="instrucciones"
                label="Instrucciones para el conductor"
                error={campoError(estado, "instrucciones")}
                descripcion="Opcional — piso, timbre, referencias de la dirección, etc."
              >
                <Textarea
                  id="instrucciones"
                  name="instrucciones"
                  rows={3}
                  maxLength={400}
                  placeholder="Ej: Tocar timbre 3 veces, edificio sin ascensor, dejar con el conserje si no hay respuesta"
                  className="resize-none"
                />
              </Campo>

              <Campo
                id="fecha_compromiso"
                label="Fecha de entrega comprometida"
                error={campoError(estado, "fecha_compromiso")}
                descripcion="Opcional — si no indicas fecha, la entrega es hoy"
              >
                <Input
                  id="fecha_compromiso"
                  name="fecha_compromiso"
                  type="date"
                  min={hoy}
                  className="h-9 max-w-52"
                />
              </Campo>
            </div>
          )}
        </div>

        {/* Acciones */}
        <div className="flex items-center justify-end gap-3 border-t pt-5">
          <Button asChild variant="ghost">
            <Link href="/portal/pedidos">Terminar</Link>
          </Button>
          <Button type="submit" loading={pendiente}>
            {pendiente ? "Solicitando…" : "Solicitar envío"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function Campo({
  id,
  label,
  requerido,
  descripcion,
  error,
  children,
}: {
  id: string;
  label: string;
  requerido?: boolean;
  descripcion?: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {requerido && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
      </label>
      {descripcion && <p className="text-xs text-muted-foreground">{descripcion}</p>}
      {children}
      {error && (
        <p role="alert" className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
