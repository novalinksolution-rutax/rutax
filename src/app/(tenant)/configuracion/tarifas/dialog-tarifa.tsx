"use client";

/**
 * Dialog de creación y edición de tarifa (F14).
 * Cubre todos los campos del rate card: base, mínimos y recargo de reprogramación.
 */

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
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
import { accionCrearTarifa, accionEditarTarifa } from "./actions";
import { pagasMasDeLoQueCobras } from "./cajon-tarifa";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { formatearCLP } from "@/lib/ui/formato-moneda";

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

export function DialogTarifa({ sellers, tarifa, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  // seller_id se envía por un input hidden para conservar el contrato del
  // servidor ("" = tarifa por defecto del tenant); el Select solo es presentación.
  const [sellerId, setSellerId] = useState("");

  // Los dos montos son controlados —no `defaultValue`— porque el aviso de
  // margen invertido tiene que correr MIENTRAS se escribe. Enterarse después de
  // guardar es enterarse cuando la tarifa ya cobra.
  const [cobras, setCobras] = useState(
    tarifa?.montoClp != null ? String(tarifa.montoClp) : "",
  );
  const [pagas, setPagas] = useState(
    tarifa?.montoConductorClp != null ? String(tarifa.montoConductorClp) : "",
  );
  const margenInvertido = pagasMasDeLoQueCobras(Number(cobras), Number(pagas));

  const esEdicion = !!tarifa;

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm">Nueva tarifa</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{esEdicion ? "Editar tarifa" : "Nueva tarifa"}</DialogTitle>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
          {/* Seller y tipo */}
          <div className="grid gap-4 sm:grid-cols-2">
            {!esEdicion && (
              <div className="space-y-1.5">
                <Label htmlFor="seller_id">Seller</Label>
                <input type="hidden" name="seller_id" value={sellerId} />
                <Select
                  value={sellerId || SELLER_DEFECTO}
                  onValueChange={(v) => setSellerId(v === SELLER_DEFECTO ? "" : v)}
                >
                  <SelectTrigger id="seller_id" className="h-9 w-full">
                    <SelectValue placeholder="Tarifa por defecto del tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELLER_DEFECTO}>Tarifa por defecto del tenant</SelectItem>
                    {sellers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!esEdicion && (
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
            )}
          </div>

          {/* Cálculo y zona */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="modo_calculo">Modo de cálculo</Label>
              <Select name="modo_calculo" required defaultValue={tarifa?.modoCalculo ?? "monto_fijo"}>
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

          {/* Los dos montos: lo que entra y lo que sale */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="monto_clp">Le cobras al seller (CLP)</Label>
              <Input
                id="monto_clp"
                name="monto_clp"
                type="number"
                min={0}
                step={1}
                required
                value={cobras}
                onChange={(e) => setCobras(e.target.value)}
                placeholder="ej. 2500"
              />
              <p className="text-xs text-muted-foreground">Sin IVA — el 19% se agrega al facturar</p>
            </div>
            {/*
              El campo que faltaba, y el que dejaba TODAS las liquidaciones en
              $0: la columna `monto_conductor_clp` existe en la base desde el
              primer día con `default 0`, y ningún formulario la pedía. En los
              datos de demo venía sembrada con valor, así que en local nunca se
              vio; en producción cada tarifa nacía en 0 y el motor generaba
              línea de liquidación por $0 sin quejarse de nada.

              Va `required` a propósito, y pegado al cobro: los dos montos son
              las dos mitades del mismo trato y el margen se lee de un vistazo.
            */}
            <div className="space-y-1.5">
              <Label htmlFor="monto_conductor_clp">Le pagas al conductor (CLP)</Label>
              <Input
                id="monto_conductor_clp"
                name="monto_conductor_clp"
                type="number"
                min={0}
                step={1}
                required
                value={pagas}
                onChange={(e) => setPagas(e.target.value)}
                placeholder="ej. 1200"
              />
              <p className="text-xs text-muted-foreground">
                Por entrega efectiva — es lo que se acumula en su liquidación
              </p>
            </div>
          </div>

          {/*
            ⚠️ **El aviso de margen invertido: avisa, no bloquea.**
            Pagarle al conductor más de lo que se le cobra al seller puede ser
            deliberado —una promoción, un tramo que se subsidia para no perder
            al seller— así que impedirlo sería decidir por el courier. Pero es
            también la forma más cara de equivocarse de tecla en todo el
            producto: cada entrega hecha bajo esa tarifa genera su línea de
            cobro y su línea de liquidación, y la resta va en contra. Nadie lo
            nota hasta el cierre del período.

            Va en `attention` y no en `fault`: no hay nada roto, hay algo que
            conviene mirar. Y dice la diferencia con su número, porque «pagas
            más de lo que cobras» sin la cifra obliga a restar de cabeza.
          */}
          {margenInvertido && (
            <p className="border border-attention-line bg-attention-bg px-3 py-2 text-sm text-attention-fg">
              Le vas a pagar al conductor{" "}
              <span className="rx-num font-mono font-semibold">
                {formatearCLP(Number(pagas) - Number(cobras))}
              </span>{" "}
              más de lo que le cobras al seller. Cada entrega con esta tarifa te deja esa
              diferencia en contra. Si es a propósito, sigue.
            </p>
          )}

          {/* Vigencia */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vigente_desde">Vigente desde</Label>
              <Input
                id="vigente_desde"
                name="vigente_desde"
                type="date"
                required
                defaultValue={tarifa?.vigenteDesdeFecha ?? fechaLocalEnSantiago(new Date())}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vigente_hasta">Vigente hasta</Label>
              <Input
                id="vigente_hasta"
                name="vigente_hasta"
                type="date"
                defaultValue={tarifa?.vigenteHasta ?? ""}
              />
              <p className="text-xs text-muted-foreground">Opcional — vacío = sin vencimiento</p>
            </div>
          </div>

          {/* Mínimos y recargos */}
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Mínimos y recargos
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="minimo_facturacion_clp">Mínimo facturación (CLP)</Label>
                <Input
                  id="minimo_facturacion_clp"
                  name="minimo_facturacion_clp"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={tarifa?.minimoFacturacionClp ?? ""}
                  placeholder="ej. 10000"
                />
                <p className="text-xs text-muted-foreground">Total mínimo del período, IVA incluido</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minimo_retiro_clp">Mínimo por retiro (CLP)</Label>
                <Input
                  id="minimo_retiro_clp"
                  name="minimo_retiro_clp"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={tarifa?.minimoRetiroClp ?? ""}
                  placeholder="ej. 1000"
                />
                <p className="text-xs text-muted-foreground">Mínimo por línea individual, IVA incluido</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recargo_reprogramacion_clp">Recargo reprogramación (CLP)</Label>
                <Input
                  id="recargo_reprogramacion_clp"
                  name="recargo_reprogramacion_clp"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={tarifa?.recargoReprogramacionClp ?? ""}
                  placeholder="ej. 500"
                />
                <p className="text-xs text-muted-foreground">Cobro adicional si reagendan</p>
              </div>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isPending}>
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? esEdicion
                  ? "Guardando..."
                  : "Creando..."
                : esEdicion
                  ? "Guardar cambios"
                  : "Crear tarifa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
