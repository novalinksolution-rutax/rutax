"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Navegación entre las dos pestañas de Consumo (Costos / Uso). No hay
 * componente de tabs/segmented reusable en el repo para navegación por URL
 * (los `Tabs` de shadcn cambian de panel en el cliente, no de ruta) — se
 * arman como enlaces estilados, mismo patrón visual que un segmented control.
 * El período seleccionado (`?periodo=`) se preserva al cambiar de pestaña.
 */
export function TabsConsumo() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const sufijo = qs ? `?${qs}` : "";

  const tabs = [
    { href: "/admin/consumo", etiqueta: "Costos" },
    { href: "/admin/consumo/uso", etiqueta: "Uso" },
  ];

  return (
    <div role="tablist" className="inline-flex gap-1 rounded-lg border bg-muted/40 p-1">
      {tabs.map((tab) => {
        const activo = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={`${tab.href}${sufijo}`}
            role="tab"
            aria-selected={activo}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              activo
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.etiqueta}
          </Link>
        );
      })}
    </div>
  );
}
