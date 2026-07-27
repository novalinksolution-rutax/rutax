"use client";

import { useState } from "react";
import Link from "next/link";
import type { Excepcion } from "../../_fixture/estado-torre";
import { clpTorre, numeroTorre } from "../../_lib/formato";
import { formatoVentanaCorta, horaSantiago } from "../../_lib/tiempo";
import { BOTON_CONFIRMAR, BOTON_OUTLINE, BOTON_SOLIDO, FOCO_ANILLO } from "../../_lib/estilos";

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
  confirmando: string | null;
  onSeleccionarZona: (zonaId: string) => void;
  onPedirConfirmacion: (accionId: string) => void;
  onCancelarConfirmacion: () => void;
  onConfirmarAccion: (accionId: string) => void;
  onDescartar: () => void;
  /** móvil (README §5): tipografía un punto mayor, acciones apiladas a ancho completo. */
  variante?: "escritorio" | "movil";
}

/**
 * Ficha de excepción (README §4). Las acciones con `requiereConfirmacion`
 * abren una tira EN EL SITIO, sin modal — el usuario no pierde el contexto
 * del tablero.
 *
 * Nota de alcance (B3, UI contra fixture): no hay backend de acciones del
 * motor de riesgo todavía. "Ver los N pedidos" enlaza de verdad a
 * `/operaciones` (filtrado por fecha, lo único que esa lista ya soporta hoy);
 * confirmar una acción que sí requiere confirmación la marca como registrada
 * localmente — ejecutar de verdad (mover un corte, reasignar conductores) es
 * trabajo de otro paso, no de este.
 */
export function FichaExcepcion({
  excepcion,
  zonaNombre,
  ahoraIso,
  confirmando,
  onSeleccionarZona,
  onPedirConfirmacion,
  onCancelarConfirmacion,
  onConfirmarAccion,
  onDescartar,
  variante = "escritorio",
}: Props) {
  const [ejecutadas, setEjecutadas] = useState<Set<string>>(new Set());
  const [revelada, setRevelada] = useState<string | null>(null);
  const movil = variante === "movil";

  const ejecutarAccion = (accionId: string) => {
    setEjecutadas((prev) => new Set(prev).add(accionId));
  };

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

      {excepcion.origen === "senal" && excepcion.confianza !== null ? (
        <span className="mt-2 inline-block border border-tc-ink-300 px-1.5 py-0.5 text-[9.5px] text-tc-ink-600 uppercase">
          Desde prensa · confianza {Math.round(excepcion.confianza * 100)} %
        </span>
      ) : null}

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
          const enConfirmacion = confirmando === accion.id;
          const yaEjecutada = ejecutadas.has(accion.id);
          const claseBoton = movil ? "min-h-[46px]" : "";

          if (enConfirmacion) {
            return (
              <div key={accion.id} className="w-full border-2 border-tc-tinta bg-tc-inserto p-3">
                <p className="text-[9.5px] font-extrabold tracking-[0.1em] text-tc-tinta uppercase">
                  Confirma antes de ejecutar
                </p>
                <p className="mt-1 text-[12px] text-tc-ink-700">{accion.descripcion}</p>
                <div className={movil ? "mt-2 flex flex-col gap-2" : "mt-2 flex gap-2"}>
                  <button
                    type="button"
                    className={`${BOTON_CONFIRMAR} ${claseBoton}`}
                    onClick={() => {
                      onConfirmarAccion(accion.id);
                      ejecutarAccion(accion.id);
                    }}
                  >
                    Sí, ejecutar
                  </button>
                  <button type="button" className={`${BOTON_OUTLINE} ${claseBoton}`} onClick={onCancelarConfirmacion}>
                    Cancelar
                  </button>
                </div>
              </div>
            );
          }

          if (accion.requiereConfirmacion) {
            return (
              <button
                key={accion.id}
                type="button"
                disabled={yaEjecutada}
                className={`${BOTON_SOLIDO} ${claseBoton} ${movil ? "w-full" : ""}`}
                onClick={() => onPedirConfirmacion(accion.id)}
              >
                {yaEjecutada ? `${accion.etiqueta} · confirmado` : accion.etiqueta}
              </button>
            );
          }

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

        {excepcion.descartable ? (
          <button
            type="button"
            className={`${BOTON_OUTLINE} ${claseBotonDescartar(movil)}`}
            onClick={onDescartar}
          >
            Descartar
          </button>
        ) : null}
      </div>
    </article>
  );
}

function claseBotonDescartar(movil: boolean): string {
  return movil ? "min-h-[46px] w-full" : "";
}

function ImpactoCelda({ etiqueta, valor, pequena }: { etiqueta: string; valor: string; pequena?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 first:pl-0 last:pr-0">
      <span className="text-[9px] font-bold tracking-[0.08em] text-tc-ink-600 uppercase">{etiqueta}</span>
      <span className={`tc-num font-extrabold text-tc-tinta ${pequena ? "text-[11px]" : "text-[13px]"}`}>{valor}</span>
    </div>
  );
}
