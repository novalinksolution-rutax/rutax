import type { ResumenPlataformas } from "@/modules/plataforma/perfil-comercial";

/**
 * «Plataformas de origen»: cuántos couriers declaran cada una. Es la métrica
 * para decidir qué integrar. Cuenta couriers, no menciones; el denominador son
 * los que respondieron (los antiguos sin fila no cuentan como «no usa»).
 */
export function ResumenPlataformasOrigen({
  resumen,
  totalCouriers,
}: {
  resumen: ResumenPlataformas;
  totalCouriers: number;
}) {
  const maximo = Math.max(1, ...resumen.plataformas.map((p) => p.couriers));

  return (
    <section aria-labelledby="titulo-plataformas" className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titulo-plataformas" className="text-sm font-medium">
          Plataformas de origen
        </h2>
        <p className="text-xs text-muted-foreground">
          {resumen.respondieron} de {totalCouriers} courier{totalCouriers === 1 ? "" : "s"} respondieron
        </p>
      </div>

      {resumen.respondieron === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no hay respuestas.</p>
      ) : (
        <>
          <ul className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {resumen.plataformas.map((p) => (
              <li key={p.valor} className="flex items-center gap-3 text-sm">
                <span className="w-44 shrink-0 truncate" title={p.etiqueta}>
                  {p.etiqueta}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${(p.couriers / maximo) * 100}%` }}
                  />
                </span>
                <span className="w-6 text-right tabular-nums">{p.couriers}</span>
              </li>
            ))}
          </ul>

          {resumen.otras.length > 0 ? (
            <div className="border-t pt-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Otras</h3>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {resumen.otras.map((o) => (
                  <li key={o.texto} className="rounded-md border bg-muted/30 px-2 py-1 text-sm">
                    {o.texto} <span className="tabular-nums text-muted-foreground">· {o.couriers}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
