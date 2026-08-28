"use client";

/**
 * El contacto público del courier — a quién le escribe el que espera su paquete.
 * =============================================================================
 *
 * La página de seguimiento (`/tracking/[token]`) **la firma el courier**, no
 * Rutax: para quien espera un paquete, quien lo trae es el courier. Pero solo
 * mostraba su nombre de fantasía, así que el comprador con una duda no tenía a
 * quién escribirle y terminaba llamando al seller — exactamente lo que el
 * courier quiere evitar delegando el despacho.
 *
 * ⚠️ Basta con uno de los dos. Obligar a los dos dejaría a un courier que solo
 * atiende por WhatsApp inventándose un correo que nadie lee.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  SeccionConfiguracion,
  type ResultadoGuardado,
} from "@/app/(tenant)/configuracion/_componentes/seccion-configuracion";
import { accionGuardarContacto } from "../acciones-datos-courier";

export function FormularioContacto({
  telefono,
  email,
}: {
  telefono: string | null;
  email: string | null;
}) {
  async function guardar(datos: FormData): Promise<ResultadoGuardado> {
    const resultado = await accionGuardarContacto(datos);
    if (!resultado.ok) return { ok: false, mensaje: resultado.mensaje };
    return { ok: true, acuse: resultado.acuse };
  }

  return (
    <SeccionConfiguracion
      titulo="Cómo te contacta quien espera un paquete"
      descripcion="Se muestra en la página de seguimiento que ve el destinatario, que hoy solo lleva tu nombre. Con uno de los dos basta."
      etiquetaAccion="Guardar el contacto"
      onGuardar={guardar}
    >
      <div className="grid max-w-xl gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contacto-telefono">Teléfono</Label>
          <Input
            id="contacto-telefono"
            name="telefono_contacto"
            type="tel"
            defaultValue={telefono ?? ""}
            placeholder="+56 9 1234 5678"
            className="rx-num"
          />
          <p className="text-xs text-fg-muted">
            Escríbelo como quieras: lo normalizamos nosotros.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="contacto-email">Correo</Label>
          <Input
            id="contacto-email"
            name="email_contacto"
            type="email"
            defaultValue={email ?? ""}
            placeholder="contacto@tucourier.cl"
          />
        </div>
      </div>
    </SeccionConfiguracion>
  );
}
