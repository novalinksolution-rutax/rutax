"use client";

/**
 * Configuración → Tarifas → Períodos. Elegir cada cuánto se cierra la cuenta.
 * =============================================================================
 *
 * Es el `formulario de configuración` de B3b con una elección entre tres, no un
 * campo libre: guardado explícito, un botón, acuse de recibo. La mecánica vive
 * en `SeccionConfiguracion`.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ RADIOS Y NO UN DESPLEGABLE
 * -----------------------------------------------------------------------------
 * Son tres opciones y cada una necesita una línea que explique dónde cae el
 * corte. En un `<select>` esa línea no cabe: habría que elegir a ciegas y
 * comprobar después, sobre una decisión que reparte las líneas de cobro de todo
 * el mes. Con radios las tres reglas están a la vista al mismo tiempo, que es lo
 * que permite compararlas.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL RANGO CONCRETO LO CALCULA EL SERVIDOR, NO ESTE ARCHIVO
 * -----------------------------------------------------------------------------
 * Debajo de cada regla va el rango REAL en que caería una entrega de hoy, y sale
 * de `calcularRangoPeriodo` — la misma función que usa el motor al crear el
 * período. Llega ya calculado en `rangoDeHoy`. Recalcularlo acá sería una
 * segunda implementación de la regla, y la que la persona lee sería la que NO
 * manda.
 *
 * ⚠️ El acuse dice la consecuencia, no el trámite: «tus períodos ahora cierran
 * el 15 y el último día del mes» es lo que la persona vino a conseguir. Y en el
 * caso de reafirmar lo que ya estaba lo dice tal cual, en vez de fingir que
 * guardó algo.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { TipoPeriodoFacturacion } from "@/modules/dinero/tipos";

import {
  SeccionConfiguracion,
  type ResultadoGuardado,
} from "../_componentes/seccion-configuracion";
import { accionFijarPeriodicidad } from "./acciones-periodicidad";
import { OPCIONES_PERIODICIDAD, etiquetaPeriodicidad } from "./periodicidad";

interface Props {
  /** La periodicidad efectiva hoy: la elegida, o el respaldo del motor. */
  actual: TipoPeriodoFacturacion;
  /** `false` = nadie la eligió nunca; el motor está usando su respaldo. */
  explicita: boolean;
  /** Por opción, el rango en que caería una entrega de hoy. Ya formateado. */
  rangoDeHoy: Record<TipoPeriodoFacturacion, string>;
  /** Períodos abiertos con líneas. > 0 deshabilita el guardado. */
  periodosBloqueantes: number;
}

export function FormularioPeriodicidad({
  actual,
  explicita,
  rangoDeHoy,
  periodosBloqueantes,
}: Props) {
  const router = useRouter();
  const [elegida, setElegida] = useState<TipoPeriodoFacturacion>(actual);
  const bloqueado = periodosBloqueantes > 0;

  async function guardar(datos: FormData): Promise<ResultadoGuardado> {
    const resultado = await accionFijarPeriodicidad(datos);
    if (!resultado.ok) return { ok: false, mensaje: resultado.mensaje };

    router.refresh();

    if (!resultado.aplicado) {
      return {
        ok: true,
        acuse: `Ya estaba en ${etiquetaPeriodicidad(resultado.tipoNuevo as TipoPeriodoFacturacion)} — no había nada que cambiar.`,
      };
    }

    const nueva = resultado.tipoNuevo as TipoPeriodoFacturacion;
    return {
      ok: true,
      acuse:
        `Desde ahora tus períodos de cobro y las liquidaciones de tus conductores ` +
        `cierran en modo ${etiquetaPeriodicidad(nueva).toLowerCase()}. ` +
        `Una entrega de hoy cae en ${rangoDeHoy[nueva]}.`,
    };
  }

  return (
    <SeccionConfiguracion onGuardar={guardar} etiquetaAccion="Guardar periodicidad">
      <fieldset className="space-y-2" disabled={bloqueado}>
        <legend className="sr-only">Periodicidad de facturación</legend>

        {OPCIONES_PERIODICIDAD.map((opcion) => {
          const puesta = elegida === opcion.valor;
          const esVigente = actual === opcion.valor;

          return (
            <Label
              key={opcion.valor}
              htmlFor={`periodicidad-${opcion.valor}`}
              className={cn(
                "flex cursor-pointer items-start gap-3 border px-4 py-3 transition-colors",
                // 44 px con el dedo: esta pantalla también se abre en tablet.
                "pointer-coarse:py-4",
                puesta
                  ? "border-brand bg-bg-sunken"
                  : "border-line hover:border-fg-subtle",
                bloqueado && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                id={`periodicidad-${opcion.valor}`}
                name="tipo_periodo"
                value={opcion.valor}
                checked={puesta}
                onChange={() => setElegida(opcion.valor)}
                className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
              />
              <span className="space-y-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-fg">{opcion.etiqueta}</span>
                  {esVigente && (
                    <span className="border border-line px-1.5 py-0.5 text-[11px] text-fg-muted">
                      {explicita ? "vigente" : "en uso, sin elegir"}
                    </span>
                  )}
                </span>
                <span className="block text-sm text-fg-muted">{opcion.regla}</span>
                {/* El dato que convierte la regla en algo comprobable: dónde
                    caería lo que se entregue HOY. */}
                <span className="rx-num block text-xs text-fg-subtle">
                  Una entrega de hoy cae en {rangoDeHoy[opcion.valor]}
                </span>
              </span>
            </Label>
          );
        })}
      </fieldset>
    </SeccionConfiguracion>
  );
}
