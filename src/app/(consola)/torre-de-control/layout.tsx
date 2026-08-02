import { Archivo } from "next/font/google";

/**
 * Layout del módulo Torre de control.
 *
 * Existe por una sola razón: cargar Archivo y abrir el scope `.torre`.
 *
 * La fuente se carga AQUÍ y no en el layout raíz a propósito. El resto del
 * producto usa Inter (ADN de Retell) y no debe pagar los bytes de una segunda
 * familia que solo aparece en esta pantalla. `next/font` la auto-hospeda y la
 * incluye únicamente en el bundle de esta ruta.
 *
 * Se pide la cara VARIABLE (sin `weight`): el handoff usa 400 lectura /
 * 600 metadatos / 800 toda cifra o título, y un archivo variable cubre los tres
 * pesando menos que tres cortes estáticos.
 *
 * `.torre` es el aislamiento del lenguaje visual: los tokens `--tc-` de la
 * retícula, el fondo Chasis y la regla de radio 0 viven ahí (ver globals.css).
 * Nada de esto se filtra a otra pantalla del producto.
 *
 * Y fija el VIEWPORT de la consola: `h-svh` + `overflow-hidden`. La altura del
 * tablero es la de la ventana y nada más, porque el diseño reparte esa altura
 * entre las regiones (barra 52 · ola 132 · mapa 1fr · tiempo 98) y solo el riel
 * scrollea. `svh` y no `vh` para que en móvil la barra de direcciones del
 * navegador no recorte la última región. En móvil el árbol interno sí scrollea
 * —no hay mapa que proteger, ver README §5— y lo hace en su propio contenedor.
 */
const archivo = Archivo({
  variable: "--font-tc-src",
  subsets: ["latin"],
  display: "swap",
});

export default function LayoutTorreDeControl({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${archivo.variable} torre h-svh overflow-hidden`}>{children}</div>
  );
}
