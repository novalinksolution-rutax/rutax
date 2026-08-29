"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { EmptyState } from "@/components/ui/empty-state";
import { Receipt, ExternalLink } from "lucide-react";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import {
  BADGE_ESTADO_PERIODO_SUSCRIPCION,
  traducirEstadoPeriodoSuscripcion,
} from "@/lib/ui/traduccion-estados";
import type { PeriodoConPago } from "@/modules/plataforma/consultas";
import { TooltipSoloLectura } from "../../tooltip-solo-lectura";
import { accionGenerarLinkCobro, accionRegistrarPagoManual } from "../acciones";
import { formatearFecha as formatearFechaCl } from "@/lib/formato-cl";
import { BotonConfirmado } from "@/components/ui/boton-confirmado";

function formatearFecha(iso: string | null): string {
  if (!iso) return "—";
  return formatearFechaCl(iso);
}

function FilaPeriodo({ periodo, puedeEscribir }: { periodo: PeriodoConPago; puedeEscribir: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Link recién generado en esta sesión (o el ya persistido del período).
  const [linkUrl, setLinkUrl] = useState<string | null>(periodo.linkPagoUrl);

  const cobrable = periodo.estado !== "pagado" && periodo.montoClp > 0;

  function generarLink() {
    setError(null);
    const fd = new FormData();
    fd.set("periodo_id", periodo.id);
    startTransition(async () => {
      const r = await accionGenerarLinkCobro(fd);
      if (!r.ok) {
        setError((r as { mensaje?: string }).mensaje ?? "Error al generar el link.");
        return;
      }
      setLinkUrl((r as { url: string }).url);
      router.refresh();
    });
  }

  function marcarPagado() {
    setError(null);
    const fd = new FormData();
    fd.set("periodo_id", periodo.id);
    fd.set("metodo", "transferencia_manual");
    startTransition(async () => {
      const r = await accionRegistrarPagoManual(fd);
      if (!r.ok) {
        setError((r as { mensaje?: string }).mensaje ?? "Error al registrar el pago.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <tr className="border-t hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 whitespace-nowrap">
        {formatearFecha(periodo.periodoInicio)} – {formatearFecha(periodo.periodoFin)}
      </td>
      <td className="px-4 py-3 tabular-nums font-mono">
        {formatearCLP(periodo.montoClp)}
        {/* 🔴 De dónde sale el monto. La migración guarda `pedidos_efectivos` y
            `tarifa_aplicada_clp` justamente para poder contestar «¿por qué me
            cobraste esto?» —recalcularlo meses después da otro número, porque
            los pedidos cambian de estado— y hasta acá NADIE las leía: se
            escribían en cada cierre y no se mostraban en ninguna pantalla.

            Cuando el monto NO cuadra con entregas × tarifa, mandó el mínimo del
            plan; se dice, en vez de dejar al que mira restando. */}
        {periodo.pedidosEfectivos !== null && periodo.tarifaAplicadaClp !== null ? (
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            {periodo.pedidosEfectivos.toLocaleString("es-CL")} ×{" "}
            {formatearCLP(periodo.tarifaAplicadaClp)}
            {periodo.pedidosEfectivos * periodo.tarifaAplicadaClp < periodo.montoClp
              ? " · mínimo del plan"
              : ""}
          </span>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <BadgeEstado
          variante={BADGE_ESTADO_PERIODO_SUSCRIPCION[periodo.estado]} eje="periodo-suscripcion" valor={periodo.estado}
          texto={traducirEstadoPeriodoSuscripcion(periodo.estado)}
        />
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {periodo.estado === "pagado" ? (
          <span>
            {periodo.metodoPago === "fintoc_link"
              ? "Link Fintoc"
              : periodo.metodoPago === "cortesia"
                ? "Cortesía"
                : "Transferencia"}
            {periodo.pagadoEn ? ` · ${formatearFecha(periodo.pagadoEn)}` : ""}
          </span>
        ) : linkUrl ? (
          <a
            href={linkUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-foreground hover:underline"
          >
            Ver link <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col items-end gap-1">
          {cobrable &&
            (puedeEscribir ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={isPending} onClick={generarLink}>
                  {linkUrl ? "Regenerar link" : "Generar link"}
                </Button>
                <BotonConfirmado
                  etiqueta="Marcar pagado"
                  variant="ghost"
                  deshabilitado={isPending}
                  cargando={isPending}
                  titulo="Vas a marcar este período como pagado"
                  consecuencia={
                    <>
                      Esto <strong>no cobra nada</strong>: registra que el courier te pagó
                      por transferencia, fuera de Rutax. Su deuda baja y deja de aparecer
                      en morosidad. Si no te pagó, va a quedar como pagado sin estarlo.
                    </>
                  }
                  textoConfirmar="Marcar como pagado"
                  onConfirmar={marcarPagado}
                />
              </div>
            ) : (
              <TooltipSoloLectura>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled>
                    {linkUrl ? "Regenerar link" : "Generar link"}
                  </Button>
                  <Button variant="ghost" size="sm" disabled>
                    Marcar pagado
                  </Button>
                </div>
              </TooltipSoloLectura>
            ))}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </td>
    </tr>
  );
}

export function CobrosPeriodos({
  periodos,
  puedeEscribir,
}: {
  periodos: PeriodoConPago[];
  /** `false` para `soporte_lectura` — oculta los controles de escritura (el gate real vive en el servidor). */
  puedeEscribir: boolean;
}) {
  if (periodos.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        tono="arranque"
        titulo="Sin períodos de cobro"
        descripcion="El cron mensual generará los períodos de esta suscripción, o créalos manualmente."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Períodos de cobro de la suscripción">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2">Período</th>
              <th className="px-4 py-2">Monto</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Cobro</th>
              <th className="px-4 py-2 text-right">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {periodos.map((p) => (
              <FilaPeriodo key={p.id} periodo={p} puedeEscribir={puedeEscribir} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
