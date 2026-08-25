"use client";

/**
 * La costura entre el servidor y la barra de cajones.
 * =============================================================================
 *
 * `page.tsx` es un Server Component y arma los destinos como cadenas —el cajón
 * vive en la URL, que es lo que permite compartir «mis tarifas programadas» y
 * volver atrás con el botón del navegador—; `BarraCajones` es de cliente y avisa
 * por callback. Este archivo es la costura, igual que en Pedidos.
 *
 * ⚠️ **Acá los cajones SÍ suman el total, y por eso no hay `excluido` ni
 * `transversal`.** Una tarifa cae en exactamente uno de los cuatro: los estados
 * son mutuamente excluyentes por construcción (`clasificarTarifa` devuelve uno
 * solo) y `contarPorCajon` tiene una prueba que lo afirma. Si algún día aparece
 * un cajón que cruza —«sin monto al conductor», por ejemplo, que atraviesa
 * vigentes y programadas— va como `transversal` y no como un quinto cajón, o la
 * suma deja de dar.
 */

import { useRouter } from "next/navigation";

import { BarraCajones } from "@/components/ui/barra-cajones";

export function BarraCajonesTarifas({
  cajones,
  activo,
  total,
  destinos,
}: {
  cajones: { clave: string; etiqueta: string; conteo: number | null }[];
  activo: string | null;
  total: number | null;
  /** Destino de cada cajón, y el de «todas» bajo la clave vacía. */
  destinos: Record<string, string>;
}) {
  const router = useRouter();

  return (
    <BarraCajones
      cajones={cajones}
      activo={activo}
      total={total}
      onSeleccionar={(clave) => {
        const destino = destinos[clave ?? ""];
        if (destino) router.push(destino);
      }}
    />
  );
}
