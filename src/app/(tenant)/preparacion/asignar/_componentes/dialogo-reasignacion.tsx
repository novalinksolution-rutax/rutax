"use client";

/**
 * Diálogo de reasignación (§7.3) — solo aparece si
 * `agruparAdvertenciaReasignacion` no está vacío. Agrupado POR CONDUCTOR DE
 * ORIGEN, que es lo que lo hace legible con decenas de pedidos.
 *
 * No pide motivo escrito (decisión ya tomada del alcance, §7.3): lo
 * no-negociable es que el coordinador VEA a quién se lo está quitando, no
 * que lo justifique.
 */

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { textoGrupoReasignacion } from "../_lib/textos";
import type { GrupoReasignacion } from "../_lib/seleccion";

interface Props {
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
  grupos: GrupoReasignacion[];
  conductorElegidoNombre: string;
  onConfirmar: () => void;
  pending: boolean;
}

export function DialogoReasignacion({
  abierto,
  onOpenChange,
  grupos,
  conductorElegidoNombre,
  onConfirmar,
  pending,
}: Props) {
  const total = grupos.reduce((acc, g) => acc + g.pedidos.length, 0);

  return (
    <Dialog
      open={abierto}
      onOpenChange={(o) => {
        if (!pending) onOpenChange(o);
      }}
    >
      <DialogContent showCloseButton={!pending} className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning-subtle-foreground">
              <AlertTriangle className="size-4" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-2">
              <DialogTitle>Vas a mover pedidos de otro conductor</DialogTitle>
              <DialogDescription>
                Estos pedidos ya están asignados a otra persona. Si continúas, se los vas a quitar y
                van a quedar con {conductorElegidoNombre}.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {grupos.map((grupo) => (
            <li
              key={grupo.conductorActualId}
              className="rounded-lg bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground"
            >
              <p className="font-medium">{textoGrupoReasignacion(grupo.conductorActualNombre, grupo.pedidos.length)}</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {grupo.pedidos.map((pedido) => (
                  <li key={pedido.pedidoId}>
                    · {pedido.codigoVisible} · {pedido.comuna ?? "Sin comuna"}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={onConfirmar} loading={pending}>
            Confirmar de todos modos ({total})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
