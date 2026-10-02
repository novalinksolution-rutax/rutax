/**
 * El aviso de términos del registro: «Al continuar aceptas los términos y
 * declaras haber leído la política de privacidad.»
 * =============================================================================
 * Sin casilla, a propósito (decisión del producto, 1-oct-2026): el clic en el
 * botón de al lado ES la aceptación, y su evidencia queda guardada en el
 * servidor (`intencion-registro.ts` → `identidad.tenants.terminos_*`). Por eso
 * el texto es siempre el mismo y los dos enlaces abren en pestaña nueva: quien
 * quiere leer no pierde lo que ya llenó.
 *
 * Sin hooks ni `"use client"`: lo usan `/registro` y `/registro/empresa`.
 */

const CLASE_ENLACE = "font-medium underline underline-offset-4 hover:text-fg";

export function AvisoTerminos({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-xs leading-relaxed text-fg-muted"}>
      Al continuar aceptas los{" "}
      <a href="/terminos" target="_blank" rel="noopener noreferrer" className={CLASE_ENLACE}>
        términos
      </a>{" "}
      y declaras haber leído la{" "}
      <a href="/privacidad" target="_blank" rel="noopener noreferrer" className={CLASE_ENLACE}>
        política de privacidad
      </a>
      .
    </p>
  );
}
