"use client";

import { useActionState } from "react";
import Link from "next/link";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
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
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
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
          <input
            id="nombre"
            name="nombre"
            type="text"
            required
            maxLength={120}
            placeholder="Ej: Juan Pérez González"
            className={inputClass(!!campoError(estado, "nombre"))}
            autoComplete="off"
          />
        </Campo>

        <Campo
          id="telefono"
          label="Teléfono de contacto"
          error={campoError(estado, "telefono")}
          descripcion="Opcional — útil para el conductor"
        >
          <input
            id="telefono"
            name="telefono"
            type="tel"
            maxLength={20}
            placeholder="+56 9 1234 5678"
            className={inputClass(!!campoError(estado, "telefono"))}
            autoComplete="off"
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
        <input
          id="direccion"
          name="direccion"
          type="text"
          required
          maxLength={200}
          placeholder="Ej: Av. Providencia 1234, Dpto 52"
          className={inputClass(!!campoError(estado, "direccion"))}
          autoComplete="off"
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
          <select
            id="comuna"
            name="comuna"
            required
            className={inputClass(!!campoError(estado, "comuna"))}
            defaultValue=""
          >
            <option value="" disabled>Selecciona una comuna</option>
            {COMUNAS_RM.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Campo>

        <Campo
          id="fecha_compromiso"
          label="Fecha de entrega comprometida"
          error={campoError(estado, "fecha_compromiso")}
          descripcion="Opcional — hoy si no se especifica"
        >
          <input
            id="fecha_compromiso"
            name="fecha_compromiso"
            type="date"
            min={hoy}
            className={inputClass(false)}
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
        <textarea
          id="instrucciones"
          name="instrucciones"
          rows={3}
          maxLength={400}
          placeholder="Ej: Tocar timbre 3 veces, edificio sin ascensor, dejar con el conserje si no hay respuesta"
          className={`${inputClass(false)} resize-none`}
        />
      </Campo>

      {/* Acciones */}
      <div className="flex items-center justify-end gap-3 border-t pt-5">
        <Link
          href="/portal/pedidos"
          className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={pendiente}
          className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {pendiente ? "Solicitando…" : "Solicitar envío"}
        </button>
      </div>
    </form>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function inputClass(conError: boolean) {
  return `w-full rounded-md border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring ${
    conError ? "border-red-400 focus:ring-red-400" : "border-input"
  }`;
}

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
        {requerido && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
      </label>
      {descripcion && <p className="text-xs text-muted-foreground">{descripcion}</p>}
      {children}
      {error && (
        <p role="alert" className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
