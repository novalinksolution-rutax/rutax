/**
 * Envoltorios de las DOS funciones SQL que escriben `operacion.pedidos.
 * situacion_retiro` (migración 20260813000004 §6): `operacion.
 * cerrar_sesion_retiro` y `operacion.resolver_bulto_retiro`. Ambas son
 * `security definer`, ejecutables SOLO por `service_role`, y viven en el
 * esquema `operacion` (no hay envoltorio en `public`) — por eso el RPC se
 * apunta con `.schema('operacion')`, igual que `resolverZona`
 * (`operacion/zonas.ts:315`, que documenta el mismo gotcha: sin el
 * `.schema()` explícito, PostgREST busca `public.<función>`, no la encuentra
 * y falla en silencio si el llamador no revisa el error).
 *
 * Ninguna de las dos hace nada más que llamar al RPC y traducir la fila de
 * salida — la lógica de negocio (bitácora, gates) vive en los llamadores
 * (`sesiones.ts` para el cierre). Devuelven la primera fila del `SETOF`
 * (`returns table`, siempre exactamente una fila por diseño de la función).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// =============================================================================
// cerrar_sesion_retiro
// =============================================================================

export interface ResultadoCerrarSesionRetiro {
  sesionId: string;
  estado: "abierta" | "cerrada";
  bultosTotal: number;
  bultosResueltos: number;
  bultosSinResolver: number;
  cerradaEn: string;
  /** true si la sesión YA estaba cerrada (idempotencia): nada se recalculó. */
  yaEstabaCerrada: boolean;
  pedidosMarcados: number;
}

interface FilaCerrarSesionRetiro {
  sesion_id: string;
  sesion_estado: "abierta" | "cerrada";
  total_bultos: number;
  total_resueltos: number;
  total_sin_resolver: number;
  cerrada_ts: string;
  ya_estaba_cerrada: boolean;
  pedidos_marcados: number;
}

/**
 * Cierra la visita a una bodega. NO valida pertenencia por su cuenta: el
 * llamador (`sesiones.ts`) ya filtró la sesión por tenant + conductor antes
 * de llegar aquí; la función SQL vuelve a exigirlo (42501 si el conductor no
 * es el de la visita) como defensa en profundidad.
 */
export async function cerrarSesionRetiroRpc(
  cliente: SupabaseClient,
  entrada: { tenantId: string; sesionId: string; conductorId: string },
): Promise<ResultadoCerrarSesionRetiro> {
  const { data, error } = await cliente.schema("operacion").rpc("cerrar_sesion_retiro", {
    p_tenant_id: entrada.tenantId,
    p_sesion_id: entrada.sesionId,
    p_conductor_id: entrada.conductorId,
  });

  if (error) {
    throw new Error(`Error al cerrar la visita de retiro: ${error.message}`);
  }

  const fila = (Array.isArray(data) ? data[0] : data) as FilaCerrarSesionRetiro | undefined;
  if (!fila) {
    throw new Error("cerrar_sesion_retiro no devolvió ninguna fila.");
  }

  return {
    sesionId: fila.sesion_id,
    estado: fila.sesion_estado,
    bultosTotal: fila.total_bultos,
    bultosResueltos: fila.total_resueltos,
    bultosSinResolver: fila.total_sin_resolver,
    cerradaEn: fila.cerrada_ts,
    yaEstabaCerrada: fila.ya_estaba_cerrada,
    pedidosMarcados: fila.pedidos_marcados,
  };
}

// =============================================================================
// resolver_bulto_retiro
// =============================================================================
//
// ⚠️ SIN CONSUMIDOR EN ESTA ETAPA — a propósito. La etapa 3 resuelve el bulto
// EN LA MISMA INSERCIÓN del escaneo (ver `escaneos.ts`), así que este RPC no
// hace falta ahí. Este envoltorio queda listo para dos usos futuros, ninguno
// de los dos construido en esta entrega:
//   1. El consumidor diferido de `operacion/bulto-retiro.sin-pedido` (evento
//      definido en `src/lib/inngest/eventos.ts`) — cuando `integraciones`
//      confirme contra ML que un bulto `no_procesado` sí es de este courier.
//   2. Una resolución manual futura (un coordinador casa a mano un código
//      que la ingesta no reconoció) — fuera del alcance de esta etapa.

export interface ResultadoResolverBultoRetiro {
  bultoId: string;
  pedidoId: string;
  sellerId: string;
  resueltoEn: string;
  /** true si la visita YA estaba cerrada al resolverse (el acta no se recalcula). */
  sesionEstabaCerrada: boolean;
  /** true si este resolver fue el que marcó el pedido `retirado` (puede ya venir marcado). */
  pedidoMarcadoRetirado: boolean;
}

interface FilaResolverBultoRetiro {
  bulto_resuelto_id: string;
  pedido_resuelto_id: string;
  seller_resuelto_id: string;
  resuelto_ts: string;
  sesion_estaba_cerrada: boolean;
  pedido_marcado_retirado: boolean;
}

/**
 * Casa un bulto YA INSERTADO con un pedido, tarde o temprano. Lanza si el
 * bulto es `codigo_formato = 'desconocido'` (23514 — un ilegible no se puede
 * resolver) o si el pedido no existe / es de otro tenant (23503 / 23514).
 */
export async function resolverBultoRetiroRpc(
  cliente: SupabaseClient,
  entrada: { tenantId: string; bultoId: string; pedidoId: string },
): Promise<ResultadoResolverBultoRetiro> {
  const { data, error } = await cliente.schema("operacion").rpc("resolver_bulto_retiro", {
    p_tenant_id: entrada.tenantId,
    p_bulto_id: entrada.bultoId,
    p_pedido_id: entrada.pedidoId,
  });

  if (error) {
    throw new Error(`Error al resolver el bulto de retiro: ${error.message}`);
  }

  const fila = (Array.isArray(data) ? data[0] : data) as FilaResolverBultoRetiro | undefined;
  if (!fila) {
    throw new Error("resolver_bulto_retiro no devolvió ninguna fila.");
  }

  return {
    bultoId: fila.bulto_resuelto_id,
    pedidoId: fila.pedido_resuelto_id,
    sellerId: fila.seller_resuelto_id,
    resueltoEn: fila.resuelto_ts,
    sesionEstabaCerrada: fila.sesion_estaba_cerrada,
    pedidoMarcadoRetirado: fila.pedido_marcado_retirado,
  };
}
