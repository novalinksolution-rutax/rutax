import { cn } from "@/lib/utils"
import { MarcaRutax } from "@/components/ui/marca-rutax"

/**
 * PantallaSinSesion — el marco común de las 13 pantallas públicas.
 *
 * POR QUÉ HACE FALTA
 * ---------------------------------------------------------------------------
 * Las trece existían y **cada una armaba su propio marco**: unas con
 * `min-h-svh`, otras con `flex-1`; unas centradas, otras no; ninguna con marca.
 * Trece marcos que se parecen no son un marco: son trece sitios donde arreglar
 * lo mismo, y el que se queda atrás es el que ve alguien que no tiene cuenta.
 *
 * LAS TRES MARCAS, Y QUIÉN LAS DECIDE (regla 42)
 * ---------------------------------------------------------------------------
 * **La marca la pone el dueño de la relación**, no el dueño del software:
 *
 * · `rutax` — el visitante es cliente NUESTRO: el courier que se registra, que
 *   activa su cuenta, que recupera su contraseña.
 * · `courier` — el visitante es cliente DEL COURIER: el seller invitado, el
 *   conductor, el comprador que sigue su paquete. A esa persona el nombre
 *   «Rutax» no le dice nada; la relación es con quien le despacha.
 * · `neutra` — **no lo sabemos**. Es el caso del login unificado: por esa misma
 *   puerta entran el dueño del courier, el seller y el conductor, y no hay forma
 *   de saber cuál antes de que escriba su correo. Poner una marca ahí es
 *   afirmar una relación que no está establecida.
 *
 * **Regla 43: el nombre del courier en texto es la versión canónica.** Su logo
 * es una mejora opcional — si no hay, no falta nada. Por eso esto no acepta una
 * imagen: acepta un nombre.
 *
 * REGLA 44 · SIN SESIÓN, EL TEMA LO DECIDE EL SISTEMA OPERATIVO
 * ---------------------------------------------------------------------------
 * No se fuerza acá: el `ThemeProvider` ya corre con `defaultTheme="system"` y
 * `enableSystem`, así que quien llega sin preferencia guardada hereda la del
 * sistema. Este componente **no** impone un tema, que sería la forma de
 * romperlo.
 *
 * ⚠️ REGLA 45 · NO CONFIRMA NI NIEGA
 * ---------------------------------------------------------------------------
 * El marco no puede imponerla —depende de lo que diga cada pantalla— pero se
 * anota acá porque es donde se lee: **ninguna de estas trece pantallas puede
 * confirmar ni negar la existencia de un correo, de un envío ajeno o de una
 * cuenta.** «Ese correo no está registrado» convierte una pantalla pública en
 * un oráculo de cuentas.
 */

export type MarcaSinSesion =
  | { tipo: "rutax" }
  | { tipo: "courier"; nombre: string }
  | { tipo: "neutra" }

export function PantallaSinSesion({
  marca,
  /**
   * Un rótulo **junto a la marca**, no dentro del contenido. Hoy solo lo usa el
   * backstage: su distintivo `BACKSTAGE` en ámbar no adorna, avisa de que **acá
   * se ven datos de varias empresas**. Va arriba porque es una propiedad de la
   * puerta, no del formulario que hay detrás.
   */
  distintivo,
  /** Nota bajo el contenido: enlaces legales, «¿problemas?», etc. */
  pie,
  className,
  children,
}: {
  marca: MarcaSinSesion
  distintivo?: React.ReactNode
  pie?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        // `min-h-svh` y no `min-h-screen`: en un teléfono con la barra del
        // navegador visible, `vh` sobra justo el alto de esa barra y deja la
        // tarjeta cortada por abajo.
        "flex min-h-svh flex-col items-center justify-center gap-6 bg-bg-sunken px-4 py-12",
        className,
      )}
    >
      {/* Rutax lleva su SÍMBOLO; el courier lleva su nombre.
          No es una asimetría por descuido: hoy ningún courier tiene logo cargado
          en el sistema, y el manual es explícito — «sin logo del courier, el
          nombre de fantasía es el titular. No hay hueco, no hay caja vacía». El
          día que se pueda subir un logo, entra acá y nada más se mueve. */}
      {marca.tipo === "rutax" || distintivo ? (
        <div className="flex items-center gap-2.5">
          {marca.tipo === "rutax" ? <MarcaRutax version="reducida" /> : null}
          {distintivo}
        </div>
      ) : marca.tipo === "courier" ? (
        <p className="font-heading text-sm font-semibold tracking-[0.08em] text-fg-muted uppercase">
          {marca.nombre}
        </p>
      ) : null}

      {children}

      {pie ? (
        <div className="max-w-sm text-center text-xs leading-relaxed text-fg-subtle">{pie}</div>
      ) : null}
    </div>
  )
}
