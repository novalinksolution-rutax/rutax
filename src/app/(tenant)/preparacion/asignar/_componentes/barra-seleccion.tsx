"use client";

/**
 * Barra inferior sticky — aparece SOLO con selección activa (§6.3). Lee
 * TODO del `Map` de selección, nunca de la página visible: "Ver selección
 * (N)" y "K fuera de este filtro" tienen que seguir siendo ciertos aunque
 * el coordinador haya cambiado de filtro desde que marcó algunos pedidos.
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL SELECTOR MUESTRA QUIÉN ESTÁ DISPONIBLE
 * -----------------------------------------------------------------------------
 * `disponible` llegaba en la prop y **no se pintaba en ninguna parte**: los no
 * disponibles quedaban más abajo en una lista de nombres idénticos, así que se
 * les podía repartir treinta paquetes sin que la pantalla dijera nada. El
 * porqué de cada decisión —dos grupos, la marca dentro del ítem, el aviso que
 * no bloquea y por qué el copy no dice «hoy»— está en `_lib/disponibilidad.ts`.
 */

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { contarFueraDeFiltro, type PedidoSeleccionado } from "../_lib/seleccion";
import {
  agruparPorDisponibilidad,
  avisoNoDisponible,
  etiquetaConductor,
} from "../_lib/disponibilidad";

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
  const { disponibles, noDisponibles } = agruparPorDisponibilidad(conductores);
  // ⚠️ El aviso NO deshabilita «Asignar»: el coordinador puede acabar de hablar
  // con el conductor por teléfono, y el software no le va a discutir un hecho
  // que él conoce y nosotros no.
  const aviso = avisoNoDisponible(conductores, conductorElegidoId);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
      {aviso && (
        <div className="mx-auto max-w-6xl px-4 pt-2 lg:pl-64">
          <p
            role="status"
            className="border border-attention-line bg-attention-bg px-3 py-1.5 text-xs leading-relaxed text-attention-fg"
          >
            {aviso}
          </p>
        </div>
      )}
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
            <SelectTrigger size="default" className="h-9 w-full sm:w-64" aria-label="Elegir conductor">
              <SelectValue placeholder="Elegir conductor" />
            </SelectTrigger>
            <SelectContent>
              {/* Los grupos solo se dibujan si tienen a alguien: antes de las
                  16:00 puede que nadie se haya marcado todavía, y un rótulo
                  sobre una lista vacía se lee como un error. */}
              {disponibles.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Disponibles</SelectLabel>
                  {disponibles.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {etiquetaConductor(c)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {noDisponibles.length > 0 && (
                <SelectGroup>
                  <SelectLabel>No disponibles</SelectLabel>
                  {noDisponibles.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {etiquetaConductor(c)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
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
