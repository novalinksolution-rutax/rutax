"use client";

/**
 * Selector interactivo de pedidos para agregar al manifiesto (asignación masiva).
 * Multi-selección con checkboxes, barra sticky de acción, advertencia de
 * reasignación (B-5).
 *
 * Pulido Fase 4 (UX-7): sistema de diseño (Table densa, Checkbox/Button/Dialog
 * accesibles), color por tokens y feedback inmediato con toast.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Inbox } from "lucide-react";
import type { Pedido } from "@/modules/operacion/tipos";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { actionAsignarPedidos } from "../../actions";

interface PedidoDisponible {
  pedido: Pedido;
  nombreConductorActual: string | null;
  nombreManifiestoActual: string | null;
}

interface Props {
  manifiestoId: string;
  pedidosDisponibles: PedidoDisponible[];
}

export function SelectorPedidosManifiesto({ manifiestoId, pedidosDisponibles }: Props) {
  const router = useRouter();
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [dialogReasignacion, setDialogReasignacion] = useState<PedidoDisponible[] | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleSeleccion(pedidoId: string) {
    setSeleccionados((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(pedidoId)) siguiente.delete(pedidoId);
      else siguiente.add(pedidoId);
      return siguiente;
    });
  }

  const todosSeleccionados =
    seleccionados.size === pedidosDisponibles.length && pedidosDisponibles.length > 0;

  function toggleTodos() {
    if (todosSeleccionados) setSeleccionados(new Set());
    else setSeleccionados(new Set(pedidosDisponibles.map((p) => p.pedido.id)));
  }

  function handleAgregar() {
    if (seleccionados.size === 0) return;

    // Si alguno ya tiene asignación activa, confirmar la reasignación (B-5).
    const conReasignacion = pedidosDisponibles.filter(
      (pd) => seleccionados.has(pd.pedido.id) && pd.pedido.estado === "asignado",
    );

    if (conReasignacion.length > 0) {
      setDialogReasignacion(conReasignacion);
      return;
    }

    ejecutarAsignacion();
  }

  function ejecutarAsignacion() {
    const cantidad = seleccionados.size;
    const formData = new FormData();
    formData.set("manifiestoId", manifiestoId);
    formData.set("pedidoIds", Array.from(seleccionados).join(","));

    startTransition(async () => {
      const resultado = await actionAsignarPedidos(formData);
      if (resultado?.error) {
        setDialogReasignacion(null);
        toast.error("No se pudieron agregar los pedidos", { description: resultado.error });
      } else {
        toast.success(
          `${cantidad} pedido${cantidad !== 1 ? "s" : ""} agregado${cantidad !== 1 ? "s" : ""} al manifiesto`,
        );
        router.push(`/manifiestos/${manifiestoId}`);
      }
    });
  }

  const haySeleccionados = seleccionados.size > 0;

  if (pedidosDisponibles.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        titulo="No hay pedidos pendientes de asignación"
        descripcion="Los pedidos llegan solos desde Mercado Libre. También puedes crear un pedido same-day desde Operación."
      />
    );
  }

  return (
    <>
      <DataTable
        toolbar={
          <span className="text-sm text-muted-foreground tabular-nums">
            {pedidosDisponibles.length} pedido{pedidosDisponibles.length !== 1 ? "s" : ""} disponible
            {pedidosDisponibles.length !== 1 ? "s" : ""}
          </span>
        }
      >
        <Table densidad="compact" aria-label="Pedidos disponibles para agregar al manifiesto">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-10 px-4">
                <Checkbox
                  checked={todosSeleccionados}
                  onCheckedChange={toggleTodos}
                  aria-label="Seleccionar todos"
                />
              </TableHead>
              <TableHead className="px-4">Destinatario</TableHead>
              <TableHead className="hidden px-4 sm:table-cell">Dirección / Comuna</TableHead>
              <TableHead className="hidden px-4 md:table-cell">Seller</TableHead>
              <TableHead className="hidden px-4 lg:table-cell">F. compromiso</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pedidosDisponibles.map(({ pedido, nombreConductorActual }) => {
              const yaAsignado = pedido.estado === "asignado";
              const marcado = seleccionados.has(pedido.id);
              return (
                <TableRow
                  key={pedido.id}
                  data-state={marcado ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => toggleSeleccion(pedido.id)}
                >
                  <TableCell className="px-4" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={marcado}
                      onCheckedChange={() => toggleSeleccion(pedido.id)}
                      aria-label={`Seleccionar pedido de ${pedido.destinatarioNombre}`}
                    />
                  </TableCell>
                  <TableCell className="px-4">
                    <p className="font-medium">{pedido.destinatarioNombre}</p>
                    {yaAsignado && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-warning-subtle-foreground">
                        <AlertTriangle className="inline size-3" aria-hidden="true" />
                        Ya asignado{nombreConductorActual ? ` a ${nombreConductorActual}` : ""}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="hidden px-4 text-muted-foreground sm:table-cell">
                    <span>{pedido.destinatarioDireccion}</span>
                    <span className="ml-1 text-xs font-medium text-foreground">
                      {pedido.destinatarioComuna}
                    </span>
                  </TableCell>
                  <TableCell className="hidden px-4 text-muted-foreground md:table-cell">
                    {pedido.sellerId}
                  </TableCell>
                  <TableCell className="hidden px-4 font-mono text-muted-foreground tabular-nums lg:table-cell">
                    {pedido.fechaCompromiso ?? "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTable>

      {/* Espaciador para que la barra sticky no tape la última fila */}
      <div className="h-20" aria-hidden="true" />

      {/* Barra sticky de acción */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 lg:pl-64">
          <p className="text-sm text-muted-foreground">
            {haySeleccionados ? (
              <span className="font-medium text-foreground tabular-nums">
                {seleccionados.size} pedido{seleccionados.size !== 1 ? "s" : ""} seleccionado
                {seleccionados.size !== 1 ? "s" : ""}
              </span>
            ) : (
              "Selecciona los pedidos que quieres agregar"
            )}
          </p>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => router.back()} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={handleAgregar} disabled={!haySeleccionados} loading={pending}>
              Agregar al manifiesto
            </Button>
          </div>
        </div>
      </div>

      {/* Dialog de advertencia de reasignación (B-5) */}
      <Dialog
        open={!!dialogReasignacion}
        onOpenChange={(o) => {
          if (!o && !pending) setDialogReasignacion(null);
        }}
      >
        <DialogContent showCloseButton={!pending} className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning-subtle-foreground">
                <AlertTriangle className="size-4" aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-2">
                <DialogTitle>Pedidos ya asignados</DialogTitle>
                <DialogDescription>
                  Estos pedidos ya están en otro manifiesto. Si continúas, se quitarán de ahí y se
                  moverán a este.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {(dialogReasignacion ?? []).map(
              ({ pedido, nombreConductorActual, nombreManifiestoActual }) => (
                <li
                  key={pedido.id}
                  className="rounded-lg bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground"
                >
                  <span className="font-medium">{pedido.destinatarioNombre}</span> está en{" "}
                  <span className="font-medium">
                    &ldquo;{nombreManifiestoActual ?? "sin nombre"}&rdquo;
                  </span>{" "}
                  ({nombreConductorActual ?? "conductor desconocido"}).
                </li>
              ),
            )}
          </ul>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogReasignacion(null)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button onClick={ejecutarAsignacion} loading={pending}>
              Continuar de todos modos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
