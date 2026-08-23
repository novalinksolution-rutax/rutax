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
import { ModalActoExplicito } from "@/components/ui/modal-acto-explicito";
import { formatearFechaHora } from "@/lib/formato-cl";
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
  /** Quién firma. Va dentro del modal, antes de actuar. */
  autorNombre: string;
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
  autorNombre,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [estadoPreflight, setEstadoPreflight] = useState<EstadoPreflight>("verificando");
  const [preflight, setPreflight] = useState<ResultadoPreflight | null>(null);
  const [mensajeErrorPreflight, setMensajeErrorPreflight] = useState<string | null>(null);
  const [continuarSinVerificar, setContinuarSinVerificar] = useState(false);
  const [errorPago, setErrorPago] = useState<string | null>(null);

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
    setErrorPago(null);
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
        // La transferencia es asíncrona: acá solo se encoló. Regla 57, además:
        // todo éxito de dinero lleva monto y contraparte.
        toast.success(
          `La transferencia a ${conductorNombre} quedó en curso · ${formatearCLPOGuion(montoAPagar)}`,
          { description: "Te avisamos cuando el banco responda." },
        );
        // El job Inngest crea el registro de payout ('pendiente') después de
        // que esta acción retorna — un pequeño retraso deja tiempo a que la
        // tabla lo refleje al recargar (mismo comportamiento que antes).
        setTimeout(() => {
          router.refresh();
        }, 2000);
      } else {
        // Regla 56: ningún error de dinero va en notificación temporal. Y acá
        // menos que en ninguna parte: la pregunta que deja —¿salió la plata o
        // no?— tiene que poder leerse después de parpadear.
        setErrorPago(resultado.mensaje ?? "No pudimos emitir el pago.");
      }
    });
  }

  const resumenPago =
    preflight && preflight.resumen.tipoAccion === "emitir_pago" ? preflight.resumen : null;
  const itemLineasAnuladas = preflight?.informativos.find(
    (i) => i.codigo === "lineas_anuladas_excluidas",
  );

  // El monto que de verdad sale: el líquido del preflight cuando ya verificó, y
  // el total de la fila mientras tanto.
  const montoAPagar = resumenPago?.montoLiquidoClp ?? montoTotalClp;

  const avisosModal: { tono: "attention" | "fault"; texto: React.ReactNode }[] = [];
  if (errorPago) {
    avisosModal.push({
      tono: "fault",
      texto: (
        <>
          <strong>No pudimos emitir el pago.</strong> {errorPago} No salió plata; puedes
          volver a intentarlo.
        </>
      ),
    });
  }
  if (estadoPreflight === "listo" && preflight && !preflight.ok) {
    avisosModal.push({
      tono: "fault",
      texto: "Resuelve los bloqueos indicados arriba antes de continuar.",
    });
  }
  if (estadoPreflight === "error_preflight" && continuarSinVerificar) {
    avisosModal.push({
      tono: "attention",
      texto: "Omitiste la verificación previa. Queda registrado a tu nombre que la saltaste.",
    });
  }

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

      <ModalActoExplicito
        open={abierto}
        onOpenChange={setAbierto}
        // Peldaño 3. Es la única acción del producto que saca plata del banco y
        // no vuelve: «si te equivocas, hay que pedírselo de vuelta».
        peldano={3}
        titulo={`Vas a transferirle ${formatearCLPOGuion(montoAPagar)} a ${conductorNombre}`}
        consecuencia={
          <>
            Sale de tu cuenta y <strong>no se puede revertir desde acá</strong>: si te
            equivocas, hay que pedírselo de vuelta.
          </>
        }
        resumen={[
          {
            etiqueta: "Período",
            valor: `${formatearFechaCorta(fechaInicio)} – ${formatearFechaCorta(fechaFin)}`,
            mono: true,
          },
          {
            etiqueta: "Entregas liquidadas",
            valor: resumenPago?.lineasIncluidas ?? "—",
            mono: true,
          },
          ...(resumenPago && resumenPago.montoRetencionClp > 0
            ? [
                {
                  etiqueta: "Monto bruto",
                  valor: formatearCLP(resumenPago.montoBrutoClp),
                  mono: true,
                },
                {
                  etiqueta: "Retención",
                  valor: `− ${formatearCLP(resumenPago.montoRetencionClp)}`,
                  mono: true,
                },
              ]
            : []),
        ]}
        total={
          montoAPagar !== null
            ? { etiqueta: "Monto líquido a pagar", monto: montoAPagar }
            : undefined
        }
        // La frase es el MONTO sin formato. Obliga a leer la cifra, que es el
        // error real: no transferir sin querer, sino transferir otra cantidad.
        confirmacion={
          montoAPagar !== null
            ? {
                frase: String(montoAPagar),
                rotulo: (
                  <>
                    Escribe <strong className="text-fg">{montoAPagar}</strong> para confirmar
                  </>
                ),
              }
            : undefined
        }
        autor={{ nombre: autorNombre, cuando: formatearFechaHora(new Date()) }}
        avisos={avisosModal}
        cargando={isPending}
        confirmDeshabilitado={confirmDeshabilitado}
        textoConfirmar={`Transferir ${formatearCLPOGuion(montoAPagar)}`}
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
              {itemLineasAnuladas && (
                <p className="text-xs text-muted-foreground">
                  {itemLineasAnuladas.titulo}
                  {itemLineasAnuladas.detalle ? ` ${itemLineasAnuladas.detalle}` : ""}
                </p>
              )}
            </>
          )}
        </div>
      </ModalActoExplicito>
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
