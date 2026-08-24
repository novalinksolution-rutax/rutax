"use client";

/**
 * La lista de pasos del asistente — el índice, no el contenido.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ REEMPLAZA
 * -----------------------------------------------------------------------------
 * Cinco tarjetas de igual peso, cada una con un botón que **navegaba a otra
 * pantalla**. Sin número, sin orden declarado, sin dependencias visibles: el
 * dueño no podía saber qué le tocaba primero ni por qué, y al entrar a un paso
 * perdía de vista los otros cuatro.
 *
 * Ahora es una lista numerada del 1 al 5 donde **elegir un paso lo abre abajo,
 * en la misma pantalla**. La lista no se va.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EL PASO ACTIVO VIAJA EN LA URL
 * -----------------------------------------------------------------------------
 * `?paso=folios` y no estado local: así el botón «atrás» del navegador funciona,
 * el enlace se puede compartir —«ábrele el paso 2 a tu contadora»— y una recarga
 * después de guardar deja abierto el mismo paso en vez de mandar al dueño al
 * principio.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Lock } from "lucide-react";

import type { ClavePaso, PasoAsistente } from "./pasos";

export function ListaPasos({
  pasos,
  activo,
}: {
  pasos: readonly PasoAsistente[];
  activo: ClavePaso;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function abrir(clave: ClavePaso) {
    const siguiente = new URLSearchParams(params.toString());
    siguiente.set("paso", clave);
    router.push(`${pathname}?${siguiente.toString()}`, { scroll: false });
  }

  return (
    <ol className="divide-y divide-line border border-line">
      {pasos.map((paso) => {
        const esActivo = paso.clave === activo;
        return (
          <li key={paso.clave}>
            <button
              type="button"
              onClick={() => abrir(paso.clave)}
              aria-current={esActivo ? "step" : undefined}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                esActivo ? "bg-accent-bg/40" : "hover:bg-bg-sunken"
              }`}
            >
              {/* El número es el orden, y va SIEMPRE — también cuando el paso ya
                  está listo. Reemplazarlo por un tick pierde la posición, que es
                  justo lo que la lista viene a dar. */}
              <span
                className={`rx-num mt-0.5 flex size-6 shrink-0 items-center justify-center border text-xs ${
                  paso.listo
                    ? "border-balanced-line bg-balanced-bg text-balanced-fg"
                    : paso.bloqueado
                      ? "border-line text-fg-subtle"
                      : "border-line text-fg-muted"
                }`}
              >
                {paso.listo ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : paso.bloqueado ? (
                  <Lock className="size-3" aria-hidden="true" />
                ) : (
                  paso.numero
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  {/* El número vive en el distintivo de la izquierda y no se
                      repite acá: «4. Cobranza» al lado de un círculo con un 4
                      es el mismo dato dos veces. */}
                  <span className="font-medium text-fg">{paso.titulo}</span>
                  {paso.critico && !paso.listo ? (
                    <span className="rx-num border border-line px-1.5 py-0.5 text-[10px] leading-none tracking-[0.1em] text-fg-muted uppercase">
                      Necesario para operar
                    </span>
                  ) : null}
                </span>
                {/* El resumen lleva el dato real, no un rótulo de estado: «3
                    rangos vigentes», «sin tarifas: una entrega se hace y no se
                    puede cobrar». */}
                <span className="mt-0.5 block text-sm leading-snug text-fg-muted">
                  {paso.bloqueado ? paso.motivoBloqueo : paso.resumen}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
