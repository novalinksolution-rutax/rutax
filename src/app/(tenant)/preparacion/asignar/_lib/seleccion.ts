/**
 * La selección — `Map<pedidoId, PedidoSeleccionado>`, lógica PURA (§6 del
 * documento). Ver docs/ux/etapa-6-asignacion-en-bloque.md §6.1-§6.3.
 *
 * =============================================================================
 * EL BUG QUE ESTO EXISTE PARA HACER IMPOSIBLE (§6.1)
 * =============================================================================
 * Con un `Set<string>` de ids, la advertencia de reasignación se calculaba
 * filtrando la lista VISIBLE:
 *
 *   pedidosDisponibles.filter(pd => seleccionados.has(pd.pedido.id) && pd.pedido.estado === "asignado")
 *
 * `pedidosDisponibles` es la página actual. Un pedido marcado bajo un filtro
 * anterior sigue en el `Set` —sigue viajando en el envío— pero deja de tener
 * dónde mostrarse: el filtro nunca lo encuentra, así que la advertencia no
 * dispara aunque el id sí se envíe.
 *
 * El arreglo: la selección guarda su propia FOTO de cada pedido al marcarlo
 * (`PedidoSeleccionado`, tomada de la fila real en el instante del clic). Con
 * eso, "qué está seleccionado" deja de depender de "qué está renderizado" —
 * la barra, el panel y la advertencia leen SIEMPRE del `Map`, nunca de la
 * lista filtrada actual. No hay dos listas entre las que un filtro nuevo
 * pueda hacer que algo se pierda.
 *
 * Por qué vive en `_lib/` y no en el `.tsx`: Vitest corre en entorno `node` y
 * solo recoge `src/**\/*.test.ts` (ver `vitest.config.ts`) — nada que viva
 * dentro de un componente se puede probar. Mismo criterio que
 * `preparacion/_lib/estado-preparacion.ts` y `reloj-inactividad.ts`.
 */

import type { EstadoAsignable, PedidoAsignable } from "@/modules/operacion/asignacion";

// =============================================================================
// La foto — §6.2
// =============================================================================

/** La foto mínima que la selección guarda de cada pedido al marcarlo (§6.2). */
export interface PedidoSeleccionado {
  pedidoId: string;
  /** `ml_shipment_id ?? codigo_interno`. NUNCA `tracking_token`: ese es público. */
  codigoVisible: string;
  comuna: string | null;
  sellerNombre: string | null;
  estado: EstadoAsignable;
  conductorActualId: string | null;
  conductorActualNombre: string | null;
}

/** Construye la foto a partir de una fila de la bandeja — se toma al marcar. */
export function fotoDeSeleccion(pedido: PedidoAsignable): PedidoSeleccionado {
  return {
    pedidoId: pedido.pedidoId,
    codigoVisible: pedido.codigoVisible,
    comuna: pedido.comuna,
    sellerNombre: pedido.sellerNombre,
    estado: pedido.estado,
    conductorActualId: pedido.conductorActualId,
    conductorActualNombre: pedido.conductorActualNombre,
  };
}

// =============================================================================
// "N fuera de este filtro" — §6.3
// =============================================================================

/**
 * Cuántos seleccionados NO están entre los ids de la página actual
 * (§6.3: "3 fuera de este filtro"). No es "no cumple los filtros aplicados"
 * en sentido estricto — es "no está entre lo que se ve ahora mismo en
 * pantalla", que es la pregunta que responde la barra.
 */
export function contarFueraDeFiltro(
  seleccion: ReadonlyMap<string, PedidoSeleccionado>,
  idsVisibles: ReadonlySet<string>,
): number {
  let fuera = 0;
  for (const id of seleccion.keys()) {
    if (!idsVisibles.has(id)) fuera += 1;
  }
  return fuera;
}

// =============================================================================
// Advertencia de reasignación, agrupada por conductor de origen — §7.2-§7.3
// =============================================================================

export interface GrupoReasignacion {
  conductorActualId: string;
  conductorActualNombre: string;
  pedidos: PedidoSeleccionado[];
}

/**
 * Pedidos seleccionados que YA tienen conductor distinto del elegido,
 * agrupados por ese conductor de origen (§7.2: "Se filtra el Map COMPLETO
 * por estado === 'asignado' && conductorActualId !== conductorElegidoId").
 * Vacío ⇒ no hace falta el diálogo de reasignación — el envío va directo,
 * sin fricción para el caso más común.
 *
 * Itera el `Map` completo, nunca una lista "visible": es la mitad del
 * arreglo de §6.2 que hace la advertencia correcta por construcción — no hay
 * forma de volver a escribir el filtro equivocado, porque no hay una lista
 * "renderizada" que consultar en vez del `Map`.
 */
export function agruparAdvertenciaReasignacion(
  seleccion: ReadonlyMap<string, PedidoSeleccionado>,
  conductorElegidoId: string,
): GrupoReasignacion[] {
  const grupos = new Map<string, GrupoReasignacion>();

  for (const pedido of seleccion.values()) {
    if (pedido.estado !== "asignado") continue;
    if (!pedido.conductorActualId) continue;
    if (pedido.conductorActualId === conductorElegidoId) continue;

    const clave = pedido.conductorActualId;
    const existente = grupos.get(clave);
    if (existente) {
      existente.pedidos.push(pedido);
    } else {
      grupos.set(clave, {
        conductorActualId: clave,
        // Defensivo: por construcción `driver_id_asignado` siempre trae su
        // nombre resuelto (`asignacion.ts:filaAPedidoAsignable`), pero un
        // `null` acá no debe reventar la pantalla — mismo criterio de
        // fallback que usaba el selector anterior.
        conductorActualNombre: pedido.conductorActualNombre ?? "Conductor desconocido",
        pedidos: [pedido],
      });
    }
  }

  // Orden estable y determinista: alfabético por nombre de conductor — para
  // que el mismo estado de selección produzca siempre el mismo diálogo.
  return [...grupos.values()].sort((a, b) =>
    a.conductorActualNombre.localeCompare(b.conductorActualNombre, "es"),
  );
}

/** `true` si hay al menos un pedido que dispararía el diálogo de reasignación. */
export function hayReasignacion(
  seleccion: ReadonlyMap<string, PedidoSeleccionado>,
  conductorElegidoId: string,
): boolean {
  return agruparAdvertenciaReasignacion(seleccion, conductorElegidoId).length > 0;
}

// =============================================================================
// Selección agrupada por comuna — panel "Ver selección" (§6.3)
// =============================================================================

export interface GrupoSeleccionPorComuna {
  comuna: string | null;
  pedidos: PedidoSeleccionado[];
}

/**
 * Selección agrupada por comuna para el panel lateral. Mismo criterio que
 * `listarComunasConAsignables`: alfabético, y "sin comuna conocida" —
 * `comuna: null`— siempre al final y solo si tiene algo.
 */
export function agruparSeleccionPorComuna(
  seleccion: ReadonlyMap<string, PedidoSeleccionado>,
): GrupoSeleccionPorComuna[] {
  const grupos = new Map<string, PedidoSeleccionado[]>();
  const sinComuna: PedidoSeleccionado[] = [];

  for (const pedido of seleccion.values()) {
    if (pedido.comuna === null) {
      sinComuna.push(pedido);
      continue;
    }
    const lista = grupos.get(pedido.comuna);
    if (lista) lista.push(pedido);
    else grupos.set(pedido.comuna, [pedido]);
  }

  const resultado: GrupoSeleccionPorComuna[] = [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "es"))
    .map(([comuna, pedidos]) => ({ comuna, pedidos }));

  if (sinComuna.length > 0) resultado.push({ comuna: null, pedidos: sinComuna });

  return resultado;
}
