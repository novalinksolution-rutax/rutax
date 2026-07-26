/**
 * Clases compartidas — estados de los controles (README §4, tabla final).
 * Centralizadas para no repetir (y no desalinear) foco/hover/disabled entre
 * las ~10 piezas del tablero que usan botón sólido / outline / fila.
 */

/**
 * Nunca el ring azul del navegador: outline explícito en todo interactivo.
 *
 * ⚠️ `focus-visible:outline-solid` NO es redundante — es lo que hace que el
 * anillo exista. En Tailwind 4 `outline-none` fija `--tw-outline-style: none`,
 * y `outline-2` toma el estilo de ESA MISMA variable, así que sin reponerlo el
 * navegador computa `outline: 2px none <color>`: ancho correcto, color
 * correcto, y nada dibujado. En Tailwind 3 el `outline` suelto equivalía a
 * `outline-style: solid` y esto funcionaba; en 4 ya no.
 *
 * Se detectó tabulando en la pantalla real: el elemento sí matcheaba
 * `:focus-visible` pero el foco de teclado era invisible. No lo habría cazado
 * ningún test ni el typecheck.
 */
export const FOCO_ANILLO =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tc-senal";

/** "Fila de zona (lista)": foco hacia adentro, para no salirse de la fila. */
export const FOCO_ANILLO_FILA =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tc-tinta";

/** Acción sólida: fondo Tinta, texto Papel. */
export const BOTON_SOLIDO =
  `bg-tc-tinta px-[11px] py-[7px] text-left text-[11.5px] font-extrabold text-tc-papel hover:bg-[#444141] active:bg-tc-chasis disabled:cursor-not-allowed disabled:opacity-45 ${FOCO_ANILLO}`;

/** Confirmación destructiva: fondo Señal. Foco outline Tinta (no Señal, para que se note distinto). */
export const BOTON_CONFIRMAR =
  "bg-tc-senal px-[11px] py-[7px] text-left text-[11.5px] font-extrabold text-tc-papel hover:bg-[#dd2b0f] active:bg-tc-senal-text outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tc-tinta";

/** Botón outline discreto. */
export const BOTON_OUTLINE =
  `border border-tc-ink-300 px-[11px] py-[7px] text-[11.5px] font-extrabold text-tc-tinta hover:border-tc-tinta hover:text-tc-tinta ${FOCO_ANILLO}`;
