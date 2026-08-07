'use client';

/**
 * Lista de comunas — el equivalente sin mapa (F10).
 * =============================================================================
 *
 * Las mismas cifras que el mapa, ordenadas por cuántas faltan y navegables con
 * teclado. Cumple dos papeles y ninguno es «segunda superficie»:
 *
 *   · **Degradación honesta** cuando no carga la geometría o el basemap.
 *   · **La vista principal bajo `lg`**, donde el mapa se retira entero. Está
 *     medido: con el panel de 340 px fijos, a 768 px de ancho el mapa cae a
 *     124 px. Eso no es un mapa, es un rectángulo de color.
 *
 * ⚠️ **No es co-igual al mapa y no debe llevarse la mitad del esfuerzo.** Nació
 * como equivalente accesible *y* vista de celular; con el móvil resuelto fuera
 * de este repo —en la app nativa— le queda solo el rol de respaldo y de lectura
 * rápida.
 */

import Link from 'next/link';
import type { ComunaEnTorre } from '@/modules/contexto/contrato-torre';
import { cn } from '@/lib/utils';

export function ListaComunas({
  comunas,
  comunaActiva,
  onComuna,
}: {
  comunas: readonly ComunaEnTorre[];
  comunaActiva: string | null;
  onComuna?: (nombre: string) => void;
}) {
  if (comunas.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        No hay pedidos con compromiso para hoy.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {comunas.map((comuna) => (
        <li
          key={comuna.nombre}
          className={cn(
            'flex items-center gap-3 px-4 py-3',
            comuna.nombre === comunaActiva && 'bg-muted',
          )}
        >
          <button
            type="button"
            onClick={() => onComuna?.(comuna.nombre)}
            className="min-w-0 flex-1 text-left focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{comuna.nombre}</span>
              {comuna.incidenciasAbiertas > 0 ? (
                // El color nunca es el único canal: el punto rojo va con su cifra.
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-destructive">
                  <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
                  {comuna.incidenciasAbiertas}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-sm tabular-nums text-muted-foreground">
              faltan {comuna.pendientes} de {comuna.total}
              {comuna.enRiesgoDeCorte > 0 ? (
                <span className="text-warning-subtle-foreground">
                  {' '}
                  · {comuna.enRiesgoDeCorte} cerca del corte
                </span>
              ) : null}
            </span>
          </button>

          {/* F11: cada fila lleva a donde se actúa, con el filtro ya puesto. */}
          <Link
            href={`/operaciones?comuna=${encodeURIComponent(comuna.nombre)}`}
            className="shrink-0 text-xs font-medium text-brand hover:underline"
          >
            Ver pedidos
          </Link>
        </li>
      ))}
    </ul>
  );
}
