"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { PERIODOS, type Periodo } from "../_lib/periodo";

/** Selector simple de período — recarga la página con `?periodo=` (cálculo en el server). */
export function SelectorPeriodo({ periodoActual }: { periodoActual: Periodo }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className="inline-flex gap-1 rounded-lg border bg-muted/40 p-1">
      {PERIODOS.map((opcion) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("periodo", opcion.valor);
        const activo = opcion.valor === periodoActual;
        return (
          <Link
            key={opcion.valor}
            href={`${pathname}?${params.toString()}`}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              activo
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opcion.etiqueta}
          </Link>
        );
      })}
    </div>
  );
}
