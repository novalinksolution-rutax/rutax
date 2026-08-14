/**
 * Clasificación del resultado de `asignar_pedidos_en_bloque` en sus TRES
 * bloques de severidad (§7.5) — lógica PURA, sin React. Es la pieza donde un
 * error se lee como "se asignaron menos de los que pedí" sin explicar por
 * qué, así que vive fuera del `.tsx` y con pruebas propias (Vitest en
 * entorno `node`, `src/**\/*.test.ts` — nada dentro de un componente se
 * puede probar).
 *
 * =============================================================================
 * POR QUÉ TRES BLOQUES Y NO UN SOLO BALDE DE "OMITIDOS" (§7.5)
 * =============================================================================
 * El backend devuelve tres motivos de omisión juntos, pero para el
 * coordinador NO son la misma noticia:
 *
 *   · `ya_estaba_en_manifiesto` — el sistema confirma que su intención YA
 *     estaba lograda. No es un problema.
 *   · `no_retirado` / `estado_no_asignable` (y, defensivamente, `ajeno`) —
 *     esto sí es "no se pudo asignar", tono ámbar.
 *
 * Darle el mismo tono a "ya estaba con este conductor" que a "se canceló"
 * entrena al coordinador a temerle a un resultado parcial que en realidad es
 * un éxito.
 *
 * =============================================================================
 * SOBRE `ajeno` — NO ESTÁ EN LA TABLA DEL §7.5, Y ES UNA DECISIÓN DE ESTA ETAPA
 * =============================================================================
 * La tabla de §7.5 solo lista tres motivos (`ya_estaba_en_manifiesto`,
 * `no_retirado`, `estado_no_asignable`); `ajeno` no aparece ahí, aunque SÍ
 * está en la lista de motivos del contrato (mensaje que encargó esta etapa) y
 * en `operacion.asignar_pedidos_en_bloque` (migración 20260814000001). En la
 * práctica no debería ocurrir nunca desde esta pantalla —los ids que se
 * envían siempre vinieron de una fila que la propia bandeja mostró, o de
 * `resolverIdsAsignables` sobre el mismo tenant—, pero la función SQL lo
 * contempla como reja defensiva (id que dejó de existir o que resultó de
 * otro courier). Decisión: se trata como el resto del balde "no se pudo
 * asignar" (tono ámbar, mismo bloque), con su propio texto y SIN botón "Ver
 * pedido" — a diferencia de `estado_no_asignable`, un pedido `ajeno` puede no
 * existir siquiera en este tenant, y enlazarlo sería un callejón sin salida.
 */

import type { MotivoOmision, ResultadoAsignacionEnBloque } from "@/modules/operacion/asignacion-rpc";
import type { PedidoSeleccionado } from "./seleccion";

// Re-exportadas para que el resto de `_componentes/` y `bandeja-asignar.tsx`
// las importen desde acá (el punto de entrada de este módulo de
// clasificación) sin tener que conocer `asignacion-rpc.ts` directamente.
export type { MotivoOmision, ResultadoAsignacionEnBloque };

export interface OmisionResultado {
  pedidoId: string;
  motivo: MotivoOmision;
}

// =============================================================================
// Clasificación
// =============================================================================

/** Los dos motivos que SÍ pertenecen al bloque ámbar "no se pudo asignar". */
export type MotivoNoAsignado = "no_retirado" | "estado_no_asignable" | "ajeno";

export interface ItemResultado {
  pedidoId: string;
  codigoVisible: string;
  comuna: string | null;
}

export interface ItemNoAsignado extends ItemResultado {
  motivo: MotivoNoAsignado;
}

export interface ResultadoClasificado {
  huboOmisiones: boolean;
  /** `totalAsignados + totalReasignados` — los que de verdad quedaron con el conductor elegido. */
  totalQuedaronCon: number;
  totalReasignadosDesdeOtro: number;
  /** Bloque neutro: ya estaban donde el coordinador quería. */
  yaEnManifiesto: ItemResultado[];
  /** Bloque ámbar: esto sí necesita que el coordinador actúe. */
  noSePudoAsignar: ItemNoAsignado[];
}

/**
 * Arma el ítem de UNA omisión combinando el `pedidoId` que devuelve el
 * backend con la foto que la SELECCIÓN ya tenía guardada (§6.2) — el backend
 * no repite código visible ni comuna, así que sin la foto el diálogo no
 * tendría qué mostrar. `pedidoId` como respaldo del código visible: nunca
 * deja una fila en blanco, aunque la foto faltara.
 */
function itemDe(pedidoId: string, fotos: ReadonlyMap<string, PedidoSeleccionado>): ItemResultado {
  const foto = fotos.get(pedidoId);
  return {
    pedidoId,
    codigoVisible: foto?.codigoVisible ?? pedidoId,
    comuna: foto?.comuna ?? null,
  };
}

/**
 * Clasifica el resultado crudo del backend en los tres bloques de §7.5.
 * `fotos` es la selección ANTES de depurarla (ver `idsQueSiguenSeleccionados`
 * más abajo) — tiene que ser una foto tomada en el momento del envío, porque
 * para cuando este resultado se renderiza el estado de selección ya pudo
 * haber cambiado.
 */
export function clasificarResultado(
  resultado: ResultadoAsignacionEnBloque,
  fotos: ReadonlyMap<string, PedidoSeleccionado>,
): ResultadoClasificado {
  const yaEnManifiesto: ItemResultado[] = [];
  const noSePudoAsignar: ItemNoAsignado[] = [];

  for (const omision of resultado.omitidos) {
    if (omision.motivo === "ya_estaba_en_manifiesto") {
      yaEnManifiesto.push(itemDe(omision.pedidoId, fotos));
    } else {
      noSePudoAsignar.push({ ...itemDe(omision.pedidoId, fotos), motivo: omision.motivo });
    }
  }

  return {
    huboOmisiones: resultado.totalOmitidos > 0,
    totalQuedaronCon: resultado.totalAsignados + resultado.totalReasignados,
    totalReasignadosDesdeOtro: resultado.totalReasignados,
    yaEnManifiesto,
    noSePudoAsignar,
  };
}

// =============================================================================
// Qué sigue seleccionado al cerrar — §7.5 "Qué pasa con la selección al cerrar"
// =============================================================================

/**
 * Los que terminaron bien (asignados, reasignados, ya en el manifiesto)
 * SALEN de la selección. Los que de verdad no se pudieron asignar SE QUEDAN
 * seleccionados, en la barra y en el panel, para que el coordinador actúe
 * sin volver a buscarlos — nunca "obliga a ir a buscarlos a mano".
 */
export function idsQueSiguenSeleccionados(resultado: ResultadoAsignacionEnBloque): Set<string> {
  return new Set(
    resultado.omitidos
      .filter((omision) => omision.motivo !== "ya_estaba_en_manifiesto")
      .map((omision) => omision.pedidoId),
  );
}
