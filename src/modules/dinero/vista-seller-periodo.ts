/**
 * Qué ve el seller de este período, dicho en la pantalla del courier.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * PARA QUÉ SIRVE
 * -----------------------------------------------------------------------------
 * El courier está por cerrar, emitir o reabrir un período, y la pregunta que se
 * hace antes de llamar al seller es **qué está viendo el otro en su portal**.
 * Hasta hoy no se podía responder desde ninguna pantalla: había que entrar al
 * portal con una cuenta de seller.
 *
 * -----------------------------------------------------------------------------
 * ESTO NO ES UN ESPEJO, Y POR ESO NO SE ROMPE
 * -----------------------------------------------------------------------------
 * No replica la pantalla del seller: **declara lo que esa pantalla muestra**,
 * que es una decisión estable del producto. Un espejo tendría que seguir cada
 * cambio del portal y quedaría desincronizado en silencio.
 *
 * Lo que sí hay que sostener contra el portal (`src/app/portal/cobros/`):
 * el seller ve TODOS sus períodos, incluidos los abiertos, con su monto y su
 * conteo de líneas. Eso sorprende y es lo primero que hay que decir.
 */

import type { EstadoPeriodo } from "./tipos";

export interface VistaSellerPeriodo {
  /** Frase principal: qué está viendo ahora mismo. */
  ve: string;
  /** Lo que NO ve, cuando hay algo que aclarar. */
  noVe: string | null;
}

export function loQueVeElSeller(
  estado: EstadoPeriodo,
  opciones: { folio?: number | null; tieneDocumento?: boolean } = {},
): VistaSellerPeriodo {
  switch (estado) {
    case "abierto":
      return {
        // Lo primero, porque es lo que nadie espera: un período abierto YA es
        // visible en el portal, y su monto sube con cada entrega.
        ve: "Ya lo ve en su estado de cuenta, con el monto al día y el conteo de líneas. La cifra le sube con cada entrega.",
        noVe: "No ve la fecha de cierre ni las excepciones de conciliación.",
      };
    case "cerrado":
      return {
        ve: "Lo ve cerrado, con su monto final y sus líneas. La cifra ya no se mueve.",
        noVe: "Todavía no tiene factura que descargar, y no sabe si la vas a emitir hoy o mañana.",
      };
    case "facturado":
      return {
        ve: opciones.folio
          ? `Lo ve facturado, con el folio ${opciones.folio}${
              opciones.tieneDocumento ? ", y puede descargar la factura" : ""
            }.`
          : "Lo ve facturado. El folio aparece en cuanto el documento queda emitido.",
        noVe: opciones.tieneDocumento
          ? null
          : "El PDF todavía no está disponible para él: se publica cuando el proveedor lo devuelve.",
      };
    case "anulado":
      return {
        ve: "Lo ve anulado, con su nota de crédito. Las entregas volvieron a su período en curso.",
        noVe: "No ve el motivo que escribiste: ese queda en tu bitácora.",
      };
  }
}
