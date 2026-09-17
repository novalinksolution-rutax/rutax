/**
 * Envoltorio de `identidad.eliminar_cuenta_persona` — el borrado duro
 * TODO-O-NADA de un seller o conductor + su ficha, en una sola transacción SQL.
 *
 * Molde: `src/modules/operacion/asignacion-rpc.ts` (`.schema('identidad').rpc(...)`
 * explícito — sin él, PostgREST busca `public.<función>`, no la encuentra y
 * falla en silencio si el llamador no revisa el error). La función SQL vive en
 * `supabase/migrations/20260917000001_identidad_eliminar_cuenta_persona.sql` —
 * léela antes de tocar este archivo, ahí está el porqué de cada paso.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTE ENVOLTORIO DEVUELVE `boolean` Y NO LANZA (a diferencia del molde)
 * -----------------------------------------------------------------------------
 * `asignarPedidosEnBloqueRpc` traduce códigos de error PREVISTOS y lanza — el
 * llamador no tiene alternativa a esos errores, así que hay que decírselos con
 * un mensaje de dominio. Acá es distinto: CUALQUIER fallo de esta función
 * —incluida una FK restrict que el SQL no enumeró— tiene el MISMO camino de
 * reserva legítimo en `baja-cuentas.ts`: degradar a desactivación. No hay
 * "error inesperado que deba interrumpir el flujo"; todos degradan igual. Por
 * eso el contrato es un booleano simple: `true` = todo se borró (atómico),
 * `false` = nada se borró (rollback), sin distinguir el motivo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoPersonaEliminable = "seller" | "conductor";

/**
 * Intenta el borrado duro completo (perfil + ficha + hijos con FK restrict) de
 * una persona. `true` solo si la RPC completó sin error — en ese caso, y solo
 * en ese caso, es seguro para el llamador borrar después la cuenta de
 * `auth.users`. `false` ante cualquier error: nada se borró (la transacción SQL
 * hizo rollback), así que no hay nada que limpiar ni ningún huérfano que
 * temer.
 */
export async function eliminarCuentaPersonaRpc(
  cliente: SupabaseClient,
  entrada: {
    usuarioId: string;
    tipo: TipoPersonaEliminable;
    tenantId: string;
    entidadId: string;
  },
): Promise<boolean> {
  const { error } = await cliente.schema("identidad").rpc("eliminar_cuenta_persona", {
    p_usuario_id: entrada.usuarioId,
    p_tipo: entrada.tipo,
    p_tenant_id: entrada.tenantId,
    p_entidad_id: entrada.entidadId,
  });

  return !error;
}
