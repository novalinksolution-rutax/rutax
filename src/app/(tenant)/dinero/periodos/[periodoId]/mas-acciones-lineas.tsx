"use client";

import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Exportar y cruzar con el pago al conductor: se usan de vez en cuando, así que
 * van en un ⋯ y no como tres enlaces sueltos sobre la tabla.
 */
export function MasAccionesLineas({ periodoId }: { periodoId: string }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Más acciones de las líneas"
          className="size-11 md:size-8"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem asChild className="min-h-11 md:min-h-0">
          <a href={`/dinero/periodos/${periodoId}/exportar`}>Exportar CSV</a>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11 md:min-h-0"
          onSelect={() => router.push(`/dinero/reporteria?periodo=${periodoId}`)}
        >
          Ver con el pago al conductor
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
