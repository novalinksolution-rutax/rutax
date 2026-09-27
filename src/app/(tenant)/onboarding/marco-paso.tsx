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
 * 3. **Que no hay que apurarse.** Se puede salir y volver: lo ya guardado se
 *    queda. ⚠️ NO dice «se guarda solo», que es lo que decía antes y era
 *    falso: la regla 25 prohíbe el autoguardado en configuración —cada paso
 *    tiene su botón— y prometer lo contrario invita a salirse sin guardar.
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
  dependencia,
  siguiente,
  children,
}: {
  paso: PasoAsistente;
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
    <section aria-label={paso.titulo} className="space-y-4">
      {paso.bloqueado ? (
        <div className="space-y-3">
          <p className="border border-attention-line bg-attention-bg px-4 py-3 text-sm leading-relaxed text-attention-fg">
            {paso.motivoBloqueo}{" "}
            {dependencia ? (
              <button
                type="button"
                onClick={() => abrir(dependencia.clave)}
                className="inline-flex min-h-11 items-center font-medium underline"
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

      {siguiente ? (
        <div className="flex justify-end border-t border-line pt-3">
          <Button
            variant="outline"
            className="min-h-11 w-full sm:w-auto"
            onClick={() => abrir(siguiente.clave)}
          >
            Seguir con {siguiente.enFrase}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </section>
  );
}
