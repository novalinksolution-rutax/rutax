"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { obtenerEnlaceSellerAction } from "../sellers/enlace/actions";
import type { SiguienteAccion } from "./siguiente-accion-datos";

const TITULOS: Record<SiguienteAccion, string> = {
  invitar_seller: "Invita a tu primer seller",
  sumar_conductor: "Suma a tu primer conductor",
  esperar_pedido: "Esperando el primer pedido",
};

/**
 * La única tarjeta del dashboard mientras no hay pedidos reales (§9). Sin
 * cuerpo, sin barra de completitud, sin lista de lo que viene después.
 */
export function SiguienteAccionTarjeta({ accion }: { accion: SiguienteAccion }) {
  const [url, setUrl] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [falloCopia, setFalloCopia] = useState(false);

  // El enlace se trae al montar (no al hacer clic) para que el clic copie en el
  // mismo gesto del usuario: Safari rechaza el portapapeles tras un await.
  useEffect(() => {
    if (accion !== "invitar_seller") return;
    let vigente = true;
    obtenerEnlaceSellerAction().then((r) => {
      if (vigente && r.ok && r.activo) setUrl(`${window.location.origin}/registro-seller/${r.token}`);
    });
    return () => {
      vigente = false;
    };
  }, [accion]);

  function copiar() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => {
        setFalloCopia(false);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1500);
      },
      () => setFalloCopia(true),
    );
  }

  return (
    <section className="border border-line p-6 sm:p-8" aria-labelledby="siguiente-accion-titulo">
      <h2 id="siguiente-accion-titulo" className="font-heading text-xl font-semibold">
        {TITULOS[accion]}
      </h2>
      {accion === "invitar_seller" ? (
        <div className="mt-5">
          <Button type="button" onClick={copiar} disabled={!url} className="h-10 pointer-coarse:h-12">
            {copiado ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copiado ? "Copiado" : "Copiar enlace"}
          </Button>
          {falloCopia && url ? (
            <input
              readOnly
              value={url}
              aria-label="Enlace"
              onFocus={(e) => e.currentTarget.select()}
              className="mt-3 block w-full truncate border border-line bg-bg-sunken px-2.5 py-2 font-mono text-xs"
            />
          ) : null}
        </div>
      ) : null}
      {accion === "sumar_conductor" ? (
        <div className="mt-5">
          <Button asChild className="h-10 pointer-coarse:h-12">
            <Link href="/conductores">Invitar conductor</Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}
