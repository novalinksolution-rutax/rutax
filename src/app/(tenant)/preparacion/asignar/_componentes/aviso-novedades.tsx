"use client";

/**
 * "Hay pedidos nuevos disponibles. [Actualizar]" — la ÚNICA superficie de
 * tiempo real sobre la tabla (§8). `IndicadorEnVivo` (en `bandeja-asignar.tsx`)
 * enciende esto vía su prop `onSenal` en vez de refrescar solo: si la tabla
 * se recolocara mientras el coordinador hace clic, el clic siguiente caería
 * sobre el pedido equivocado.
 */

import { Button } from "@/components/ui/button";

interface Props {
  onActualizar: () => void;
}

export function AvisoNovedades({ onActualizar }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-info-subtle-foreground/20 bg-info-subtle px-3 py-2 text-sm text-info-subtle-foreground">
      <span>Hay pedidos nuevos disponibles.</span>
      <Button type="button" variant="outline" size="sm" onClick={onActualizar}>
        Actualizar
      </Button>
    </div>
  );
}
