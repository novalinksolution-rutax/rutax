"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { accionInactivarTarifa } from "./actions";

export function BotonInactivarTarifa({ tarifaId }: { tarifaId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const resultado = await accionInactivarTarifa(tarifaId);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={handleClick}
        disabled={isPending}
        aria-label="Inactivar tarifa"
      >
        {isPending ? "..." : "Inactivar"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
