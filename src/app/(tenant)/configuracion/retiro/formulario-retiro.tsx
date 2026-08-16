"use client";

/**
 * Formulario de un solo campo — Configuración → Retiro.
 * Mismo patrón de envío que `DialogTarifa` (FormData + Server Action +
 * `useTransition`), pero SIN dialog: es una pantalla de configuración
 * permanente, no un alta puntual (mismo criterio que `PanelZonas`).
 */

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { accionGuardarConfigRetiro } from "./actions";

interface Props {
  /** `null` = sin fila en `courier_config_retiro` ("sin configurar", nunca cero). */
  montoActual: number | null;
}

export function FormularioRetiro({ montoActual }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [guardadoOk, setGuardadoOk] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setGuardadoOk(null);
    const formData = new FormData(e.currentTarget);
    const monto = Number(formData.get("monto_visita_bodega_clp"));

    startTransition(async () => {
      const resultado = await accionGuardarConfigRetiro(formData);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setGuardadoOk(monto);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="monto_visita_bodega_clp">Le pagas al conductor por visita a bodega (CLP)</Label>
        <Input
          id="monto_visita_bodega_clp"
          name="monto_visita_bodega_clp"
          type="number"
          min={1}
          step={1}
          required
          defaultValue={montoActual ?? ""}
          placeholder="ej. 1500"
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">
          Se paga por CADA visita cerrada, sin importar cuántos bultos retiró el conductor en
          ella. Puedes fijar un monto distinto para una bodega puntual desde Configuración →
          Bodegas.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {guardadoOk !== null && !error && (
        <p className="text-sm text-success-subtle-foreground">
          Guardado — desde ahora cada visita a bodega liquida {formatearCLP(guardadoOk)} al conductor.
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
