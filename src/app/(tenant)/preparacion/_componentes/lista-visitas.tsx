/**
 * "Visitas de hoy" — Server Component. Maneja SU PROPIO estado de error
 * (§5.3): si la consulta de visitas falló, este bloque lo dice y el resto de
 * la pantalla (franja, carga por comuna, asignación) sigue en pie.
 *
 * "En bodega ahora" nunca se colapsa (§10): es la lista que hay que poder
 * barrer entera de un vistazo. La provisión de escala de "De vuelta" (colapsar
 * sobre 8 tarjetas) queda prevista pero no construida en la Etapa 5.
 */

import type { VisitaRetiroResumenCourier } from "@/modules/operacion/retiro/preparacion";
import { TarjetaVisita } from "./tarjeta-visita";

export function ListaVisitas({
  errorVisitas,
  abiertas,
  cerradas,
  esperadosPorSeller,
}: {
  errorVisitas: boolean;
  abiertas: readonly VisitaRetiroResumenCourier[];
  cerradas: readonly VisitaRetiroResumenCourier[];
  /** Bultos esperados hoy por seller, para el denominador de cada visita. */
  esperadosPorSeller?: Record<string, number> | null;
}) {
  return (
    <section aria-labelledby="visitas-de-hoy-heading" className="space-y-4">
      <h2 id="visitas-de-hoy-heading" className="text-sm font-semibold text-muted-foreground">
        Visitas de hoy
      </h2>

      {errorVisitas ? (
        <div
          role="alert"
          className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
        >
          No pudimos cargar las visitas de hoy. Intenta recargar la página.
        </div>
      ) : (
        <div className="space-y-6">
          {abiertas.length === 0 ? (
            // El bloque "En bodega ahora" se RETIRA entero (§5.7): no queda ni
            // el encabezado numerado, solo esta línea.
            <p className="text-sm text-muted-foreground">Todos los conductores ya volvieron.</p>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">En bodega ahora ({abiertas.length})</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {abiertas.map((v) => (
                  <TarjetaVisita
                    key={v.sesionId}
                    visita={v}
                    esperados={esperadosPorSeller?.[v.seller.id] ?? null}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Lo cerrado se COLAPSA a una línea. Una visita cerrada ya no es una
              decisión: aportó sus bultos y se fue. Con tarjeta completa cada una,
              a media tarde el bloque de lo terminado tapa el de lo que está
              pasando — que es lo único sobre lo que se puede actuar. El detalle
              de cada acta sigue en su visita, a un clic desde el pedido. */}
          {cerradas.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              <strong className="font-medium text-foreground tabular-nums">
                {cerradas.length}
              </strong>{" "}
              {cerradas.length === 1 ? "visita cerrada" : "visitas cerradas"} hoy ·{" "}
              <span className="tabular-nums">{bultosCerrados(cerradas)}</span> bultos
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Los bultos que aportaron las visitas ya cerradas, por su acta. */
function bultosCerrados(cerradas: readonly VisitaRetiroResumenCourier[]): number {
  // Por el ACTA y no por el conteo vivo: el acta es lo que el conductor firmó, y
  // un escaneo que llegó después del cierre no se le suma (ver `tarjeta-visita`).
  return cerradas.reduce((s, v) => s + (v.acta?.total ?? 0), 0);
}
