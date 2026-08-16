import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import { obtenerMontoVisitaDefaultClp } from "@/lib/datos-tenant/config-retiro";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormularioRetiro } from "./formulario-retiro";

export const metadata: Metadata = {
  title: "Retiro en bodega",
};

/**
 * Configuración → Retiro (etapa 8 de "retiro en bodega + ruteo").
 *
 * Un solo campo: cuánto le paga el courier al conductor por CADA visita
 * cerrada a una bodega de seller (`identidad.courier_config_retiro`, 1:1 con
 * el tenant). La AUSENCIA de fila significa "sin configurar" — nunca $0 — y
 * mientras no exista, el generador de líneas de dinero levanta una excepción
 * bloqueante en vez de liquidar $0 (misma lección que
 * `identidad.tarifas.monto_conductor_clp`, ver el comentario de esa columna
 * en `configuracion/tarifas/dialog-tarifa.tsx`). Por eso esta pantalla no
 * trata el vacío como un estado neutro: lo anuncia arriba de todo, con su
 * consecuencia operativa.
 *
 * RBAC: `gestionar_tarifas` — ver la justificación en `./actions.ts`.
 */
export default async function PaginaConfiguracionRetiro() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (!puedeGestionarTarifas(sesion.usuario)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Sin permiso para ver esta sección</p>
          <p className="text-sm text-muted-foreground">
            La configuración del pago por retiro es exclusiva del dueño o administración.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard">Volver al dashboard</Link>
        </Button>
      </div>
    );
  }

  const tenantId = sesion.usuario.tenantId;
  const montoActual = await obtenerMontoVisitaDefaultClp(tenantId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Retiro en bodega</h1>
        <p className="text-sm text-muted-foreground">
          Define cuánto le pagas al conductor por cada visita que hace a una bodega de seller para
          retirar pedidos.
        </p>
      </div>

      {montoActual === null && (
        <div role="alert" className="rounded-lg border border-warning-subtle bg-warning-subtle px-4 py-3">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-warning-subtle-foreground">
                Todavía no configuras este pago
              </p>
              <p className="text-sm text-warning-subtle-foreground">
                Mientras no definas un monto, las visitas a bodega que cierren tus conductores NO
                generan su pago: quedan como excepción bloqueante en la bandeja de conciliación.
                No es un campo opcional.
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
