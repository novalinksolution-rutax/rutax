"use client";

/**
 * Dialog de confirmación para EMITIR la factura (DTE) de un período cerrado.
 *
 * Es la compuerta de aprobación humana del motor entrega→dinero (B1-1): el
 * cierre del período NO factura; emitir el DTE es una acción deliberada,
 * porque un DTE es irreversible ante el SII sin nota de crédito.
 *
 * UX (UX-4 / §A2): previsualización del monto y las líneas + consecuencia
 * escrita + paso de confirmación explícito antes de habilitar el botón.
 *
 * El copy, el badge y el toast dependen del `modoDte` efectivo (sandbox vs.
 * real) para que una emisión simulada nunca parezca real (auditoría §3.7/QW7).
 *
 * PREFLIGHT (hallazgo P0 de auditoría, jul 2026): al abrir el diálogo se
 * dispara `accionPreflightEmitirFactura` (100% lectura) que verifica folios,
 * RUT del seller, opt-in real y advertencias de conciliación/incidencias
 * ANTES de que el usuario confirme. El resumen (líneas/monto/badge) que se
 * muestra una vez listo viene del preflight, no de las props del período —
 * evita mostrar dos fuentes de verdad distintas para el mismo monto.
 *
 * Al confirmar: llama a accionEmitirFactura (gate `emitir_facturas`). Si el
 * preflight mismo falló (error de lectura, no un bloqueo de negocio), exige
 * un checkbox adicional de "continúo bajo mi responsabilidad" y registra el
 * override en bitácora antes de emitir.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, FileText, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { DialogConfirmacionDinero } from "@/components/ui/dialog-confirmacion-dinero";
import { cn } from "@/lib/utils";
import { formatearCLP, formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import type { ModoDte } from "@/modules/dinero/modo-dte";
import type { ItemPreflight, ResultadoPreflight } from "@/modules/dinero/preflight";
import { BadgeModoDte } from "../../badge-modo-dte";
import {
  accionEmitirFactura,
  accionPreflightEmitirFactura,
  accionRegistrarPreflightOmitido,
} from "./actions";

interface Props {
  periodoId: string;
  sellerNombre: string;
  totalLineas: number;
  montoTotalClp: number | null;
  modoDte: ModoDte;
}

type EstadoPreflight = "verificando" | "listo" | "error_preflight";

export function DialogEmitirFactura({
  periodoId,
  sellerNombre,
  totalLineas,
  montoTotalClp,
  modoDte,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [isPending, startTransition] = useTransition();
  const esReal = modoDte === "real";

  const [estadoPreflight, setEstadoPreflight] = useState<EstadoPreflight>("verificando");
  const [preflight, setPreflight] = useState<ResultadoPreflight | null>(null);
  const [mensajeErrorPreflight, setMensajeErrorPreflight] = useState<string | null>(null);
  const [continuarSinVerificar, setContinuarSinVerificar] = useState(false);

  const cargarPreflight = useCallback(() => {
    setEstadoPreflight("verificando");
    setMensajeErrorPreflight(null);
    setContinuarSinVerificar(false);
    void (async () => {
      const resultado = await accionPreflightEmitirFactura(periodoId);
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

  // Dispara el preflight cuando el diálogo pasa a abierto (no antes, y no en
  // cada render) — el diálogo mismo se abre de inmediato al click.
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
          await accionRegistrarPreflightOmitido("emitir_factura", periodoId);
        } catch (err) {
          toast.error("No se pudo registrar la verificación omitida", {
            description: err instanceof Error ? err.message : undefined,
          });
          return;
        }
      }
      const resultado = await accionEmitirFactura(periodoId);
      if (resultado.ok) {
        setAbierto(false);
        toast.success(`Factura emitida para ${sellerNombre}`, {
          description: esReal
            ? "El DTE se emitió al SII. El seller ya puede descargarla."
            : "El DTE se generó en modo sandbox (no se envió al SII real). El seller ya puede descargarla.",
        });
        router.refresh();
      } else {
        toast.error("No se pudo emitir la factura", { description: resultado.mensaje });
      }
    });
  }

  const resumenCobro =
    preflight && preflight.resumen.tipoAccion === "emitir_factura" ? preflight.resumen : null;
  const itemLineasAnuladas = preflight?.informativos.find(
    (i) => i.codigo === "lineas_anuladas_excluidas",
  );

  const confirmDeshabilitado =
    estadoPreflight === "verificando" ||
    (estadoPreflight === "listo" && !(preflight?.ok ?? false)) ||
    (estadoPreflight === "error_preflight" && !continuarSinVerificar);

  return (
    <>
      <Button onClick={() => setAbierto(true)} size="sm">
        <FileText className="size-4" aria-hidden="true" />
        Emitir factura
      </Button>

      <DialogConfirmacionDinero
        open={abierto}
        onOpenChange={setAbierto}
        titulo={`Emitir factura de ${sellerNombre}`}
        consecuencia={
          esReal ? (
            <>
              Se emitirá un DTE (factura electrónica) al SII bajo el RUT de tu
              courier. Un documento emitido <strong>no se puede anular</strong>:
              corregirlo después exige una nota de crédito.
            </>
          ) : (
            <>
              Se generará la factura en <strong>modo sandbox</strong>: no se envía
              al SII. Es una simulación para probar el flujo; en producción este
              paso es irreversible.
            </>
          )
        }
        cargando={isPending}
        textoConfirmar="Emitir factura"
        requiereConfirmacionExplicita
        etiquetaConfirmacion={
          esReal
            ? "Revisé el monto y las líneas. Entiendo que el DTE es irreversible ante el SII."
            : "Revisé el monto y las líneas. (Modo sandbox: no se envía al SII.)"
        }
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
                  <dt className="text-muted-foreground">Líneas a facturar</dt>
                  <dd className="font-mono font-medium tabular-nums">
                    {resumenCobro?.lineasIncluidas ?? totalLineas}
                  </dd>
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
        </div>
      </DialogConfirmacionDinero>
    </>
  );
}

// =============================================================================
// Sub-componentes del preflight — compartidos en forma/estilo con los otros
// dos diálogos de acciones financieras irreversibles (diseño cerrado ux-ui).
// =============================================================================

function SkeletonPreflight() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <span className="sr-only">Verificando antes de emitir…</span>
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
