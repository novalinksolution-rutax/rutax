"use client";

/**
 * `panel de acción` — hacer algo sin salir de la pantalla.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ RESUELVE
 * -----------------------------------------------------------------------------
 * Crear un same-day, invitar a un seller, editar una tarifa: cosas de un
 * formulario que **hasta ahora costaban una navegación completa**. Salir de la
 * lista para volver a ella es caro de dos maneras: se pierde el filtro y el
 * lugar en el scroll, y se pierde el contexto — al invitar a alguien uno está
 * mirando a quién ya tiene.
 *
 * -----------------------------------------------------------------------------
 * 🔴 DOS ANATOMÍAS, UNA SOLA PIEZA, Y EL CORTE ESTÁ EN 768 px
 * -----------------------------------------------------------------------------
 * · **Bajo 768 px** entra como **hoja inferior**, arrastrable, con el pie fijo.
 *   Un panel lateral en una pantalla de 390 px es un panel de 390 px: no queda
 *   nada de la lista detrás, así que el «lateral» no aporta y sí aleja el botón
 *   del pulgar.
 * · **Desde 768 px** es el **panel lateral de 430 px** a la derecha, con la
 *   lista a la vista.
 *
 * ⚠️ **El corte se decide en JS y no con clases de Tailwind**, y no es
 * capricho: son dos árboles de DOM distintos —la hoja tiene asa, puntos de
 * altura y arrastre; el lateral no— y montarlos los dos para esconder uno con
 * `hidden` duplicaría el formulario, sus `id` y su estado. Dos campos con el
 * mismo `id` rompen los `<label htmlFor>` de la mitad de la pantalla.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ ESTE SÍ ES MODAL, Y LA VISTA PREVIA DE PEDIDOS NO
 * -----------------------------------------------------------------------------
 * Parecen lo mismo y resuelven cosas opuestas. La vista previa es para **mirar
 * sin perder el sitio**: por eso es un `aside` sin velo, la lista se atenúa
 * pero sigue viva, y tocar otra fila cambia el contenido sin cerrar.
 *
 * Esto es para **hacer una cosa**: lleva velo y atrapa el foco a propósito.
 * Poder clicar detrás mientras se llena un formulario es cómo se pierde lo
 * escrito sin querer, y el foco tiene que quedarse dentro para que el tabulador
 * recorra el formulario y no la lista de atrás.
 *
 * -----------------------------------------------------------------------------
 * LA CABECERA NOMBRA EL OBJETO
 * -----------------------------------------------------------------------------
 * Título y, debajo, la línea que dice **cuál** —«Vega Norte · Same-day · Norte
 * · vigente desde 01-08»—, separada del cuerpo por la regla de 2 px que usan la
 * ficha del seller y los correos. Es la anatomía que B3b pide para las siete
 * pantallas del segundo nivel.
 */

import * as React from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { HojaInferior } from "@/components/ui/hoja-inferior";
import { cn } from "@/lib/utils";

/** El corte entre hoja y lateral. Es el `md` de Tailwind, y coincide a propósito. */
const CORTE_LATERAL = 768;

/**
 * ¿Hay ancho para el panel lateral?
 *
 * Arranca en `false` —o sea, hoja— para que el primer render del servidor y el
 * del cliente coincidan: `window` no existe en el servidor y adivinar
 * «escritorio» produce un parpadeo del árbol completo en cada teléfono.
 */
function useHayAnchoLateral(): boolean {
  const [hayAncho, setHayAncho] = React.useState(false);

  React.useEffect(() => {
    const consulta = window.matchMedia(`(min-width: ${CORTE_LATERAL}px)`);
    const aplicar = () => setHayAncho(consulta.matches);
    aplicar();
    consulta.addEventListener("change", aplicar);
    return () => consulta.removeEventListener("change", aplicar);
  }, []);

  return hayAncho;
}

export function PanelAccion({
  abierto,
  onOpenChange,
  disparador,
  titulo,
  /** Cuál objeto. Va bajo el título, en mono, y es lo que evita el «¿cuál era?». */
  subtitulo,
  /** Botones. En la hoja quedan fijos abajo; en el lateral, al final del cuerpo. */
  pie,
  children,
  ancho = "normal",
  className,
}: {
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
  /** Opcional: quien controla `abierto` desde fuera no lo necesita. */
  disparador?: React.ReactNode;
  titulo: React.ReactNode;
  subtitulo?: React.ReactNode;
  pie?: React.ReactNode;
  children: React.ReactNode;
  /**
   * `normal` (430 px) es la medida del tablero para las siete pantallas del
   * segundo nivel. `amplio` (620 px) es la excepción que B3b ya contempla
   * —«salvo las dos que necesitan el ancho completo»— y existe para los
   * formularios largos: el alta de same-day tiene cuatro grupos y un buscador
   * de direcciones, y en 430 px cada campo queda en su propia línea.
   *
   * ⚠️ No es cosmético. La razón por la que el alta de same-day se sacó de un
   * modal de 512 px fue justamente que un formulario largo necesita espacio;
   * meterlo en 430 px sería repetir ese error con otro nombre.
   */
  ancho?: "normal" | "amplio";
  className?: string;
}) {
  const lateral = useHayAnchoLateral();

  if (!lateral) {
    return (
      <>
        {/* 🐞 **El disparador hay que cablearlo a mano acá.** En la rama del
            lateral lo hace `SheetTrigger asChild`; en ésta no hay Radix que lo
            haga, así que sin este `cloneElement` el botón se dibuja y **no abre
            nada** — que es exactamente lo que pasó al probarlo en 390 px: el
            panel funcionaba en escritorio y en teléfono el botón no hacía nada.

            Se conserva el `onClick` que el llamador haya puesto: puede tener
            uno propio y perderlo en silencio sería peor que no abrir. */}
        {React.isValidElement<{ onClick?: React.MouseEventHandler }>(disparador)
          ? React.cloneElement(disparador, {
              onClick: (evento: React.MouseEvent<HTMLElement>) => {
                disparador.props.onClick?.(evento);
                if (!evento.defaultPrevented) onOpenChange(true);
              },
            })
          : disparador}
        <HojaInferior
          abierta={abierto}
          onOpenChange={onOpenChange}
          titulo={titulo}
          descripcion={subtitulo}
          pie={pie}
          // `completa` y no `media`: son formularios, y media hoja obliga a
          // arrastrar antes de poder escribir el segundo campo.
          inicial="completa"
        >
          <div className={cn("space-y-4", className)}>{children}</div>
        </HojaInferior>
      </>
    );
  }

  return (
    <Sheet open={abierto} onOpenChange={onOpenChange}>
      {disparador ? <SheetTrigger asChild>{disparador}</SheetTrigger> : null}
      {/* ⚠️ El `!` en el ancho: `SheetContent` trae
          `data-[side=right]:sm:max-w-sm` en su clase base y un selector con
          atributo de datos le gana a una utilidad suelta. Sin esto el panel se
          queda en 384 px. */}
      <SheetContent
        side="right"
        className={cn(
          "w-full gap-0 overflow-y-auto p-0",
          ancho === "amplio"
            ? "sm:w-[620px] sm:max-w-[620px]!"
            : "sm:w-[430px] sm:max-w-[430px]!",
        )}
      >
        <SheetHeader className="gap-1 border-b-2 border-fg px-4 py-3.5">
          <SheetTitle className="text-base font-semibold">{titulo}</SheetTitle>
          {subtitulo ? (
            <SheetDescription className="text-xs text-fg-muted">{subtitulo}</SheetDescription>
          ) : (
            // Radix exige una descripción para el lector de pantalla. Sin
            // subtítulo se pone vacía y oculta, no se omite.
            <SheetDescription className="sr-only">{titulo}</SheetDescription>
          )}
        </SheetHeader>

        <div className={cn("space-y-4 px-4 py-4", className)}>{children}</div>

        {pie ? <div className="px-4 pt-1 pb-5">{pie}</div> : null}
      </SheetContent>
    </Sheet>
  );
}
