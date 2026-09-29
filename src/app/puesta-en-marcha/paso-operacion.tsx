"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Interruptor } from "@/components/ui/interruptor";
import { Label } from "@/components/ui/label";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import { guardarPasoOperacion } from "./actions";
import { formatearDuracion, validarHorario } from "./horario";
import { PieDePaso } from "./pie-de-paso";

/** Valores sugeridos: el despacho arranca a las 16:00 y el corte es 21:00–22:00. */
export const SALIDA_SUGERIDA = "16:00";
export const CORTE_SUGERIDO = "21:00";

const CLASE_TARJETA = "flex min-h-14 items-center justify-between gap-4 border border-line px-4 py-3";

export function PasoOperacion({
  inicial,
}: {
  inicial: { ofreceFlex: boolean; ofreceShopify: boolean; salida: string; corte: string } | null;
}) {
  const router = useRouter();
  const id = useId();
  const [flex, setFlex] = useState(inicial?.ofreceFlex ?? false);
  const [shopify, setShopify] = useState(inicial?.ofreceShopify ?? false);
  const [salida, setSalida] = useState(inicial?.salida ?? SALIDA_SUGERIDA);
  const [corte, setCorte] = useState(inicial?.corte ?? CORTE_SUGERIDO);
  const [errorHora, setErrorHora] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const horario = validarHorario(salida, corte);

  function continuar() {
    if (pendiente) return;
    setErrorGeneral(null);
    if (!horario.ok) {
      setErrorHora(horario.mensaje);
      return;
    }
    setErrorHora(null);
    iniciar(async () => {
      const r = await guardarPasoOperacion({
        ofreceFlex: flex,
        ofreceShopify: shopify,
        horaSalida: salida,
        horaCorte: corte,
      });
      if (!r.ok) {
        if (r.campo) setErrorHora(r.mensaje);
        else setErrorGeneral(r.mensaje);
        return;
      }
      router.push("/puesta-en-marcha?paso=4");
    });
  }

  return (
    <>
      <h1 className="font-heading text-2xl font-semibold">Tu operación</h1>

      <div className="mt-7 space-y-2">
        <div className={CLASE_TARJETA}>
          <span className="text-sm font-medium">Pedidos propios</span>
          <Check className="size-4 text-primary" role="img" aria-label="Incluido" />
        </div>
        <div className={CLASE_TARJETA}>
          <Interruptor
            className="w-full items-center"
            etiqueta={etiquetaFuentePedido("ml_flex")}
            checked={flex}
            onCheckedChange={setFlex}
            disabled={pendiente}
          />
        </div>
        <div className={CLASE_TARJETA}>
          <Interruptor
            className="w-full items-center"
            etiqueta={etiquetaFuentePedido("shopify")}
            checked={shopify}
            onCheckedChange={setShopify}
            disabled={pendiente}
          />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-salida`}>Salida a reparto</Label>
          <Input
            id={`${id}-salida`}
            type="time"
            step={900}
            value={salida}
            onChange={(e) => {
              setSalida(e.target.value);
              setErrorHora(null); // el error se recalcula al continuar; dejarlo con la hora ya corregida confunde
            }}
            className="tabular-nums pointer-coarse:h-12"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-corte`}>Corte</Label>
          <Input
            id={`${id}-corte`}
            type="time"
            step={900}
            value={corte}
            onChange={(e) => {
              setCorte(e.target.value);
              setErrorHora(null);
            }}
            aria-invalid={Boolean(errorHora)}
            aria-describedby={errorHora ? `${id}-hora-error` : undefined}
            className="tabular-nums pointer-coarse:h-12"
          />
        </div>
      </div>

      <div aria-live="polite" className="mt-2 min-h-5 text-sm">
        {errorHora ? (
          <p id={`${id}-hora-error`} role="alert" className="text-fault-fg">
            {errorHora}
          </p>
        ) : horario.ok ? (
          <p className="text-fg-muted tabular-nums">{formatearDuracion(horario.minutos)} de reparto</p>
        ) : null}
      </div>

      {errorGeneral ? (
        <p role="alert" className="mt-2 text-sm text-fault-fg">
          {errorGeneral}
        </p>
      ) : null}

      <PieDePaso volverAPaso={2} etiqueta="Continuar" cargando={pendiente} onClick={continuar} />
    </>
  );
}
