"use client";

/**
 * Formulario para crear un manifiesto nuevo.
 * El nombre se pre-rellena con "Ruta [nombre conductor] — [fecha]", editable.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { actionCrearManifiesto } from "../actions";

interface Props {
  conductores: { id: string; nombre: string }[];
  fechaHoy: string;
  tenantId: string;
}

export function FormularioNuevoManifiesto({ conductores, fechaHoy }: Props) {
  const router = useRouter();
  const [conductorSeleccionado, setConductorSeleccionado] = useState("");
  const [fecha, setFecha] = useState(fechaHoy);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Pre-rellenar nombre cuando cambia conductor o fecha
  function actualizarNombreAuto(conductorId: string, nuevaFecha: string) {
    const conductor = conductores.find((c) => c.id === conductorId);
    if (conductor) {
      setNombre(`Ruta ${conductor.nombre} — ${nuevaFecha}`);
    }
  }

  function handleConductorChange(id: string) {
    setConductorSeleccionado(id);
    actualizarNombreAuto(id, fecha);
  }

  function handleFechaChange(nuevaFecha: string) {
    setFecha(nuevaFecha);
    if (conductorSeleccionado) {
      actualizarNombreAuto(conductorSeleccionado, nuevaFecha);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const resultado = await actionCrearManifiesto(formData);
      if (resultado?.error) {
        setError(resultado.error);
      }
      // Si tuvo éxito, actionCrearManifiesto hace redirect — no hay que manejar nada más.
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Conductor */}
      <div>
        <label htmlFor="driverId" className="block text-sm font-medium">
          Conductor <span aria-hidden="true">*</span>
        </label>
        {conductores.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            No hay conductores activos. Agrega uno primero en Equipo.
          </p>
        ) : (
          <select
            id="driverId"
            name="driverId"
            required
            disabled={pending}
            value={conductorSeleccionado}
            onChange={(e) => handleConductorChange(e.target.value)}
            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Seleccionar conductor...</option>
            {conductores.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Fecha de operación */}
      <div>
        <label htmlFor="fechaOperacion" className="block text-sm font-medium">
          Fecha de operación <span aria-hidden="true">*</span>
        </label>
        <input
          id="fechaOperacion"
          name="fechaOperacion"
          type="date"
          required
          disabled={pending}
          value={fecha}
          onChange={(e) => handleFechaChange(e.target.value)}
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Nombre */}
      <div>
        <label htmlFor="nombre" className="block text-sm font-medium">
          Nombre <span aria-hidden="true">*</span>
        </label>
        <input
          id="nombre"
          name="nombre"
          type="text"
          required
          disabled={pending}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ruta Conductor — Fecha"
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Notas (opcional) */}
      <div>
        <label htmlFor="notas" className="block text-sm font-medium">
          Notas <span className="text-muted-foreground">(opcional)</span>
        </label>
        <textarea
          id="notas"
          name="notas"
          rows={2}
          disabled={pending}
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <Link
          href="/manifiestos"
          className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={pending || conductores.length === 0}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {pending ? "Creando..." : "Crear manifiesto"}
        </button>
      </div>
    </form>
  );
}
