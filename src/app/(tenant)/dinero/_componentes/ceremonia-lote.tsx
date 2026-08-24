"use client";

/**
 * La ceremonia de una acción financiera EN LOTE — facturas o pagos.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ ERA ANTES, Y POR QUÉ SE PARTIÓ EN DOS
 * -----------------------------------------------------------------------------
 * Esto vivía dentro de `AprobacionLote`, un **panel encima de la tabla con su
 * propio checklist**. O sea: la misma pantalla tenía dos listas del mismo dato
 * —la tabla, sin casillas, y el checklist del panel— y **la selección de una no
 * tenía nada que ver con la otra**. Se podía filtrar la tabla a un seller y
 * facturar, desde el panel de arriba, períodos de otro.
 *
 * La ceremonia estaba bien y no se toca: peldaño 3, el monto en el título,
 * frase a escribir («EMITIR 6»), preflight consolidado con los bloqueados y su
 * motivo, y comprobante por elemento. Lo que cambia es **de dónde viene la
 * selección**: ahora la traen las casillas de la tabla, vía `BarraSeleccion`.
 *
 * -----------------------------------------------------------------------------
 * EL PREFLIGHT CORRE AL ABRIR, NO AL SELECCIONAR
 * -----------------------------------------------------------------------------
 * Es una llamada al servidor por cada elemento. Correrlo mientras se marcan
 * casillas sería una consulta por clic; corre una vez, cuando el usuario dice
 * que va en serio.
 *
 * -----------------------------------------------------------------------------
 * EL REFRESCO VA AL CERRAR, Y ESO YA MORDIÓ UNA VEZ
 * -----------------------------------------------------------------------------
 * Refrescar al recibir el resultado se lleva el comprobante puesto: los
 * elementos recién aprobados dejan de ser elegibles, la lista se rearma y el
 * cuadro desaparece. Quien aprobó cinco pagos y vio fallar dos nunca se entera
 * de cuáles. Verificado en pantalla en su momento.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import type { ResultadoPreflightLote } from "@/modules/dinero/preflight-lote";
import type { ResultadoLote } from "@/modules/dinero/acciones-lote";
import { TarjetaResultadoBloque } from "@/components/ui/tarjeta-resultado-bloque";
import { ModalActoExplicito } from "@/components/ui/modal-acto-explicito";

export interface ItemLoteUI {
  id: string;
  etiqueta: string;
  sub?: string;
  montoClp: number;
}

type RespPreflight = { ok: true; resultado: ResultadoPreflightLote } | { ok: false; mensaje: string };
type RespEmitir = { ok: true; resultado: ResultadoLote } | { ok: false; mensaje: string };

interface Props {
  abierto: boolean;
  /** Se llama al cerrar. Si hubo emisión exitosa, `hubo` viene en `true`. */
  onCerrar: (hubo: boolean) => void;
  /** Los ids seleccionados en la tabla, en el orden en que se muestran. */
  ids: readonly string[];
  /** Metadatos de esos ids, para nombrarlos en la revisión y el comprobante. */
  items: readonly ItemLoteUI[];
  tipo: "factura" | "pago";
  accionPreflight: (ids: string[]) => Promise<RespPreflight>;
  accionEmitir: (ids: string[]) => Promise<RespEmitir>;
}

const TEXTOS = {
  factura: {
    nombreSingular: "factura",
    nombrePlural: "facturas",
    confirmarVerbo: "Emitir",
    /** Para la frase del peldaño 3: «EMITIR 6». */
    fraseVerbo: "EMITIR",
    /**
     * ⚠️ El monto del preflight de facturas es `totalClp` — **neto más IVA**,
     * calculado sobre las líneas reales. La tabla de la que viene la selección
     * muestra el NETO. Son dos cifras distintas para el mismo acto, y sin decir
     * cuál es cuál la ceremonia parece contradecir la barra de selección.
     * Regla 18: la cifra va rotulada.
     */
    rotuloMonto: "con IVA",
  },
  pago: {
    nombreSingular: "pago",
    nombrePlural: "pagos",
    confirmarVerbo: "Solicitar",
    fraseVerbo: "PAGAR",
    /** `montoLiquidoClp`: lo que llega a la cuenta, ya descontada la retención. */
    rotuloMonto: "líquidos",
  },
} as const;

export function CeremoniaLote({
  abierto,
  onCerrar,
  ids,
  items,
  tipo,
  accionPreflight,
  accionEmitir,
}: Props) {
  const router = useRouter();
  const t = TEXTOS[tipo];

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<ResultadoPreflightLote | null>(null);
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);

  const mapaItems = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // El preflight corre al ABRIR. Va en un efecto —no en el manejador del clic—
  // porque quien abre es el padre: la barra de selección solo cambia `abierto`,
  // y así no hay dos caminos para entrar a la ceremonia.
  const claveIds = ids.join("|");
  useEffect(() => {
    if (!abierto) return;
    let vigente = true;
    // Todo el estado se toca DENTRO de la transición y no en el cuerpo del
    // efecto: escribir estado sincrónicamente ahí encadena un render extra
    // —React lo desaconseja y la regla de lint del repo lo rechaza— y acá no
    // hace falta, porque igual hay que esperar la respuesta del servidor.
    startTransition(async () => {
      setError(null);
      setResultado(null);
      setPreflight(null);
      const r = await accionPreflight(claveIds ? claveIds.split("|") : []);
      if (!vigente) return;
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setPreflight(r.resultado);
    });
    return () => {
      vigente = false;
    };
    // `accionPreflight` es una Server Action estable; incluirla en las
    // dependencias volvería a correr el preflight en cada render del padre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, claveIds]);

  function confirmar() {
    if (!preflight) return;
    const idsEmitibles = preflight.items.filter((i) => i.emitible).map((i) => i.id);
    if (idsEmitibles.length === 0) return;
    setError(null);
    startTransition(async () => {
      const r = await accionEmitir(idsEmitibles);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setResultado(r.resultado);
      // Sin `router.refresh()` acá: se lleva el comprobante puesto. Va al cerrar.
    });
  }

  function cerrar() {
    const hubo = resultado !== null && resultado.exitosos > 0;
    setPreflight(null);
    setResultado(null);
    setError(null);
    onCerrar(hubo);
    if (hubo) router.refresh();
  }

  // ── Los textos de la ceremonia, del sistema de mensajes §2 ──────────────
  // `periodos.emitirLote.conf` y `liquidaciones.pagarLote.conf`. El molde del
  // título es «Vas a [acción] N cosas por $X»: **el monto va en el título**, no
  // escondido en el resumen — es la cifra que uno tiene que leer antes de
  // apretar. La frase a escribir es corta y en mayúsculas («EMITIR 6»,
  // «PAGAR 2») porque acá no hay una contraparte única que nombrar: son varias.
  const cuantos = preflight?.emitibles ?? 0;
  const montoLote = preflight?.totalMontoEmitibleClp ?? 0;
  const frase = cuantos > 0 ? `${t.fraseVerbo} ${cuantos}` : "";

  const tituloCeremonia =
    tipo === "factura"
      ? `Vas a emitir ${cuantos} ${cuantos === 1 ? "factura" : "facturas"} por ${formatearCLP(montoLote)} ${t.rotuloMonto}`
      : `Vas a hacer ${cuantos} ${cuantos === 1 ? "transferencia" : "transferencias"} por ${formatearCLP(montoLote)} ${t.rotuloMonto}`;

  const consecuenciaCeremonia =
    tipo === "factura" ? (
      <>
        {cuantos === 1 ? "Se emite" : "Se emiten"} al Servicio de Impuestos Internos y{" "}
        {cuantos === 1 ? "consume un folio" : `consumen ${cuantos} folios`}.{" "}
        <strong>Ninguna se puede deshacer.</strong>
      </>
    ) : (
      <>
        {cuantos === 1 ? "Sale" : "Salen"} de tu cuenta a{" "}
        {cuantos === 1 ? "la cuenta del conductor" : "las cuentas de los conductores"}.{" "}
        <strong>Ninguna se puede revertir desde acá</strong>: si te equivocas, hay que pedirlo
        de vuelta.
      </>
    );

  const tituloResultado = resultado
    ? resultado.exitosos === 0
      ? `No se pudo ${tipo === "factura" ? "emitir" : "pagar"} nada`
      : `${resultado.exitosos} ${
          resultado.exitosos === 1 ? t.nombreSingular : t.nombrePlural
        } ${resultado.exitosos === 1 ? "quedó" : "quedaron"} en curso`
    : "";

  // El monto de lo que SÍ salió. Se calcula sobre los ids exitosos y no sobre
  // el total de la revisión: si dos de cinco fallaron, el total de la revisión
  // ya no corresponde a lo que ocurrió.
  const composicionResultado = resultado
    ? [
        formatearCLP(
          resultado.resultados
            .filter((r) => r.ok)
            .reduce((suma, r) => suma + (mapaItems.get(r.id)?.montoClp ?? 0), 0),
        ) + ` en total, ${t.rotuloMonto}`,
        `${new Set(resultado.resultados.filter((r) => r.ok).map((r) => r.id)).size} de ${
          resultado.resultados.length
        } ${tipo === "factura" ? "períodos" : "liquidaciones"}`,
      ]
    : [];

  return (
    <ModalActoExplicito
      open={abierto}
      onOpenChange={(v) => {
        if (!v) cerrar();
      }}
      peldano={3}
      titulo={tituloCeremonia}
      consecuencia={consecuenciaCeremonia}
      confirmacion={frase ? { frase } : undefined}
      comprobante={
        resultado
          ? {
              tono: resultado.fallidos > 0 ? "attention" : "progress",
              titulo: tituloResultado,
              cuerpo: (
                <TarjetaResultadoBloque
                  sinMarco
                  composicion={composicionResultado}
                  exitosos={resultado.exitosos}
                  fallos={resultado.resultados
                    .filter((r) => !r.ok)
                    .map((r) => ({
                      etiqueta: mapaItems.get(r.id)?.etiqueta ?? r.id,
                      motivo: r.mensaje,
                    }))}
                />
              ),
            }
          : null
      }
      avisos={error ? [{ tono: "fault", texto: error }] : []}
      cargando={isPending}
      textoConfirmar={`${t.confirmarVerbo} ${preflight?.emitibles ?? 0} ${
        (preflight?.emitibles ?? 0) === 1 ? t.nombreSingular : t.nombrePlural
      }`}
      subtextoConfirmar={
        preflight
          ? `${formatearCLP(preflight.totalMontoEmitibleClp)} ${t.rotuloMonto}`
          : undefined
      }
      confirmDeshabilitado={!preflight || preflight.emitibles === 0}
      onConfirmar={confirmar}
    >
      {preflight ? (
        /* Fase REVISIÓN (resumen consolidado) */
        <div className="space-y-3">
          <div className="border border-line bg-bg-sunken px-3 py-2 text-sm">
            <span className="font-semibold">{preflight.emitibles}</span> de {preflight.totalItems} se{" "}
            {tipo === "factura" ? "emitirán" : "pagarán"}
            {preflight.bloqueados > 0 && (
              <span className="text-fg-muted">
                {" "}
                ({preflight.bloqueados} bloqueado{preflight.bloqueados !== 1 ? "s" : ""})
              </span>
            )}
            {" · "}
            Total {t.rotuloMonto}:{" "}
            <span className="rx-num font-semibold">
              {formatearCLP(preflight.totalMontoEmitibleClp)}
            </span>
          </div>
          <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
            {preflight.items.map((it) => {
              const meta = mapaItems.get(it.id);
              const motivoBloqueo = it.error ?? it.preflight?.bloqueos[0]?.titulo ?? null;
              const advertencias = it.preflight?.advertencias.length ?? 0;
              return (
                <li key={it.id} className="flex items-start gap-2 px-2 py-1">
                  {it.emitible ? (
                    <CheckCircle2
                      className="mt-0.5 size-4 shrink-0 text-balanced-fg"
                      aria-hidden="true"
                    />
                  ) : (
                    <AlertTriangle
                      className="mt-0.5 size-4 shrink-0 text-fault-fg"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="truncate">{meta?.etiqueta ?? it.id}</span>
                    {it.emitible && advertencias > 0 && (
                      <span className="block text-xs text-attention-fg">
                        {advertencias} advertencia{advertencias !== 1 ? "s" : ""} — revisa antes de
                        confirmar
                      </span>
                    )}
                    {!it.emitible && motivoBloqueo && (
                      <span className="block text-xs text-fault-fg">{motivoBloqueo}</span>
                    )}
                  </span>
                  {it.emitible && (
                    <span className="rx-num text-fg-muted">{formatearCLP(it.montoClp)}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {preflight.emitibles === 0 && (
            <p className="text-sm text-fault-fg">
              Ningún elemento cumple las condiciones para{" "}
              {tipo === "factura" ? "facturar" : "pagar"}.
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center py-8 text-fg-muted">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </div>
      )}
    </ModalActoExplicito>
  );
}
