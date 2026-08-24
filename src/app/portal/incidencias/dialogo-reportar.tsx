"use client";

/**
 * «Reportar un problema» — peldaño 1, y la promesa que el portal debía.
 * =============================================================================
 *
 * La bienvenida decía «Reporta incidencias directo desde aquí — quedan
 * registradas y con seguimiento» y la acción **no existía en ninguna parte del
 * portal**. Este es el formulario que la cumple.
 *
 * -----------------------------------------------------------------------------
 * PELDAÑO 1, Y EL ACUSE DICE LO QUE **NO** PASA
 * -----------------------------------------------------------------------------
 * Reportar no destruye nada y se puede volver a reportar: no necesita motivo ni
 * frase escrita. Lo que sí necesita es que el acuse sea honesto sobre lo que
 * ocurre después: **no se manda ningún correo**. Sin decirlo, el seller reporta
 * y se queda esperando una respuesta que nadie prometió — y a los veinte minutos
 * llama por teléfono, que es exactamente lo que esta pantalla viene a evitar.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIPOS_INCIDENCIA } from "@/modules/operacion/tipos";
import { TIPO_INCIDENCIA_PORTAL } from "@/lib/ui/vocabulario-portal";
import { accionReportarProblema } from "../acciones-incidencias";

export interface PedidoReportable {
  id: string;
  etiqueta: string;
}

export function DialogoReportar({
  pedidos,
  nombreCourier,
  pedidoFijo,
  variante = "principal",
}: {
  /** Los pedidos del seller entre los que elegir. Vacío = no hay qué reportar. */
  pedidos: readonly PedidoReportable[];
  nombreCourier: string;
  /** Cuando se abre desde el detalle de un pedido, ya se sabe cuál es. */
  pedidoFijo?: PedidoReportable;
  variante?: "principal" | "secundaria";
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [pedidoId, setPedidoId] = useState(pedidoFijo?.id ?? "");
  const [tipo, setTipo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [pendiente, iniciarTransicion] = useTransition();

  const sinPedidos = !pedidoFijo && pedidos.length === 0;

  function enviar() {
    setError(null);
    iniciarTransicion(async () => {
      const r = await accionReportarProblema(pedidoId, tipo, descripcion);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setListo(true);
      router.refresh();
    });
  }

  function cerrar() {
    setAbierto(false);
    setListo(false);
    setError(null);
    setTipo("");
    setDescripcion("");
    if (!pedidoFijo) setPedidoId("");
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={variante === "principal" ? "default" : "outline"}
        disabled={sinPedidos}
        title={sinPedidos ? "Todavía no tienes pedidos sobre los que reportar" : undefined}
        onClick={() => setAbierto(true)}
      >
        Reportar un problema
      </Button>

      <Dialog open={abierto} onOpenChange={(a) => !a && !pendiente && cerrar()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {listo ? "Quedó reportado" : "Reportar un problema"}
            </DialogTitle>
          </DialogHeader>

          {listo ? (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-fg-muted">
                {nombreCourier} lo va a ver en su bandeja de incidencias. Vas a poder seguirlo
                desde <strong className="font-medium text-fg">Mis incidencias</strong>, con lo que
                respondan y el efecto que tenga en tu cobro.
              </p>
              {/* Lo que NO pasa, dicho. Sin esto se espera un correo que no llega
                  y a los veinte minutos suena el teléfono del courier. */}
              <p className="text-sm leading-relaxed text-fg-muted">
                No te vamos a mandar un correo: revísalo acá cuando quieras.
              </p>
            </div>
          ) : (
            <>
              {!pedidoFijo ? (
                <div className="space-y-1.5">
                  <Label htmlFor="reportar-pedido">Qué pedido</Label>
                  <Select value={pedidoId} onValueChange={setPedidoId}>
                    <SelectTrigger id="reportar-pedido" className="w-full">
                      <SelectValue placeholder="Elige el pedido" />
                    </SelectTrigger>
                    <SelectContent>
                      {pedidos.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.etiqueta}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-sm text-fg-muted">
                  Sobre <strong className="font-medium text-fg">{pedidoFijo.etiqueta}</strong>.
                </p>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="reportar-tipo">Qué pasó</Label>
                <Select value={tipo} onValueChange={setTipo}>
                  <SelectTrigger id="reportar-tipo" className="w-full">
                    <SelectValue placeholder="Elige qué pasó" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_INCIDENCIA.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TIPO_INCIDENCIA_PORTAL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reportar-descripcion">Cuéntanos</Label>
                <Textarea
                  id="reportar-descripcion"
                  rows={3}
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="El cliente dice que nadie tocó el timbre y estuvo toda la tarde."
                />
                <p className="text-xs text-fg-muted">
                  Lo lee {nombreCourier}. Mientras más concreto, más rápido lo resuelven.
                </p>
              </div>

              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </>
          )}

          <DialogFooter>
            {listo ? (
              <Button onClick={cerrar}>Listo</Button>
            ) : (
              <>
                <Button variant="ghost" disabled={pendiente} onClick={cerrar}>
                  Volver
                </Button>
                <Button
                  disabled={pendiente || !pedidoId || !tipo || descripcion.trim().length < 10}
                  onClick={enviar}
                >
                  {pendiente ? "Reportando…" : "Reportar"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
