import { formatearFechaCivilLarga } from "@/lib/formato-cl";
import type { VersionDocumentoLegal } from "@/lib/legal/versiones";

/**
 * El encabezado de un documento legal: su título, su versión y desde cuándo rige.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ LA VERSIÓN VA ARRIBA Y NO AL PIE
 * -----------------------------------------------------------------------------
 * Porque **es lo que se cita**. Un consentimiento no puede registrar «aceptó los
 * términos»: registra a qué redacción dijo que sí. Cuando alguien —un conductor,
 * un abogado, el propio courier— tiene que comprobar qué aceptó, lo primero que
 * busca es si está mirando esa misma versión, y eso se contesta antes de empezar
 * a leer, no después de terminar.
 *
 * Antes solo había «Última actualización: 5 de agosto de 2026». Es información
 * útil para el lector y **no sirve como llave**: dos redacciones pueden compartir
 * fecha, y una fecha suelta no se compara con lo que quedó guardado.
 *
 * Así que se muestran las dos cosas, y cada una hace su trabajo: la versión
 * identifica, la fecha orienta.
 */
export function CabeceraDocumentoLegal({
  titulo,
  documento,
}: {
  titulo: string;
  documento: VersionDocumentoLegal;
}) {
  return (
    <header className="mb-8 border-b border-line pb-5">
      <h1 className="font-heading text-2xl font-semibold text-fg">{titulo}</h1>

      <p className="rx-num mt-2 font-mono text-xs text-fg-muted">
        Versión {documento.version}
        {" · "}
        {/* «Vigente desde», no «última actualización»: lo que importa no es
            cuándo se tocó el archivo, sino desde qué día obliga este texto. */}
        vigente desde el {formatearFechaCivilLarga(documento.vigenteDesde)}
      </p>
    </header>
  );
}
