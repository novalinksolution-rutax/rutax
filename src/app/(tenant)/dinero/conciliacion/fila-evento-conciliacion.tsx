"use client";

/**
 * Fila de la bandeja de excepciones de conciliación (D-4, §1.1 P1) — Client
 * Component (una instancia por fila): clic en CUALQUIER parte de la fila
 * (excepto "Asignarme", el menú rápido y el link al pedido) abre el Sheet de
 * detalle (`panel-detalle-excepcion.tsx`), controlado por este componente.
 *
 * Radix no monta el contenido del Sheet mientras está cerrado, así que tener
 * una instancia por fila es barato (mismo patrón que `DialogEmitirPago` por
 * fila en la tabla de liquidaciones) — no hace falta un Sheet único
 * compartido a nivel de tabla.
 */

import { useState, useTransition } from "react";
import type { MouseEvent } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { formatearFecha } from "@/lib/formato-cl";
import {
  BADGE_CATEGORIA_NEGOCIO_CONCILIACION,
  BADGE_ESTADO_CONCILIACION,
  badgeTipoDiferencia,
  traducirCategoriaNegocioConciliacion,
  traducirEstadoConciliacion,
  traducirTipoDiferencia,
} from "@/lib/ui/traduccion-estados";
import type { UsuarioInterno } from "@/modules/identidad/consultas";
import type { EventoConciliacionUI } from "./tipos-ui";
import { semaforoVencimiento } from "./semaforo-vencimiento";
import { MenuAccionesConciliacion } from "./menu-acciones-conciliacion";
import { PanelDetalleExcepcion } from "./panel-detalle-excepcion";
import { accionAsignarEvento } from "./actions";

function inicialesDeNombre(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase();
  return `${partes[0]![0]}${partes[1]![0]}`.toUpperCase();
}

interface Props {
  evento: EventoConciliacionUI;
  usuariosInternos: UsuarioInterno[];
  usuarioActualId: string;
  abrirInicial: boolean;
  /** Query string de los filtros actuales (sin `evento`) — se preserva al abrir/cerrar el Sheet. */
  queryStringFiltros: string;
  /** Selección múltiple. La gobierna la tabla, no la fila. */
  seleccionada?: boolean;
  onAlternarSeleccion?: () => void;
}

export function FilaEventoConciliacion({
  evento,
  usuariosInternos,
  usuarioActualId,
  abrirInicial,
  queryStringFiltros,
  seleccionada = false,
  onAlternarSeleccion,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(abrirInicial);
  const [isPendingAsignarme, startAsignarme] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    const params = new URLSearchParams(queryStringFiltros);
    if (next) params.set("evento", evento.id);
    else params.delete("evento");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function handleMutated() {
    router.refresh();
  }

  function asignarme(e: MouseEvent) {
    e.stopPropagation();
    startAsignarme(async () => {
      const resultado = await accionAsignarEvento(evento.id, usuarioActualId);
      if (resultado.ok) {
        toast.success("Excepción asignada a ti");
        handleMutated();
      } else {
        toast.error("No se pudo asignar la excepción", { description: resultado.mensaje });
      }
    });
  }

  const tieneReferenciaConductor = !!(evento.driverId || evento.liquidacionId);
  const tieneBloqueo = evento.bloqueaFacturacion || evento.bloqueaPago;
  const sem = semaforoVencimiento(evento.fechaLimite, evento.estado);
  const asignado = evento.asignadoAUsuarioId
    ? (usuariosInternos.find((u) => u.id === evento.asignadoAUsuarioId) ?? null)
    : null;

  return (
    <>
      <TableRow
        className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none"
        tabIndex={0}
        role="button"
        aria-label={`Ver detalle de la excepción de conciliación: ${traducirTipoDiferencia(evento.tipoDiferencia)}`}
        onClick={() => handleOpenChange(true)}
        onKeyDown={(e) => {
          // Solo cuando el foco está en la fila misma (no en un botón/link
          // anidado — "Asignarme", el menú rápido o el link al pedido ya
          // manejan su propio Enter/Space de forma nativa).
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            handleOpenChange(true);
          }
        }}
      >
        {/* La casilla NO abre el detalle: `stopPropagation` porque la fila
            entera es un botón. Sin esto, marcar cien excepciones abriría cien
            paneles. */}
        {onAlternarSeleccion ? (
          <TableCell className="px-4" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={seleccionada}
              onCheckedChange={onAlternarSeleccion}
              aria-label="Seleccionar esta excepción"
            />
          </TableCell>
        ) : null}
        <TableCell className="px-4">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant={BADGE_CATEGORIA_NEGOCIO_CONCILIACION[evento.categoriaNegocio]}
                className="w-fit text-xs"
              >
                {traducirCategoriaNegocioConciliacion(evento.categoriaNegocio)}
              </Badge>
              <Badge variant={badgeTipoDiferencia(evento.tipoDiferencia)} className="w-fit text-xs">
                {traducirTipoDiferencia(evento.tipoDiferencia)}
              </Badge>
              {tieneBloqueo && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex shrink-0 text-destructive">
                      <Lock className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">Tiene bloqueo activo</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {[evento.bloqueaFacturacion && "Bloquea facturación", evento.bloqueaPago && "Bloquea pago"]
                      .filter(Boolean)
                      .join(" · ")}
                    {evento.motivoBloqueo ? ` — ${evento.motivoBloqueo}` : ""}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {tieneReferenciaConductor && (
              <span className="text-xs text-muted-foreground">
                Conductor
                {evento.liquidacionId && (
                  <>
                    {" "}
                    · Liq. <span className="font-mono">#{evento.liquidacionId.slice(0, 8)}</span>
                  </>
                )}
              </span>
            )}
          </div>
        </TableCell>

        <TableCell className="hidden px-4 sm:table-cell">
          <BadgeEstado
            variante={BADGE_ESTADO_CONCILIACION[evento.estado]} eje="conciliacion" valor={evento.estado}
            texto={traducirEstadoConciliacion(evento.estado)}
          />
        </TableCell>

        <TableCell className="hidden px-4 md:table-cell">
          <div className="flex flex-col gap-1">
            <span className="text-xs tabular-nums text-muted-foreground">
              {evento.fechaLimite ? formatearFecha(evento.fechaLimite) : "—"}
            </span>
            <Badge variant={sem.variant} className="w-fit text-[10px]">
              {sem.etiqueta}
            </Badge>
          </div>
        </TableCell>

        <TableCell className="hidden px-4 lg:table-cell" onClick={(e) => e.stopPropagation()}>
          {asignado ? (
            <div className="flex items-center gap-1.5" title={asignado.nombreCompleto}>
              <Avatar size="sm">
                <AvatarFallback>{inicialesDeNombre(asignado.nombreCompleto)}</AvatarFallback>
              </Avatar>
              <span className="max-w-24 truncate text-xs text-muted-foreground">
                {asignado.nombreCompleto}
              </span>
            </div>
          ) : evento.asignadoAUsuarioId ? (
            <span className="text-xs text-muted-foreground">Usuario no disponible</span>
          ) : (
            <Button type="button" variant="outline" size="xs" onClick={asignarme} loading={isPendingAsignarme}>
              Asignarme
            </Button>
          )}
        </TableCell>

        <TableCell className="hidden px-4 xl:table-cell text-right">
          {evento.montoDiferenciaClp !== null ? (
            <span className="font-mono text-sm font-semibold tabular-nums text-destructive">
              {formatearCLP(evento.montoDiferenciaClp)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>

        <TableCell className="hidden px-4 2xl:table-cell text-muted-foreground">
          {evento.sellerNombre ?? "—"}
        </TableCell>

        <TableCell className="hidden px-4 2xl:table-cell">
          {evento.pedidoId ? (
            <Link
              href={`/operaciones/${evento.pedidoId}`}
              className="font-mono text-xs text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              #{evento.pedidoId.slice(0, 8)}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>

        <TableCell className="px-4 text-right" onClick={(e) => e.stopPropagation()}>
          <MenuAccionesConciliacion eventoId={evento.id} estadoActual={evento.estado} onMutated={handleMutated} />
        </TableCell>
      </TableRow>

      <PanelDetalleExcepcion
        evento={evento}
        usuariosInternos={usuariosInternos}
        open={open}
        onOpenChange={handleOpenChange}
        onMutated={handleMutated}
      />
    </>
  );
}
