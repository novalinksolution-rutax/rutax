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
 * Lo que sí funciona: estado local para el teléfono y `md:block` para el
 * escritorio, **en un solo árbol**. El escritorio no depende del estado —así el
 * primer render del servidor ya sale correcto en las dos anchuras— y las
 * acciones no se duplican en el DOM, que con tres diálogos y sus Server Actions
 * no es un detalle.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export function ZonaConsecuencia({
  children,
  /** Qué hacen las acciones de esta zona, en una frase. La escribe quien la usa. */
  resumen,
  className,
}: {
  children: ReactNode;
  resumen: string;
  className?: string;
}) {
  const [abiertoEnTelefono, setAbiertoEnTelefono] = useState(false);

  return (
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
      {/* El aviso de auditoría, arriba y siempre visible — también con el
          bloque plegado en el teléfono. */}
      <p className="mt-0.5 font-mono text-[10px] font-medium tracking-[0.12em] text-fault-fg/90 uppercase">
        Todo queda en la bitácora
      </p>

      {/* El disparador es solo del teléfono: en `md` el bloque va siempre
          desplegado y este botón no existe. */}
      <button
        type="button"
        onClick={() => setAbiertoEnTelefono((v) => !v)}
        aria-expanded={abiertoEnTelefono}
        aria-controls="zona-consecuencia-acciones"
        className="mt-3 flex w-full cursor-pointer items-center justify-between gap-2 border border-fault-line/60 bg-bg-raised px-3 py-2 text-sm font-medium text-fault-fg md:hidden"
      >
        Más acciones
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", abiertoEnTelefono && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      <div
        id="zona-consecuencia-acciones"
        className={cn(
          "mt-3 flex-col gap-2 md:flex",
          abiertoEnTelefono ? "flex" : "hidden",
        )}
      >
        {children}
        <p className="mt-1 text-xs text-fault-fg/90">{resumen}</p>
      </div>
    </section>
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
