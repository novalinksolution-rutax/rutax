/**
 * Nombre visible de una cuenta de Mercado Libre conectada (modelo 1:N —
 * `docs/arquitectura/seller-multicuenta-ml.md`).
 *
 * Prioridad: alias que el seller le puso → nickname que entrega ML al conectar
 * → últimos 4 dígitos del id de cuenta, como último recurso. Nunca expone el
 * `ml_user_id` completo ni jerga técnica.
 *
 * Compartido entre el portal del seller (`portal/panel-conexion-ml.tsx`) y el
 * panel del courier (`(tenant)/sellers/`) para no duplicar esta regla de
 * presentación — CLAUDE.md: "Helpers de UI compartidos... viven en
 * `src/lib/ui/`. Reusarlos en vez de duplicar lógica de presentación entre
 * `(tenant)`, `portal` y `conductor`."
 */
export interface CuentaMlEtiquetable {
  alias: string | null;
  mlNickname: string | null;
  mlUserId: string | null;
}

export function etiquetaConexionMl(cuenta: CuentaMlEtiquetable): string {
  if (cuenta.alias && cuenta.alias.trim().length > 0) return cuenta.alias;
  if (cuenta.mlNickname && cuenta.mlNickname.trim().length > 0) return cuenta.mlNickname;
  if (cuenta.mlUserId && cuenta.mlUserId.length >= 4) return `Cuenta ···${cuenta.mlUserId.slice(-4)}`;
  return "Cuenta de Mercado Libre";
}
