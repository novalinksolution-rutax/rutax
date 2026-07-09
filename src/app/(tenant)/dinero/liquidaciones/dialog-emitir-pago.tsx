"use client";

/**
 * Dialog de confirmación para emitir un pago electrónico a un conductor (F19).
 *
 * Invoca accionEmitirPagoLiquidacion → emitirPagoLiquidacion → job Inngest.
 * El pago es asíncrono: la acción no espera confirmación del banco.
 *
 * Migrado a DialogConfirmacionDinero (antes usaba un modal artesanal propio
 * que permitía cerrar con click en el backdrop — inconsistente con las otras
 * 2 acciones financieras igual de irreversibles: factura y nota de crédito).
 * Mismo tratamiento de PREFLIGHT (hallazgo P0 de auditoría, jul 2026):
 * `accionPreflightEmitirPago` (100% lectura) verifica datos bancarios, monto
 * mínimo de retiro y advertencias de conciliación/incidencias ANTES de que
 * el usuario confirme. El resumen (monto bruto/retención/líquido) que se
 * muestra una vez listo viene del preflight, no de las props de la fila.
 *
 * Al confirmar: llama a accionEmitirPagoLiquidacion (gate
 * `gestionar_liquidaciones_conductores`). Si el preflight mismo falló (error
 * de lectura, no un bloqueo de negocio), exige un checkbox adicional de
 * "continúo bajo mi responsabilidad" y registra el override en bitácora
 * antes de emitir. Al confirmar con éxito, se recarga la lista con un
 * pequeño retraso para reflejar el estado 'pendiente' del payout (el job
 * Inngest crea esa fila después de que esta acción retorna).
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Banknote, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { DialogConfirmacionDinero } from "@/components/ui/dialog-confirmacion-dinero";
import { cn } from "@/lib/utils";
import { formatearCLP, formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import type { ItemPreflight, ResultadoPreflight } from "@/modules/dinero/preflight";
import {
  accionEmitirPagoLiquidacion,
  accionPreflightEmitirPago,
  accionRegistrarPreflightOmitido,
} from "./actions";

interface Props {
  liquidacionId: string;
  conductorNombre: string;
  fechaInicio: string;
  fechaFin: string;
  montoTotalClp: number | null;
}

type EstadoPreflight = "verificando" | "listo" | "error_preflight";

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

export function DialogEmitirPago({
  liquidacionId,
  conductorNombre,
  fechaInicio,
  fechaFin,
  montoTotalClp,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [estadoPreflight, setEstadoPreflight] = useState<EstadoPreflight>("verificando");
  const [preflight, setPreflight] = useState<ResultadoPreflight | null>(null);
  const [mensajeErrorPreflight, setMensajeErrorPreflight] = useState<string | null>(null);
  const [continuarSinVerificar, setContinuarSinVerificar] = useState(false);

  const cargarPreflight = useCallback(() => {
    setEstadoPreflight("verificando");
    setMensajeErrorPreflight(null);
    setContinuarSinVerificar(false);
    void (async () => {
      const resultado = await accionPreflightEmitirPago(liquidacionId);
      if (resultado.ok) {
        setPreflight(resultado.preflight);
        setEstadoPreflight("listo");
      } else {
        setPreflight(null);
        setMensajeErrorPreflight(resultado.mensaje);
        setEstadoPreflight("error_preflight");
      }
    })();
  }, [liquidacionId]);

  // Dispara el preflight cuando el diálogo pasa a abierto (no antes).
  useEffect(() => {
    // cargarPreflight solo actualiza estado dentro de su propio callback
    // async, no de forma síncrona en el render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (abierto) cargarPreflight();
  }, [abierto, cargarPreflight]);

  function handleConfirmar() {
    startTransition(async () => {
      if (estadoPreflight === "error_preflight") {
        try {
          await accionRegistrarPreflightOmitido("emitir_pago", liquidacionId);
        } catch (err) {
          toast.error("No se pudo registrar la verificación omitida", {
            description: err instanceof Error ? err.message : undefined,
          });
          return;
        }
      }
      const resultado = await accionEmitirPagoLiquidacion(liquidacionId);
      if (resultado.ok) {
        setAbierto(false);
        toast.success(`Pago iniciado a ${conductorNombre}`, {
          description: "Se procesará en los próximos minutos.",
        });
        // El job Inngest crea el registro de payout ('pendiente') después de
        // que esta acción retorna — un pequeño retraso deja tiempo a que la
        // tabla lo refleje al recargar (mismo comportamiento que antes).
        setTimeout(() => {
          router.refresh();
        }, 2000);
      } else {
        toast.error("No se pudo emitir el pago", { description: resultado.mensaje });
      }
    });
  }

  const resumenPago =
    preflight && preflight.resumen.tipoAccion === "emitir_pago" ? preflight.resumen : null;
  const itemLineasAnuladas = preflight?.informativos.find(
    (i) => i.codigo === "lineas_anuladas_excluidas",
  );

  const confirmDeshabilitado =
    estadoPreflight === "verificando" ||
    (estadoPreflight === "listo" && !(preflight?.ok ?? false)) ||
    (estadoPreflight === "error_preflight" && !continuarSinVerificar);

  return (
    <>
      <Button size="sm" onClick={() => setAbierto(true)}>
        <Banknote className="size-4" aria-hidden="true" />
        Emitir pago
      </Button>

      <DialogConfirmacionDinero
        open={abierto}
        onOpenChange={setAbierto}
        titulo={`Confirmar pago a ${conductorNombre}`}
        consecuencia={
          <>
            Se iniciará una <strong>transferencia electrónica real</strong> a la
            cuenta bancaria del conductor. El pago se procesará en los próximos
            minutos y <strong>no se puede deshacer</strong> desde aquí una vez iniciado.
          </>
        }
        cargando={isPending}
        textoConfirmar="Confirmar pago"
        requiereConfirmacionExplicita
        etiquetaConfirmacion="Revisé el monto y los datos bancarios. Entiendo que esto inicia una transferencia real."
        confirmDeshabilitado={confirmDeshabilitado}
        onConfirmar={handleConfirmar}
      >
        <div className="flex flex-col gap-3">
          {estadoPreflight === "verificando" && <SkeletonPreflight />}

          {estadoPreflight === "error_preflight" && (
            <BloquePreflightFallido
              mensaje={mensajeErrorPreflight}
              reintentar={cargarPreflight}
              deshabilitado={isPending}
              marcado={continuarSinVerificar}
              onMarcadoChange={setContinuarSinVerificar}
            />
          )}

          {estadoPreflight === "listo" && preflight && (
            <>
              {preflight.bloqueos.length > 0 && (
                <BandaItemsPreflight items={preflight.bloqueos} tono="bloquea" />
              )}
              {preflight.advertencias.length > 0 && (
                <BandaItemsPreflight items={preflight.advertencias} tono="advierte" />
              )}

              <dl className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Período</dt>
                  <dd className="font-medium">
                    {formatearFechaCorta(fechaInicio)} – {formatearFechaCorta(fechaFin)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Entregas liquidadas</dt>
                  <dd className="font-mono font-medium tabular-nums">
                    {resumenPago?.lineasIncluidas ?? "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Monto bruto</dt>
                  <dd className="font-mono tabular-nums">
                    {resumenPago
                      ? formatearCLP(resumenPago.montoBrutoClp)
                      : formatearCLPOGuion(montoTotalClp)}
                  </dd>
                </div>
                {resumenPago && resumenPago.montoRetencionClp > 0 && (
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Retención</dt>
                    <dd className="font-mono tabular-nums text-destructive">
                      −{formatearCLP(resumenPago.montoRetencionClp)}
                    </dd>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Monto líquido a pagar</dt>
                  <dd className="font-mono text-base font-semibold tabular-nums">
                    {resumenPago
                      ? formatearCLP(resumenPago.montoLiquidoClp)
                      : formatearCLPOGuion(montoTotalClp)}
                  </dd>
                </div>
              </dl>

              {itemLineasAnuladas && (
                <p className="text-xs text-muted-foreground">
                  {itemLineasAnuladas.titulo}
                  {itemLineasAnuladas.detalle ? ` ${itemLineasAnuladas.detalle}` : ""}
                </p>
              )}

              {!preflight.ok && (
                <p className="text-xs font-medium text-destructive">
                  Resuelve los bloqueos indicados arriba antes de continuar.
                </p>
              )}
            </>
          )}
        </div>
      </DialogConfirmacionDinero>
    </>
  );
}

// =============================================================================
// Sub-componentes del preflight — mismo estilo que los diálogos de factura y
// nota de crédito (diseño cerrado ux-ui, compartido en forma, no en código).
// =============================================================================

function SkeletonPreflight() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <span className="sr-only">Verificando antes de pagar…</span>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}

function BloquePreflightFallido({
  mensaje,
  reintentar,
  deshabilitado,
  marcado,
  onMarcadoChange,
}: {
  mensaje: string | null;
  reintentar: () => void;
  deshabilitado: boolean;
  marcado: boolean;
  onMarcadoChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No se pudo verificar automáticamente</p>
        {mensaje && <p className="mt-1 text-xs">{mensaje}</p>}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={reintentar}
          disabled={deshabilitado}
        >
          Reintentar
        </Button>
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm text-foreground">
        <Checkbox
          checked={marcado}
          onCheckedChange={(v) => onMarcadoChange(v === true)}
          disabled={deshabilitado}
          className="mt-0.5"
        />
        <span>El sistema no pudo verificar. Continúo igualmente bajo mi responsabilidad.</span>
      </label>
    </div>
  );
}

function BandaItemsPreflight({
  items,
  tono,
}: {
  items: ItemPreflight[];
  tono: "bloquea" | "advierte";
}) {
  const Icono = tono === "bloquea" ? XCircle : AlertTriangle;
  const lista = (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <li key={`${item.codigo}-${i}`} className="flex items-start gap-2">
          <Icono className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium">{item.titulo}</span>
            {item.detalle && <span className="block text-xs opacity-90">{item.detalle}</span>}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className={cn(
        "rounded-md p-3 text-sm",
        tono === "bloquea"
          ? "bg-destructive-subtle text-destructive-subtle-foreground"
          : "bg-warning-subtle text-warning-subtle-foreground",
      )}
    >
      {tono === "advierte" && items.length > 2 ? (
        <details>
          <summary className="cursor-pointer font-medium">
            {items.length} advertencias — ver detalle
          </summary>
          <div className="mt-2">{lista}</div>
        </details>
      ) : (
        lista
      )}
    </div>
  );
}
