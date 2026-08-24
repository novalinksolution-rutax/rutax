/**
 * La versión de cada documento legal, en un solo sitio.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ UN DOCUMENTO LEGAL NECESITA VERSIÓN Y NO SOLO FECHA
 * -----------------------------------------------------------------------------
 * Porque **hay consentimientos que lo referencian**. Cuando un conductor acepta
 * algo, lo que queda registrado no puede ser «aceptó los términos»: tiene que
 * ser **a qué redacción dijo que sí**. Sin un identificador estable, un cambio
 * en el texto convierte todos los consentimientos anteriores en afirmaciones
 * sobre un documento que ya no existe.
 *
 * El patrón ya estaba en el producto —`VERSION_TEXTO_CONSENTIMIENTO_PUNTO_TERMINO`
 * hace exactamente esto para el consentimiento de ubicación— y le faltaba a los
 * dos documentos que más se referencian.
 *
 * ⚠️ **«Última actualización: 5 de agosto» no sirve para eso.** Es información
 * para el lector, no una llave: dos redacciones distintas pueden compartir fecha,
 * y una fecha no se puede guardar en una columna y comparar sin ambigüedad.
 *
 * -----------------------------------------------------------------------------
 * CÓMO SE SUBE
 * -----------------------------------------------------------------------------
 * **Al cambiar el texto, sube el número y la fecha de vigencia.** Las dos cosas,
 * en el mismo cambio. Y a partir de ahí, un consentimiento guardado con la
 * versión anterior sigue siendo cierto sobre lo que esa persona aceptó — que es
 * justo lo que un registro de consentimiento tiene que poder afirmar.
 *
 * `vigenteDesde` va como fecha civil `YYYY-MM-DD` a propósito: no es un instante,
 * es un día. Se formatea con `formatearFechaCivilLarga`, que no la pasa por
 * `Date` y por lo tanto no la corre un día al mostrarla en Santiago.
 */

export interface VersionDocumentoLegal {
  /** Estable y comparable. Es lo que se guarda en un consentimiento. */
  version: string;
  /** Fecha civil `YYYY-MM-DD`. El día desde el que rige esta redacción. */
  vigenteDesde: string;
}

export const TERMINOS: VersionDocumentoLegal = {
  version: "v1",
  vigenteDesde: "2026-08-05",
};

export const PRIVACIDAD: VersionDocumentoLegal = {
  version: "v1",
  vigenteDesde: "2026-08-05",
};
