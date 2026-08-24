"use client";

/**
 * Cambiar el rol de alguien — peldaño 2, con las consecuencias enumeradas.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ HABÍA
 * -----------------------------------------------------------------------------
 * La celda decía, literal, **«Gestión de rol próximamente»**. Era la única
 * ocurrencia de esa palabra en todo `src/`, y el comentario al lado explicaba
 * por qué: «se deja para una iteración posterior con su propio diálogo de
 * confirmación; no se improvisa aquí un botón sin el flujo que una acción sobre
 * el acceso de otra persona amerita». Tenía razón. Esta es esa iteración.
 *
 * -----------------------------------------------------------------------------
 * LAS TRES LISTAS SALEN DEL CATÁLOGO, NO DE UN TEXTO
 * -----------------------------------------------------------------------------
 * Qué pierde, qué gana y qué sigue sin tener se calculan por diferencia de
 * conjuntos sobre `MATRIZ_ROL_CAPACIDADES`. No hay una descripción escrita a
 * mano que pueda quedar desincronizada: si mañana cambia el mapa, este diálogo
 * cambia con él.
 *
 * **«Sigue sin tener» no es relleno.** Sin esa tercera lista, quien aprueba
 * tiene que acordarse del catálogo entero para saber qué NO está pasando. Con
 * ella, la pregunta queda cerrada.
 *
 * -----------------------------------------------------------------------------
 * PELDAÑO 2 Y NO 3
 * -----------------------------------------------------------------------------
 * El cambio de rol **se deshace**: se vuelve a cambiar. No es irreversible como
 * emitir un DTE. Lo que necesita es que la consecuencia esté escrita antes de
 * apretar, y que quede en la bitácora con nombre — las dos cosas están.
 */

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { compararRoles, describirRol } from "@/modules/identidad/capacidades-legibles";
import { ROLES_INTERNOS, type RolInterno } from "@/modules/identidad/roles";
import { DESCRIPCIONES_ROLES_INTERNOS } from "./descripciones-roles";
import { cambiarRolDePersona } from "./actions";

export function DialogoCambiarRol({
  usuarioId,
  nombre,
  rolActual,
  onCambiado,
}: {
  usuarioId: string;
  nombre: string;
  rolActual: RolInterno;
  onCambiado: (rol: RolInterno) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [rolNuevo, setRolNuevo] = useState<RolInterno>(rolActual);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  const cambio = compararRoles(rolActual, rolNuevo);
  const hayCambio = rolNuevo !== rolActual;

  function confirmar() {
    setError(null);
    iniciarTransicion(async () => {
      const r = await cambiarRolDePersona(usuarioId, rolNuevo);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      onCambiado(rolNuevo);
      setAbierto(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRolNuevo(rolActual);
          setError(null);
          setAbierto(true);
        }}
        className="text-xs font-medium text-accent-text hover:underline"
      >
        Cambiar el rol
      </button>

      <Dialog open={abierto} onOpenChange={(a) => !a && !pendiente && setAbierto(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {hayCambio
                ? `Vas a cambiar a ${nombre} de ${DESCRIPCIONES_ROLES_INTERNOS[rolActual].etiqueta} a ${DESCRIPCIONES_ROLES_INTERNOS[rolNuevo].etiqueta}`
                : `Cambiar el rol de ${nombre}`}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor={`rol-${usuarioId}`}>Rol</Label>
            <Select value={rolNuevo} onValueChange={(v) => setRolNuevo(v as RolInterno)}>
              <SelectTrigger id={`rol-${usuarioId}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES_INTERNOS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {DESCRIPCIONES_ROLES_INTERNOS[r].etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* La descripción del rol elegido sale del catálogo, no de un texto
                a mano que haya que acordarse de revisar. */}
            <p className="text-xs leading-relaxed text-fg-muted">{describirRol(rolNuevo)}</p>
          </div>

          {hayCambio ? (
            <div className="space-y-3 border border-line bg-bg-sunken px-4 py-3">
              {/* Lo que PIERDE va primero: es lo que puede romper el trabajo de
                  alguien mañana por la mañana. */}
              <ListaCapacidades
                rotulo="Pierde"
                tono="fault"
                items={cambio.pierde}
                vacio="No pierde nada."
              />
              <ListaCapacidades
                rotulo="Gana"
                tono="balanced"
                items={cambio.gana}
                vacio="No gana nada nuevo."
              />
              <ListaCapacidades
                rotulo="Sigue sin tener"
                tono="muted"
                items={cambio.sigueSinTener}
                vacio="Nada más queda fuera."
                colapsable
              />
            </div>
          ) : (
            <p className="text-sm text-fg-muted">
              Elige otro rol para ver qué cambia.
            </p>
          )}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <p className="text-xs leading-relaxed text-fg-muted">
            Toma efecto en su próxima carga de pantalla y queda en la bitácora a tu nombre.
          </p>

          <DialogFooter>
            <Button variant="ghost" disabled={pendiente} onClick={() => setAbierto(false)}>
              Volver
            </Button>
            <Button disabled={pendiente || !hayCambio} onClick={confirmar}>
              {pendiente ? "Cambiando…" : "Cambiar el rol"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ListaCapacidades({
  rotulo,
  tono,
  items,
  vacio,
  colapsable = false,
}: {
  rotulo: string;
  tono: "fault" | "balanced" | "muted";
  items: string[];
  vacio: string;
  /** «Sigue sin tener» puede ser larga: se puede plegar sin perderse. */
  colapsable?: boolean;
}) {
  const color =
    tono === "fault" ? "text-fault-fg" : tono === "balanced" ? "text-balanced-fg" : "text-fg-muted";

  const cuerpo =
    items.length === 0 ? (
      <p className="text-sm text-fg-muted">{vacio}</p>
    ) : (
      <ul className="list-disc space-y-0.5 pl-5 text-sm leading-snug text-fg-muted">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    );

  if (colapsable && items.length > 3) {
    return (
      <details>
        <summary className={`cursor-pointer text-[10px] font-medium tracking-[0.12em] uppercase ${color}`}>
          {rotulo} ({items.length})
        </summary>
        <div className="mt-1">{cuerpo}</div>
      </details>
    );
  }

  return (
    <div>
      <p className={`text-[10px] font-medium tracking-[0.12em] uppercase ${color}`}>
        {rotulo}
        {items.length > 0 ? ` (${items.length})` : ""}
      </p>
      <div className="mt-1">{cuerpo}</div>
    </div>
  );
}
