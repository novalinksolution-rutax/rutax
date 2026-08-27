"use client";

/**
 * Registrar un retiro desde la oficina.
 * =============================================================================
 *
 * =============================================================================
 * ESTO NO ES UN FORMULARIO ADMINISTRATIVO, Y LA PANTALLA TIENE QUE DECIRLO
 * =============================================================================
 * Registrar el retiro **le paga la visita al conductor** y **le avisa al seller
 * por WhatsApp**. Decisión del usuario (2026-08-26): el ciclo es idéntico al de
 * escanear en terreno, sin modo "solo marcar".
 *
 * Por eso el botón final pasa por `DialogConfirmacionDinero` con casilla
 * explícita — el mismo componente que gobierna emitir una factura. Un
 * coordinador que registra un retiro por error no está corrigiendo una casilla:
 * está generando una línea de liquidación a nombre de una persona.
 *
 * =============================================================================
 * SE ELIGE PRIMERO EL QUIÉN Y EL DÓNDE, Y RECIÉN DESPUÉS LOS BULTOS
 * =============================================================================
 * El orden importa: conductor y bodega son los datos que convierten esto en un
 * hecho atribuible. Si se pudieran marcar pedidos sin haberlos elegido, la
 * pantalla invitaría a tratar el retiro como una selección masiva y el "quién"
 * quedaría como un trámite del final.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, PackageCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogConfirmacionDinero } from "@/components/ui/dialog-confirmacion-dinero";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PedidoPendienteDeRetiro } from "@/modules/operacion/retiro/registro-web";

import { actionRegistrarRetiroDesdeWeb } from "./actions";

export interface ConductorOpcion {
  id: string;
  nombre: string;
}

export interface BodegaOpcion {
  id: string;
  nombre: string;
  comuna: string | null;
  sellerNombre: string;
}

interface Props {
  conductores: readonly ConductorOpcion[];
  bodegas: readonly BodegaOpcion[];
  pedidos: readonly PedidoPendienteDeRetiro[];
}

type Aviso =
  | { tipo: "exito"; texto: string }
  | { tipo: "error"; texto: string };

export function FormularioRetiro({ conductores, bodegas, pedidos }: Props) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  const [conductorId, setConductorId] = useState("");
  const [bodegaId, setBodegaId] = useState("");
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const registrables = useMemo(() => pedidos.filter((p) => p.registrable), [pedidos]);
  const sinCodigo = pedidos.length - registrables.length;

  const conductorElegido = conductores.find((c) => c.id === conductorId);
  const bodegaElegida = bodegas.find((b) => b.id === bodegaId);

  const listo = conductorId !== "" && bodegaId !== "" && seleccion.size > 0;

  function alternar(pedidoId: string) {
    setAviso(null);
    setSeleccion((actual) => {
      const copia = new Set(actual);
      if (copia.has(pedidoId)) copia.delete(pedidoId);
      else copia.add(pedidoId);
      return copia;
    });
  }

  function alternarTodos() {
    setAviso(null);
    setSeleccion((actual) =>
      actual.size === registrables.length ? new Set() : new Set(registrables.map((p) => p.id)),
    );
  }

  function registrar() {
    setConfirmando(false);
    setAviso(null);
    startTransition(async () => {
      const r = await actionRegistrarRetiroDesdeWeb(conductorId, bodegaId, [...seleccion]);
      if (!r.ok) {
        setAviso({ tipo: "error", texto: r.mensaje });
        return;
      }
      const total = r.datos.resultados.length;
      const fuera = r.datos.noRegistrados.length;
      setAviso({
        tipo: "exito",
        texto:
          `Retiro registrado: ${total} bulto${total === 1 ? "" : "s"} a nombre de ${conductorElegido?.nombre ?? "el conductor"}` +
          (fuera > 0 ? `. ${fuera} pedido${fuera === 1 ? " quedó" : "s quedaron"} fuera` : "") +
          ". Ya puedes asignarlos.",
      });
      setSeleccion(new Set());
      router.refresh();
    });
  }

  if (pedidos.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No hay pedidos pendientes de retiro para hoy. Todo lo del día ya está en poder del
          courier, o todavía no ha entrado ningún pedido.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* --- Quién y dónde ---------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quién retiró y en qué bodega</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="conductor">Conductor</Label>
            <Select value={conductorId} onValueChange={setConductorId}>
              <SelectTrigger id="conductor">
                <SelectValue placeholder="Elige quién fue" />
              </SelectTrigger>
              <SelectContent>
                {conductores.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bodega">Bodega</Label>
            <Select value={bodegaId} onValueChange={setBodegaId}>
              <SelectTrigger id="bodega">
                <SelectValue placeholder="Elige la bodega" />
              </SelectTrigger>
              <SelectContent>
                {bodegas.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.nombre}
                    {b.comuna ? ` · ${b.comuna}` : ""} — {b.sellerNombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* --- Qué se retiró ---------------------------------------------- */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">
            Qué se retiró
            <span className="ml-2 font-normal text-muted-foreground">
              {seleccion.size} de {registrables.length}
            </span>
          </CardTitle>
          <Button variant="outline" size="sm" onClick={alternarTodos} disabled={pendiente}>
            {seleccion.size === registrables.length ? "Quitar todos" : "Marcar todos"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {pedidos.map((p) => (
            <label
              key={p.id}
              className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm ${
                p.registrable ? "cursor-pointer hover:bg-muted/50" : "opacity-60"
              }`}
            >
              <Checkbox
                checked={seleccion.has(p.id)}
                onCheckedChange={() => alternar(p.id)}
                disabled={!p.registrable || pendiente}
              />
              <span className="font-mono">{p.codigoVisible}</span>
              <span className="text-muted-foreground">{p.destinatarioComuna ?? "Sin comuna"}</span>
              {!p.registrable && (
                <span className="ml-auto text-xs text-muted-foreground">
                  Sin código — no se puede registrar
                </span>
              )}
            </label>
          ))}

          {/* Los que no se pueden registrar se muestran igual: esconderlos deja
              al coordinador con un conteo que no le cuadra y sin explicación. */}
          {sinCodigo > 0 && (
            <p className="pt-2 text-xs text-muted-foreground">
              {sinCodigo} pedido{sinCodigo === 1 ? "" : "s"} sin código identificable. Se muestran
              para que el conteo cuadre, pero hay que resolverlos por otra vía.
            </p>
          )}
        </CardContent>
      </Card>

      {aviso && (
        <p
          className={`text-sm ${aviso.tipo === "error" ? "text-destructive" : "text-muted-foreground"}`}
          role="status"
        >
          {aviso.texto}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => setConfirmando(true)} disabled={!listo || pendiente}>
          <PackageCheck className="mr-2 size-4" />
          Registrar retiro
        </Button>
        {!listo && (
          <span className="text-sm text-muted-foreground">
            Elige conductor, bodega y al menos un pedido.
          </span>
        )}
      </div>

      <DialogConfirmacionDinero
        open={confirmando}
        onOpenChange={setConfirmando}
        titulo="Registrar el retiro"
        consecuencia={
          <>
            Esto es exactamente lo mismo que si el conductor lo hubiera escaneado en terreno:{" "}
            <strong>se le paga la visita a {conductorElegido?.nombre ?? "el conductor"}</strong> y{" "}
            <strong>se le avisa por WhatsApp al seller</strong> que le retiraron sus pedidos.
            Regístralo solo si la visita ocurrió de verdad.
          </>
        }
        onConfirmar={registrar}
        cargando={pendiente}
        textoConfirmar="Registrar retiro"
        requiereConfirmacionExplicita
        etiquetaConfirmacion="Confirmo que esta visita ocurrió"
      >
        <div className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">Retiró:</span>{" "}
            {conductorElegido?.nombre ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Bodega:</span> {bodegaElegida?.nombre ?? "—"}
            {bodegaElegida ? ` — ${bodegaElegida.sellerNombre}` : ""}
          </p>
          <p>
            <span className="text-muted-foreground">Bultos:</span> {seleccion.size}
          </p>
        </div>
      </DialogConfirmacionDinero>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        Los bultos quedan registrados como tecleados, no escaneados: el acta deja constancia de
        que no hubo lectura de QR.
      </p>
    </div>
  );
}
