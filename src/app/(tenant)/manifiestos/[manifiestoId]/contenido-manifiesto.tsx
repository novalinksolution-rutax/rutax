"use client";

/**
 * El contenido del detalle de un manifiesto — compartido por la página y el
 * panel lateral.
 * =============================================================================
 * Una sola pieza para las dos superficies: la página `/manifiestos/[id]`
 * (deep-link) y el panel que se abre al tocar una fila del listado. Así lo que
 * se ve y lo que se puede hacer es idéntico, se entre por donde se entre.
 *
 * `enPanel` cambia solo la MAQUETACIÓN, no el contenido: el panel es angosto
 * (≤430 px) y en un escritorio ancho `lg:` mira el viewport, no el contenedor,
 * así que la reja de dos columnas se apaga a mano cuando esto vive en el panel.
 *
 * ⚠️ El marco rojo «Zona de consecuencia» se retiró (decisión del usuario,
 * 2026-09): Cancelar y Redistribuir quedan como acciones normales de la
 * columna, sin el recuadro de falla.
 */

import Link from "next/link";
import { Plus, Package } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { BloqueTrazabilidad } from "@/components/ui/bloque-trazabilidad";
import {
  traducirEstadoManifiesto,
  BADGE_ESTADO_MANIFIESTO,
} from "@/lib/ui/traduccion-estados";
import type { EstadoManifiesto } from "@/modules/operacion/tipos";
import { cn } from "@/lib/utils";

import { PanelRuta } from "./panel-ruta";
import { BotonConfirmarManifiesto } from "./boton-confirmar-manifiesto";
import { BotonCancelarManifiesto } from "./boton-cancelar-manifiesto";
import { BotonCompletarManifiesto } from "./boton-completar-manifiesto";
import { BotonRedistribuir } from "./boton-redistribuir";
import type { DatosDetalleManifiesto } from "./datos-detalle";

export function ContenidoManifiesto({
  datos,
  enPanel = false,
}: {
  datos: DatosDetalleManifiesto;
  /** Cambia la maquetación a una sola columna (el panel es angosto). */
  enPanel?: boolean;
}) {
  const {
    manifiestoId,
    driverId,
    nombreConductor,
    estado,
    nombre,
    notas,
    fechaOperacion,
    etiquetaDelDia,
    origen,
    paradas,
    bitacora,
    fallaDeLectura,
    totalPedidos,
    paradasAbiertas,
    paradasCerradas,
    puede,
  } = datos;

  const esBorrador = estado === "borrador";
  const esConfirmado = estado === "confirmado";
  const enRuta = estado === "en_ruta";
  const hayPedidos = totalPedidos > 0;

  return (
    <div className="space-y-6">
      {/* Encabezado (en el panel el conductor/estado ya van en la cabecera del
          panel, así que solo se muestra en la página). */}
      {!enPanel ? (
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold">{nombreConductor}</h1>
          <p className="rx-num mt-0.5 text-xs text-fg-muted">
            {etiquetaDelDia} · {nombre}
            {origen?.nombre ? ` · sale desde ${origen.nombre}` : ""}
          </p>
          {notas && <p className="mt-1 text-sm text-fg-muted italic">{notas}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <BadgeEstado
              variante={BADGE_ESTADO_MANIFIESTO[estado]}
              eje="manifiesto"
              valor={estado}
              texto={traducirEstadoManifiesto(estado)}
            />
            {hayPedidos ? (
              <span className="rx-num border border-line px-1.5 py-0.5 text-[11px] text-fg-muted">
                {totalPedidos} paradas · {paradasCerradas} cerradas
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "grid gap-6",
          !enPanel && "lg:grid-cols-[minmax(0,1fr)_320px]",
        )}
      >
        <div className="min-w-0">
          {fallaDeLectura ? (
            <div className="border border-fault-line bg-fault-bg px-4 py-3.5">
              <p className="text-sm leading-relaxed text-fault-fg">
                <strong className="font-medium">No se pudieron leer las paradas.</strong> El
                manifiesto existe y puede tener paradas asignadas: esta pantalla no las está
                viendo. No lo canceles ni redistribuyas hasta poder verlas — recarga en unos
                segundos.
              </p>
            </div>
          ) : hayPedidos ? (
            <PanelRuta
              manifiestoId={manifiestoId}
              paradas={paradas}
              origen={origen}
              puedeQuitar={esBorrador && puede.asignar}
            />
          ) : (
            <EmptyState
              icon={Package}
              titulo="Esta ruta no tiene ni una parada"
              descripcion={textoVacioSegunEstado(estado, nombreConductor)}
              accion={
                esBorrador && puede.asignar ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/preparacion/asignar?conductor=${driverId}`}>Agregar pedidos</Link>
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>

        <aside className="space-y-5">
          {esBorrador && (puede.asignar || puede.crearManifiesto) && !fallaDeLectura ? (
            <section className="flex flex-col items-stretch gap-2">
              <Rotulo>Acciones</Rotulo>
              {puede.asignar ? (
                <Button asChild variant="outline" size="sm" className="w-full justify-start">
                  <Link href={`/preparacion/asignar?conductor=${driverId}`}>
                    <Plus className="size-4" aria-hidden="true" />
                    Agregar pedidos
                  </Link>
                </Button>
              ) : null}
              {puede.asignar ? (
                <BotonConfirmarManifiesto
                  manifiestoId={manifiestoId}
                  nombreConductor={nombreConductor}
                  totalPedidos={totalPedidos}
                  habilitado={hayPedidos}
                />
              ) : null}
            </section>
          ) : null}

          {esConfirmado ? (
            <p className="border border-line bg-bg-sunken px-3 py-2.5 text-sm text-fg-muted">
              Manifiesto confirmado. Sus paradas ya le aparecen al conductor en la app, en el
              orden de la ruta.
            </p>
          ) : null}

          {enRuta && puede.asignar && !fallaDeLectura ? (
            <section className="flex flex-col items-stretch gap-2">
              <Rotulo>Cerrar la ruta</Rotulo>
              <BotonCompletarManifiesto
                manifiestoId={manifiestoId}
                driverId={driverId}
                nombreConductor={nombreConductor}
                paradasAbiertas={paradasAbiertas}
              />
            </section>
          ) : null}

          {/* Acciones que cambian algo de verdad. Sin el marco rojo de antes,
              pero con su recordatorio de que todo queda en la bitácora. */}
          {!fallaDeLectura && puede.asignar && (esBorrador || esConfirmado || enRuta) ? (
            <section className="flex flex-col items-stretch gap-2.5">
              <Rotulo>Todo queda en la bitácora</Rotulo>

              {esConfirmado || enRuta ? (
                <div className="space-y-1.5">
                  <p className="text-xs leading-relaxed text-fg-muted">
                    Reparte sus paradas abiertas entre los conductores que siguen en ruta. Las
                    que no encuentren receptor quedan en la bandeja sin conductor.
                  </p>
                  <BotonRedistribuir
                    conductorId={driverId}
                    nombreConductor={nombreConductor}
                    fecha={fechaOperacion}
                    paradasAbiertas={paradasAbiertas}
                  />
                </div>
              ) : null}

              {puede.crearManifiesto && esBorrador ? (
                <div className="space-y-1.5">
                  <p className="text-xs leading-relaxed text-fg-muted">
                    Cancelar devuelve las paradas a la bandeja sin conductor. Queda con tu
                    nombre y con el motivo que escribas.
                  </p>
                  <BotonCancelarManifiesto manifiestoId={manifiestoId} paradas={totalPedidos} />
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-2 border-t border-line pt-4">
            <Rotulo>Bitácora</Rotulo>
            <BloqueTrazabilidad
              hechos={bitacora}
              vacio="Todavía no hay movimientos registrados en este manifiesto."
            />
          </section>
        </aside>
      </div>
    </div>
  );
}

function textoVacioSegunEstado(estado: EstadoManifiesto, nombreConductor: string): string {
  switch (estado) {
    case "borrador":
      return `${nombreConductor} ve «tu ruta todavía no está lista». Agrégale pedidos o cancela el manifiesto para que pueda ir a retirar.`;
    case "confirmado":
    case "en_ruta":
      return `Está confirmado y sin paradas: ${nombreConductor} abre la app y no encuentra nada que entregar. Si le quitaron las paradas, ciérralo para que no le quede una ruta viva.`;
    case "completado":
      return `Se cerró sin ninguna parada. ${nombreConductor} no entregó nada con este manifiesto.`;
    case "cancelado":
      return "Se canceló y sus paradas volvieron a la bandeja. No hay nada que hacer acá.";
  }
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium tracking-[0.12em] text-fg-muted uppercase">{children}</p>
  );
}
