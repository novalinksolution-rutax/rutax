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
 * Ahora es una lista numerada donde **elegir un paso lo abre abajo, en la misma
 * pantalla**. La lista no se va.
 *
 * -----------------------------------------------------------------------------
 * 🔴 POR QUÉ HAY ENCABEZADOS DE BLOQUE
 * -----------------------------------------------------------------------------
 * Los pasos pasaron de cinco a catorce. Catorce renglones planos son una lista
 * de tareas que se abandona en el cuarto: no hay forma de ver, de una pasada,
 * cuáles impiden operar y cuáles son ajustes que pueden esperar.
 *
 * Los tres encabezados —para operar, para cobrar, para que cuadre— responden esa
 * pregunta antes de leer un solo renglón. **La numeración sigue siendo corrida**
 * (1 a 14, no 1 a 3 por bloque): «paso 9 de 14» ubica, «paso 2 del bloque 3»
 * obliga a sumar.
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

import { BLOQUES, type ClavePaso, type PasoAsistente } from "./pasos";

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
    <div className="space-y-5">
      {BLOQUES.map((bloque) => {
        const delBloque = pasos.filter((p) => p.bloque === bloque.clave);
        if (delBloque.length === 0) return null;
        const listos = delBloque.filter((p) => p.listo).length;

        return (
          <section
            key={bloque.clave}
            aria-labelledby={`bloque-${bloque.clave}`}
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <h2
                id={`bloque-${bloque.clave}`}
                className="text-xs font-medium tracking-[0.08em] text-fg uppercase"
              >
                {bloque.titulo}
              </h2>
              {/* El conteo del bloque es del bloque, y no compite con el global:
                  el de arriba dice cuánto falta en total, éste dice si ESTE
                  grupo ya está resuelto. */}
              <span className="rx-num text-xs text-fg-subtle">
                {listos} de {delBloque.length}
              </span>
            </div>
            <p className="mb-2 text-sm leading-snug text-fg-muted">
              {bloque.proposito}
            </p>
            <ol className="divide-y divide-line border border-line">
              {delBloque.map((paso) => {
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
                          <span className="font-medium text-fg">
                            {paso.titulo}
                          </span>
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
          </section>
        );
      })}
    </div>
  );
}
