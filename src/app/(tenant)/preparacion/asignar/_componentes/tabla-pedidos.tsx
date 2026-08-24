"use client";

/**
 * La tabla de la bandeja — escritorio (`Table`) y móvil (tarjetas), mismo
 * criterio que `/preparacion` (§9, §10). Es una hoja de presentación pura:
 * la selección vive en `bandeja-asignar.tsx`; acá solo se lee (para pintar
 * los checkboxes) y se dispara al hacer clic.
 *
 * Fila: `Sin asignar` (neutro) · `Asignado a {conductor}` (ámbar, con
 * `AlertTriangle`) — nunca rojo, el tope de severidad de esta pantalla es
 * ámbar (§13, criterio §15).
 */

import { AlertTriangle } from "lucide-react";
import type { PedidoAsignable } from "@/modules/operacion/asignacion";
import { CasillaTactil, useBarridoSeleccion } from "@/components/ui/casilla-tactil";
import { DataTable } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PedidoSeleccionado } from "../_lib/seleccion";

interface Props {
  pedidos: PedidoAsignable[];
  /** Cuenta ML de origen, SOLO si el seller del pedido tiene más de una conectada (§9). */
  origenPorPedido: Record<string, string | null>;
  seleccion: ReadonlyMap<string, PedidoSeleccionado>;
  onAlternarUno: (pedido: PedidoAsignable) => void;
  onAlternarPagina: (marcar: boolean) => void;
  footer?: React.ReactNode;
}

function EstadoFila({ pedido }: { pedido: PedidoAsignable }) {
  if (pedido.estado === "pendiente_asignacion") {
    return <span className="text-sm text-muted-foreground">Sin asignar</span>;
  }
  return (
    <span className="flex items-center gap-1 text-sm text-warning-subtle-foreground">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      Asignado a {pedido.conductorActualNombre ?? "un conductor"}
    </span>
  );
}

export function TablaPedidos({
  pedidos,
  origenPorPedido,
  seleccion,
  onAlternarUno,
  onAlternarPagina,
  footer,
}: Props) {
  const todosMarcados = pedidos.length > 0 && pedidos.every((p) => seleccion.has(p.pedidoId));
  const algunosMarcados = !todosMarcados && pedidos.some((p) => seleccion.has(p.pedidoId));
  const estadoCabecera = todosMarcados ? true : algunosMarcados ? "indeterminate" : false;

  /**
   * El **tercer nivel de selección**: barrer con el dedo por la columna de
   * casillas. Los otros dos —la fila suelta y «todos los de esta página»— ya
   * estaban.
   *
   * Es lo que convierte treinta toques en un gesto. Y treinta toques de pie en
   * la bodega, con el camión descargando al lado, no son una molestia: son parte
   * de por qué la flota sale 16:40 en vez de 16:00.
   */
  const { propsDeCelda } = useBarridoSeleccion({
    items: pedidos,
    idDe: (p) => p.pedidoId,
    estaMarcado: (p) => seleccion.has(p.pedidoId),
    onAlternar: onAlternarUno,
  });

  return (
    <>
      {/* Escritorio (≥1024px) */}
      <div className="hidden lg:block">
        <DataTable footer={footer}>
          <Table densidad="comfortable" aria-label="Pedidos retirados disponibles para asignar">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-10 px-4">
                  <CasillaTactil
                    checked={estadoCabecera}
                    onCheckedChange={(valor) => onAlternarPagina(valor === true)}
                    aria-label="Seleccionar todos los de esta página"
                  />
                </TableHead>
                <TableHead className="px-4">Código</TableHead>
                <TableHead className="px-4">Comuna</TableHead>
                <TableHead className="px-4">Seller</TableHead>
                <TableHead className="px-4">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidos.map((pedido, indice) => {
                const marcado = seleccion.has(pedido.pedidoId);
                const origen = origenPorPedido[pedido.pedidoId];
                return (
                  <TableRow
                    key={pedido.pedidoId}
                    data-state={marcado ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => onAlternarUno(pedido)}
                  >
                    <TableCell
                      className="px-4"
                      onClick={(e) => e.stopPropagation()}
                      {...propsDeCelda(indice)}
                    >
                      <CasillaTactil
                        checked={marcado}
                        onCheckedChange={() => onAlternarUno(pedido)}
                        aria-label={`Seleccionar pedido ${pedido.codigoVisible}`}
                      />
                    </TableCell>
                    <TableCell className="px-4 font-mono text-sm">{pedido.codigoVisible}</TableCell>
                    <TableCell className="px-4">
                      <span className="text-sm">{pedido.comuna ?? "Sin comuna conocida"}</span>
                      {origen && <span className="mt-0.5 block text-xs text-muted-foreground">{origen}</span>}
                    </TableCell>
                    <TableCell className="px-4 text-sm text-muted-foreground">
                      {pedido.sellerNombre ?? "—"}
                    </TableCell>
                    <TableCell className="px-4">
                      <EstadoFila pedido={pedido} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DataTable>
      </div>

      {/* Móvil (<1024px) — lista de tarjetas, mismo criterio que /preparacion */}
      <div className="space-y-3 lg:hidden">
        <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <CasillaTactil
            checked={estadoCabecera}
            onCheckedChange={(valor) => onAlternarPagina(valor === true)}
            aria-label="Seleccionar todos los de esta página"
          />
          Seleccionar todos en esta página
        </label>

        <ul className="space-y-2">
          {pedidos.map((pedido, indice) => {
            const marcado = seleccion.has(pedido.pedidoId);
            const origen = origenPorPedido[pedido.pedidoId];
            return (
              <li key={pedido.pedidoId}>
                {/* `<div>`, no `<button>`: `Checkbox` (Radix) ya es un
                    `<button role="checkbox">` por dentro, y anidar un botón
                    dentro de otro botón es HTML inválido — mismo criterio
                    que la fila de escritorio (`TableRow`, tampoco un
                    elemento interactivo). El `stopPropagation` del checkbox
                    evita el doble-toggle cuando se hace clic justo en él. */}
                <div
                  onClick={() => onAlternarUno(pedido)}
                  data-state={marcado ? "selected" : undefined}
                  // Sin sombra y sin radio grande (regla 4): la tarjeta era del
                  // ADN anterior — `rounded-lg` y `shadow-xs` — y en el sistema
                  // nuevo lo que separa es la línea, no la elevación.
                  className="flex cursor-pointer items-start gap-3 border border-line bg-bg-raised p-3 transition-colors data-[state=selected]:border-brand data-[state=selected]:bg-accent-deep"
                >
                  <span
                    onClick={(e) => e.stopPropagation()}
                    {...propsDeCelda(indice)}
                    className="-m-1 flex items-start p-1"
                  >
                    <CasillaTactil
                      checked={marcado}
                      onCheckedChange={() => onAlternarUno(pedido)}
                      aria-label={`Seleccionar pedido ${pedido.codigoVisible}`}
                      className="mt-0.5"
                    />
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-mono text-sm font-medium">{pedido.codigoVisible}</p>
                    <p className="text-xs text-muted-foreground">
                      {pedido.comuna ?? "Sin comuna conocida"}
                      {origen ? ` · ${origen}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{pedido.sellerNombre ?? "—"}</p>
                    <div className="pt-0.5">
                      <EstadoFila pedido={pedido} />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {footer && <div className="pt-1">{footer}</div>}
      </div>
    </>
  );
}
