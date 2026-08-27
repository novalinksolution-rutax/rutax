/**
 * Efectos same-day sobre el manifiesto — acciones que ocurren cuando
 * el conductor marca su manifiesto como 'en_ruta'.
 *
 * FRONTERA DURA: solo se actúa sobre pedidos cuyo POD gobierna Rutax (eje de
 * `fuente`, no de `tipo_pedido` — ver `./fuente.ts`). Los pedidos Flex NO se
 * tocan — sus transiciones de estado vienen de ML (la app de Mercado Envíos
 * Flex es obligatoria y no integrable — CLAUDE.md).
 *
 * Idempotente: los pedidos que ya están en 'en_ruta' (u otro estado) son
 * ignorados silenciosamente gracias al filtro de estado='asignado' en la
 * consulta y al optimistic locking de actualizarEstadoPedido.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import { actualizarEstadoPedido } from "./pedidos";
import { ErrorConflicto } from "@/modules/identidad/errores";

/**
 * Transiciona en lote los pedidos same-day del manifiesto que estén en
 * estado 'asignado' → 'en_ruta', con ejecutor 'conductor'.
 *
 * Idempotente: si un pedido ya salió de 'asignado' antes de ejecutarse
 * (carrera resuelta), el ErrorConflicto del optimistic locking se captura
 * y se ignora (no es un fallo real — el pedido ya avanzó).
 *
 * NO toca pedidos Flex (filtro por `fuente`, ver docstring del archivo).
 *
 * ⚠️ **`actorUsuarioId` es el UUID de `auth.users`, NO el del conductor**, y es un
 * parámetro propio precisamente porque `UsuarioActual` no lo tiene. Hasta el
 * 2026-08-14 esta función pasaba `actor.driverId` —el id de
 * `identidad.conductores`— como `actuadoPorUsuarioId`, y
 * `bitacora_auditoria.actor_usuario_id` tiene FK contra `auth.users(id)`. O sea:
 * el INSERT de bitácora violaba la FK, `actualizarEstadoPedido` lanzaba, y
 * **ningún pedido same-day llegaba nunca a `en_ruta`**. El conductor veía su
 * parada sin botón de "Entregar" y no había forma de destrabarla, porque
 * reintentar exige el manifiesto en `confirmado` y ya había pasado a `en_ruta`.
 *
 * Va **obligatorio y sin valor por defecto** a propósito: uno opcional dejaría
 * compilar a los llamadores viejos y el fallo volvería a aparecer en ejecución,
 * que es exactamente como se escapó la primera vez.
 *
 * @param cliente     Cliente service_role de Supabase.
 * @param manifiestoId UUID del manifiesto que pasó a 'en_ruta'.
 * @param tenantId    UUID del tenant (aislamiento).
 * @param driverId    UUID del conductor (para la barrera en actualizarEstadoPedido).
 * @param actor       UsuarioActual del conductor (para RBAC).
 * @param actorUsuarioId UUID de `auth.users` — el "quién" de RNF-04 en bitácora.
 * @param ejecutor    Quién dispara la transición. `'conductor'` cuando arranca su
 *                    ruta; `'sistema'` cuando la asignación pone al día una
 *                    parada con un manifiesto que YA va en la calle.
 *
 * ⚠️ **`'interno'` NO sirve acá y cuesta media hora descubrirlo.** La máquina de
 * estados admite `asignado → en_ruta` solo por `['sistema', 'conductor']` —
 * «un interno no puede hacer transiciones de ML», dice su propia prueba— y
 * además `actualizarEstadoPedido` le exige un `motivo` a todo lo `interno`
 * (RF-029). Con `'interno'` fallan las dos cosas, y si el llamador envuelve
 * esto en un `try/catch` (que debe hacerlo: la asignación no puede perderse por
 * esto), el pedido se queda en `asignado` sin que nada lo diga. Pasó el
 * 2026-08-27.
 *
 * La puesta al día es una CONSECUENCIA de la asignación, no una corrección
 * manual: `'sistema'` es además lo que describe el hecho. El «quién» no se
 * pierde — viaja igual en `actorUsuarioId`.
 */
export async function transicionarPedidosSameDayAEnRuta(
  cliente: SupabaseClient,
  manifiestoId: string,
  tenantId: string,
  driverId: string,
  actor: UsuarioActual,
  actorUsuarioId: string,
  ejecutor: "conductor" | "sistema" = "conductor",
): Promise<void> {
  // Leer los pedidos same-day del manifiesto que aún están en 'asignado'.
  // La JOIN va por asignaciones_pedido: la tabla que relaciona pedido↔manifiesto.
  const { data: asignaciones, error } = await cliente
    .from("asignaciones_pedido")
    .select("pedido_id, pedidos!inner(id, estado, fuente, driver_id_asignado)")
    .eq("manifiesto_id", manifiestoId)
    .eq("tenant_id", tenantId)
    .eq("activa", true)
    .eq("pedidos.estado", "asignado")
    // Filtro de recurso embebido de PostgREST: no puede llamar a la función TS
    // `podLoGobiernaLaFuente` de `./fuente`. El predicado equivalente es "toda
    // fuente salvo las que tienen POD externo" — hoy solo `ml_flex`
    // (`FUENTES_CON_POD_EXTERNO` en `./fuente.ts`). Si algún día se agrega una
    // segunda fuente con POD externo, este `.neq` deja de ser equivalente y hay
    // que revisarlo junto con esa lista.
    .neq("pedidos.fuente", "ml_flex");

  if (error) {
    // Un fallo de lectura es un error de infraestructura — relanzar para que
    // el llamador pueda registrarlo. No bloquea la transición del manifiesto,
    // que ya se hizo en la Server Action antes de llamar a esta función.
    throw new Error(
      `Error al leer pedidos same-day del manifiesto para en_ruta: ${error.message}`,
    );
  }

  if (!asignaciones || asignaciones.length === 0) return;

  // Transicionar cada pedido. Procesamos en serie para no saturar el pool de
  // conexiones (en MVP los manifiestos tienen <50 paradas).
  for (const asignacion of asignaciones) {
    try {
      await actualizarEstadoPedido(
        cliente,
        {
          pedidoId: asignacion.pedido_id,
          tenantId,
          estadoNuevo: "en_ruta",
          estadoEsperado: "asignado",
          ejecutor,
          // El id de `auth.users`, NUNCA `actor.driverId`: la FK de
          // `bitacora_auditoria.actor_usuario_id` apunta a `auth.users(id)` y un
          // id de conductor la viola. Ver el aviso del docstring.
          actuadoPorUsuarioId: actorUsuarioId,
        },
        actor,
      );
    } catch (err) {
      // ErrorConflicto = el pedido ya salió de 'asignado' antes de nuestro UPDATE.
      // Es una condición de carrera resuelta — no es un fallo real. Ignorar.
      if (err instanceof ErrorConflicto) continue;
      // Cualquier otro error (infraestructura, validación inesperada) lo relanzamos.
      throw err;
    }
  }
}

// =============================================================================
// Paradas que llegan con la ruta ya empezada
// =============================================================================

/**
 * Pone al día los pedidos recién asignados con el estado del manifiesto.
 *
 * 🔴 **El bug que arregla (2026-08-27).** `transicionarPedidosSameDayAEnRuta`
 * corre UNA sola vez, cuando el conductor arranca. Una parada asignada después
 * se quedaba en `asignado` mientras el manifiesto ya iba `en_ruta`, y
 * `asignado → entregado` es una transición inválida: el conductor veía la
 * parada en su lista y **no podía entregarla**, sin ningún mensaje que lo
 * explicara. Es el caso normal, no el raro: el coordinador reparte por lotes
 * durante toda la mañana y el despacho arranca a las 16:00.
 *
 * Se llama DESPUÉS de asignar. Si el manifiesto no va en ruta, no hace nada:
 * la parada entra en `asignado` como siempre y arrancará con el resto.
 *
 * ⚠️ **Solo toca same-day**, por la misma frontera dura del resto del archivo:
 * el estado de un pedido Flex lo escribe Mercado Envíos y Rutax no se lo pisa.
 * Una parada Flex agregada a una ruta en curso se queda en `asignado`, y está
 * bien — su ciclo lo gobierna la app de Flex.
 *
 * ⚠️ **Nota operativa, no técnica:** `en_ruta` significa «el conductor lleva
 * este bulto». Al asignar a alguien que ya salió, el bulto puede seguir en la
 * bodega. La asignación ya exige `situacion_retiro = 'retirado'`, así que
 * alguien lo tomó; quién lo tiene físicamente es una decisión del coordinador
 * y Rutax no puede saberlo. Se asume a propósito.
 *
 * @returns `true` si el manifiesto iba en ruta y se puso al día.
 */
export async function alinearPedidosNuevosConManifiestoEnRuta(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    manifiestoId: string;
    driverId: string;
    actor: UsuarioActual;
    actorUsuarioId: string;
    ejecutor?: "conductor" | "sistema";
  },
): Promise<boolean> {
  const { data: manifiesto, error } = await cliente
    .from("manifiestos")
    .select("estado")
    .eq("id", entrada.manifiestoId)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al leer el estado del manifiesto: ${error.message}`);
  }
  if (manifiesto?.estado !== "en_ruta") return false;

  await transicionarPedidosSameDayAEnRuta(
    cliente,
    entrada.manifiestoId,
    entrada.tenantId,
    entrada.driverId,
    entrada.actor,
    entrada.actorUsuarioId,
    entrada.ejecutor ?? "sistema",
  );
  return true;
}
