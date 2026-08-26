"use client";

/**
 * Mis datos — el único formulario editable de la pantalla.
 *
 * Un botón, con acuse de recibo. **Nada se guarda al salir del campo**: en
 * configuración el autoguardado es una trampa (regla del tablero B3b), y acá
 * además el nombre viaja al bloque de cuenta del sidebar — que se mueva solo
 * mientras alguien está escribiendo se lee como un fallo.
 */

import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { accionGuardarMiPerfil } from "./actions";

export function FormularioPerfil({
  nombreInicial,
  telefonoInicial,
}: {
  nombreInicial: string;
  /** Ya legible («+56 9 1234 5678»), no el E.164 crudo. */
  telefonoInicial: string;
}) {
  const [nombre, setNombre] = useState(nombreInicial);
  const [telefono, setTelefono] = useState(telefonoInicial);
  /**
   * 🔴 **Lo último GUARDADO, en estado — no las props.**
   *
   * Comparar contra las props parece lo natural y está mal: no cambian al
   * guardar. El síntoma, comprobado en el navegador: se guarda de verdad —el
   * teléfono llega a la base normalizado— pero el botón se queda habilitado y
   * el «Guardado.» no aparece **nunca**, porque su condición pide que ya no
   * haya cambios. O sea que la pantalla dice exactamente lo mismo que si el
   * guardado hubiera fallado, e invita a pulsar otra vez.
   *
   * Es justo el fallo que el acuse de recibo existía para evitar.
   */
  const [guardadoNombre, setGuardadoNombre] = useState(nombreInicial);
  const [guardadoTelefono, setGuardadoTelefono] = useState(telefonoInicial);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [pendiente, iniciar] = useTransition();

  const hayCambio = nombre !== guardadoNombre || telefono !== guardadoTelefono;

  function guardar() {
    setError(null);
    setGuardado(false);
    iniciar(async () => {
      const r = await accionGuardarMiPerfil(nombre, telefono);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      // La base normaliza el teléfono («9 4709 5571» → `56947095571`), así que
      // la línea base es lo que se ESCRIBIÓ, no lo que quedó guardado: si no,
      // el campo se marcaría como cambiado apenas se refresque la página.
      setGuardadoNombre(nombre);
      setGuardadoTelefono(telefono);
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
        <Label htmlFor="perfil-nombre">Nombre y apellido</Label>
        <Input
          id="perfil-nombre"
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            setGuardado(false);
          }}
          autoComplete="name"
          maxLength={120}
        />
        <p className="text-xs text-fg-muted">
          Es el nombre con el que te ve tu equipo, y el que queda en la bitácora junto a cada cosa
          que hagas.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="perfil-telefono">Teléfono</Label>
        <Input
          id="perfil-telefono"
          value={telefono}
          onChange={(e) => {
            setTelefono(e.target.value);
            setGuardado(false);
          }}
          inputMode="tel"
          autoComplete="tel"
          placeholder="9 1234 5678"
        />
        {/* Se dice que es opcional Y qué pasa si se deja vacío: sin la segunda
            mitad, borrar el número parece que no se pudo. */}
        <p className="text-xs text-fg-muted">
          Opcional. Déjalo en blanco para quitarlo.
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
        {/* El acuse de recibo. Sin él, el botón se deshabilita al guardar y eso
            es indistinguible de que nunca se pulsó. */}
        {guardado && !hayCambio ? (
          <span className="text-sm text-balanced-fg" role="status">
            Guardado.
          </span>
        ) : null}
      </div>
    </form>
  );
}
