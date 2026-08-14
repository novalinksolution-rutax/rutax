"use client";

/**
 * Barra inferior sticky — aparece SOLO con selección activa (§6.3). Lee
 * TODO del `Map` de selección, nunca de la página visible: "Ver selección
 * (N)" y "K fuera de este filtro" tienen que seguir siendo ciertos aunque
 * el coordinador haya cambiado de filtro desde que marcó algunos pedidos.
 */

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { contarFueraDeFiltro, type PedidoSeleccionado } from "../_lib/seleccion";

export interface ConductorOpcion {
  id: string;
  nombre: string;
  disponible: boolean;
  cargaHoy: number;
}

interface Props {
  seleccion: ReadonlyMap<string, PedidoSeleccionado>;
  idsVisibles: ReadonlySet<string>;
  conductores: ConductorOpcion[];
  conductorElegidoId: string | null;
  onCambiarConductor: (id: string) => void;
  onVerSeleccion: () => void;
  onVaciarSeleccion: () => void;
  onAsignar: () => void;
  pending: boolean;
}

export function BarraSeleccion({
  seleccion,
  idsVisibles,
  conductores,
  conductorElegidoId,
  onCambiarConductor,
  onVerSeleccion,
  onVaciarSeleccion,
  onAsignar,
  pending,
}: Props) {
  const total = seleccion.size;
  const fueraDeFiltro = contarFueraDeFiltro(seleccion, idsVisibles);
  const puedeAsignar = total > 0 && !!conductorElegidoId && !pending;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:pl-64">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 font-medium tabular-nums"
            onClick={onVerSeleccion}
          >
            Ver selección ({total})
          </Button>
          {fueraDeFiltro > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{fueraDeFiltro} fuera de este filtro</span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onVaciarSeleccion}
            disabled={pending}
            className="text-muted-foreground"
          >
            Vaciar selección
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Select value={conductorElegidoId ?? undefined} onValueChange={onCambiarConductor}>
            <SelectTrigger size="default" className="h-9 w-full sm:w-56" aria-label="Elegir conductor">
              <SelectValue placeholder="Elegir conductor" />
            </SelectTrigger>
            <SelectContent>
              {conductores.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre} · {c.cargaHoy} hoy
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={onAsignar} disabled={!puedeAsignar} loading={pending}>
            Asignar
          </Button>
        </div>
      </div>
    </div>
  );
}
