"use client";

/**
 * El teléfono del conductor: mostrarlo y editarlo.
 * =============================================================================
 * Vive suelto, fuera de la ficha y fuera de la nómina, porque **hace falta en
 * las dos** y por razones distintas:
 *
 *  · La **ficha** (`/conductores/[id]`) está tras el gate financiero
 *    `gestionar_liquidaciones_conductores` — dueño y administración. Es una
 *    pantalla de dinero.
 *  · La **nómina** (`/conductores`) está tras `asignar_y_reasignar_pedidos`, o
 *    sea el coordinador. Y el coordinador es justamente quien marca ese número:
 *    son las 17:30, un conductor no aparece en una comuna, y hay que llamarlo.
 *
 * Poner el teléfono solo en la ficha era dejarlo fuera del alcance de la única
 * persona que lo va a usar. Duplicar el editor era garantizar que uno de los dos
 * se quedara atrás — con validaciones distintas para el mismo campo.
 *
 * ⚠️ SE MUESTRA ENTERO, sin enmascarar, y es deliberado. `enmascararTelefono`
 * existe para listados donde basta reconocer de quién es el número; acá el
 * propósito es marcarlo, y `+56 9 **** 5571` no sirve para eso. La minimización
 * protege del vistazo de paso, no de la persona cuyo trabajo es llamar — y
 * llegar hasta acá ya exigió pasar el RBAC.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearTelefonoLegible, telefonoParaMarcar } from "@/lib/telefono-cl";
import { actionActualizarTelefonoConductor } from "./actions";

export function EditorTelefonoConductor({
  conductorId,
  telefono,
  puedeEditar,
  idCampo = "telefono-conductor",
  onGuardado,
}: {
  conductorId: string;
  /** E.164 sin `+`, o `null` si nunca se cargó. */
  telefono: string | null;
  /** `asignar_y_reasignar_pedidos`. Sin esto el número se ve pero no se toca. */
  puedeEditar: boolean;
  /** Para que dos instancias en la misma pantalla no compartan `id`. */
  idCampo?: string;
  /**
   * La nómina mantiene su lista en estado del cliente y necesita enterarse; la
   * ficha se recarga del servidor. Si no viene, se recarga.
   */
  onGuardado?: (telefonoNuevo: string | null) => void;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(telefono ? formatearTelefonoLegible(telefono) : "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, iniciar] = useTransition();

  function guardar() {
    setError(null);
    iniciar(async () => {
      const r = await actionActualizarTelefonoConductor(conductorId, valor);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setEditando(false);
      if (onGuardado) onGuardado(r.datos.telefono);
      else router.refresh();
    });
  }

  function cancelar() {
    setValor(telefono ? formatearTelefonoLegible(telefono) : "");
    setError(null);
    setEditando(false);
  }

  if (editando) {
    return (
      <div className="space-y-2">
        <Label htmlFor={idCampo} className="sr-only">
          Teléfono del conductor
        </Label>
        <Input
          id={idCampo}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") guardar();
            if (e.key === "Escape") cancelar();
          }}
          placeholder="9 1234 5678"
          inputMode="tel"
          autoFocus
          aria-describedby={error ? `${idCampo}-error` : `${idCampo}-ayuda`}
        />
        {error ? (
          <p id={`${idCampo}-error`} className="text-[12.5px] text-destructive">
            {error}
          </p>
        ) : (
          <p id={`${idCampo}-ayuda`} className="text-[12.5px] text-fg-subtle">
            Déjalo en blanco para quitarlo.
          </p>
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
          <Button size="sm" variant="ghost" onClick={cancelar} disabled={guardando}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {telefono ? (
        <a
          href={`tel:${telefonoParaMarcar(telefono)}`}
          className="rx-num tabular-nums underline decoration-dotted underline-offset-4 hover:text-brand"
        >
          {formatearTelefonoLegible(telefono)}
        </a>
      ) : (
        <span className="text-fg-muted">Sin teléfono</span>
      )}
      {puedeEditar ? (
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditando(true)}>
          <Pencil className="size-3.5" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only sm:ml-1">
            {telefono ? "Editar" : "Agregar"}
          </span>
        </Button>
      ) : null}
    </div>
  );
}
