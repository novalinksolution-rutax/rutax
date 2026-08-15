/**
 * Envoltorio de `operacion.aplicar_secuencia_paradas` — el LADO DE ESCRITURA de
 * la secuencia de paradas (etapa 7 de "retiro en bodega + ruteo").
 *
 * La LECTURA no pasa por aquí: la secuencia viaja en la misma consulta de
 * `asignaciones_pedido` que ya hacen los tres puntos de render, y el orden final
 * lo arma `ordenarParadasConSecuencia` en `./orden-paradas.ts`.
 *
 * Molde: `./asignacion-rpc.ts` (etapa 6) — `.schema('operacion').rpc(...)`
 * explícito (sin él PostgREST busca `public.<función>`, no la encuentra y falla
 * de una forma que el llamador descuidado no mira), normalización defensiva del
 * `data` array-o-escalar, y traducción de los errores previstos a mensajes de
 * dominio en vez de dejar salir el error crudo.
 *
 * La función SQL vive en
 * `supabase/migrations/20260814000004_operacion_secuencia_paradas.sql` — léela
 * antes de tocar este archivo. Es `security definer`, ejecutable SOLO por
 * `service_role`: el `cliente` que recibe este módulo ya debe serlo (lo
 * construye el llamador con `crearClienteServiceRole()`), y el aislamiento lo
 * impone `p_tenant_id`, que el llamador ya resolvió contra la sesión — nunca lo
 * tomes de un claim del navegador.
 *
 * =============================================================================
 * UN SOLO CAMINO PARA LOS DOS CASOS
 * =============================================================================
 * El motor de ruteo y el arrastre manual del coordinador son EL MISMO HECHO:
 * "la secuencia de este manifiesto pasa a ser ésta". Por eso hay una sola
 * función y un solo envoltorio; lo único que los distingue es `origen`, que
 * viaja al asiento de bitácora y a ningún otro sitio.
 *
 * =============================================================================
 * SE MANDA LA SECUENCIA COMPLETA, NUNCA UN DELTA
 * =============================================================================
 * `pedidoIdsEnOrden` es la lista final del manifiesto, y su POSICIÓN es el
 * orden. Lo que no venga en la lista queda sin secuencia (NULL) — que es el
 * estado correcto para una parada que el motor no pudo ubicar. Mandar "solo lo
 * que cambió" es imposible a propósito: un delta obliga a razonar sobre el
 * estado previo, y el estado previo puede haber cambiado bajo los pies del
 * coordinador.
 *
 * =============================================================================
 * TRADUCCIÓN DE ERRORES — SIN CONFIRMAR LA EXISTENCIA DE DATOS AJENOS
 * =============================================================================
 * `P0002` significa "el manifiesto no existe O es de otro courier", y el SQL los
 * deja DELIBERADAMENTE indistinguibles: un error distinto para el segundo caso
 * confirmaría la existencia del manifiesto ajeno. No separes ese mensaje en dos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// =============================================================================
// Contrato público
// =============================================================================

/**
 * Quién produjo la secuencia. Los DOS valores existen en el `CHECK` implícito de
 * la función SQL (`p_origen not in ('motor','manual')` → 22023): si agregas uno
 * aquí sin agregarlo allá, la llamada falla con "parámetro inválido" y el
 * mensaje no dirá por qué. Las dos mitades se atan en
 * `secuencia-paradas-rpc.test.ts`.
 */
export type OrigenSecuencia = "motor" | "manual";

export const ORIGENES_SECUENCIA: readonly OrigenSecuencia[] = ["motor", "manual"] as const;

export interface ResultadoSecuenciaParadas {
  /** Paradas que quedaron con número de orden. */
  totalParadas: number;
  /**
   * Paradas ACTIVAS del manifiesto que quedaron sin secuencia — típicamente las
   * que el motor devolvió en `sinUbicar` por no tener coordenada usable. Es lo
   * que permite decir "27 secuenciadas · 3 sin coordenada" en la pantalla, en
   * vez de dejar que el conductor lo descubra en la calle.
   */
  totalSinSecuencia: number;
  /** Cuántas tenían secuencia antes de esta escritura (0 = manifiesto sin rutear). */
  totalPreviasLimpiadas: number;
}

// =============================================================================
// Puente con el motor de ruteo
// =============================================================================

/**
 * Convierte la `secuencia` que devuelve `calcularRuta` en el arreglo ordenado
 * que espera la función SQL.
 *
 * El motor ya emite `orden` empezando en 1 y contiguo, pero este helper ORDENA
 * igualmente por `orden` en vez de confiar en el orden del arreglo: el contrato
 * del motor promete el número, no la posición, y apoyarse en un detalle que el
 * tipo no garantiza es exactamente cómo se cuela un bug que solo aparece cuando
 * alguien cambia el solver.
 *
 * No se le pasan las `sinUbicar`: su sitio es quedarse sin secuencia.
 */
export function pedidoIdsDesdeSecuencia(
  secuencia: readonly { pedidoId: string; orden: number }[],
): string[] {
  return [...secuencia].sort((a, b) => a.orden - b.orden).map((s) => s.pedidoId);
}

// =============================================================================
// Traducción de errores previstos del SQL
// =============================================================================

interface ErrorPostgrestMinimo {
  code?: string;
  message: string;
}

/**
 * La lista enviada ya no corresponde a las paradas activas del manifiesto
 * (`P0001`): alguien reasignó, quitó o agregó un pedido mientras el coordinador
 * ordenaba.
 *
 * Existe como TIPO y no solo como mensaje porque la pantalla tiene que
 * comportarse distinto: **el remedio es RECARGAR, no reintentar.** Reintentar
 * con la misma lista vuelve a fallar exactamente igual, y un botón de
 * "reintentar" ahí es una trampa — el coordinador lo aprieta tres veces antes de
 * entender que el problema no es la red. Distinguirlo por el texto del mensaje
 * sería atarlo a una redacción que el copywriter puede cambiar mañana.
 */
export class ErrorSecuenciaDesincronizada extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorSecuenciaDesincronizada";
  }
}

function traducirErrorSecuencia(error: ErrorPostgrestMinimo): Error {
  switch (error.code) {
    case "22023":
      // Parámetros nulos, `origen` desconocido, un NULL dentro del arreglo o un
      // pedido repetido (migración §3, paso (1)). Con el gate de la Server
      // Action puesto antes, esto solo ocurre si la lista se corrompió en el
      // camino — y entonces reintentar con la misma lista no arregla nada.
      return new Error(
        "La secuencia recibida no es válida (hay paradas repetidas o incompletas). Vuelve a cargar la ruta e inténtalo de nuevo.",
      );
    case "P0002":
      // Manifiesto inexistente O de otro courier. MISMO mensaje para los dos —
      // el SQL los deja indistinguibles a propósito. No lo separes.
      return new Error("El manifiesto no existe o no pertenece a tu operación.");
    case "55000":
      return new Error(
        "Este manifiesto ya está cerrado (completado o cancelado) y su ruta no se puede modificar.",
      );
    case "P0001":
      // La lista no corresponde a las paradas activas del manifiesto: o venía un
      // pedido que no está en él, o la asignación cambió entre que la pantalla se
      // dibujó y el coordinador guardó. El mensaje pide RECARGAR, no reintentar:
      // reintentar con la misma lista volvería a fallar igual. Va con TIPO propio
      // para que la pantalla pueda ofrecer "recargar" en vez de "reintentar".
      return new ErrorSecuenciaDesincronizada(
        "La lista de paradas cambió mientras ordenabas la ruta. Vuelve a cargar el manifiesto y ordénalo otra vez.",
      );
    case "23503":
      return new Error("El usuario que aplica la ruta no es válido.");
    default:
      return new Error(`Error al guardar la secuencia de paradas: ${error.message}`);
  }
}

// =============================================================================
// aplicarSecuenciaParadasRpc
// =============================================================================

interface FilaAplicarSecuenciaSql {
  // `integer` en el SQL. Se normaliza con `Number()` igual: PostgREST puede
  // devolver un integer como string según la ruta de serialización, y confiar en
  // el tipo declarado sin convertir es el tipo de supuesto que ya mordió aquí.
  total_paradas: number | string;
  total_sin_secuencia: number | string;
  total_previas_limpiadas: number | string;
}

/**
 * Escribe la secuencia COMPLETA de paradas de un manifiesto, en una sola
 * transacción SQL. Sirve por igual para la ruta que calculó el motor y para el
 * reordenamiento manual del coordinador — no hay dos caminos.
 *
 * - `pedidoIdsEnOrden` es la lista final: su posición es el orden (1..N). Lo que
 *   no venga en ella queda sin secuencia.
 * - Un arreglo VACÍO es válido y significa "este manifiesto queda sin secuencia".
 * - La bitácora la escribe la función SQL, DENTRO de la misma transacción: este
 *   envoltorio NO debe escribir un segundo asiento.
 *
 * Lanza `Error` (nunca el error crudo de PostgREST) en los casos previstos del
 * SQL y también si el RPC no devuelve fila.
 */
export async function aplicarSecuenciaParadasRpc(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    manifiestoId: string;
    pedidoIdsEnOrden: readonly string[];
    origen: OrigenSecuencia;
    /** `null` para un job sin sesión humana — queda como actor `sistema`. */
    actorUsuarioId: string | null;
  },
): Promise<ResultadoSecuenciaParadas> {
  const { data, error } = await cliente.schema("operacion").rpc("aplicar_secuencia_paradas", {
    p_tenant_id: entrada.tenantId,
    p_manifiesto_id: entrada.manifiestoId,
    p_pedido_ids: entrada.pedidoIdsEnOrden,
    p_origen: entrada.origen,
    p_actor_usuario_id: entrada.actorUsuarioId,
  });

  if (error) {
    throw traducirErrorSecuencia(error);
  }

  const fila = (Array.isArray(data) ? data[0] : data) as FilaAplicarSecuenciaSql | undefined;
  if (!fila) {
    throw new Error("aplicar_secuencia_paradas no devolvió ninguna fila.");
  }

  return {
    totalParadas: Number(fila.total_paradas),
    totalSinSecuencia: Number(fila.total_sin_secuencia),
    totalPreviasLimpiadas: Number(fila.total_previas_limpiadas),
  };
}
