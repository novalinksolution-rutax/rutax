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
 * EL CONTRATO: BOOLEANO PARA FALLOS DE DOMINIO, EXCEPCIÓN PARA "INFRA CAÍDA"
 * -----------------------------------------------------------------------------
 * `asignarPedidosEnBloqueRpc` (el molde) traduce códigos de error PREVISTOS y
 * lanza. Acá casi todos los fallos —incluida una FK restrict que el SQL no
 * enumeró— tienen el MISMO camino de reserva legítimo en `baja-cuentas.ts`:
 * degradar a desactivación. Para esos, el contrato es un booleano: `true` = todo
 * se borró (atómico), `false` = nada se borró (rollback), sin distinguir motivo.
 *
 * La ÚNICA excepción es `PGRST202` (la función no está en el caché de esquema de
 * PostgREST): eso no es un fallo de dominio, es infra de borrado no disponible,
 * y degradarlo a desactivación en silencio fue el bug del 17-sep (huérfano
 * invisible + choque de RUT al re-registrar). Ese caso LANZA
 * `RpcEliminarCuentaNoDisponibleError` y el Server Action lo convierte en
 * "reintenta", en vez de reportar una desactivación falsa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { capturarMensaje } from "@/lib/observabilidad";

export type TipoPersonaEliminable = "seller" | "conductor";

/**
 * La RPC no está en el caché de esquema de PostgREST (código `PGRST202`). NO es
 * un fallo de dominio que deba degradar a desactivación: es que la
 * infraestructura de borrado no está disponible ahora mismo (típicamente justo
 * tras un `db push`, antes de que PostgREST relea el catálogo). Degradarlo en
 * silencio fue el bug del 17-sep: el borrado duro caía a desactivación, la ficha
 * `sellers` sobrevivía y el re-registro chocaba con el unique `(tenant_id, rut)`.
 * Por eso este caso LANZA y el llamador lo convierte en "reintenta", en vez de
 * reportar una desactivación falsa que deja un huérfano invisible.
 */
export class RpcEliminarCuentaNoDisponibleError extends Error {
  constructor() {
    super(
      "El borrado de cuentas no está disponible en este momento (PostgREST aún no " +
        "publica la función). No se dio de baja nada. Reintentá en unos segundos.",
    );
    this.name = "RpcEliminarCuentaNoDisponibleError";
  }
}

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

  if (error) {
    // Caso especial: la función no está en el caché de esquema de PostgREST
    // (`PGRST202`). Eso NO es una FK restrict ni un fallo de dominio que amerite
    // degradar — es infra no disponible. Degradarlo en silencio dejaba un
    // huérfano invisible (bug del 17-sep). Se registra como ERROR y se LANZA
    // para que el llamador lo convierta en "reintenta", no en una desactivación
    // falsa.
    if (error.code === "PGRST202") {
      await capturarMensaje(
        "La RPC eliminar_cuenta_persona no está en el caché de PostgREST (PGRST202); NO se degrada, se pide reintento",
        "error",
        { origen: "plataforma:baja-cuentas", extra: { tipo: entrada.tipo, codigo: error.code, motivo: error.message } },
      );
      throw new RpcEliminarCuentaNoDisponibleError();
    }

    // Cualquier OTRO error (p. ej. una FK restrict no enumerada) sí tiene el
    // camino de reserva legítimo: degradar a desactivación. Pero NO en silencio:
    // se registra el código/motivo (sin PII más allá de lo que traiga el error).
    await capturarMensaje("La RPC eliminar_cuenta_persona falló; la baja degrada a desactivación", "warning", {
      origen: "plataforma:baja-cuentas",
      extra: { tipo: entrada.tipo, codigo: error.code ?? null, motivo: error.message },
    });
    return false;
  }
  return true;
}
