"use client";

/**
 * El panel de caso de una incidencia (tablero B1b).
 *
 * -----------------------------------------------------------------------------
 * QUÉ REEMPLAZA
 * -----------------------------------------------------------------------------
 * Un cajón de acciones abierto desde un botón «Gestionar» por fila, con tres
 * datos y una caja de notas. El tablero pide otra cosa: **el caso completo**, de
 * arriba abajo — lo que reportó el conductor, el efecto en el dinero, a dónde
 * puede pasar, y dos salidas que cierran de verdad.
 *
 * -----------------------------------------------------------------------------
 * LAS TRANSICIONES SE DECLARAN, NO SE ADIVINAN
 * -----------------------------------------------------------------------------
 * `PASAR A` muestra **solo los destinos válidos** desde el estado actual, y dice
 * por qué falta el que falta: «Cerrada» no aparece hasta que la incidencia esté
 * resuelta, y eso se explica en vez de dejar un botón muerto o, peor, esconderlo
 * sin motivo.
 *
 * -----------------------------------------------------------------------------
 * LAS DOS SALIDAS TOCAN EL PEDIDO, Y ESO ES EL PUNTO
 * -----------------------------------------------------------------------------
 * «Devolver al seller» y «Reagendar para mañana» resuelven la incidencia **y**
 * dejan el pedido en un estado coherente. Resolver la incidencia sin tocar el
 * pedido es exactamente cómo se produce el cabo suelto que CLAUDE.md tiene
 * anotado: el pedido queda en `fallido`, nunca llega a `devuelto`, y su línea de
 * cobro sigue viva mientras el supervisor cree que cerró el caso.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  BADGE_ESTADO_INCIDENCIA,
  TEXTO_ESTADO_INCIDENCIA,
  explicarAfectacionIncidencia,
  traducirEstadoIncidencia,
  traducirTipoIncidencia,
} from "@/lib/ui/traduccion-estados";
import { formatearFechaHora } from "@/lib/formato-cl";
import type { EstadoIncidencia, Incidencia } from "@/modules/operacion/tipos";
import type { ContextoIncidencia } from "@/modules/operacion/bandeja-incidencias";
import { DialogReclasificarIncidencia } from "../[pedidoId]/dialog-reclasificar-incidencia";
import {
  actionActualizarIncidencia,
  actionDevolverAlSeller,
  actionReagendarParaManana,
} from "./actions";
import { Bandera } from "./bandeja";

/**
 * A dónde puede pasar cada estado. Es la misma máquina que impone el módulo:
 * acá solo se dibuja, y si el servidor la rechaza el mensaje vuelve al panel.
 */
const DESTINOS: Record<EstadoIncidencia, EstadoIncidencia[]> = {
  abierta: ["en_gestion"],
  en_gestion: ["resuelta"],
  resuelta: ["cerrada"],
  cerrada: [],
};

/** Por qué no está el destino que falta. Nunca un botón muerto y mudo. */
const POR_QUE_FALTA: Record<EstadoIncidencia, string | null> = {
  abierta: "«Resuelta» aparece cuando alguien la tome: primero se gestiona.",
  en_gestion: "«Cerrada» aparece una vez resuelta.",
  resuelta: null,
  cerrada: "Una incidencia cerrada no vuelve atrás. Si reaparece, se abre una nueva.",
};

export function PanelCaso({
  incidencia,
  contexto,
  seller,
  puedeGestionar,
  onCerrar,
}: {
  incidencia: Incidencia | null;
  contexto: ContextoIncidencia | undefined;
  seller: string;
  puedeGestionar: boolean;
  onCerrar: () => void;
}) {
  const [notas, setNotas] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!incidencia) return null;

  const destinos = DESTINOS[incidencia.estado];
  const referencia = contexto?.referencia ?? incidencia.pedidoId.slice(0, 8);

  function ejecutar(accion: () => Promise<{ error?: string; exito?: boolean }>) {
    setError(null);
    iniciar(async () => {
      const r = await accion();
      if (r.error) setError(r.error);
      else onCerrar();
    });
  }

  function pasarA(estado: EstadoIncidencia) {
    const fd = new FormData();
    fd.set("incidenciaId", incidencia!.id);
    fd.set("estado", estado);
    if (notas.trim()) fd.set("notasResolucion", notas);
    ejecutar(() => actionActualizarIncidencia(fd));
  }

  return (
    <Sheet open onOpenChange={(a) => !a && onCerrar()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[420px]!"
      >
        <SheetHeader className="border-b border-line px-4 py-3">
          <SheetTitle className="text-base">
            {traducirTipoIncidencia(incidencia.tipo)}
          </SheetTitle>
          <Link
            href={`/operaciones/${incidencia.pedidoId}`}
            className="rx-num inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
          >
            {referencia}
            {contexto?.comuna ? ` · ${contexto.comuna}` : ""}
            <ChevronRight className="size-3" aria-hidden="true" />
          </Link>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 py-4">
          {/* --------------------------------------------------------------
              Lo que se reportó. Va primero porque es lo que hay que leer para
              decidir; todo lo demás es consecuencia de esto.
              -------------------------------------------------------------- */}
          <section>
            <Rotulo>Lo que se reportó</Rotulo>
            {incidencia.descripcion ? (
              <blockquote className="mt-1.5 border-s-2 border-line-strong ps-3 text-sm leading-relaxed text-fg">
                {incidencia.descripcion}
              </blockquote>
            ) : (
              <p className="mt-1.5 text-sm text-fg-muted">
                Se abrió sin descripción. El tipo es lo único que se declaró.
              </p>
            )}
            <p className="mt-1.5 text-xs text-fg-muted">
              {contexto?.conductorNombre ?? "Sin conductor asignado"} ·{" "}
              {formatearFechaHora(incidencia.abiertaEn)}
              {contexto && contexto.fotos > 0 ? (
                <>
                  {" · "}
                  {/* Solo el conteo con su enlace: el visor de evidencias vive en
                      el detalle del pedido y reparte URL firmadas de un bucket
                      privado. Duplicarlo acá sería una segunda puerta al mismo
                      bucket, con su propio riesgo de quedarse sin caducar. */}
                  <Link
                    href={`/operaciones/${incidencia.pedidoId}`}
                    className="text-accent-text hover:underline"
                  >
                    {contexto.fotos} {contexto.fotos === 1 ? "foto" : "fotos"}
                  </Link>
                </>
              ) : null}
            </p>
          </section>

          {/* --------------------------------------------------------------
              El efecto en el dinero, leído de la FILA y no del tipo.
              -------------------------------------------------------------- */}
          <section className="border-t border-line pt-3">
            <Rotulo>Efecto en el dinero</Rotulo>
            <div className="mt-1.5 flex gap-1">
              <Bandera activa={incidencia.afectaCobro} texto="COBRO" />
              <Bandera activa={incidencia.afectaLiquidacion} texto="LIQ" />
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
              {explicarAfectacionIncidencia(
                incidencia.afectaCobro,
                incidencia.afectaLiquidacion,
              )}
            </p>
            {puedeGestionar ? (
              <div className="mt-2">
                {/* El mismo diálogo que el detalle del pedido, no una copia:
                    reclasificar cambia el efecto en el dinero, y dos versiones
                    de esa regla divergirían. */}
                <DialogReclasificarIncidencia
                  pedidoId={incidencia.pedidoId}
                  incidenciaId={incidencia.id}
                  tipoActual={incidencia.tipo}
                />
              </div>
            ) : null}
          </section>

          {/* --------------------------------------------------------------
              Estado y transiciones.
              -------------------------------------------------------------- */}
          <section className="border-t border-line pt-3">
            <Rotulo>Estado</Rotulo>
            <div className="mt-1.5">
              <BadgeEstado
                variante={BADGE_ESTADO_INCIDENCIA[incidencia.estado]}
                eje="incidencia"
                valor={incidencia.estado}
                texto={traducirEstadoIncidencia(incidencia.estado)}
              />
            </div>

            {puedeGestionar && destinos.length > 0 ? (
              <>
                <p className="mt-3 text-xs font-medium text-fg">Pasar a</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {destinos.map((d) => (
                    <Button
                      key={d}
                      size="sm"
                      variant="outline"
                      disabled={pendiente || (d === "resuelta" && notas.trim() === "")}
                      onClick={() => pasarA(d)}
                    >
                      {TEXTO_ESTADO_INCIDENCIA[d]}
                    </Button>
                  ))}
                </div>
                {/* Deshabilitado CON su motivo: el botón se ve y dice qué falta. */}
                {destinos.includes("resuelta") && notas.trim() === "" ? (
                  <p className="mt-1.5 text-xs text-attention-fg">
                    Escribe las notas de resolución para poder marcarla resuelta.
                  </p>
                ) : null}
              </>
            ) : null}

            {POR_QUE_FALTA[incidencia.estado] ? (
              <p className="mt-2 text-xs leading-relaxed text-fg-muted">
                {POR_QUE_FALTA[incidencia.estado]}
              </p>
            ) : null}
          </section>

          {/* --------------------------------------------------------------
              Notas y cierre.
              -------------------------------------------------------------- */}
          {puedeGestionar && incidencia.estado !== "cerrada" ? (
            <section className="border-t border-line pt-3">
              <Label htmlFor="notas-caso" className="text-xs font-medium">
                Notas de resolución
              </Label>
              <Textarea
                id="notas-caso"
                rows={3}
                className="mt-1.5"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder={incidencia.notasResolucion ?? "Qué se hizo con este caso."}
              />
              <p className="mt-1 text-xs text-fg-muted">
                Las lee el seller en su portal, y quien revise este caso después.
              </p>

              <div className="mt-4 border border-fault-line p-3">
                <Rotulo tono="fault">Cerrar el caso</Rotulo>
                <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
                  Las dos resuelven la incidencia <strong className="text-fg">y</strong> mueven
                  el pedido. Quedan a tu nombre en la bitácora.
                </p>

                <Label htmlFor="motivo-cierre" className="mt-3 block text-xs font-medium">
                  Motivo
                </Label>
                <Textarea
                  id="motivo-cierre"
                  rows={2}
                  className="mt-1.5"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="El destinatario pidió que se lo dejaran mañana."
                />

                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pendiente || motivo.trim().length < 3}
                    onClick={() =>
                      ejecutar(() => actionReagendarParaManana(incidencia.id, motivo))
                    }
                  >
                    Reagendar para mañana
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-fault-line text-fault-fg hover:bg-fault-bg"
                    disabled={pendiente || motivo.trim().length < 3}
                    onClick={() => ejecutar(() => actionDevolverAlSeller(incidencia.id, motivo))}
                  >
                    Devolver al seller
                  </Button>
                </div>
                {/* La consecuencia dicha antes de apretar, no después. */}
                <p className="mt-2 text-xs leading-relaxed text-fg-muted">
                  Reagendar mueve la fecha de compromiso al día siguiente, que es contra la
                  que se mide el SLA de este pedido. Devolver lo deja en estado{" "}
                  <strong className="text-fg">devuelto</strong> y anula su cobro al seller.
                </p>
              </div>
            </section>
          ) : null}

          {/* El seller ve al seller, no al conductor: acá va como contexto del
              caso, no como dato del destinatario. */}
          <p className="border-t border-line pt-3 text-xs text-fg-muted">Seller: {seller}</p>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Rotulo({
  children,
  tono,
}: {
  children: React.ReactNode;
  tono?: "fault";
}) {
  return (
    <p
      className={`text-[10px] font-medium tracking-[0.12em] uppercase ${
        tono === "fault" ? "text-fault-fg" : "text-fg-muted"
      }`}
    >
      {children}
    </p>
  );
}
