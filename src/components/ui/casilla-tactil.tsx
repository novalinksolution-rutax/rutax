"use client";

/**
 * La casilla táctil de 56 px, y el barrido que la acompaña.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL PROBLEMA NO ERA EL TELÉFONO: ERA LA TABLET
 * -----------------------------------------------------------------------------
 * La pantalla de asignar ya tenía dos ramas —tabla en escritorio, tarjetas en
 * móvil— y parecía cubierta. **Un iPad en horizontal mide 1024 px**, así que cae
 * en la rama de escritorio: filas de 40 px y casillas de 16, hechas para un
 * puntero.
 *
 * Y esa es exactamente la situación real: el coordinador reparte 30 paquetes
 * **de pie en la bodega, con una tablet**, mientras el camión descarga al lado.
 * Un objetivo de 16 px con el dedo, treinta veces, contra el reloj de las 16:00.
 *
 * -----------------------------------------------------------------------------
 * SE DECIDE POR EL DEDO, NO POR EL ANCHO
 * -----------------------------------------------------------------------------
 * El tamaño lo manda `@media (pointer: coarse)`, que pregunta **con qué se está
 * apuntando** en vez de adivinarlo por el ancho de la ventana. Un iPad de 1024
 * px con el dedo recibe el objetivo grande; un portátil de 1024 px con trackpad,
 * no. Un punto de corte por ancho se equivoca en los dos casos.
 *
 * El cuadro visible **no crece**: crece el área que responde al toque, con un
 * `::after` invisible de 56 × 56 centrado. Agrandar el dibujo desalinearía la
 * columna y haría la tabla más alta sin necesidad; lo que hace falta es que el
 * dedo acierte, no que el cuadrito se vea grande.
 *
 * -----------------------------------------------------------------------------
 * EL BARRIDO ARRANCA ACÁ, Y POR ESO VIVE EN ESTE COMPONENTE
 * -----------------------------------------------------------------------------
 * El gesto de arrastrar hacia abajo **ya significa desplazar la lista**. Si el
 * barrido empezara en cualquier parte de la fila, seleccionar y hacer scroll
 * serían el mismo gesto. Arrancando en la columna de la casilla los dos
 * conviven: el dedo en la casilla selecciona, el dedo en el resto desplaza.
 *
 * `touch-action: none` va **solo en esta celda**, nunca en la fila ni en la
 * lista: es lo que permite que el navegador entregue el arrastre en vez de
 * convertirlo en scroll, y acotarlo a la banda de la casilla es lo que deja el
 * resto de la pantalla desplazándose como siempre.
 *
 * La lógica del barrido —qué se marca y qué no— vive aparte y con pruebas, en
 * `src/lib/ui/barrido-seleccion.ts`.
 */

import * as React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  filasAAlternar,
  iniciarBarrido,
  type EstadoBarrido,
} from "@/lib/ui/barrido-seleccion";

/**
 * Envuelve una casilla y le da 56 × 56 de área táctil cuando quien apunta es un
 * dedo. En escritorio con puntero se comporta exactamente como antes.
 */
export function CasillaTactil({
  className,
  ...props
}: React.ComponentProps<typeof Checkbox>) {
  return (
    <Checkbox
      {...props}
      className={cn(
        // 56 px centrados sobre el cuadro de 16: `-inset-5` a cada lado.
        // Solo bajo `pointer: coarse`, para no ampliar el blanco del ratón —
        // un área invisible de 56 px en escritorio se come los clics de la
        // celda vecina.
        //
        // ⚠️ Va en `-inset-x` e `-inset-y` por separado y NO como `-inset-5`:
        // la casilla base ya trae `after:-inset-x-3 after:-inset-y-2`, y cuál de
        // las dos gana depende del orden en que Tailwind emita las reglas, no
        // del orden en que se escriban acá. Sobrescribiendo las mismas dos
        // utilidades no hay ambigüedad que resolver.
        "pointer-coarse:after:-inset-x-5 pointer-coarse:after:-inset-y-5",
        className,
      )}
    />
  );
}

/**
 * El barrido, listo para colgar de la columna de casillas.
 *
 * ⚠️ **Trabaja con la API que la pantalla ya tiene, que es *alternar*.** No pide
 * un `Set` ni un «marca esto»: la bandeja de asignar guarda su selección en un
 * `Map` y expone `onAlternarUno`. Adaptar el gesto a lo que existe evita
 * plomería nueva —y una segunda fuente de verdad de la selección, que es el
 * error que de verdad cuesta caro.
 *
 * Acá no se guarda nada de negocio: solo el gesto en curso.
 */
export function useBarridoSeleccion<T>({
  items,
  idDe,
  estaMarcado,
  onAlternar,
}: {
  /** Los elementos en el orden en que se ven. El tramo se calcula sobre esto. */
  items: readonly T[];
  idDe: (item: T) => string;
  estaMarcado: (item: T) => boolean;
  onAlternar: (item: T) => void;
}) {
  const barrido = React.useRef<EstadoBarrido | null>(null);
  const ultimoIndice = React.useRef<number>(-1);

  // Los datos vivos en un ref: durante un barrido llegan decenas de eventos y
  // leerlos del render dejaría a cada uno trabajando sobre una foto vieja.
  //
  // ⚠️ Se refresca en un efecto **sin lista de dependencias** —o sea, después de
  // cada render— y no asignando durante el render. Escribir un ref mientras se
  // renderiza rompe con el render concurrente, donde React puede renderizar y
  // descartar: el ref se quedaría con datos de un árbol que nunca se mostró.
  // Los manejadores de eventos corren después del render, así que siempre leen
  // lo último.
  const datos = React.useRef({ items, idDe, estaMarcado, onAlternar });
  React.useEffect(() => {
    datos.current = { items, idDe, estaMarcado, onAlternar };
  });

  const terminar = React.useCallback(() => {
    barrido.current = null;
    ultimoIndice.current = -1;
  }, []);

  React.useEffect(() => {
    // El final del gesto se escucha en la ventana, no en la celda: el dedo se
    // levanta muy seguido **fuera** de la última casilla, y ahí el `pointerup`
    // de la celda no llega nunca — el barrido quedaría abierto y la siguiente
    // fila que rozara se marcaría sola.
    window.addEventListener("pointerup", terminar);
    window.addEventListener("pointercancel", terminar);
    return () => {
      window.removeEventListener("pointerup", terminar);
      window.removeEventListener("pointercancel", terminar);
    };
  }, [terminar]);

  const propsDeCelda = React.useCallback(
    (indice: number) => ({
      // Solo la banda de la casilla renuncia al scroll. Ponerlo en la fila o en
      // la lista dejaría la pantalla sin poder desplazarse.
      style: { touchAction: "none" as const },
      onPointerDown: (e: React.PointerEvent) => {
        // Solo el botón principal o el dedo: un clic derecho no selecciona.
        if (e.button !== 0) return;
        const { items: xs, estaMarcado: marcado, idDe: id } = datos.current;
        const item = xs[indice];
        if (!item) return;
        const b = iniciarBarrido(marcado(item));
        // La fila de partida se anota sin alternarla: de eso ya se encarga el
        // `onCheckedChange` de la propia casilla. Marcarla acá la desharía.
        b.tocadas.add(id(item));
        barrido.current = b;
        ultimoIndice.current = indice;
      },
      onPointerEnter: () => {
        const b = barrido.current;
        if (!b) return;
        const { items: xs, idDe: id, estaMarcado: marcado, onAlternar: alternar } = datos.current;
        const ids = xs.map(id);
        const desde = ultimoIndice.current < 0 ? indice : ultimoIndice.current;
        const porId = new Map(xs.map((x) => [id(x), x]));
        for (const idFila of filasAAlternar(b, ids, desde, indice, (k) => {
          const item = porId.get(k);
          return item ? marcado(item) : false;
        })) {
          const item = porId.get(idFila);
          if (item) alternar(item);
        }
        ultimoIndice.current = indice;
      },
    }),
    [],
  );

  return { propsDeCelda };
}
