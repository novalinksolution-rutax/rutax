'use client';

/**
 * La leyenda del mapa.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ LA RAMPA NO LLEVA NÚMEROS FIJOS
 * -----------------------------------------------------------------------------
 * La rampa de carga es de **cuartiles del día**, no una escala con cortes
 * escritos: el paso 3 puede ser «14 pendientes» un martes de agosto y «60» un
 * CyberMonday. Poner «0–5 / 6–15 / 16–30» sería inventar cortes que el mapa no
 * usa, y el propio estilo lo advierte: «es un ordinal —más oscuro = más
 * faltan—, no una escala semántica».
 *
 * Entonces la leyenda dice **los extremos reales de hoy**: «por entregar · 1 →
 * 14». Es una magnitud y no un índice (regla 3), se lee sin aprender nada, y el
 * día que la operación se duplique la leyenda se duplica sola.
 *
 * -----------------------------------------------------------------------------
 * LO QUE NO ESTÁ, Y NO ES UN OLVIDO
 * -----------------------------------------------------------------------------
 * El tablero B1a incluye en la leyenda **«última posición del conductor»**. Ese
 * rastreo se cortó el 2026-08-14 tras una revisión de privacidad —la última
 * posición del día sobrevivía indefinidamente y muchas veces era el domicilio
 * del conductor, Ley 21.431— y hay un candado de regresión que impide volver a
 * leer esa tabla. Dibujar su entrada en la leyenda sería anunciar un símbolo que
 * el mapa nunca pinta: la leyenda quedaría mintiendo sobre lo que se puede ver.
 */

import type { PaletaMapa } from '../_lib/mapa/paleta';

export function LeyendaMapa({
  paleta,
  minPendientes,
  maxPendientes,
}: {
  paleta: PaletaMapa;
  /** Mínimo de pendientes entre las comunas CON carga. */
  minPendientes: number;
  maxPendientes: number;
}) {
  // Sin carga no hay rampa que explicar, y una leyenda de una capa que no se
  // dibuja es ruido sobre un mapa vacío.
  if (maxPendientes === 0) return null;

  return (
    <div
      // `pointer-events-none`: la leyenda explica el mapa, no compite por sus
      // clics. Los pocos elementos que sí reciben clic lo reactivan.
      className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-card/90 px-2.5 py-1.5 text-xs backdrop-blur-[2px]"
      aria-label="Leyenda del mapa"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Por entregar</span>
        <span className="flex" aria-hidden="true">
          {paleta.datos.cargaComuna.map((color, i) => (
            <span
              key={i}
              className="size-3"
              style={{ backgroundColor: color, borderRadius: 0 }}
            />
          ))}
        </span>
        {/* Los extremos reales del día, no cortes inventados. Cuando el mínimo
            y el máximo coinciden —un día tranquilo con una parada por comuna—
            se dice el número solo: «1 → 1» se lee como un rango roto. */}
        <span className="tabular-nums text-muted-foreground">
          {minPendientes === maxPendientes
            ? maxPendientes
            : `${minPendientes} → ${maxPendientes}`}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {/* El único rojo del mapa, y lo único accionable de la pantalla. */}
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: paleta.datos.puntoIncidencia }}
          aria-hidden="true"
        />
        <span className="text-muted-foreground">Incidencia abierta</span>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Ámbar, y anillo en vez de relleno: marca urgencia sin competir con el
            rojo de la incidencia, que es el único que reclama acción. */}
        <span
          className="size-2 rounded-full border-2"
          style={{ borderColor: paleta.datos.anilloCorte }}
          aria-hidden="true"
        />
        <span className="text-muted-foreground">Cerca del corte</span>
      </div>
    </div>
  );
}
