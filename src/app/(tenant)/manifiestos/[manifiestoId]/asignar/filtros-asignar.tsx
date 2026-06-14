"use client";

/**
 * Filtros de la pantalla "Agregar pedidos" a un manifiesto — Client Component.
 * El seller navega al cambiar; la comuna (texto libre) navega al confirmar
 * (Enter o blur). Usa los componentes del sistema.
 */

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TODOS = "__todos__";

interface Props {
  manifiestoId: string;
  sellers: { id: string; nombre: string }[];
  seller: string;
  comuna: string;
}

export function FiltrosAsignar({ manifiestoId, sellers, seller, comuna }: Props) {
  const router = useRouter();
  const base = `/manifiestos/${manifiestoId}/asignar`;
  const [comunaLocal, setComunaLocal] = useState(comuna);

  const navegar = useCallback(
    (nextSeller: string, nextComuna: string) => {
      const params = new URLSearchParams();
      if (nextSeller) params.set("seller", nextSeller);
      if (nextComuna.trim()) params.set("comuna", nextComuna.trim());
      const qs = params.toString();
      router.push(qs ? `${base}?${qs}` : base);
    },
    [router, base],
  );

  const hayFiltros = !!(seller || comuna);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="f-seller" className="text-xs font-medium text-muted-foreground">
          Seller
        </label>
        <Select
          value={seller || TODOS}
          onValueChange={(v) => navegar(v === TODOS ? "" : v, comunaLocal)}
        >
          <SelectTrigger id="f-seller" size="default" className="h-9 w-52">
            <SelectValue placeholder="Todos los sellers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los sellers</SelectItem>
            {sellers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-comuna" className="text-xs font-medium text-muted-foreground">
          Comuna
        </label>
        <Input
          id="f-comuna"
          type="text"
          value={comunaLocal}
          placeholder="Ej: Providencia"
          onChange={(e) => setComunaLocal(e.target.value)}
          onBlur={() => comunaLocal !== comuna && navegar(seller, comunaLocal)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              navegar(seller, comunaLocal);
            }
          }}
          className="h-9 w-44"
        />
      </div>

      {hayFiltros && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setComunaLocal("");
            router.push(base);
          }}
          className="h-9 text-muted-foreground"
        >
          Limpiar
        </Button>
      )}
    </div>
  );
}
