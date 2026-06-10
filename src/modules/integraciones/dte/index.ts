/**
 * Superficie pública del módulo DTE.
 * =====================================================================
 *
 * Solo se exporta lo que los consumidores externos (jobs de `dinero`,
 * server actions, tests) necesitan ver. El adaptador concreto
 * (`SimplefacturaAdapter`) es un detalle de implementación — no se
 * exporta aquí; el llamador trabaja contra `PuertoDte`.
 */

export { obtenerPuertoDte } from './puerto';
export type { PuertoDte } from './puerto';

export type {
  EmitirFacturaEntrada,
  EmitirFacturaResultado,
  ConsultarEstadoDteResultado,
  LineaDetalleDte,
  TipoDocumentoDte,
  ProveedorDte,
} from './tipos';

export {
  ErrorDte,
  ErrorDteProveedor,
  ErrorFolioAgotado,
  ErrorConfigDteInvalida,
} from './errores';
