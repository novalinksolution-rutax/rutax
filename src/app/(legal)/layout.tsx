import Link from "next/link";

/**
 * Marco de los documentos legales (términos y privacidad).
 *
 * Fuera del `AppShell` a propósito: son páginas PÚBLICAS, sin sesión. Alguien
 * tiene que poder leer la política de privacidad sin tener cuenta —de hecho, el
 * destinatario de un paquete nunca la va a tener— así que no pueden colgar de un
 * layout que exige tenant.
 */
export default function LayoutLegal({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-muted/30">
      {/* ⚠️ Cabecera, cuerpo y pie comparten la misma medida **y el mismo tamaño
          de letra en el contenedor**, que es lo que de verdad la iguala: `ch` se
          resuelve contra la fuente del propio elemento, así que un `max-w-[62ch]`
          sobre un pie en `text-xs` da una columna más angosta que la del cuerpo.
          Medido: 610 px arriba, 534 en el medio y 458 abajo, los tres «62ch».
          El tamaño visible se pone en el contenido, no en el contenedor.

          Cabecera, cuerpo y pie comparten la MISMA medida. Cuando el cuerpo
          bajó a 62 caracteres y el marco se quedó en 768 px, la página dejaba de
          leerse como una columna: el texto quedaba descolgado dentro de un
          contenedor más ancho, y la navegación de arriba apuntaba a un borde que
          ya no existía. */}
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-[62ch] items-center justify-between px-6 py-4 text-sm">
          <Link href="/" className="text-sm font-semibold">
            Rutax
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link href="/terminos" className="hover:text-foreground">
              Términos
            </Link>
            <Link href="/privacidad" className="hover:text-foreground">
              Privacidad
            </Link>
          </nav>
        </div>
      </header>

      {/* ⚠️ **La medida es de 62 caracteres, no `max-w-[62ch]`.**
          `max-w-[62ch]` son 768 px, que a 14 px dan del orden de **110 caracteres
          por línea** — casi el doble de lo que el ojo sigue sin perder el
          renglón. En un texto corto da igual; en el documento más largo y menos
          voluntario del producto —el que alguien lee cuando tiene una duda
          legal— es la diferencia entre leerlo y barrerlo.

          Va en `ch`, que es la unidad que mide lo que la regla dice: caracteres.
          Con `px` la medida se rompería sola al cambiar el tamaño de la letra.

          `prose` no está disponible en el proyecto: el ritmo tipográfico se
          resuelve con utilidades sobre los elementos, que además deja el estilo
          a la vista de quien edite el texto. */}
      <main
        id="contenido"
        className="mx-auto max-w-[62ch] px-6 py-12 text-sm leading-relaxed text-foreground [&_a]:underline [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:font-medium [&_li]:mb-1.5 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-4 [&_table]:mb-4 [&_table]:w-full [&_td]:border-t [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top [&_th]:pb-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-medium [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6"
      >
        {children}
      </main>

      <footer className="border-t bg-background">
        {/* `text-sm` acá y `text-xs` en el contenido: el tamaño de letra del
              contenedor es lo que fija la medida, no lo que se lee dentro. */}
        <div className="mx-auto max-w-[62ch] px-6 py-6 text-sm">
          <p className="text-xs text-muted-foreground">
          Rutax es un producto de Novalink SpA · RUT 78.060.175-2 · Eulogia Sánchez 065,
          Santiago de Chile ·{" "}
          <a href="mailto:novalinksolution@gmail.com" className="underline">
            novalinksolution@gmail.com
          </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
