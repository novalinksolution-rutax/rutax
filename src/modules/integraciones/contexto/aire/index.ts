/**
 * Superficie pública del puerto de CALIDAD DEL AIRE.
 * =====================================================================
 *
 * Además del puerto se exporta el mapeo PM2.5 → nivel, porque el composer
 * necesita `nivelMasSevero` para agregar horas → día (el tipo `PronosticoAire`
 * del contrato congelado es diario) y porque `UMBRALES_PM25` es dato de dominio
 * que la UI puede querer citar al explicar un puntaje. Lo que NO se exporta son
 * los adaptadores concretos.
 */

export { obtenerPuertoAire } from './puerto';
export type { PuertoAire } from './puerto';

export type {
  NivelAire,
  ParametrosAire,
  PronosticoAireHorario,
  PronosticoHoraAire,
  ProveedorAire,
} from './tipos';

export {
  clasificarSerie,
  nivelDesdePm25Media24h,
  nivelMasSevero,
  ORDEN_NIVEL_AIRE,
  promedioMovil,
  UMBRALES_PM25,
  VENTANA_MOVIL_HORAS,
} from './niveles';
