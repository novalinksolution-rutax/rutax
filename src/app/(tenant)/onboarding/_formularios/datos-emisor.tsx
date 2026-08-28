"use client";

/**
 * Los cuatro campos del bloque Emisor que el SII exige y `tenants` no tenía.
 * =============================================================================
 *
 * Va DENTRO del paso de facturación electrónica y encima del formulario del
 * proveedor, no en un paso aparte: un certificado cargado sin estos cuatro
 * campos no emite igual, así que separarlos dejaría un paso que se puede marcar
 * listo estando incompleto.
 *
 * ⚠️ La actividad económica **no se deduce del giro**. El Acteco es un código de
 * 6 dígitos que el courier tiene en su inicio de actividades; adivinarlo desde
 * un texto libre sería inventar un dato tributario. La ayuda del campo dice
 * dónde encontrarlo en vez de ofrecer un desplegable que sería siempre
 * incompleto.
 *
 * ⚠️ La comuna se elige con el `Select` de shadcn y estado local, como en
 * `configuracion/bodegas/panel-bodega.tsx`: Radix solo emite el campo al
 * `FormData` si es controlado y lleva `name`.
 */

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";

import {
  SeccionConfiguracion,
  type ResultadoGuardado,
} from "@/app/(tenant)/configuracion/_componentes/seccion-configuracion";
import { accionGuardarDatosEmisor } from "../acciones-datos-courier";

export interface DatosEmisorIniciales {
  giro: string | null;
  direccion: string | null;
  comuna: string | null;
  actividadEconomica: string | null;
}

export function FormularioDatosEmisor({ iniciales }: { iniciales: DatosEmisorIniciales }) {
  const [comuna, setComuna] = useState(iniciales.comuna ?? "");

  async function guardar(datos: FormData): Promise<ResultadoGuardado> {
    const resultado = await accionGuardarDatosEmisor(datos);
    if (!resultado.ok) return { ok: false, mensaje: resultado.mensaje };
    return { ok: true, acuse: resultado.acuse };
  }

  return (
    <SeccionConfiguracion
      titulo="Los datos de tu empresa en la factura"
      descripcion="Van impresos en cada documento que emitas y el SII los exige. Tu razón social y tu RUT ya los tenemos del alta."
      etiquetaAccion="Guardar los datos"
      onGuardar={guardar}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="emisor-giro">Giro</Label>
          <Input
            id="emisor-giro"
            name="giro"
            required
            maxLength={80}
            defaultValue={iniciales.giro ?? ""}
            placeholder="Ej: Transporte de carga por carretera"
          />
          <p className="text-xs text-fg-muted">Máximo 80 caracteres: es el tope del SII.</p>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="emisor-direccion">Dirección de tu casa matriz</Label>
          <Input
            id="emisor-direccion"
            name="direccion"
            required
            defaultValue={iniciales.direccion ?? ""}
            placeholder="Ej: Av. Providencia 1234, of. 55"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="emisor-comuna">Comuna de tu casa matriz</Label>
          {/* Es la comuna TRIBUTARIA, no una de reparto: no tiene relación con
              las zonas ni con `zona_comunas`. */}
          <Select name="comuna" required value={comuna} onValueChange={setComuna}>
            <SelectTrigger id="emisor-comuna" className="h-9 w-full">
              <SelectValue placeholder="Selecciona una comuna" />
            </SelectTrigger>
            <SelectContent>
              {COMUNAS_RM.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="emisor-actividad">Actividad económica</Label>
          <Input
            id="emisor-actividad"
            name="actividad_economica"
            required
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            defaultValue={iniciales.actividadEconomica ?? ""}
            placeholder="492300"
            className="rx-num"
          />
          <p className="text-xs text-fg-muted">
            Los 6 dígitos del código del SII. Están en tu inicio de actividades.
          </p>
        </div>
      </div>
    </SeccionConfiguracion>
  );
}
