"use client";

/**
 * Zona de consecuencia — el marco donde vive lo que no se deshace solo.
 * =============================================================================
 * Tablero `P3 · Detalle del pedido`, decisión n.º 2 del bloque «lo que esta
 * pantalla decide para todas las demás».
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL PROBLEMA: LO GRAVE ESTABA SUELTO ENTRE LO INOCUO
 * -----------------------------------------------------------------------------
 * «Cancelar el pedido» convivía en la misma lista y con el mismo peso visual que
 * «Abrir una incidencia», y las dos anulaciones de dinero **no tenían dónde
 * vivir en absoluto**. La escalera de fricción ya distinguía los peldaños en el
 * *diálogo* —motivo obligatorio, tercera salida—, pero no antes de tocar: la
 * persona descubría la gravedad cuando ya había hecho clic.
 *
 * Esto lo dice antes. Marco propio en tono falla, encabezado que declara la
 * bitácora, y **ninguna acción grave fuera de acá**.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL AVISO DE LA BITÁCORA VA ANTES, NO DESPUÉS
 * -----------------------------------------------------------------------------
 * «Todo queda en la bitácora» es el encabezado de la zona y no el pie de un
 * diálogo, a propósito: quien se entera de que quedó registrado cuando ya actuó
 * no tuvo la información que necesitaba. La auditoría es contexto, no
 * consecuencia.
 *
 * -----------------------------------------------------------------------------
 * EN TELÉFONO SE COLAPSA, Y NO ES POR ESPACIO
 * -----------------------------------------------------------------------------
 * Debajo de `md` las acciones quedan detrás de «Más acciones». La razón es
 * física: de pie en la bodega, un botón que cancela un pedido a 15 px del pulgar
 * es un accidente esperando. No es una concesión de maquetación — es el mismo
 * criterio de la escalera, aplicado al dedo.
 *
 * ⚠️ **Se intentó con `<details open>` y NO sirve.** El atributo `open` es
 * estático: deja el bloque abierto también en el teléfono, que es exactamente lo
 * que hay que evitar. Y no se puede corregir con CSS por punto de corte, porque
 * el navegador oculta el contenido cerrado desde su propio shadow DOM y una
 * utilidad de Tailwind sobre el hijo no llega ahí.
 *
 * Lo que sí funciona: estado local para el teléfono y una utilidad `md:` para
 * el escritorio. El escritorio no depende del estado, así que el primer render
 * del servidor ya sale correcto en las dos anchuras.
 *
 * ⚠️ **En teléfono el disparador va FUERA del marco y las acciones también.**
 * El tablero dibuja «Más acciones» como una acción más —junto a «Cambiar de
 * estado» y «Descargar etiqueta»— y deja la zona como un bloque de aviso que
 * solo se lee. La primera versión metía el disparador dentro del marco rojo, y
 * eso invierte el mensaje: convierte la zona en algo que se abre en vez de un
 * aviso que advierte.
 *
 * ⚠️ `children` va UNA sola vez en el árbol. Una primera versión lo ponía dos
 * —una para cada anchura— creyendo que la rama oculta no se renderizaba, y es
 * falso: `hidden` es CSS y las dos quedan montadas. Con tres diálogos dentro,
 * eso son seis instancias colgando del árbol y dos ids repetidos.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export function ZonaConsecuencia({
  children,
  /** Qué hacen las acciones de esta zona, en una frase. La escribe quien la usa. */
  resumen,
  /**
   * 🔴 Plegar SIEMPRE, sin mirar el punto de corte.
   *
   * Lo pide el panel de vista previa, y la razón es que `md:` mira el VIEWPORT y
   * no el ancho del contenedor: en un escritorio de 1440 la zona se desplegaba
   * dentro de una columna de 430 px, que es ancho de teléfono. El tablero define
   * para esa anchura el trato plegado, así que quien conoce su ancho real lo
   * dice acá. (Un contenedor con `@container` resolvería esto solo; hoy el
   * proyecto no lo usa en ninguna parte y estrenarlo por un bloque sería
   * introducir una técnica nueva para un caso.)
   */
  siemprePlegada = false,
  className,
}: {
  children: ReactNode;
  resumen: string;
  siemprePlegada?: boolean;
  className?: string;
}) {
  const [abiertoEnTelefono, setAbiertoEnTelefono] = useState(false);

  const plegada = siemprePlegada || !abiertoEnTelefono;

  return (
    <>
      {/* ── El disparador, SUELTO y ARRIBA ─────────────────────────────────
          Va fuera del marco a propósito: el tablero lo dibuja como una acción
          más —junto a «Cambiar de estado» y «Descargar etiqueta»— y no como un
          control dentro de la zona roja. La primera versión lo metía adentro, y
          eso invierte el mensaje: convierte la zona en algo que se abre en vez
          de un aviso que se lee. */}
      <button
        type="button"
        onClick={() => setAbiertoEnTelefono((v) => !v)}
        aria-expanded={abiertoEnTelefono}
        aria-controls="zona-consecuencia-acciones"
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-muted",
          !siemprePlegada && "md:hidden",
        )}
      >
        Más acciones
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", abiertoEnTelefono && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      <section
        aria-labelledby="zona-consecuencia-titulo"
        className={cn("border border-fault-line bg-fault-bg/40 px-4 py-3", className)}
      >
        <h2
          id="zona-consecuencia-titulo"
          className="font-heading text-sm font-semibold text-fault-fg"
        >
          Zona de consecuencia
        </h2>
        {/* El aviso de auditoría, siempre visible — también con las acciones
            plegadas. Es lo único que la zona tiene que decir cuando está
            cerrada. */}
        <p className="mt-0.5 font-mono text-[10px] font-medium tracking-[0.12em] text-fault-fg/90 uppercase">
          Todo queda en la bitácora
        </p>

        {/* Las acciones, UNA sola vez en el árbol. En escritorio están
            siempre; en teléfono, detrás del disparador de arriba. */}
        <div
          id="zona-consecuencia-acciones"
          className={cn(
            "mt-3 flex-col gap-2",
            !siemprePlegada && "md:flex",
            abiertoEnTelefono ? "flex" : "hidden",
          )}
        >
          {children}
        </div>

        <p className={cn("text-xs text-fault-fg/90", plegada ? "mt-2" : "mt-3")}>{resumen}</p>
      </section>
    </>
  );
}

/**
 * Una fila de la zona: qué hace, y el control que lo hace.
 *
 * El texto va a la izquierda y el control a la derecha para que se lea la
 * consecuencia antes de llegar al botón — al revés, el ojo encuentra primero el
 * gesto y después el motivo.
 */
export function FilaConsecuencia({
  descripcion,
  children,
}: {
  descripcion: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border border-fault-line/60 bg-bg-raised px-3 py-2">
      <span className="min-w-0 text-sm text-fg">{descripcion}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
