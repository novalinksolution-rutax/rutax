"use client";

/**
 * El bloque de WhatsApp del perfil del seller.
 *
 * Dos estados y nada más: tiene número y avisos activos, o no los tiene. La
 * baja es de un clic — poner fricción en el «no» sería exactamente al revés de
 * como debe ser un consentimiento.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  guardarWhatsAppDelSeller,
  darseDeBajaDeWhatsApp,
  type WhatsAppDelSeller,
} from "./actions";

function formatearParaEditar(e164: string | null): string {
  if (!e164) return "";
  // Se le devuelve legible para que lo reconozca y lo pueda corregir. Es SU
  // número: enmascararlo acá sería absurdo.
  if (e164.startsWith("56") && e164.length === 11) {
    return `+56 ${e164[2]} ${e164.slice(3, 7)} ${e164.slice(7)}`;
  }
  return `+${e164}`;
}

export function PanelWhatsAppDelSeller({ datos }: { datos: WhatsAppDelSeller }) {
  const router = useRouter();
  const activo = datos.consentimiento === "otorgado";

  const [editando, setEditando] = useState(!datos.telefono);
  const [telefono, setTelefono] = useState(formatearParaEditar(datos.telefono));
  const [acepta, setAcepta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    iniciar(async () => {
      const r = await guardarWhatsAppDelSeller({ telefono });
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setEditando(false);
      setAcepta(false);
      router.refresh();
    });
  }

  function darDeBaja() {
    setError(null);
    iniciar(async () => {
      const r = await darseDeBajaDeWhatsApp();
      if (!r.ok) setError(r.mensaje);
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageCircle className="size-5 text-fg-muted" aria-hidden="true" />
          <CardTitle>Avisos por WhatsApp</CardTitle>
        </div>
        <CardDescription>
          Te avisamos cuando retiramos pedidos desde tus bodegas. Los mensajes llegan desde el
          número oficial de Rutax.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {!editando && datos.telefono ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-fg">{formatearParaEditar(datos.telefono)}</span>
              {activo ? (
                <BadgeEstado variante="success" texto="Avisos activos" />
              ) : (
                <BadgeEstado variante="neutral" texto="Diste de baja los avisos" />
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditando(true)} disabled={pendiente}>
                {activo ? "Cambiar número" : "Volver a activar"}
              </Button>
              {activo ? (
                // Un clic, sin confirmación: darse de baja tiene que ser lo más
                // fácil de esta pantalla.
                <Button variant="ghost" size="sm" onClick={darDeBaja} disabled={pendiente}>
                  Dar de baja
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <form onSubmit={guardar} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="whatsapp">Tu número de WhatsApp</Label>
              <Input
                id="whatsapp"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+56 9 1234 5678"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                required
              />
              <p className="text-sm text-fg-muted">
                Da lo mismo cómo lo escribas: lo guardamos en el formato que exige WhatsApp.
              </p>
            </div>

            <div className="flex items-start gap-3 rounded-md border border-border bg-bg-subtle p-3">
              <Checkbox
                id="acepta"
                checked={acepta}
                onCheckedChange={(v) => setAcepta(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="acepta" className="cursor-pointer text-sm font-normal leading-relaxed">
                Acepto recibir avisos de mis entregas por WhatsApp. Puedo darme de baja desde acá,
                o respondiendo <span className="font-medium">BAJA</span> al mensaje.
              </Label>
            </div>

            {error ? <p className="text-sm text-danger">{error}</p> : null}

            <div className="flex flex-wrap gap-2">
              {/* Sin la casilla no se guarda: es lo que convierte un número en
                  un permiso. */}
              <Button type="submit" disabled={pendiente || !acepta}>
                {pendiente ? "Guardando…" : "Guardar y activar avisos"}
              </Button>
              {datos.telefono ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditando(false);
                    setError(null);
                  }}
                  disabled={pendiente}
                >
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>
        )}

        {datos.adicionalesDeRutax > 0 ? (
          <p className="border-t border-border pt-3 text-sm text-fg-muted">
            Además del tuyo, hay {datos.adicionalesDeRutax}{" "}
            {datos.adicionalesDeRutax === 1 ? "número adicional" : "números adicionales"} recibiendo
            estos avisos. Si quieres cambiarlos, escríbenos.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
