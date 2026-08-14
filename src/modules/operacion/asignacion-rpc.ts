/**
 * Envoltorio de `operacion.asignar_pedidos_en_bloque` — el LADO DE ESCRITURA
 * de la asignación en bloque (etapa 6, docs/ux/etapa-6-asignacion-en-bloque.md
 * §7). La lectura (bandeja de asignables) vive en `./asignacion.ts`, que este
 * archivo no toca.
 *
 * Molde: `src/modules/operacion/retiro/rpc.ts` — `.schema('operacion').rpc(...)`
 * explícito (sin él, PostgREST busca `public.<función>`, no la encuentra y
 * falla en silencio si el llamador no revisa el error), normalización
 * defensiva del `data` array-o-escalar, y lanza con mensaje propio en vez de
 * devolver algo vacío.
 *
 * La función SQL vive en
 * `supabase/migrations/20260814000001_operacion_asignacion_en_bloque.sql` —
 * léela antes de tocar este archivo, ahí está el porqué de cada regla. Es
 * `security definer`, ejecutable SOLO por `service_role`: el `cliente` que
 * recibe este módulo ya debe serlo (lo construye el llamador con
 * `crearClienteServiceRole()`), y el aislamiento lo impone `p_tenant_id`, que
 * el llamador ya resolvió contra la sesión — nunca lo tomes de un claim.
 *
 * =============================================================================
 * EL MAPEO DE MOTIVOS ES EXPLÍCITO A PROPÓSITO
 * =============================================================================
 * El SQL clasifica cada omisión como `'ajeno' | 'no_retirado' |
 * 'estado_no_asignable' | 'ya_en_manifiesto'` (migración §1, paso (5)). El
 * contrato de este módulo usa `'ya_estaba_en_manifiesto'` para ese último
 * valor — los nombres NO coinciden letra por letra — así que la traducción
 * pasa por una tabla explícita (`MOTIVOS_OMISION_SQL_A_DOMINIO`), nunca por un
 * cast a ciegas. Si el SQL algún día emite un motivo que esta tabla no
 * reconoce, `asignarPedidosEnBloqueRpc` LANZA en vez de devolver un valor
 * inventado: dos mitades de una verdad (el `CHECK` de la migración de
 * conciliación y su lista en TypeScript) que se separan en silencio es el
 * patrón que más caro ha costado en este repo. `asignacion-rpc.test.ts` trae
 * una prueba que ata las dos listas — copiada de la migración, no derivada de
 * esta misma tabla — para que un futuro editor no pueda tocar una mitad sin
 * que la otra reviente.
 *
 * =============================================================================
 * TRADUCCIÓN DE ERRORES — SIN CONFIRMAR LA EXISTENCIA DE DATOS AJENOS
 * =============================================================================
 * La función SQL lanza en tres casos previstos: `22023` (lote vacío o
 * parámetros nulos), `P0002` (conductor que no existe O que es de otro
 * tenant — DELIBERADAMENTE el mismo código y mensaje para los dos casos,
 * migración §1 paso (1): distinguirlos confirmaría la existencia de un
 * conductor ajeno) y `23503` (el actor de la acción no existe en
 * `auth.users`). Este envoltorio traduce los tres a mensajes de dominio, y
 * mantiene la MISMA ambigüedad para `P0002` — no lo separes al traducirlo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// =============================================================================
// Contrato público
// =============================================================================

export type MotivoOmision =
  | "no_retirado"
  | "estado_no_asignable"
  | "ya_estaba_en_manifiesto"
  | "ajeno";

export interface ResultadoAsignacionEnBloque {
  manifiestoId: string;
  manifiestoCreado: boolean;
  totalSolicitados: number;
  totalAsignados: number;
  totalReasignados: number;
  totalOmitidos: number;
  /** Uno por pedido omitido. Sin esto la pantalla solo puede decir cuántos, no cuáles. */
  omitidos: { pedidoId: string; motivo: MotivoOmision }[];
}

// =============================================================================
// El mapeo de motivos — única fuente de verdad de la traducción SQL → dominio
// =============================================================================

/**
 * Claves: el texto EXACTO que emite `operacion.asignar_pedidos_en_bloque`
 * (migración §1, paso (5), el `case` de `clasificado` y el filtro final de
 * `omitidos_detalle`). Valores: el `MotivoOmision` de este contrato.
 * Exportada para que la prueba de `asignacion-rpc.test.ts` pueda atarla,
 * campo por campo, contra una copia independiente de la lista del SQL.
 */
export const MOTIVOS_OMISION_SQL_A_DOMINIO: Readonly<Record<string, MotivoOmision>> = {
  ajeno: "ajeno",
  no_retirado: "no_retirado",
  estado_no_asignable: "estado_no_asignable",
  ya_en_manifiesto: "ya_estaba_en_manifiesto",
};

function mapearMotivoOmision(motivoSql: string, pedidoId: string): MotivoOmision {
  const motivo = MOTIVOS_OMISION_SQL_A_DOMINIO[motivoSql];
  if (!motivo) {
    throw new Error(
      `asignarPedidosEnBloqueRpc: motivo de omisión desconocido "${motivoSql}" para el pedido ${pedidoId}. ` +
        "operacion.asignar_pedidos_en_bloque emitió un motivo que este envoltorio no traduce todavía " +
        "(actualiza MOTIVOS_OMISION_SQL_A_DOMINIO en src/modules/operacion/asignacion-rpc.ts).",
    );
  }
  return motivo;
}

interface FilaOmitidoDetalleSql {
  pedido_id: string;
  motivo: string;
}

/**
 * `omitidos_detalle` es `jsonb`, con default `'[]'::jsonb` en el SQL — nunca
 * debería llegar `null`, pero se trata defensivamente igual (mismo criterio
 * que el resto del módulo `operacion/retiro` frente a la forma de PostgREST).
 * Cualquier valor que no sea un arreglo se trata como "sin detalle" en vez de
 * reventar: es preferible una pantalla sin desglose a una que no carga.
 */
function normalizarOmitidos(detalle: unknown): ResultadoAsignacionEnBloque["omitidos"] {
  if (!Array.isArray(detalle)) return [];
  return (detalle as FilaOmitidoDetalleSql[]).map((item) => ({
    pedidoId: item.pedido_id,
    motivo: mapearMotivoOmision(item.motivo, item.pedido_id),
  }));
}

// =============================================================================
// Traducción de errores previstos del SQL
// =============================================================================

interface ErrorPostgrestMinimo {
  code?: string;
  message: string;
}

function traducirErrorAsignacionEnBloque(error: ErrorPostgrestMinimo): Error {
  switch (error.code) {
    case "22023":
      // Lote vacío o p_tenant_id/p_conductor_id/p_fecha nulos (migración §1,
      // paso (0)). En la práctica, con el gate de la Server Action puesto
      // antes, esto solo ocurre si la selección se perdió en el camino.
      return new Error(
        "No se recibió ningún pedido válido para asignar. Vuelve a seleccionar e inténtalo de nuevo.",
      );
    case "P0002":
      // Mismo mensaje tanto si el conductor no existe como si es de otro
      // tenant — el SQL los deja indistinguibles a propósito (migración §1,
      // paso (1)) para no confirmar la existencia de un conductor ajeno. NO
      // separar este mensaje en dos casos.
      return new Error("El conductor no existe o no pertenece a tu equipo.");
    case "23503":
      // El actor (`p_actor_usuario_id`) no existe — la FK de
      // `asignaciones_pedido`/`bitacora_auditoria` lo rechaza (migración §1,
      // paso (7)). No debería ocurrir con un `actorUsuarioId` que sale de la
      // sesión validada, pero se traduce igual para no filtrar el error crudo.
      return new Error("El usuario que ejecuta la asignación no es válido.");
    default:
      return new Error(`Error al asignar los pedidos: ${error.message}`);
  }
}

// =============================================================================
// asignarPedidosEnBloqueRpc
// =============================================================================

interface FilaAsignarPedidosEnBloqueSql {
  manifiesto_id: string;
  manifiesto_creado: boolean;
  // `integer` en el SQL — normalmente llega como number, pero se normaliza
  // con `Number()` igual: PostgREST puede devolver un `integer` como string
  // según la ruta de serialización, y confiar en el tipo declarado sin
  // convertir es exactamente el tipo de supuesto que ya mordió en este repo.
  total_solicitados: number | string;
  total_asignados: number | string;
  total_reasignados: number | string;
  total_omitidos: number | string;
  omitidos_detalle: unknown;
}

/**
 * Asigna (o reasigna) un lote de pedidos a un conductor, en una sola
 * transacción SQL. Ver la cabecera de este archivo y la de la migración para
 * el contrato completo — resumen:
 *
 * - El manifiesto de `(conductor, fecha)` es subproducto: se reutiliza si
 *   sigue vivo, se crea si no. `manifiestoCreado` distingue los dos casos.
 * - Cada `pedidoId` cae en exactamente un cubo: asignado, reasignado, u
 *   omitido con su motivo (`omitidos`).
 * - La bitácora la escribe la función SQL, DENTRO de la misma transacción —
 *   este envoltorio no debe escribir un segundo asiento.
 *
 * Lanza `Error` (nunca el error crudo de Postgrest) en los tres casos
 * previstos del SQL (lote vacío, conductor ajeno/inexistente, actor
 * inexistente) y también si el RPC no devuelve fila o si el propio Postgrest
 * falla por cualquier otro motivo.
 */
export async function asignarPedidosEnBloqueRpc(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    conductorId: string;
    fecha: string;
    pedidoIds: readonly string[];
    actorUsuarioId: string;
  },
): Promise<ResultadoAsignacionEnBloque> {
  const { data, error } = await cliente.schema("operacion").rpc("asignar_pedidos_en_bloque", {
    p_tenant_id: entrada.tenantId,
    p_conductor_id: entrada.conductorId,
    p_fecha: entrada.fecha,
    p_pedido_ids: entrada.pedidoIds,
    p_actor_usuario_id: entrada.actorUsuarioId,
  });

  if (error) {
    throw traducirErrorAsignacionEnBloque(error);
  }

  const fila = (Array.isArray(data) ? data[0] : data) as FilaAsignarPedidosEnBloqueSql | undefined;
  if (!fila) {
    throw new Error("asignar_pedidos_en_bloque no devolvió ninguna fila.");
  }

  return {
    manifiestoId: fila.manifiesto_id,
    manifiestoCreado: fila.manifiesto_creado,
    totalSolicitados: Number(fila.total_solicitados),
    totalAsignados: Number(fila.total_asignados),
    totalReasignados: Number(fila.total_reasignados),
    totalOmitidos: Number(fila.total_omitidos),
    omitidos: normalizarOmitidos(fila.omitidos_detalle),
  };
}
