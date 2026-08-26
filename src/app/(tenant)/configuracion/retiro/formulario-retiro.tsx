"use client";

/**
 * Configuración → Retiro. Un solo campo, y el molde de la sección.
 * =============================================================================
 *
 * Es el `formulario de configuración` de B3b en su forma más simple: una
 * sección, guardado explícito, acuse de recibo. Toda la mecánica —el botón, el
 * acuse, el borrado del acuse al volver a escribir, el error— vive en
 * `SeccionConfiguracion`; acá solo va el campo y **qué decir cuando se
 * guardó**.
 *
 * ⚠️ El acuse dice la CONSECUENCIA y no el trámite. «Guardado» informa de la
 * mecánica; «desde ahora cada visita a bodega liquida $4.500 al conductor»
 * informa del efecto, que es lo que la persona vino a conseguir y lo único que
 * le permite darse cuenta de que se equivocó de tecla.
 */

import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import {
  SeccionConfiguracion,
  type ResultadoGuardado,
} from "../_componentes/seccion-configuracion";
import { accionGuardarConfigRetiro } from "./actions";

interface Props {
  /** `null` = sin fila en `courier_config_retiro` ("sin configurar", nunca cero). */
  montoActual: number | null;
}

export function FormularioRetiro({ montoActual }: Props) {
  const router = useRouter();

  async function guardar(datos: FormData): Promise<ResultadoGuardado> {
    const monto = Number(datos.get("monto_visita_bodega_clp"));
    const resultado = await accionGuardarConfigRetiro(datos);
    if (!resultado.ok) return { ok: false, mensaje: resultado.mensaje };
    router.refresh();
    return {
      ok: true,
      acuse: `Desde ahora cada visita a bodega liquida ${formatearCLP(monto)} al conductor.`,
    };
  }

  return (
    <SeccionConfiguracion onGuardar={guardar}>
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="monto_visita_bodega_clp">
          Le pagas al conductor por visita a bodega (CLP)
        </Label>
        <Input
          id="monto_visita_bodega_clp"
          name="monto_visita_bodega_clp"
          type="number"
          min={1}
          step={1}
          required
          defaultValue={montoActual ?? ""}
          placeholder="ej. 1500"
        />
        {/* ⚠️ Acá seguía «Puedes fijar un monto distinto para una bodega
            puntual desde Configuración → Bodegas». Se retiró: desde que la
            sección lista las bodegas con lo que cuesta cada una, esa misma idea
            se decía TRES veces —la descripción de la tarjeta, esta ayuda y la
            tabla con su botón—. La ayuda del campo se queda con lo único que el
            campo necesita explicar. */}
        <p className="text-xs text-fg-muted">
          Se paga por CADA visita cerrada, sin importar cuántos bultos retiró el conductor en
          ella.
        </p>
      </div>
    </SeccionConfiguracion>
  );
}
