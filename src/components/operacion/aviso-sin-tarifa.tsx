/**
 * El aviso "esto se va a entregar y no se va a poder cobrar" — un banner por
 * seller sin tarifa vigente.
 *
 * Extraído de `preparacion/_componentes/cierre-del-dia.tsx` (Etapa 5) para
 * reusarlo, IDÉNTICO, en la bandeja de asignación (Etapa 6) y en "Registrar
 * retiro": las tres pantallas hacen la misma pregunta —¿hay un seller con
 * carga hoy y sin tarifa configurada?— y tienen que dar la misma respuesta,
 * con la misma cara. Quien resuelve QUÉ pedidos entran a esta lista es
 * distinto en cada pantalla (`obtenerExpectativaDelDia` en Preparación,
 * `detectarPedidosSinTarifa` de `@/modules/operacion/tarifas` en las otras
 * dos) — este componente solo dibuja el resultado.
 *
 * Ámbar (`attention-*`) y NUNCA rojo (`fault-*`): no bloquea nada, es un
 * reparo del dinero, no una incidencia operativa.
 */

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SellerSinTarifa } from "@/modules/operacion/retiro/expectativa";

export function AvisoSinTarifa({ sinTarifa }: { sinTarifa: readonly SellerSinTarifa[] }) {
  if (sinTarifa.length === 0) return null;

  return (
    <div className="space-y-2">
      {sinTarifa.map((seller) => (
        <div
          key={seller.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-attention-line bg-attention-bg px-3 py-2.5 text-sm text-attention-fg"
          role="status"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span>
            <strong className="font-medium">{seller.nombre}</strong> no tiene tarifa
            configurada, así que {textoEntregas(seller.bultos)} no se podrían cobrar.
          </span>
          {/* La acción va PEGADA al aviso: mandar a buscar la pantalla de
              tarifas es perder justamente el margen que este aviso ganó. */}
          <Button asChild size="sm" variant="outline" className="ms-auto">
            <Link href={`/configuracion/tarifas?seller=${encodeURIComponent(seller.id)}`}>
              Configurar la tarifa
            </Link>
          </Button>
        </div>
      ))}
    </div>
  );
}

function textoEntregas(bultos: number): string {
  return bultos === 1 ? "esa entrega" : `esas ${bultos} entregas`;
}
