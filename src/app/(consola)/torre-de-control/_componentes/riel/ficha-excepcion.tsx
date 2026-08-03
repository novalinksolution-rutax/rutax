"use client";

import { useState } from "react";
import Link from "next/link";
import type { Excepcion } from "../../_fixture/estado-torre";
import { clpTorre, numeroTorre } from "../../_lib/formato";
import { formatoVentanaCorta, horaSantiago } from "../../_lib/tiempo";
import { BOTON_SOLIDO, FOCO_ANILLO } from "../../_lib/estilos";

const CHIP_SEVERIDAD: Record<Excepcion["severidad"], string> = {
  critica: "bg-tc-senal text-tc-papel",
  alta: "bg-tc-tinta text-tc-papel",
  media: "border border-tc-tinta text-tc-tinta",
  informativa: "border border-tc-ink-300 text-tc-ink-600",
};

const ETIQUETA_SEVERIDAD: Record<Excepcion["severidad"], string> = {
  critica: "Crítica",
  alta: "Alta",
  media: "Media",
  informativa: "Informativa",
};

const RE_VER_PEDIDOS = /^ver los \d+ pedidos$/i;

interface Props {
  excepcion: Excepcion;
  zonaNombre: string | null;
  ahoraIso: string;
  onSeleccionarZona: (zonaId: string) => void;
  /** móvil (README §5): tipografía un punto mayor, acciones apiladas a ancho completo. */
  variante?: "escritorio" | "movil";
}

/**
 * Ficha de excepción (README §4).
 *
 * Solo muestra acciones que HACEN algo. La maquinaria de confirmación en el
 * sitio y el botón «Descartar» se retiraron: la primera se quedó sin acciones
 * que confirmar (el composer emite las tres suyas sin confirmación), y el
 * segundo solo ocultaba la ficha en memoria del navegador mientras prometía
 * calibrar umbrales. Un control que completa el flujo y no ejecuta nada es
 * peor que su ausencia.
 */
export function FichaExcepcion({
  excepcion,
  zonaNombre,
  ahoraIso,
  onSeleccionarZona,
  variante = "escritorio",
}: Props) {  const [revelada, setRevelada] = useState<string | null>(null);
  const movil = variante === "movil";

  return (
    <article className={`border-t border-tc-ink-300 ${movil ? "px-4 py-4" : "px-3.5 py-3.5"}`}>
      <header className="mb-2 flex items-center gap-2">
        <span
          className={`px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-[0.06em] uppercase ${CHIP_SEVERIDAD[excepcion.severidad]}`}
        >
          {ETIQUETA_SEVERIDAD[excepcion.severidad]}
        </span>
        {excepcion.zonaId && zonaNombre ? (
          <button
            type="button"
            onClick={() => onSeleccionarZona(excepcion.zonaId as string)}
            className={`text-[11px] font-semibold text-tc-tinta underline decoration-1 underline-offset-[3px] hover:text-tc-ink-700 ${FOCO_ANILLO}`}
          >
            {zonaNombre}
          </button>
        ) : (
          <span className="text-[11px] font-semibold text-tc-ink-600 uppercase">Toda la operación</span>
        )}
        <span className="tc-num ml-auto text-[9.5px] text-tc-ink-500">
          detectada {horaSantiago(excepcion.detectadaEn)}
        </span>
      </header>

      <p className={`text-pretty font-extrabold text-tc-tinta ${movil ? "text-[16px] leading-[1.25]" : "text-[15.5px] leading-[1.2]"}`}>
        {excepcion.titulo}
      </p>
      <p className={`mt-1.5 leading-[1.45] text-tc-ink-700 ${movil ? "text-[13px]" : "text-[12px]"}`}>{excepcion.cuerpo}</p>

      {/* Impacto */}
      {excepcion.pedidosAfectados === 0 ? (
        <p className="mt-3 text-[10.5px] text-tc-ink-600">
          Sin pedidos afectados todavía · {formatoVentanaCorta(excepcion.ventana, ahoraIso)}
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-3 divide-x divide-tc-ink-300 border-y border-tc-ink-300">
          <ImpactoCelda etiqueta="Pedidos" valor={numeroTorre(excepcion.pedidosAfectados)} />
          <ImpactoCelda etiqueta="Monto" valor={clpTorre(excepcion.montoAfectadoClp)} />
          <ImpactoCelda etiqueta="Ventana" valor={formatoVentanaCorta(excepcion.ventana, ahoraIso)} pequena />
        </div>
      )}

      {/* Acciones — en móvil, apiladas a ancho completo con min-height 46px (README §5). */}
      <div className={movil ? "mt-3 flex flex-col gap-2" : "mt-3 flex flex-wrap gap-2"}>
        {excepcion.acciones.map((accion) => {
          const claseBoton = movil ? "min-h-[46px]" : "";

          if (RE_VER_PEDIDOS.test(accion.etiqueta)) {
            const fecha = excepcion.ventana ? excepcion.ventana.inicio.slice(0, 10) : null;
            return (
              <Link
                key={accion.id}
                href={fecha ? `/operaciones?fecha=${fecha}` : "/operaciones"}
                className={`${BOTON_SOLIDO} ${claseBoton} ${movil ? "flex w-full items-center justify-start" : ""}`}
              >
                {accion.etiqueta}
              </Link>
            );
          }

          const abierta = revelada === accion.id;
          return (
            <div key={accion.id} className="w-full">
              <button
                type="button"
                className={`${BOTON_SOLIDO} ${claseBoton} ${movil ? "w-full" : ""}`}
                aria-expanded={abierta}
                onClick={() => setRevelada(abierta ? null : accion.id)}
              >
                {accion.etiqueta}
              </button>
              {abierta ? (
                <p className="mt-2 border-l-2 border-tc-ink-300 py-1 pl-3 text-[11.5px] text-tc-ink-700">
                  {accion.descripcion} Este detalle todavía no está disponible: falta que el modelo
                  de datos guarde la patente de cada conductor.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function ImpactoCelda({ etiqueta, valor, pequena }: { etiqueta: string; valor: string; pequena?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 first:pl-0 last:pr-0">
      <span className="text-[9px] font-bold tracking-[0.08em] text-tc-ink-600 uppercase">{etiqueta}</span>
      <span className={`tc-num font-extrabold text-tc-tinta ${pequena ? "text-[11px]" : "text-[13px]"}`}>{valor}</span>
    </div>
  );
}
