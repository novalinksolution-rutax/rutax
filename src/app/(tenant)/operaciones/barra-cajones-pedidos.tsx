"use client";

/**
 * La barra de cajones de Pedidos.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ HAY UN PUENTE Y NO SE USA `BarraCajones` DIRECTO
 * -----------------------------------------------------------------------------
 * `page.tsx` es un Server Component y construye sus destinos como cadenas —los
 * filtros viven en la URL, que es lo que permite compartir una vista y volver
 * atrás con el botón del navegador. `BarraCajones` es de cliente y avisa por
 * callback.
 *
 * Este archivo es la costura: recibe los `href` ya armados en el servidor y los
 * navega. **La URL sigue siendo la fuente de verdad del filtro**, que es lo que
 * no había que perder al cambiar de componente.
 *
 * -----------------------------------------------------------------------------
 * LA ARITMÉTICA DE LA BARRA, QUE NO ES OBVIA
 * -----------------------------------------------------------------------------
 * Los cajones **no suman el total, y eso es correcto**:
 *
 * · **cinco cajones suman** — sin asignar, asignado, en ruta, entregado, con
 *   problemas;
 * · **«por revisar» CRUZA los cinco**: un pedido con la dirección por revisar
 *   está además en alguno de ellos, así que sus filas **ya están contadas**.
 *   Meterlo en la suma daría un número mayor que el total;
 * · **«cancelado» queda FUERA**: no está pendiente, no va en ruta y no se
 *   entregó. Va tras el separador, en tono fuera de juego.
 *
 * La barra declara «284 de 291» y muestra la diferencia en vez de explicarla en
 * una nota al pie. ⚠️ **La interfaz no puede mentir sobre esto**: que la suma no
 * dé el total hay que decirlo, no esconderlo.
 */

import { useRouter } from "next/navigation";

import { BarraCajones } from "@/components/ui/barra-cajones";

export function BarraCajonesPedidos({
  cajones,
  transversal,
  excluido,
  activo,
  total,
  /** Destino de cada cajón, y el de «todos» bajo la clave vacía. Vienen del servidor. */
  destinos,
}: {
  cajones: { clave: string; etiqueta: string; conteo: number }[];
  transversal?: { clave: string; etiqueta: string; conteo: number };
  excluido?: { clave: string; etiqueta: string; conteo: number };
  activo: string | null;
  total: number;
  destinos: Record<string, string>;
}) {
  const router = useRouter();

  return (
    <BarraCajones
      cajones={cajones}
      transversal={transversal}
      excluido={excluido}
      activo={activo}
      total={total}
      onSeleccionar={(clave) => {
        const destino = destinos[clave ?? ""];
        if (destino) router.push(destino);
      }}
    />
  );
}
