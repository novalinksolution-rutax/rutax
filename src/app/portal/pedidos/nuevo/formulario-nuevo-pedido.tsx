"use client";

import { useActionState } from "react";
import Link from "next/link";
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

  const hoy = new Date().toISOString().split("T")[0];

  return (
    <form action={accion} className="space-y-5">
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
      <div className="grid gap-5 sm:grid-cols-2">
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

        <Campo
          id="fecha_compromiso"
          label="Fecha de entrega comprometida"
          error={campoError(estado, "fecha_compromiso")}
          descripcion="Opcional — hoy si no se especifica"
        >
          <Input
            id="fecha_compromiso"
            name="fecha_compromiso"
            type="date"
            min={hoy}
            className="h-9"
          />
        </Campo>
      </div>

      {/* Instrucciones */}
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

      {/* Acciones */}
      <div className="flex items-center justify-end gap-3 border-t pt-5">
        <Button asChild variant="ghost">
          <Link href="/portal/pedidos">Cancelar</Link>
        </Button>
        <Button type="submit" loading={pendiente}>
          {pendiente ? "Solicitando…" : "Solicitar envío"}
        </Button>
      </div>
    </form>
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
