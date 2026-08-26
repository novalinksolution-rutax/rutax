"use client";

/**
 * Qué puede hacer cada rol — de solo lectura, sin tocar a nadie.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * EL HUECO QUE LLENA
 * -----------------------------------------------------------------------------
 * En la tabla, el rol era **una etiqueta muda**: «Coordinador», y nada más. Para
 * saber qué significa había que abrir el panel de cambiar el rol de alguien —
 * que es una **acción de mutación**, solo disponible para quien puede gestionar
 * usuarios y solo sobre una persona activa. O sea que la pregunta más básica de
 * esta pantalla —«¿qué va a poder hacer un coordinador?»— solo se respondía
 * abriendo un formulario para cambiarle el rol a alguien.
 *
 * Ahora se responde acá, sin consecuencia y sin permiso: es un desplegable.
 *
 * -----------------------------------------------------------------------------
 * 🔴 REGLA 6 · UN PERMISO SE EXPLICA CON EL CATÁLOGO, NUNCA CON UN TEXTO A MANO
 * -----------------------------------------------------------------------------
 * Las listas salen de `capacidadesLegiblesDeRol`, que recorre
 * `MATRIZ_ROL_CAPACIDADES`. **No hay una frase escrita a mano que pueda quedar
 * desincronizada**: si mañana un rol gana una capacidad, esta pantalla lo dice
 * sola. El tablero B3b lo señala como defecto vivo — «sus cuatro descripciones
 * omiten capacidades reales»— y ésta es la única superficie donde el sistema
 * explica los roles: si miente, miente en el único sitio donde alguien mira.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ PLEGADO, Y POR QUÉ CON LOS CUATRO ROLES
 * -----------------------------------------------------------------------------
 * Son 4 roles × ~21 capacidades. Desplegado de entrada, el listado de personas
 * —que es a lo que se viene— quedaría debajo del pliegue. Y van los cuatro y no
 * solo los que hay en el equipo: la pregunta suele ser previa a invitar, o sea
 * sobre un rol que todavía no tiene a nadie.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ListaCapacidades } from "@/components/ui/bloque-capacidades";
import { cn } from "@/lib/utils";
import { capacidadesLegiblesDeRol } from "@/modules/identidad/capacidades-legibles";
import { DESCRIPCIONES_ROLES_INTERNOS } from "@/modules/identidad/descripciones-roles";
import { ROLES_INTERNOS } from "@/modules/identidad/roles";

export function PermisosPorRol() {
  const [abierto, setAbierto] = useState(false);

  return (
    <section className="border border-line bg-bg-raised">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-bg-sunken"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-fg">Qué puede hacer cada rol</span>
          <span className="block text-xs leading-snug text-fg-muted">
            Los {ROLES_INTERNOS.length} roles y sus permisos reales, salidos del catálogo. No es un
            resumen escrito a mano.
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-fg-muted transition-transform", abierto && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {abierto ? (
        <div className="grid gap-4 border-t border-line px-4 py-4 lg:grid-cols-2">
          {ROLES_INTERNOS.map((rol) => {
            const { vaAPoder, noVaAPoder } = capacidadesLegiblesDeRol(rol);
            return (
              <div key={rol} className="space-y-2.5 border border-line bg-bg-sunken px-4 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{DESCRIPCIONES_ROLES_INTERNOS[rol].etiqueta}</Badge>
                  <span className="rx-num text-xs text-fg-muted">
                    {vaAPoder.length} de {vaAPoder.length + noVaAPoder.length}
                  </span>
                </div>
                <ListaCapacidades
                  rotulo="Puede"
                  tono="balanced"
                  items={vaAPoder}
                  vacio="Este rol no habilita ninguna acción."
                  colapsable
                  umbral={6}
                />
                {/* «No puede» no es relleno: sin esa mitad, quien invita asume
                    que el rol cubre lo que necesita y se entera de que no cuando
                    la persona ya está adentro pidiendo permisos. */}
                <ListaCapacidades
                  rotulo="No puede"
                  tono="muted"
                  items={noVaAPoder}
                  vacio="No queda nada fuera."
                  colapsable
                  umbral={4}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
