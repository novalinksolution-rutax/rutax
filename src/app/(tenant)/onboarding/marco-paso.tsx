"use client";

/**
 * El marco del paso abierto: encabezado de posición, cuerpo y pie de continuidad.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * LAS TRES COSAS QUE FALTABAN EN LAS CUATRO PANTALLAS DE PASO
 * -----------------------------------------------------------------------------
 * 1. **Dónde estoy.** «PASO 2 DE 5 · depende del paso 1, que ya está listo». Sin
 *    esto, cada paso era una pantalla suelta sin relación con las otras cuatro.
 * 2. **Qué sigue.** El botón «Seguir con …» permite avanzar sin cerrar el paso
 *    actual — que es como se completa esto de verdad: se deja folios a medias
 *    porque falta un dato, se hacen las tarifas, se vuelve.
 * 3. **Que no hay que apurarse.** «Se guarda solo. Puedes salir cuando quieras.»
 *    Un formulario de configuración sin esa promesa se opera con miedo.
 *
 * -----------------------------------------------------------------------------
 * EL PASO BLOQUEADO MUESTRA SUS CAMPOS, ATENUADOS
 * -----------------------------------------------------------------------------
 * No se esconde: el dueño tiene que poder ver **qué le van a pedir** antes de
 * poder hacerlo. Se atenúa, se le quita la interacción y se escribe el motivo
 * con el enlace al paso que falta. Esconderlo lo deja adivinando si el paso
 * existe.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PasoAsistente } from "./pasos";

export function MarcoPaso({
  paso,
  total,
  dependencia,
  siguiente,
  children,
}: {
  paso: PasoAsistente;
  total: number;
  /** El paso del que depende, ya resuelto. `null` si no depende de ninguno. */
  dependencia: PasoAsistente | null;
  /** El siguiente pendiente alcanzable, para el pie. `null` si no queda. */
  siguiente: PasoAsistente | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function abrir(clave: string) {
    const q = new URLSearchParams(params.toString());
    q.set("paso", clave);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return (
    <section aria-labelledby={`paso-${paso.clave}`} className="space-y-4">
      <div>
        <p className="rx-num text-[10px] tracking-[0.12em] text-fg-muted uppercase">
          Paso {paso.numero} de {total}
          {/* La dependencia se DECLARA, esté cumplida o no. Decir «depende del
              paso 1, que ya está listo» es lo que hace legible el orden; decirlo
              solo cuando falla convierte la ausencia en silencio. */}
          {dependencia ? (
            <>
              {" · "}
              depende del paso {dependencia.numero}, que{" "}
              {dependencia.listo ? "ya está listo" : "todavía no está"}
            </>
          ) : null}
        </p>
        <h2 id={`paso-${paso.clave}`} className="font-heading mt-0.5 text-xl font-semibold">
          {paso.titulo}
        </h2>
      </div>

      {paso.bloqueado ? (
        <div className="space-y-3">
          <p className="border border-attention-line bg-attention-bg px-4 py-3 text-sm leading-relaxed text-attention-fg">
            {paso.motivoBloqueo}{" "}
            {dependencia ? (
              <button
                type="button"
                onClick={() => abrir(dependencia.clave)}
                className="font-medium underline"
              >
                Ir al paso {dependencia.numero}
              </button>
            ) : null}
          </p>
          {/* Atenuado y sin interacción, pero VISIBLE: así se ve qué se va a
              pedir. `inert` apaga foco y clics sin tener que deshabilitar campo
              por campo. */}
          <div className="pointer-events-none opacity-45 select-none" inert>
            {children}
          </div>
        </div>
      ) : (
        children
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <p className="text-xs text-fg-muted">
          Se guarda solo. Puedes salir y volver cuando quieras.
        </p>
        {siguiente ? (
          <Button variant="outline" size="sm" onClick={() => abrir(siguiente.clave)}>
            Seguir con {siguiente.enFrase}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </section>
  );
}
