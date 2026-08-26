import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TriangleAlert, Info } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import {
  obtenerMontoVisitaDefaultClp,
  obtenerMontoEntregaDeRespaldoClp,
} from "@/lib/datos-tenant/config-retiro";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PantallaConfiguracion,
  SinPermisoConfiguracion,
} from "../_componentes/pantalla-configuracion";
import { FormularioRetiro } from "./formulario-retiro";

export const metadata: Metadata = {
  title: "Retiro en bodega",
};

/**
 * Configuración → Retiro (etapa 8 de "retiro en bodega + ruteo").
 *
 * Un solo campo: cuánto le paga el courier al conductor por CADA visita
 * cerrada a una bodega de seller (`identidad.courier_config_retiro`, 1:1 con
 * el tenant).
 *
 * TRES ESTADOS, y la pantalla los distingue porque significan cosas distintas:
 *
 * 1. **Configurado** — se usa ese monto y punto.
 * 2. **Sin configurar, pero con tarifa de entrega útil** — se paga cada visita
 *    al MISMO valor que una entrega (decisión del usuario, 2026-08-16). No es
 *    una equivalencia real —visitar una bodega y entregar un paquete no son el
 *    mismo trabajo— así que se muestra como aviso informativo, no como si
 *    estuviera todo resuelto.
 * 3. **Sin configurar y sin tarifa útil** — las visitas NO generan pago y
 *    quedan como excepción bloqueante en conciliación. Ese es el estado que se
 *    anuncia arriba de todo, en ámbar.
 *
 * ⚠️ El respaldo del caso 2 exige `monto_conductor_clp > 0`: esa columna nació
 * con `default 0` y ningún formulario la escribía, así que caer a ese cero
 * sería liquidar $0 en silencio — el bug exacto que esto viene a evitar.
 *
 * RBAC: `gestionar_tarifas` — ver la justificación en `./actions.ts`.
 */
export default async function PaginaConfiguracionRetiro() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (!puedeGestionarTarifas(sesion.usuario)) {
    return (
      <SinPermisoConfiguracion frase="El pago por retiro solo lo pueden ver y cambiar el dueño de la cuenta o administración." />
    );
  }

  const tenantId = sesion.usuario.tenantId;
  const [montoActual, montoEntregaRespaldo] = await Promise.all([
    obtenerMontoVisitaDefaultClp(tenantId),
    obtenerMontoEntregaDeRespaldoClp(tenantId),
  ]);
  const usandoRespaldo = montoActual === null && montoEntregaRespaldo !== null;
  const sinPagoPosible = montoActual === null && montoEntregaRespaldo === null;

  return (
    <PantallaConfiguracion
      titulo="Retiro en bodega"
      bajada="Cuánto le pagas al conductor por cada visita que hace a una bodega de seller para retirar pedidos."
    >
      {/* La otra mitad del modelo, dicha donde se pregunta. El retiro genera un
          pago al conductor y **ningún cobro al seller**: eso es una decisión
          del alcance, no un olvido, y quien configura esta pantalla se lo
          pregunta apenas ve que hay un solo campo. */}
      <p className="border border-line bg-bg-sunken px-4 py-3 text-sm leading-relaxed text-fg-muted">
        Al seller todavía no se le cobra el retiro: ese lado del modelo está vacío a propósito.
        Solo la entrega efectiva genera una línea de cobro.
      </p>

      {sinPagoPosible && (
        <div role="alert" className="rounded-lg border border-warning-subtle bg-warning-subtle px-4 py-3">
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
        // heredado. Se muestra la cifra concreta porque "usa la tarifa" no le
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
    </PantallaConfiguracion>
  );
}
