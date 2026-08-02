/**
 * Enlace "saltar al contenido" (WCAG 2.2 AA — 2.4.1 Bypass Blocks).
 *
 * Invisible hasta recibir foco por teclado; al activarse lleva el foco al
 * `<main id="contenido">`. Debe ser el primer elemento enfocable de la página.
 */
export function SkipLink() {
  return (
    <a
      href="#contenido"
      className="sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-[100] focus-visible:not-sr-only focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-primary-foreground focus-visible:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      Saltar al contenido
    </a>
  );
}
