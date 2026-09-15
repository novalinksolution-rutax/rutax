"use client";

/**
 * Dónde te pagan — la cuenta a la que el seller le transfiere al courier.
 * =============================================================================
 *
 * No existía en ninguna tabla: la factura salía y el seller no tenía dónde leer
 * a qué cuenta pagar. `identidad.courier_config_cobranza`, que es lo único que
 * había, guarda la CONEXIÓN con Fintoc para conciliar lo que entra — otra cosa,
 * y se puede cobrar por transferencia sin haber conectado el banco nunca.
 *
 * ⚠️ **El titular se pide, no se deduce del tenant.** Hay couriers que cobran en
 * la cuenta de su matriz o de un socio, y rellenarlo solo con la razón social
 * del alta produciría un dato que parece confirmado y no lo está.
 *
 * ⚠️ El número de cuenta **no es un secreto**: va impreso en cada factura. Por
 * eso el campo no se enmascara ni el valor pasa por `secretos_cifrados` —
 * cifrar un dato que se publica en un PDF no protege nada y sí impide
 * mostrarlo.
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
import {
  BANCOS_CHILE,
  ETIQUETAS_TIPO_CUENTA,
  TIPOS_CUENTA_BANCARIA,
} from "@/lib/ui/bancos-chile";

import {
  SeccionConfiguracion,
  type ResultadoGuardado,
} from "@/app/(tenant)/configuracion/_componentes/seccion-configuracion";
import { accionGuardarDatosCobro } from "../acciones-datos-courier";

export interface DatosCobroIniciales {
  banco: string | null;
  tipoCuenta: string | null;
  numeroCuenta: string | null;
  rutTitular: string | null;
  nombreTitular: string | null;
  emailAviso: string | null;
}

export function FormularioDatosCobro({ iniciales }: { iniciales: DatosCobroIniciales }) {
  const [banco, setBanco] = useState(iniciales.banco ?? "");
  const [tipoCuenta, setTipoCuenta] = useState(iniciales.tipoCuenta ?? "");

  async function guardar(datos: FormData): Promise<ResultadoGuardado> {
    const resultado = await accionGuardarDatosCobro(datos);
    if (!resultado.ok) return { ok: false, mensaje: resultado.mensaje };
    return { ok: true, acuse: resultado.acuse };
  }

  return (
    <SeccionConfiguracion
      titulo="La cuenta a la que te transfieren"
      descripcion="Es lo que tus sellers van a leer para pagarte. Va en la factura y en su portal."
      etiquetaAccion="Guardar la cuenta"
      onGuardar={guardar}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cobro-banco">Banco</Label>
          <Select name="banco" required value={banco} onValueChange={setBanco}>
            <SelectTrigger id="cobro-banco" className="h-9 w-full">
              <SelectValue placeholder="Selecciona un banco" />
            </SelectTrigger>
            <SelectContent>
              {BANCOS_CHILE.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cobro-tipo">Tipo de cuenta</Label>
          <Select name="tipo_cuenta" required value={tipoCuenta} onValueChange={setTipoCuenta}>
            <SelectTrigger id="cobro-tipo" className="h-9 w-full">
              <SelectValue placeholder="Selecciona el tipo" />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_CUENTA_BANCARIA.map((t) => (
                <SelectItem key={t} value={t}>
                  {ETIQUETAS_TIPO_CUENTA[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cobro-numero">Número de cuenta</Label>
          <Input
            id="cobro-numero"
            name="numero_cuenta"
            required
            inputMode="numeric"
            defaultValue={iniciales.numeroCuenta ?? ""}
            placeholder="00012345678"
            className="rx-num"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cobro-titular">Nombre del titular</Label>
          <Input
            id="cobro-titular"
            name="nombre_titular"
            required
            defaultValue={iniciales.nombreTitular ?? ""}
            placeholder="Ej: Despachos Rápidos SpA"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cobro-rut">RUT del titular</Label>
          <Input
            id="cobro-rut"
            name="rut_titular"
            required
            defaultValue={iniciales.rutTitular ?? ""}
            placeholder="76.543.210-9"
            className="rx-num"
          />
          <p className="text-xs text-fg-muted">
            Puede no ser el RUT de tu courier si cobras en otra cuenta.
          </p>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cobro-email">Correo de aviso (opcional)</Label>
          <Input
            id="cobro-email"
            name="email_aviso"
            type="email"
            defaultValue={iniciales.emailAviso ?? ""}
            placeholder="pagos@tuempresa.cl"
          />
          <p className="text-xs text-fg-muted">
            A dónde te avisa el seller que ya transfirió. Déjalo vacío si prefieres solo la
            conciliación automática.
          </p>
        </div>
      </div>
    </SeccionConfiguracion>
  );
}
