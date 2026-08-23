import Link from "next/link";
import { FileQuestion } from "lucide-react";

/**
 * La 404 del producto. NUEVO #28.
 * =============================================================================
 *
 * **No existía ninguna.** Todo `notFound()` del repo caía en la página por
 * defecto de Next: «404 · This page could not be found», **en inglés y sin una
 * sola marca**. Era la única pantalla del producto en otro idioma.
 *
 * Y no la ve solo un usuario interno que se equivocó de URL. La ve **el
 * destinatario de un paquete** cuando el enlace de seguimiento que le mandaron
 * por WhatsApp no calza —token vencido, mal copiado, pedido ya purgado—, que es
 * la brecha #10 del inventario. Esa persona no es cliente de nadie: no tiene
 * cuenta, no sabe qué es Rutax, y lo único que quería era saber dónde está su
 * paquete.
 *
 * QUÉ DICE Y QUÉ NO
 * -----------------------------------------------------------------------------
 * **No dice qué falló**, porque no se sabe: una 404 no distingue un enlace mal
 * copiado de uno vencido de uno que nunca existió. Inventar una causa —«el
 * enlace expiró»— sería adivinar delante de alguien que no puede contradecirte.
 *
 * **Y no confirma ni niega nada** (regla 45): no dice «este envío no existe»,
 * porque eso convierte la 404 en un oráculo — probando tokens se averigua
 * cuáles son válidos. Dice que la página no está y ofrece dónde seguir.
 *
 * LA SALIDA NO ES «VOLVER AL INICIO»
 * -----------------------------------------------------------------------------
 * «Inicio» no significa nada para quien llegó desde un enlace de seguimiento: no
 * tiene inicio acá. Por eso hay dos salidas y ninguna asume quién eres — la de
 * arriba para quien tiene cuenta, y debajo la única indicación que le sirve a
 * quien no la tiene: pedirle el enlace a quien se lo mandó.
 *
 * Sin ilustración a propósito: sería una imagen de varios cientos de KB en la
 * pantalla que ve alguien con mala señal esperando un paquete.
 */
export default function NoEncontrada() {
  return (
    <div className="flex min-h-[70svh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md border border-line bg-card p-8 text-center">
        <div className="mx-auto flex size-11 items-center justify-center bg-bg-inset">
          <FileQuestion className="size-5 text-fg-muted" aria-hidden="true" />
        </div>

        <h1 className="mt-4 font-heading text-xl font-semibold text-fg">
          Esta página no está
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          El enlace puede estar mal copiado o ya no estar disponible. No podemos saber cuál de
          las dos.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-ctrl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            Ir a Rutax
          </Link>

          {/* Para quien llegó siguiendo un paquete y no tiene cuenta: es lo
              único que de verdad puede hacer. */}
          <p className="text-xs leading-relaxed text-fg-subtle">
            ¿Estabas siguiendo un envío? Pídele el enlace otra vez a quien te lo mandó: los
            enlaces de seguimiento dejan de funcionar cuando el pedido se cierra.
          </p>
        </div>
      </div>
    </div>
  );
}
