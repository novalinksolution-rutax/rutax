"use client";

/**
 * Crear o editar una tarifa — el primero de los siete del segundo nivel.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL MOTOR, EN DOS CAMPOS
 * -----------------------------------------------------------------------------
 * **Es el único formulario del producto donde alguien escribe las dos mitades
 * del motor entrega→dinero**: lo que se le cobra al seller y lo que se le paga
 * al conductor por la misma entrega. Por eso van juntos, en su propia caja
 * rotulada, y **con la resta a la vista mientras se teclea**.
 *
 * Ver la resta es lo que evita guardar una tarifa que pierde plata. Sin ella,
 * la equivocación se descubre en el cierre del período, cuando cada entrega
 * hecha bajo esa tarifa ya generó su línea de cobro y su línea de liquidación.
 *
 * Y si el margen sale negativo **avisa y deja guardar igual**: hay couriers que
 * subsidian a un seller grande a propósito, y bloquearlo sería que el software
 * decida un asunto comercial que no le toca.
 *
 * -----------------------------------------------------------------------------
 * LA CABECERA NOMBRA EL OBJETO, Y ESO REEMPLAZA A DOS CAMPOS
 * -----------------------------------------------------------------------------
 * «Vega Norte · Same-day · Norte · vigente desde 01-08». Al editar, el seller y
 * el tipo de entrega **no son editables** —cambiar cualquiera de los dos es otra
 * tarifa, no la misma con otro valor— así que en vez de dibujarlos como campos
 * apagados se dicen en la cabecera, que es donde uno mira para saber qué tiene
 * delante.
 *
 * -----------------------------------------------------------------------------
 * EL BOTÓN DICE DESDE CUÁNDO RIGE
 * -----------------------------------------------------------------------------
 * «Programar para el 01-09» cuando la fecha es futura, «Guardar» cuando rige ya.
 * Es la regla del bloque: todo lo que tiene fecha de vigencia dice desde cuándo
 * vale lo que se está guardando. Un «Guardar» a secas sobre una fecha futura
 * hace creer que el cambio empieza ahora — y con las tarifas eso es plata.
 *
 * -----------------------------------------------------------------------------
 * ES UN PANEL LATERAL, NO UN MODAL
 * -----------------------------------------------------------------------------
 * 430 px a la derecha, con la tabla a la vista. Editar una tarifa es casi
 * siempre compararla con las otras —«¿a este seller le cobro más o menos que al
 * de al lado?»— y un modal centrado tapa justo eso.
 */

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";

import { PanelAccion } from "@/components/ui/panel-accion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BloqueComposicion } from "@/components/ui/bloque-composicion";
import { etiquetaTipoEntrega } from "@/lib/ui/etiqueta-fuente-pedido";
import { fechaLocalEnSantiago, hoyEnSantiago } from "@/lib/fecha-santiago";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { accionCrearTarifa, accionEditarTarifa } from "./actions";
import { pagasMasDeLoQueCobras } from "./cajon-tarifa";

/** Sentinela visual para "tarifa por defecto del tenant" (seller_id = "" real). */
const SELLER_DEFECTO = "__defecto__";

interface TarifaExistente {
  id: string;
  sellerId: string | null;
  tipoEntrega: string;
  modoCalculo: string;
  zona: string | null;
  montoClp: number;
  /** Lo que el courier le paga al conductor por entrega. */
  montoConductorClp: number;
  vigenteDesdeFecha: string;
  vigenteHasta: string | null;
  minimoFacturacionClp: number | null;
  minimoRetiroClp: number | null;
  recargoReprogramacionClp: number | null;
}

interface Seller {
  id: string;
  nombre: string;
}

interface Props {
  sellers: Seller[];
  tarifa?: TarifaExistente;
  trigger?: React.ReactNode;
}

/** `2026-09-01` → `01-09`. Para el botón, donde el año sobra. */
function diaYMes(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}-${m}`;
}

export function PanelTarifa({ sellers, tarifa, trigger }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // seller_id se envía por un input hidden para conservar el contrato del
  // servidor ("" = tarifa por defecto del tenant); el Select solo es presentación.
  const [sellerId, setSellerId] = useState("");

  // Los dos montos son controlados —no `defaultValue`— porque la resta tiene que
  // correr MIENTRAS se escribe. Enterarse después de guardar es enterarse cuando
  // la tarifa ya cobra.
  const [cobras, setCobras] = useState(
    tarifa?.montoClp != null ? String(tarifa.montoClp) : "",
  );
  const [pagas, setPagas] = useState(
    tarifa?.montoConductorClp != null ? String(tarifa.montoConductorClp) : "",
  );
  // La fecha también es controlada: el botón dice desde cuándo rige.
  const [rigeDesde, setRigeDesde] = useState(
    tarifa?.vigenteDesdeFecha ?? fechaLocalEnSantiago(new Date()),
  );

  const esEdicion = !!tarifa;
  const nCobras = Number(cobras);
  const nPagas = Number(pagas);
  const hayMontos =
    Number.isFinite(nCobras) &&
    Number.isFinite(nPagas) &&
    cobras !== "" &&
    pagas !== "";
  const margenInvertido = pagasMasDeLoQueCobras(nCobras, nPagas);
  const esFutura = rigeDesde > hoyEnSantiago();

  const nombreSeller = tarifa?.sellerId
    ? (sellers.find((s) => s.id === tarifa.sellerId)?.nombre ?? "Seller")
    : "Todos los sellers";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const resultado = esEdicion
        ? await accionEditarTarifa(tarifa.id, formData)
        : await accionCrearTarifa(formData);

      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <PanelAccion
      abierto={open}
      onOpenChange={setOpen}
      disparador={trigger ?? <Button size="sm">Nueva tarifa</Button>}
      titulo={esEdicion ? "Editar tarifa" : "Nueva tarifa"}
      subtitulo={
        esEdicion ? (
          <span className="rx-num font-mono">
            {`${nombreSeller} · ${etiquetaTipoEntrega(tarifa.tipoEntrega)}${
              tarifa.zona ? ` · ${tarifa.zona}` : ""
            } · vigente desde ${diaYMes(tarifa.vigenteDesdeFecha)}`}
          </span>
        ) : (
          "Lo que le cobras al seller y lo que le pagas al conductor"
        )
      }
    >
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="space-y-4 px-4 py-4"
      >
        {/* Al editar, seller y tipo no se tocan: cambiar cualquiera de los dos
              es OTRA tarifa. Se dicen en la cabecera y no como campos apagados. */}
        {!esEdicion && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="seller_id">Seller</Label>
              <input type="hidden" name="seller_id" value={sellerId} />
              <Select
                value={sellerId || SELLER_DEFECTO}
                onValueChange={(v) =>
                  setSellerId(v === SELLER_DEFECTO ? "" : v)
                }
              >
                <SelectTrigger id="seller_id" className="h-9 w-full">
                  <SelectValue placeholder="Todos los sellers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SELLER_DEFECTO}>
                    Todos · por defecto
                  </SelectItem>
                  {sellers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo_entrega">Tipo de entrega</Label>
              <Select name="tipo_entrega" required defaultValue="flex">
                <SelectTrigger id="tipo_entrega" className="h-9 w-full">
                  <SelectValue placeholder="Elige el tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flex">Flex (Mercado Libre)</SelectItem>
                  <SelectItem value="same_day">Same-day propio</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="modo_calculo">Modo de cálculo</Label>
            <Select
              name="modo_calculo"
              required
              defaultValue={tarifa?.modoCalculo ?? "monto_fijo"}
            >
              <SelectTrigger id="modo_calculo" className="h-9 w-full">
                <SelectValue placeholder="Elige el modo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monto_fijo">Monto fijo</SelectItem>
                <SelectItem value="por_zona">Por zona</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zona">Zona (opcional)</Label>
            <Input
              id="zona"
              name="zona"
              placeholder="ej. norte, sur, RM"
              defaultValue={tarifa?.zona ?? ""}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="vigente_desde">Rige desde</Label>
            <Input
              id="vigente_desde"
              name="vigente_desde"
              type="date"
              required
              value={rigeDesde}
              onChange={(e) => setRigeDesde(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vigente_hasta">Rige hasta</Label>
            <Input
              id="vigente_hasta"
              name="vigente_hasta"
              type="date"
              defaultValue={tarifa?.vigenteHasta ?? ""}
            />
            <p className="text-xs text-fg-subtle">Vacío = sin término</p>
          </div>
        </div>

        {/* ───────────── EL MOTOR, EN DOS CAMPOS ───────────── */}
        <div className="border border-line bg-bg-inset p-3.5">
          <p className="font-mono text-[9px] leading-normal tracking-[0.12em] text-fg-muted uppercase">
            El motor, en dos campos
          </p>

          <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="monto_clp">Le cobras al seller</Label>
              <Input
                id="monto_clp"
                name="monto_clp"
                type="number"
                min={0}
                step={1}
                required
                inputMode="numeric"
                value={cobras}
                onChange={(e) => setCobras(e.target.value)}
                placeholder="2.500"
                className="rx-num text-right font-mono"
              />
            </div>
            {/*
                El campo que faltaba, y el que dejaba TODAS las liquidaciones en
                $0: `monto_conductor_clp` existe en la base desde el primer día
                con `default 0`, y ningún formulario la pedía. En los datos de
                demo venía sembrada, así que en local nunca se vio; en producción
                cada tarifa nacía en 0 y el motor generaba línea de liquidación
                por $0 sin quejarse de nada.
              */}
            <div className="space-y-1.5">
              <Label htmlFor="monto_conductor_clp">Le pagas al conductor</Label>
              <Input
                id="monto_conductor_clp"
                name="monto_conductor_clp"
                type="number"
                min={0}
                step={1}
                required
                inputMode="numeric"
                value={pagas}
                onChange={(e) => setPagas(e.target.value)}
                placeholder="1.200"
                className="rx-num text-right font-mono"
              />
            </div>
          </div>

          {/* La resta, a la vista. Solo con los dos campos escritos: una resta
                a medio teclear parpadea y deja de leerse. */}
          {hayMontos && (
            <BloqueComposicion
              className="mt-3 border-t border-line-subtle pt-2.5"
              sumandos={[
                { concepto: "cobras", monto: nCobras },
                { concepto: "pagas", monto: nPagas, resta: true },
              ]}
              total={{
                concepto: "de margen por entrega",
                monto: nCobras - nPagas,
              }}
            />
          )}

          <p className="mt-2.5 text-xs text-fg-subtle">
            Sin IVA — el 19 % se agrega al facturar. Al conductor se le paga por
            entrega efectiva.
          </p>
        </div>

        {/*
            ⚠️ **Avisa, no bloquea.** Pagarle al conductor más de lo que se le
            cobra al seller puede ser deliberado —hay couriers que subsidian a un
            seller grande a propósito— así que impedirlo sería decidir por el
            courier. Va en `attention` y no en `fault`: no hay nada roto, hay
            algo que conviene mirar.
          */}
        {margenInvertido && (
          <p className="border border-attention-line bg-attention-bg px-3 py-2 text-sm text-attention-fg">
            Le vas a pagar al conductor{" "}
            <span className="rx-num font-mono font-semibold">
              {formatearCLP(nPagas - nCobras)}
            </span>{" "}
            más de lo que le cobras al seller. Cada entrega con esta tarifa te
            deja esa diferencia en contra. Si es a propósito, sigue.
          </p>
        )}

        <div className="space-y-3 border border-line bg-bg-inset p-3.5">
          <p className="font-mono text-[9px] leading-normal tracking-[0.12em] text-fg-muted uppercase">
            Mínimos y recargos
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="minimo_facturacion_clp">Mínimo del período</Label>
              <Input
                id="minimo_facturacion_clp"
                name="minimo_facturacion_clp"
                type="number"
                min={0}
                step={1}
                defaultValue={tarifa?.minimoFacturacionClp ?? ""}
                placeholder="10.000"
                className="rx-num text-right font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="minimo_retiro_clp">Mínimo por línea</Label>
              <Input
                id="minimo_retiro_clp"
                name="minimo_retiro_clp"
                type="number"
                min={0}
                step={1}
                defaultValue={tarifa?.minimoRetiroClp ?? ""}
                placeholder="1.000"
                className="rx-num text-right font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recargo_reprogramacion_clp">
                Recargo si reagendan
              </Label>
              <Input
                id="recargo_reprogramacion_clp"
                name="recargo_reprogramacion_clp"
                type="number"
                min={0}
                step={1}
                defaultValue={tarifa?.recargoReprogramacionClp ?? ""}
                placeholder="500"
                className="rx-num text-right font-mono"
              />
            </div>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg"
          >
            {error}
          </p>
        )}

        {/* El guardado al pie, y el botón dice DESDE CUÁNDO rige. */}
        <div className="flex items-center gap-2 pt-1">
          <Button type="submit" disabled={isPending}>
            {isPending
              ? "Guardando…"
              : esFutura
                ? `Programar para el ${diaYMes(rigeDesde)}`
                : esEdicion
                  ? "Guardar"
                  : "Crear la tarifa"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => setOpen(false)}
          >
            Volver
          </Button>
        </div>
      </form>
    </PanelAccion>
  );
}
