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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PanelAccion } from "@/components/ui/panel-accion";
import { ListaCapacidades } from "@/components/ui/bloque-capacidades";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  compararRoles,
  describirRol,
} from "@/modules/identidad/capacidades-legibles";
import { ROLES_INTERNOS, type RolInterno } from "@/modules/identidad/roles";
import { DESCRIPCIONES_ROLES_INTERNOS } from "@/modules/identidad/descripciones-roles";
import { cambiarRolDePersona } from "./actions";

export function DialogoCambiarRol({
  usuarioId,
  nombre,
  rolActual,
  onCambiado,
  abierto: abiertoControlado,
  onOpenChange,
}: {
  usuarioId: string;
  nombre: string;
  rolActual: RolInterno;
  onCambiado: (rol: RolInterno) => void;
  /** Controlado desde fuera: la fila del listado. */
  abierto?: boolean;
  onOpenChange?: (abierto: boolean) => void;
}) {
  const [abiertoInterno, setAbiertoInterno] = useState(false);
  const abierto = abiertoControlado ?? abiertoInterno;
  const setAbierto = onOpenChange ?? setAbiertoInterno;
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
    <PanelAccion
      abierto={abierto}
      onOpenChange={(a) => {
        if (!a && pendiente) return;
        // ⚠️ El selector se devuelve al rol vigente **al cerrar**, no al abrir.
        // Al abrir habría que hacerlo en un efecto —y `setState` dentro de un
        // efecto dispara un render en cascada, que la regla señala con razón—;
        // al cerrar es un manejador de evento y no cuesta nada. El resultado es
        // el mismo: reabrir con la elección anterior a medio hacer haría creer
        // que ese cambio ya se guardó.
        if (!a) {
          setRolNuevo(rolActual);
          setError(null);
        }
        setAbierto(a);
      }}
      titulo={
        hayCambio
          ? `De ${DESCRIPCIONES_ROLES_INTERNOS[rolActual].etiqueta} a ${DESCRIPCIONES_ROLES_INTERNOS[rolNuevo].etiqueta}`
          : "Cambiar el rol"
      }
      subtitulo={nombre}
      pie={
        <div className="flex items-center gap-2">
          <Button disabled={pendiente || !hayCambio} onClick={confirmar}>
            {pendiente ? "Cambiando…" : "Cambiar el rol"}
          </Button>
          <Button
            variant="outline"
            disabled={pendiente}
            onClick={() => setAbierto(false)}
          >
            Volver
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`rol-${usuarioId}`}>Rol</Label>
          <Select
            value={rolNuevo}
            onValueChange={(v) => setRolNuevo(v as RolInterno)}
          >
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
          <p className="text-xs leading-relaxed text-fg-muted">
            {describirRol(rolNuevo)}
          </p>
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
          Toma efecto en su próxima carga de pantalla y queda en la bitácora a
          tu nombre.
        </p>
      </div>
    </PanelAccion>
  );
}
