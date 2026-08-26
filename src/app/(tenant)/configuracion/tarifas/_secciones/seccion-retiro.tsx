import { TriangleAlert, Info } from "lucide-react";

import {
  obtenerMontoVisitaDefaultClp,
  obtenerMontoEntregaDeRespaldoClp,
} from "@/lib/datos-tenant/config-retiro";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { FormularioRetiro } from "../../retiro/formulario-retiro";

/**
 * Retiro — la sección, antes `configuracion/retiro/page.tsx`.
 * =============================================================================
 *
 * Vive dentro del módulo de tarifas desde el 26-08-2026: es **la otra mitad de
 * lo que se le paga al conductor**. La tarifa cubre la entrega; esto cubre la
 * visita a la bodega. Dos pantallas separadas para las dos mitades del mismo
 * pago obligaban a recordar cuál era cuál.
 *
 * Un solo campo: cuánto le paga el courier al conductor por CADA visita cerrada
 * a una bodega de seller (`identidad.courier_config_retiro`, 1:1 con el tenant).
 *
 * ⚠️ **Se acota a `max-w-3xl`.** Un campo de monto no se lee mejor por estar en
 * un lienzo de 1580 px.
 */
export async function SeccionRetiro({ tenantId }: { tenantId: string }) {
  const [montoActual, montoEntregaRespaldo] = await Promise.all([
    obtenerMontoVisitaDefaultClp(tenantId),
    obtenerMontoEntregaDeRespaldoClp(tenantId),
  ]);
  const usandoRespaldo = montoActual === null && montoEntregaRespaldo !== null;
  const sinPagoPosible = montoActual === null && montoEntregaRespaldo === null;

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm leading-relaxed text-fg-muted">
        Cuánto le pagas al conductor por cada visita que hace a una bodega de seller para retirar
        pedidos.
      </p>

      {/* La otra mitad del modelo, dicha donde se pregunta. El retiro genera un
          pago al conductor y **ningún cobro al seller**: eso es una decisión del
          alcance, no un olvido, y quien configura esto se lo pregunta apenas ve
          que hay un solo campo. */}
      <p className="border border-line bg-bg-sunken px-4 py-3 text-sm leading-relaxed text-fg-muted">
        Al seller todavía no se le cobra el retiro: ese lado del modelo está vacío a propósito.
        Solo la entrega efectiva genera una línea de cobro.
      </p>

      {sinPagoPosible && (
        <div
          role="alert"
          className="rounded-lg border border-warning-subtle bg-warning-subtle px-4 py-3"
        >
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-warning-subtle-foreground">
                Las visitas a bodega no se están pagando
              </p>
              <p className="text-sm text-warning-subtle-foreground">
                No definiste un monto por visita y tus tarifas tampoco dicen cuánto le pagas al
                conductor por entrega, así que no hay de dónde sacar la cifra. Las visitas que
                cierren tus conductores quedan como excepción bloqueante en la bandeja de
                conciliación hasta que definas uno de los dos.
              </p>
            </div>
          </div>
        </div>
      )}

      {usandoRespaldo && (
        // Informativo, NO alarma: se está pagando, solo que con un valor
        // heredado. Se muestra la cifra concreta porque «usa la tarifa» no le
        // dice a nadie cuánto está saliendo cada visita.
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                Cada visita se está pagando {formatearCLP(montoEntregaRespaldo!)}
              </p>
              <p className="text-sm text-muted-foreground">
                Es el mismo monto que le pagas al conductor por una entrega, porque todavía no
                definiste uno propio para las visitas. Funciona, pero visitar una bodega y entregar
                un paquete no son el mismo trabajo: si no te calza, define el monto acá abajo.
              </p>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pago por visita a bodega</CardTitle>
          <CardDescription>
            Es el monto general de tu courier. Puedes fijar uno distinto para una bodega puntual
            desde Configuración → Bodegas — vacío ahí significa que hereda este valor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioRetiro montoActual={montoActual} />
        </CardContent>
      </Card>
    </div>
  );
}
