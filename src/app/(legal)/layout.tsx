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
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
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

      {/* `prose` no está disponible en el proyecto: el ritmo tipográfico se
          resuelve con utilidades sobre los elementos, que además deja el estilo
          a la vista de quien edite el texto. */}
      <main
        id="contenido"
        className="mx-auto max-w-3xl px-6 py-12 text-sm leading-relaxed text-foreground [&_a]:underline [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:font-medium [&_li]:mb-1.5 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-4 [&_table]:mb-4 [&_table]:w-full [&_td]:border-t [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top [&_th]:pb-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-medium [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6"
      >
        {children}
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto max-w-3xl px-6 py-6 text-xs text-muted-foreground">
          Rutax es un producto de Novalink SpA · RUT 78.060.175-2 · Eulogia Sánchez 065,
          Santiago de Chile ·{" "}
          <a href="mailto:novalinksolution@gmail.com" className="underline">
            novalinksolution@gmail.com
          </a>
        </div>
      </footer>
    </div>
  );
}
