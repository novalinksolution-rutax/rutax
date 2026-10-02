"use client";

/**
 * Las tres respuestas de «Tu empresa», con controles nativos (radio/checkbox
 * reales: teclado, lector de pantalla y FormData sin estado propio) presentados
 * como opciones de un toque (mín. 44 px). Solo lectura: los mismos controles
 * deshabilitados y sin botón.
 */

import { useState } from "react";
import { Check } from "lucide-react";
import { CLASE_OPCION_TOQUE } from "@/lib/ui/clase-opcion-toque";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CONDUCTORES_OPCIONES,
  ENVIOS_DIA_OPCIONES,
  FUENTES_PEDIDOS_OPCIONES,
  FUENTE_OTRA_MAX,
  type PerfilComercial,
} from "@/lib/ui/perfil-comercial";
import {
  SeccionConfiguracion,
  type ResultadoGuardado,
} from "../_componentes/seccion-configuracion";
import { accionGuardarPerfilComercial } from "./actions";

const CLASE_OPCION = CLASE_OPCION_TOQUE;

function Pregunta({
  titulo,
  ayuda,
  children,
}: {
  titulo: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-fg">{titulo}</legend>
      {ayuda ? <p className="text-xs text-fg-muted">{ayuda}</p> : null}
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

export function FormularioPerfilComercial({
  inicial,
  puedeEditar,
}: {
  inicial: PerfilComercial | null;
  puedeEditar: boolean;
}) {
  const [fuentes, setFuentes] = useState<string[]>(inicial?.fuentesPedidos ?? []);
  const lectura = !puedeEditar;

  async function guardar(datos: FormData): Promise<ResultadoGuardado> {
    const r = await accionGuardarPerfilComercial(datos);
    return r.ok ? { ok: true, acuse: r.acuse } : { ok: false, mensaje: r.mensaje };
  }

  const cuerpo = (
    <div className="space-y-6">
      <Pregunta titulo="¿Cuántos envíos entregas en un día normal?">
        {ENVIOS_DIA_OPCIONES.map((o) => (
          <label key={o.valor} className={CLASE_OPCION}>
            <input
              type="radio"
              name="envios_dia_rango"
              value={o.valor}
              defaultChecked={inicial?.enviosDiaRango === o.valor}
              disabled={lectura}
              required
              className="sr-only"
            />
            <span className="tabular-nums">{o.etiqueta}</span>
          </label>
        ))}
      </Pregunta>

      <Pregunta titulo="¿Cuántos conductores trabajan contigo?">
        {CONDUCTORES_OPCIONES.map((o) => (
          <label key={o.valor} className={CLASE_OPCION}>
            <input
              type="radio"
              name="conductores_rango"
              value={o.valor}
              defaultChecked={inicial?.conductoresRango === o.valor}
              disabled={lectura}
              required
              className="sr-only"
            />
            <span className="tabular-nums">{o.etiqueta}</span>
          </label>
        ))}
      </Pregunta>

      <div className="space-y-3">
        <Pregunta titulo="¿De dónde vienen tus pedidos?" ayuda="Puedes marcar varias.">
          {FUENTES_PEDIDOS_OPCIONES.map((o) => (
            <label key={o.valor} className={CLASE_OPCION}>
              <input
                type="checkbox"
                name="fuentes_pedidos"
                value={o.valor}
                checked={fuentes.includes(o.valor)}
                onChange={(e) =>
                  setFuentes((prev) =>
                    e.target.checked ? [...prev, o.valor] : prev.filter((f) => f !== o.valor),
                  )
                }
                disabled={lectura}
                className="sr-only"
              />
              {fuentes.includes(o.valor) ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
              {o.etiqueta}
            </label>
          ))}
        </Pregunta>

        {fuentes.includes("otra") ? (
          <div className="max-w-md space-y-1.5">
            <Label htmlFor="perfil-fuente-otra">¿Cuál?</Label>
            <Input
              id="perfil-fuente-otra"
              name="fuente_otra"
              defaultValue={inicial?.fuenteOtra ?? ""}
              maxLength={FUENTE_OTRA_MAX}
              required
              disabled={lectura}
            />
          </div>
        ) : null}
      </div>
    </div>
  );

  if (lectura) return cuerpo;

  return (
    <SeccionConfiguracion etiquetaAccion="Guardar" onGuardar={guardar}>
      {cuerpo}
    </SeccionConfiguracion>
  );
}
