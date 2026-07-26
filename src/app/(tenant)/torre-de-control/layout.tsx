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
  return <div className={`${archivo.variable} torre`}>{children}</div>;
}
