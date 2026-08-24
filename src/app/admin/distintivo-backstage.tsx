/**
 * El distintivo `BACKSTAGE`.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ AVISA, QUE NO ES «ESTÁS EN EL ADMIN»
 * -----------------------------------------------------------------------------
 * Avisa de que **acá se ven datos de varias empresas**. Es la única superficie
 * del producto donde eso pasa: en todas las demás, lo que hay en pantalla es de
 * un solo courier y el aislamiento lo impone la base. Acá no — acá el aislamiento
 * lo sostiene quien mira.
 *
 * Por eso el rótulo va **junto a la marca y no dentro del formulario**: es una
 * propiedad de la puerta, no del trámite.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ ÁMBAR CON TRAMA, EL MISMO RECURSO QUE EL MODO DE PRUEBAS
 * -----------------------------------------------------------------------------
 * Y comparte tratamiento a propósito: los dos dicen «lo que estás mirando no es
 * lo normal, fíjate en dónde estás». La trama en el borde es lo que lo sostiene
 * **en monocromo y para quien no distingue el color** — con solo el tono ámbar,
 * el aviso desaparece justo para quien más necesita una segunda señal.
 */
export function DistintivoBackstage() {
  return (
    <span
      className="border border-attention-line bg-attention-bg px-2 py-0.5 font-mono text-[10px] font-medium tracking-[0.14em] text-attention-fg uppercase"
      style={{
        // La trama del borde: mismas 45° que el tono fuera de juego, en el
        // ámbar de atención. Va en línea porque es un degradado repetido y no
        // hay utilidad de Tailwind que lo exprese sin inventarse una.
        backgroundImage:
          "repeating-linear-gradient(45deg, transparent 0 5px, color-mix(in srgb, currentColor 12%, transparent) 5px 6px)",
      }}
    >
      Backstage
    </span>
  );
}
