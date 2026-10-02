/**
 * Opción «de un toque»: un radio o checkbox nativo (`sr-only`) dentro de un
 * `<label>` que se ve como botón. Las tres preguntas del perfil comercial usan
 * esto en el registro y en Configuración: misma pregunta, mismo control.
 */
export const CLASE_OPCION_TOQUE =
  "inline-flex min-h-11 cursor-pointer items-center gap-1.5 border border-line bg-bg px-3 py-1.5 text-sm text-fg " +
  "transition-colors hover:bg-bg-sunken " +
  "has-[:checked]:border-ring has-[:checked]:bg-bg-sunken has-[:checked]:font-semibold " +
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-default has-[:disabled]:opacity-60";
