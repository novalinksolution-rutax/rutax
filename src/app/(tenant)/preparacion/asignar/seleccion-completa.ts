"use server";

/**
 * Lectura auxiliar de SOLO LECTURA para "Seleccionar los N de este filtro"
 * (§6.4). Deliberadamente en un archivo DISTINTO de `actions.ts` — ese
 * archivo lo construye otro agente en paralelo, para la ESCRITURA (asignar/
 * reasignar en bloque vía `operacion.asignar_pedidos_en_bloque`), y no hay
 * que tocarlo. Esta función no llama esa RPC ni nada que mueva un pedido: es
 * puro `SELECT`.
 *
 * =============================================================================
 * POR QUÉ ESTO EXISTE Y NO BASTA CON `resolverIdsAsignables`
 * =============================================================================
 * `resolverIdsAsignables` (`src/modules/operacion/asignacion.ts`) es correcta
 * y suficiente para el ENVÍO real del lote: la función SQL solo necesita
 * `uuid[]`. Pero la SELECCIÓN de esta pantalla guarda una "foto" por pedido
 * (§6.2 del documento: código visible, comuna, seller, estado, conductor
 * actual) — es lo que permite que el panel "Ver selección" y la advertencia
 * de reasignación sigan funcionando para pedidos que quedaron fuera de la
 * página visible. `resolverIdsAsignables` no trae esa foto (con toda razón:
 * es para el envío, que solo necesita ids).
 *
 * Para no duplicar esa proyección en una consulta nueva —y sobre todo para
 * NO TOCAR `asignacion.ts`, "terminada y probada" (ver el mensaje que
 * encargó esta etapa)—, este archivo RECORRE `listarPedidosAsignables` en
 * páginas acotadas (muy por debajo del `max_rows = 1000` de PostgREST) hasta
 * agotar el filtro. Es el mismo principio de seguridad que `leerTodasLasFilas`
 * (CLAUDE.md: "PostgREST corta en 1.000 filas sin avisar"), aplicado desde
 * el llamador porque la función de barrido genérico vive en un módulo que
 * esta etapa no debe modificar.
 *
 * Mismo gate RBAC que la asignación real (`puedeAsignarYReasignarPedidos`):
 * esto solo LEE, pero es parte de la misma pantalla protegida, y "ocultar
 * el botón no basta" — la autorización real vive en el backend.
 */

import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  listarPedidosAsignables,
  type EstadoAsignable,
  type FiltroAsignables,
  type PedidoAsignable,
} from "@/modules/operacion/asignacion";

/** Tamaño de cada barrido — bien por debajo del `max_rows = 1000` de PostgREST. */
const TAMANO_BARRIDO = 200;

/** Válvula de seguridad: un filtro roto (o un tenant enorme) falla, no descarga sin fin. */
const TOPE_FILAS = 5_000;

export interface FiltroSeleccionCompleta {
  comunas?: readonly string[];
  sellerId?: string | null;
  texto?: string | null;
  estado?: EstadoAsignable | null;
}

export type ResultadoSeleccionCompleta =
  | { ok: true; pedidos: PedidoAsignable[] }
  | { ok: false; mensaje: string };

/**
 * TODOS los pedidos que cumplen el filtro (no solo la página visible), para
 * "Seleccionar los N de este filtro" (§6.4). `fecha` se calcula acá, con la
 * MISMA regla que `page.tsx` — nunca se recibe del cliente (mismo motivo que
 * la Server Action de escritura: la base corre en UTC, y confiar en el reloj
 * del navegador correría el día operativo).
 */
export async function actionResolverSeleccionCompleta(
  filtro: FiltroSeleccionCompleta,
): Promise<ResultadoSeleccionCompleta> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }
  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para asignar pedidos." };
  }

  const cliente = crearClienteServiceRole();
  const filtroCompleto: FiltroAsignables = {
    tenantId: sesion.usuario.tenantId,
    fecha: fechaLocalEnSantiago(new Date()),
    comunas: filtro.comunas,
    sellerId: filtro.sellerId ?? null,
    texto: filtro.texto ?? null,
    estado: filtro.estado ?? null,
  };

  try {
    const acumulado: PedidoAsignable[] = [];
    let pagina = 1;

    for (;;) {
      const { pedidos, total } = await listarPedidosAsignables(cliente, filtroCompleto, {
        pagina,
        porPagina: TAMANO_BARRIDO,
      });
      acumulado.push(...pedidos);

      if (pedidos.length === 0 || acumulado.length >= total) break;

      if (acumulado.length >= TOPE_FILAS) {
        return {
          ok: false,
          mensaje: "Hay demasiados pedidos para seleccionar de una vez. Acota el filtro por comuna o por seller.",
        };
      }
      pagina += 1;
    }

    return { ok: true, pedidos: acumulado };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No pudimos traer todos los pedidos de este filtro.",
    };
  }
}
