"use client";

/**
 * Retención de boleta de terceros — el porcentaje que se le descuenta al
 * conductor independiente en su liquidación.
 * =============================================================================
 *
 * 🔴 POR QUÉ ESTE FORMULARIO EXISTE
 * -----------------------------------------------------------------------------
 * `courier_config_payout.porcentaje_retencion` la lee `calculo-payout.ts` para
 * descontársela al conductor independiente, y **la tabla no tenía un solo
 * escritor en todo el repositorio**: todas sus demás apariciones son `select`.
 * O sea que el valor efectivo era su `default 0` y **a todos los conductores
 * independientes se les retenía 0%**, sin que nada fallara ni se viera. Es el
 * mismo patrón que la periodicidad de facturación y que
 * `tarifas.monto_conductor_clp`, pero acá lo que queda mal no es una cifra
 * interna: es una obligación tributaria.
 *
 * ⚠️ **El campo nace vacío y no trae una tasa sugerida** (decisión del usuario).
 * El porcentaje lo fija el SII y cambia por año: precargarlo dejaría a Rutax
 * afirmando una cifra tributaria que puede quedar desactualizada sin que nadie
 * lo note, sobre un dato que el contador del courier sí conoce.
 *
 * ⚠️ Y **el cero hay que escribirlo**. Un courier con solo conductores
 * dependientes no retiene nada, y ése es un valor legítimo — pero tiene que
 * quedar como decisión guardada y no como el default que nadie tocó, que es
 * justo lo que no se podía distinguir hasta ahora.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  SeccionConfiguracion,
  type ResultadoGuardado,
} from "@/app/(tenant)/configuracion/_componentes/seccion-configuracion";
import { accionGuardarRetencion } from "../acciones-datos-courier";

export function FormularioRetencion({ porcentajeActual }: { porcentajeActual: number | null }) {
  async function guardar(datos: FormData): Promise<ResultadoGuardado> {
    const resultado = await accionGuardarRetencion(datos);
    if (!resultado.ok) return { ok: false, mensaje: resultado.mensaje };
    return { ok: true, acuse: resultado.acuse };
  }

  return (
    <SeccionConfiguracion
      titulo="Cuánto le retienes a un conductor independiente"
      descripcion="Se descuenta de su liquidación cuando emite boleta de honorarios. A los conductores dependientes no se les aplica nunca."
      etiquetaAccion="Guardar la retención"
      onGuardar={guardar}
    >
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="retencion-porcentaje">Porcentaje de retención</Label>
        <div className="flex items-center gap-2">
          <Input
            id="retencion-porcentaje"
            name="porcentaje_retencion"
            required
            inputMode="decimal"
            defaultValue={porcentajeActual ?? ""}
            placeholder="Ej: 14,5"
            className="rx-num"
          />
          <span aria-hidden="true" className="text-sm text-fg-muted">
            %
          </span>
        </div>
        <p className="text-xs text-fg-muted">
          Es el porcentaje vigente del SII para honorarios; te lo confirma tu contador. Si todos
          tus conductores son dependientes, escribe 0.
        </p>
      </div>
    </SeccionConfiguracion>
  );
}
