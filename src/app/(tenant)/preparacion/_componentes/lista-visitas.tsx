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
}: {
  errorVisitas: boolean;
  abiertas: readonly VisitaRetiroResumenCourier[];
  cerradas: readonly VisitaRetiroResumenCourier[];
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
                  <TarjetaVisita key={v.sesionId} visita={v} />
                ))}
              </div>
            </div>
          )}

          {cerradas.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">De vuelta ({cerradas.length})</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {cerradas.map((v) => (
                  <TarjetaVisita key={v.sesionId} visita={v} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
