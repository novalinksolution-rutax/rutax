"use client";

/**
 * Dialog de confirmación para EMITIR una NOTA DE CRÉDITO (DTE 61) que anula
 * TOTALMENTE la factura de un período facturado (RF-038, decisión B7).
 *
 * Compuerta humana espejo de la de emisión: la NC es un documento tributario
 * irreversible, así que exige un motivo obligatorio (queda en la auditoría y
 * en la propia NC) y advierte los efectos antes de confirmar. El motivo vacío
 * mantiene deshabilitado el botón final (confirmDeshabilitado).
 *
 * PREFLIGHT (hallazgo P0 de auditoría, jul 2026): al abrir el diálogo se
 * dispara `accionPreflightEmitirNotaCredito` (100% lectura) que verifica que
 * exista una factura anulable, folios de NC, RUT del seller y advertencias de
 * conciliación/incidencias. El resumen (monto) que se muestra una vez listo
 * viene del preflight, no de las props del período.
 *
 * Al confirmar: llama a accionEmitirNotaCredito (gate `emitir_facturas`). Si
 * el preflight mismo falló (error de lectura, no un bloqueo de negocio),
 * exige un checkbox adicional de "continúo bajo mi responsabilidad" y
 * registra el override en bitácora antes de emitir.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, FileX2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DialogConfirmacionDinero } from "@/components/ui/dialog-confirmacion-dinero";
import { cn } from "@/lib/utils";
import { formatearCLP, formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import type { ModoDte } from "@/modules/dinero/modo-dte";
import type { ItemPreflight, ResultadoPreflight } from "@/modules/dinero/preflight";
import { BadgeModoDte } from "../../badge-modo-dte";
import {
  accionEmitirNotaCredito,
  accionPreflightEmitirNotaCredito,
  accionRegistrarPreflightOmitido,
} from "./actions";

interface Props {
  periodoId: string;
  sellerNombre: string;
  /** Folio de la factura (DTE 33) que se va a anular. */
  folioFactura: number;
  /** Monto total de la factura a anular (el de la NC es el mismo, copiado). */
  montoTotalClp: number | null;
  /** Pagos ya imputados al período — si > 0 se advierte la desimputación. */
  montoPagadoClp: number;
  /** Modo de emisión efectivo (sandbox vs. real) — para el badge del diálogo. */
  modoDte: ModoDte;
}

type EstadoPreflight = "verificando" | "listo" | "error_preflight";

export function DialogEmitirNotaCredito({
  periodoId,
  sellerNombre,
  folioFactura,
  montoTotalClp,
  montoPagadoClp,
  modoDte,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [isPending, startTransition] = useTransition();

  const [estadoPreflight, setEstadoPreflight] = useState<EstadoPreflight>("verificando");
  const [preflight, setPreflight] = useState<ResultadoPreflight | null>(null);
  const [mensajeErrorPreflight, setMensajeErrorPreflight] = useState<string | null>(null);
  const [continuarSinVerificar, setContinuarSinVerificar] = useState(false);

  const motivoValido = motivo.trim().length > 0;

  const cargarPreflight = useCallback(() => {
    setEstadoPreflight("verificando");
    setMensajeErrorPreflight(null);
    setContinuarSinVerificar(false);
    void (async () => {
      const resultado = await accionPreflightEmitirNotaCredito(periodoId);
      if (resultado.ok) {
        setPreflight(resultado.preflight);
        setEstadoPreflight("listo");
      } else {
        setPreflight(null);
        setMensajeErrorPreflight(resultado.mensaje);
        setEstadoPreflight("error_preflight");
      }
    })();
  }, [periodoId]);

  // Dispara el preflight cuando el diálogo pasa a abierto (no antes).
  useEffect(() => {
    // cargarPreflight solo actualiza estado dentro de su propio callback
    // async, no de forma síncrona en el render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (abierto) cargarPreflight();
  }, [abierto, cargarPreflight]);

  function manejarApertura(open: boolean) {
    setAbierto(open);
    if (!open) setMotivo("");
  }

  function handleConfirmar() {
    if (!motivoValido) return;
    startTransition(async () => {
      if (estadoPreflight === "error_preflight") {
        try {
          await accionRegistrarPreflightOmitido("emitir_nota_credito", periodoId);
        } catch (err) {
          toast.error("No se pudo registrar la verificación omitida", {
            description: err instanceof Error ? err.message : undefined,
          });
          return;
        }
      }
      const resultado = await accionEmitirNotaCredito(periodoId, motivo.trim());
      if (resultado.ok) {
        manejarApertura(false);
        toast.success("Nota de crédito en emisión", {
          description: `La factura folio ${folioFactura} de ${sellerNombre} se anulará en unos segundos.`,
        });
        router.refresh();
      } else {
        toast.error("No se pudo emitir la nota de crédito", {
          description: resultado.mensaje,
        });
      }
    });
  }

  const resumenCobro =
    preflight && preflight.resumen.tipoAccion === "emitir_nota_credito" ? preflight.resumen : null;
  const itemLineasAnuladas = preflight?.informativos.find(
    (i) => i.codigo === "lineas_anuladas_excluidas",
  );

  const confirmDeshabilitado =
    !motivoValido ||
    estadoPreflight === "verificando" ||
    (estadoPreflight === "listo" && !(preflight?.ok ?? false)) ||
    (estadoPreflight === "error_preflight" && !continuarSinVerificar);

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setAbierto(true)}>
        <FileX2 className="size-4" aria-hidden="true" />
        Emitir nota de crédito
      </Button>

      <DialogConfirmacionDinero
        open={abierto}
        onOpenChange={manejarApertura}
        variante="destructive"
        titulo={`Anular factura de ${sellerNombre}`}
        consecuencia={
          <>
            Se emitirá una nota de crédito (documento tributario) que anula
            completamente la factura. <strong>No se puede deshacer</strong>: todos los
            montos del período se revertirán como si nunca se hubiera facturado.
          </>
        }
        cargando={isPending}
        textoConfirmar="Anular factura"
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

              <BadgeModoDte modo={resumenCobro?.modoDte ?? modoDte} />
              <dl className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Factura a anular</dt>
                  <dd className="font-mono font-medium tabular-nums">Folio {folioFactura}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Monto total</dt>
                  <dd className="font-mono text-base font-semibold tabular-nums">
                    {resumenCobro
                      ? formatearCLP(resumenCobro.totalClp)
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nc-motivo">
              Motivo de la anulación <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="nc-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={isPending}
              required
              rows={3}
              placeholder="Ej.: monto incorrecto, entregas mal imputadas, factura emitida por error…"
            />
            <p className="text-xs text-muted-foreground">
              Queda registrado en la auditoría y en la nota de crédito.
            </p>
          </div>

          {montoPagadoClp > 0 ? (
            <p className="rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-foreground">
              Hay <strong className="tabular-nums">{formatearCLP(montoPagadoClp)}</strong> ya
              pagados imputados a este período: volverán a la bandeja de revisión de
              pagos para reimputarse.
            </p>
          ) : null}
        </div>
      </DialogConfirmacionDinero>
    </>
  );
}

// =============================================================================
// Sub-componentes del preflight — mismo estilo que dialog-emitir-factura.tsx
// (diseño cerrado ux-ui, compartido en forma entre los diálogos de dinero).
// =============================================================================

function SkeletonPreflight() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <span className="sr-only">Verificando antes de anular…</span>
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
