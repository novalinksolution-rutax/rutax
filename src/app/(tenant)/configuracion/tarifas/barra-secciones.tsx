"use client";

/**
 * Las tres secciones del módulo de tarifas.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ TRES PANTALLAS PASARON A SER UNA
 * -----------------------------------------------------------------------------
 * Tarifas, Zonas y Retiro eran tres entradas separadas en la navegación de
 * configuración, y las tres responden la misma pregunta: **cuánto entra y cuánto
 * sale por cada cosa que hace el courier**. La zona no existe por sí misma —es
 * la clave por la que se cobra distinto según dónde entregas— y el retiro es la
 * otra mitad del pago al conductor. Separadas obligaban a saber de memoria en
 * cuál de las tres estaba el campo que uno venía a cambiar.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ CADA SECCIÓN CONSERVA SU URL, Y ESO NO ES ADORNO
 * -----------------------------------------------------------------------------
 * La sección viaja en `?seccion=`, no en un `useState`. Así el índice de
 * configuración puede enlazar directo a «Zonas», un marcador guardado sigue
 * funcionando, y el botón de atrás del navegador hace lo que promete. Un
 * conmutador de estado local perdería las tres cosas de una vez.
 *
 * Se navega con `replace` y no con `push`: moverse entre las pestañas de una
 * misma pantalla no es «avanzar», y con `push` salir de acá exigiría pulsar
 * atrás tantas veces como pestañas se hayan mirado.
 *
 * ⚠️ **El catálogo y el saneador NO viven acá**, aunque nacieron en este
 * archivo: los usa también `page.tsx`, que es servidor, y un Server Component no
 * puede llamar una función exportada por un módulo de cliente. Costó un 500 en
 * las cinco rutas del módulo, con typecheck y lint en verde. Están en
 * `./secciones`.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

import { SECCIONES_TARIFAS, type SeccionTarifas } from "./secciones";

export function BarraSeccionesTarifas({ activa }: { activa: SeccionTarifas }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <div
      role="tablist"
      aria-label="Secciones de tarifas"
      className="flex flex-wrap items-center gap-1 border-b border-line"
    >
      {SECCIONES_TARIFAS.map((s) => {
        const puesta = s.clave === activa;
        return (
          <button
            key={s.clave}
            type="button"
            role="tab"
            aria-selected={puesta}
            onClick={() => {
              const siguiente = new URLSearchParams(params.toString());
              if (s.clave === "tarifas") siguiente.delete("seccion");
              else siguiente.set("seccion", s.clave);
              // El cajón de tarifas no significa nada en Zonas ni en Retiro.
              if (s.clave !== "tarifas") siguiente.delete("cajon");
              const qs = siguiente.toString();
              router.replace(qs ? `${pathname}?${qs}` : pathname);
            }}
            className={cn(
              // 44 px con el dedo: esta pantalla se toca en la tablet de la
              // bodega tanto como en el escritorio.
              "-mb-px min-h-9 border-b-2 px-3 text-sm transition-colors pointer-coarse:min-h-11",
              puesta
                ? "border-b-brand font-medium text-fg"
                : "border-b-transparent text-fg-muted hover:text-fg",
            )}
          >
            {s.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
