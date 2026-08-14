"use client";

/**
 * "El resultado — nunca '28 de 30' a secas" (§7.5). Solo se monta cuando SÍ
 * hubo omisiones (el caso sin omisiones se resuelve con un `toast.success`
 * en `bandeja-asignar.tsx`) — es un `Dialog` que NO se autocierra: hay algo
 * que el coordinador tiene que leer.
 *
 * Tres bloques, nunca un balde único: éxito (encabezado) · neutro
 * (`ya_estaba_en_manifiesto`) · ámbar ("no se pudo asignar"). Rojo: nunca —
 * nada de esto es una incidencia abierta.
 */

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clasificarResultado, type ResultadoAsignacionEnBloque } from "../_lib/resultado";
import {
  ofreceVerPedido,
  textoMotivoNoAsignado,
  textoNoSePudoAsignar,
  textoQuedaronCon,
  textoReasignadosDesdeOtro,
  textoYaEstabaCon,
} from "../_lib/textos";
import type { PedidoSeleccionado } from "../_lib/seleccion";

interface Props {
  resultado: ResultadoAsignacionEnBloque | null;
  fotos: ReadonlyMap<string, PedidoSeleccionado>;
  conductorNombre: string;
  onClose: () => void;
}

export function DialogoResultado({ resultado, fotos, conductorNombre, onClose }: Props) {
  if (!resultado) return null;

  const clasificado = clasificarResultado(resultado, fotos);
  // Sin omisiones se resuelve con un toast (§7.5, primer caso) — este
  // diálogo solo existe para el caso "con omisiones".
  if (!clasificado.huboOmisiones) return null;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resultado de la asignación</DialogTitle>
          <DialogDescription>
            {textoQuedaronCon(clasificado.totalQuedaronCon, conductorNombre)}
            {clasificado.totalReasignadosDesdeOtro > 0 && (
              <span className="mt-0.5 block">{textoReasignadosDesdeOtro(clasificado.totalReasignadosDesdeOtro)}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 space-y-4 overflow-y-auto">
          {clasificado.yaEnManifiesto.length > 0 && (
            <div className="space-y-1.5 border-t border-border pt-3">
              <p className="text-sm text-muted-foreground">
                {textoYaEstabaCon(clasificado.yaEnManifiesto.length, conductorNombre)}
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {clasificado.yaEnManifiesto.map((item) => (
                  <li key={item.pedidoId}>
                    · {item.codigoVisible} · {item.comuna ?? "Sin comuna"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {clasificado.noSePudoAsignar.length > 0 && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-warning-subtle-foreground">
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                {textoNoSePudoAsignar(clasificado.noSePudoAsignar.length)}
              </p>
              <ul className="space-y-2">
                {clasificado.noSePudoAsignar.map((item) => (
                  <li
                    key={item.pedidoId}
                    className="rounded-lg bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-foreground"
                  >
                    <p>
                      · {item.codigoVisible} · {item.comuna ?? "Sin comuna"}
                    </p>
                    <p className="mt-0.5">{textoMotivoNoAsignado(item.motivo)}</p>
                    {ofreceVerPedido(item.motivo) && (
                      <Button
                        asChild
                        variant="link"
                        size="sm"
                        className="mt-1 h-auto p-0 text-warning-subtle-foreground underline"
                      >
                        <Link href={`/operaciones/${item.pedidoId}`}>Ver pedido</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
