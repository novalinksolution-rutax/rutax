"use client";

/**
 * Mi nombre — el único campo editable del perfil del super-admin.
 *
 * Un botón, con acuse de recibo, igual que `FormularioMiPerfil`. No lo reusa
 * porque aquél escribe nombre Y teléfono sobre `usuarios_perfil`, y acá no hay
 * teléfono ni esa tabla (ver `actions.ts`).
 */

import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { accionGuardarMiNombreAdmin } from "./actions";

export function FormularioNombreAdmin({ nombreInicial }: { nombreInicial: string }) {
  const [nombre, setNombre] = useState(nombreInicial);
  /**
   * 🔴 Lo último GUARDADO, en estado — no la prop.
   *
   * Comparar contra la prop parece lo natural y está mal: no cambia al guardar,
   * así que el botón se queda habilitado y el «Guardado.» no aparece nunca — o
   * sea, la pantalla dice exactamente lo mismo que si hubiera fallado. Es el
   * fallo que el acuse de recibo existe para evitar, y ya mordió una vez en
   * `FormularioMiPerfil`.
   */
  const [guardadoNombre, setGuardadoNombre] = useState(nombreInicial);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [pendiente, iniciar] = useTransition();

  const hayCambio = nombre !== guardadoNombre;

  function guardar() {
    setError(null);
    setGuardado(false);
    iniciar(async () => {
      const r = await accionGuardarMiNombreAdmin(nombre);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setGuardadoNombre(nombre);
      setGuardado(true);
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (hayCambio && !pendiente) guardar();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="admin-nombre">Nombre y apellido</Label>
        <Input
          id="admin-nombre"
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            setGuardado(false);
          }}
          autoComplete="name"
          maxLength={120}
        />
        {/* Que el nombre aparece en la bitácora NO es un detalle: es la razón
            por la que este cambio se audita. Decirlo acá evita que alguien lo
            trate como un apodo. */}
        <p className="text-xs text-fg-muted">
          Es el nombre con el que apareces en la bitácora, junto a cada acción que hagas sobre un
          courier. Cambiarlo queda registrado.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!hayCambio || pendiente}>
          {pendiente ? "Guardando…" : "Guardar cambios"}
        </Button>
        {guardado && !hayCambio ? (
          <span className="text-sm text-balanced-fg" role="status">
            Guardado.
          </span>
        ) : null}
      </div>
    </form>
  );
}
