"use client";

/**
 * Las cuatro secciones del módulo de tarifas.
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
 * -----------------------------------------------------------------------------
 * 🔴 LA PESTAÑA SE MARCA AL INSTANTE, ANTES DE QUE EL SERVIDOR CONTESTE
 * -----------------------------------------------------------------------------
 * Cuál pestaña está puesta lo decide el servidor —sale de `?seccion=`, y cada
 * sección es un componente de servidor que va a buscar sus datos—. Sin nada más,
 * **pulsar una pestaña no producía ningún cambio visible durante ~380 ms**
 * medidos en local, con la base al lado: el clic parecía no haber ocurrido, y lo
 * que eso provoca es un segundo clic.
 *
 * `useOptimistic` mueve la marca en el mismo fotograma del clic y se revierte
 * sola cuando la transición termina — para entonces el servidor ya mandó la
 * sección de verdad, así que no hay parpadeo. El contenido sigue tardando lo que
 * tarda; lo que se elimina es el silencio.
 *
 * ⚠️ `setOptimista` **tiene que llamarse dentro de la transición**. Fuera de
 * ella React lo descarta y la marca no se mueve, que es exactamente el problema
 * que vino a resolver.
 *
 * ⚠️ **El catálogo y el saneador NO viven acá**, aunque nacieron en este
 * archivo: los usa también `page.tsx`, que es servidor, y un Server Component no
 * puede llamar una función exportada por un módulo de cliente. Costó un 500 en
 * las cinco rutas del módulo, con typecheck y lint en verde. Están en
 * `./secciones`.
 */

import { useOptimistic, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

import { SECCIONES_TARIFAS, type SeccionTarifas } from "./secciones";

export function BarraSeccionesTarifas({ activa }: { activa: SeccionTarifas }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pendiente, iniciar] = useTransition();
  const [puestaOptimista, marcarOptimista] = useOptimistic(activa);

  return (
    <div
      role="tablist"
      aria-label="Secciones de tarifas"
      // `aria-busy` mientras llega la sección: para quien no ve el cambio de
      // pestaña, es lo único que dice que algo está pasando.
      aria-busy={pendiente}
      className="flex flex-wrap items-center gap-1 border-b border-line"
    >
      {SECCIONES_TARIFAS.map((s) => {
        const puesta = s.clave === puestaOptimista;
        return (
          <button
            key={s.clave}
            type="button"
            role="tab"
            aria-selected={puesta}
            onClick={() => {
              if (s.clave === puestaOptimista) return;
              const siguiente = new URLSearchParams(params.toString());
              if (s.clave === "tarifas") siguiente.delete("seccion");
              else siguiente.set("seccion", s.clave);
              // El cajón de tarifas no significa nada en Zonas ni en Retiro.
              if (s.clave !== "tarifas") siguiente.delete("cajon");
              const qs = siguiente.toString();
              iniciar(() => {
                marcarOptimista(s.clave);
                router.replace(qs ? `${pathname}?${qs}` : pathname);
              });
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
