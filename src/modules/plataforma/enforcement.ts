/**
 * Enforcement de límites del plan — primitiva compartida (F2, "Ola 1").
 * =============================================================================
 * Compone `obtenerEntitlementsTenant` (qué habilita el plan, YA con el merge
 * de `caracteristicas_override`) + `obtenerConsumoTenant` (cuánto ha
 * consumido el tenant) en un único resultado TIPADO. NUNCA lanza — cualquier
 * chokepoint de negocio (alta de conductor, banner de avisos, etc.) decide
 * qué hacer con el resultado sin tener que envolver en try/catch un error
 * genérico.
 *
 * ENFORCEMENT BLANDO (CLAUDE.md: "avisa, no corta la operación en marcha"):
 * - `pedidos_mes` es SIEMPRE informativo — `permitido` es SIEMPRE `true`. No
 *   existe (ni se agrega aquí) ningún camino que bloquee la ingesta/creación
 *   de pedidos por haber superado el límite del plan; el único efecto es el
 *   `porcentaje` para pintar la barra de consumo y disparar el aviso 80/100%.
 * - `conductores` SÍ puede devolver `permitido:false` (`limite_alcanzado`) —
 *   es el único recurso con un chokepoint de ALTA discreto y de bajo riesgo
 *   operativo (`crearConductor`, `operacion/conductores.ts`): no interrumpe
 *   nada que ya esté en marcha (los conductores existentes siguen operando
 *   igual), solo topa el alta de un conductor NUEVO por sobre el cap
 *   contratado.
 *
 * FAIL-OPEN sobre `sin_suscripcion`: un tenant sin suscripción (courier recién
 * onboardeado, antes de completar el alta) nunca se bloquea — mismo criterio
 * que `obtenerEntitlementsTenant`.
 *
 * DECISIÓN sobre `suspendida` (documentada aquí, no en otro lado): una
 * suscripción suspendida NO se trata más duro que una activa/trial para el
 * cap de `conductores` — el cap del PLAN se aplica exactamente igual, ni más
 * ni menos. Congelar altas durante una suspensión sería una política de
 * negocio aparte (cobranza dura) que esta iteración NO implementa. El motivo
 * `'suspendida'` solo ANOTA, cuando el alta aún cabe dentro del cap, que la
 * suscripción está suspendida — para que un llamador que quiera mostrarlo
 * pueda hacerlo — pero no cambia `permitido`.
 */

import { obtenerEntitlementsTenant } from './superficie-courier';
import { obtenerConsumoTenant } from './consumo';

/** Recursos con enforcement de límite de plan (F2, "Ola 1"). */
export type RecursoLimitado = 'conductores' | 'pedidos_mes';

export type MotivoLimite =
  | 'ok'
  | 'sin_suscripcion'
  | 'suspendida'
  | 'ilimitado'
  | 'limite_alcanzado';

export interface ResultadoLimite {
  /** `true` salvo el único caso real de bloqueo: `conductores` + `limite_alcanzado`. */
  permitido: boolean;
  motivo: MotivoLimite;
  usoActual: number;
  /** `null` = sin límite (plan ilimitado, o tenant sin suscripción todavía). */
  limite: number | null;
  /** `usoActual / limite * 100`, redondeado. `null` si `limite` es `null`. */
  porcentaje: number | null;
}

/**
 * Resuelve si el tenant puede seguir consumiendo `recurso` según su plan
 * (con overrides ya mergeados) y su consumo real del mes/actual. NUNCA lanza.
 */
export async function verificarLimite(
  tenantId: string,
  recurso: RecursoLimitado,
): Promise<ResultadoLimite> {
  const [entitlements, consumo] = await Promise.all([
    obtenerEntitlementsTenant(tenantId),
    obtenerConsumoTenant(tenantId),
  ]);

  const usoActual = recurso === 'conductores' ? consumo.conductoresActivos : consumo.pedidosMes;

  // Fail-open BLANDO: sin suscripción todavía, no hay límite que aplicar.
  if (!entitlements.estadoSuscripcion) {
    return { permitido: true, motivo: 'sin_suscripcion', usoActual, limite: null, porcentaje: null };
  }

  const limite = recurso === 'conductores' ? entitlements.conductoresMax : entitlements.limitePedidosMes;

  if (limite === null) {
    return { permitido: true, motivo: 'ilimitado', usoActual, limite: null, porcentaje: null };
  }

  const porcentaje = limite > 0 ? Math.round((usoActual / limite) * 100) : usoActual > 0 ? 100 : 0;

  // pedidos_mes: SIEMPRE informativo — ver nota de cabecera. Nunca bloquea.
  if (recurso === 'pedidos_mes') {
    return { permitido: true, motivo: 'ok', usoActual, limite, porcentaje };
  }

  // conductores: único recurso con bloqueo real (chokepoint = crearConductor).
  const dentroDelCap = usoActual < limite;
  const motivo: MotivoLimite = dentroDelCap
    ? entitlements.estadoSuscripcion === 'suspendida'
      ? 'suspendida'
      : 'ok'
    : 'limite_alcanzado';

  return { permitido: dentroDelCap, motivo, usoActual, limite, porcentaje };
}
