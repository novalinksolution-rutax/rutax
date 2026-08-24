"use client";

/**
 * Los cambios que llegan mientras el coordinador trabaja.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ ESTABA MAL, Y NO ERA UN DETALLE
 * -----------------------------------------------------------------------------
 * La pantalla se refresca sola por Realtime. Suena bien y en esta pantalla no lo
 * es: **la lista se reordena bajo el cursor sin avisar**. El coordinador estaba
 * leyendo la fila 12, entra un pedido nuevo, y la fila 12 pasa a ser otra. Peor
 * cuando iba a tocar algo: el clic aterriza en un pedido que no es el que miró.
 *
 * Ahora los cambios **se acumulan y esperan**. La franja dice cuántos son y qué
 * pasó —«Llegaron 6 pedidos nuevos y 2 salieron a ruta»—, el contador sigue
 * subiendo mientras él trabaja, y **la lista se reordena solo cuando él lo
 * pide**. Al incorporar, entra todo de una vez.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ HAY UN CONTEXTO PARA ESTO
 * -----------------------------------------------------------------------------
 * El contador se muestra en dos sitios que están lejos en el árbol: el
 * **indicador de la cabecera** —que además es quien escucha a Realtime— y la
 * **franja bajo los filtros**. Entre medio hay contenido de servidor.
 *
 * Un contexto los une sin convertir la página entera en cliente: el proveedor
 * envuelve, los hijos de servidor pasan como ranura, y solo las dos piezas que
 * necesitan el número son de cliente.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL SEGURO DE LA SELECCIÓN NO ESTÁ, Y ES A PROPÓSITO
 * -----------------------------------------------------------------------------
 * El tablero pide además que, **con una selección activa, ni los cambios en
 * sitio se apliquen** — una fila seleccionada nunca cambia de estado bajo el
 * dedo. Acá no se construyó porque **Pedidos no tiene selección**: esa vive en
 * la bandeja de asignar, donde sirve para asignar en bloque. Cuando Pedidos
 * tenga una acción en bloque que la justifique, el seguro entra en este mismo
 * archivo (decisión del usuario, 24-08-2026).
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { FranjaCambiosPendientes } from "@/components/ui/cambios-pendientes";
import { IndicadorEnVivo } from "@/components/tiempo-real/indicador-en-vivo";

interface Ctx {
  pendientes: number;
  anotar: () => void;
  incorporar: () => void;
}

const CambiosCtx = createContext<Ctx | null>(null);

function useCambios(): Ctx {
  const ctx = useContext(CambiosCtx);
  if (!ctx) throw new Error("useCambios debe usarse dentro de ProveedorCambiosEnVivo");
  return ctx;
}

export function ProveedorCambiosEnVivo({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pendientes, setPendientes] = useState(0);

  const anotar = useCallback(() => setPendientes((n) => n + 1), []);
  const incorporar = useCallback(() => {
    setPendientes(0);
    router.refresh();
  }, [router]);

  const valor = useMemo(() => ({ pendientes, anotar, incorporar }), [pendientes, anotar, incorporar]);
  return <CambiosCtx.Provider value={valor}>{children}</CambiosCtx.Provider>;
}

/**
 * El indicador de la cabecera. **Es quien escucha**: al pasarle `onSenal`,
 * `IndicadorEnVivo` deja de refrescar la ruta por su cuenta y solo avisa.
 */
export function IndicadorCambiosEnVivo({ tenantId }: { tenantId: string }) {
  const { anotar } = useCambios();
  return <IndicadorEnVivo tenantId={tenantId} onSenal={anotar} />;
}

/** La franja, fija bajo los filtros. Con cero cambios no se dibuja. */
export function FranjaCambiosEnVivo() {
  const { pendientes, incorporar } = useCambios();
  return <FranjaCambiosPendientes cantidad={pendientes} onIncorporar={incorporar} />;
}
