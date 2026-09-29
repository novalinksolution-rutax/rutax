"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completarPuestaEnMarcha } from "./actions";
import { PieDePaso } from "./pie-de-paso";

export interface RenglonCierre {
  etiqueta: string;
  valor: string;
  paso: 1 | 2 | 3 | 4;
}

/** §3.8 — resumen con cada renglón enlazado a su paso, y `Entrar`. */
export function Cierre({
  nombre,
  renglones,
}: {
  nombre: string;
  renglones: RenglonCierre[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function entrar() {
    setError(null);
    iniciar(async () => {
      const r = await completarPuestaEnMarcha();
      if (!r.ok) {
        if (r.paso) router.push(`/puesta-en-marcha?paso=${r.paso}`);
        else setError(r.mensaje);
        return;
      }
      router.replace("/dashboard");
    });
  }

  return (
    <>
      <h1 className="font-heading text-2xl font-semibold">Todo listo, {nombre}</h1>
      <dl className="mt-7 divide-y divide-line border-y border-line">
        {renglones.map((r) => (
          <div key={r.etiqueta} className="grid grid-cols-[110px_1fr] gap-3 py-3 text-sm">
            <dt className="text-fg-muted">{r.etiqueta}</dt>
            <dd>
              <Link
                href={`/puesta-en-marcha?paso=${r.paso}`}
                className="underline-offset-4 hover:underline focus-visible:underline"
              >
                {r.valor}
              </Link>
            </dd>
          </div>
        ))}
      </dl>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-fault-fg">
          {error}
        </p>
      ) : null}
      <PieDePaso volverAPaso={4} etiqueta="Entrar" cargando={pendiente} onClick={entrar} />
    </>
  );
}
