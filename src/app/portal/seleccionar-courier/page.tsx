import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { listarMisCouriersAction } from "./actions";
import { SelectorCourier } from "./selector-courier";

export const metadata: Metadata = {
  title: "Cambiar de courier",
};

/**
 * `/portal/seleccionar-courier` — el switcher multi-courier del seller
 * (RF-010 rediseño), mismo patrón que el del conductor (F4).
 *
 * Solo tiene sentido con más de una membresía: con una sola no hay nada que
 * elegir, y con cero el seller no debería estar en el portal. En ambos casos
 * se manda de vuelta a `/portal` en vez de mostrar una lista vacía o de un
 * solo renglón sin ninguna decisión que tomar.
 */
export default async function PaginaSeleccionarCourier() {
  const sesion = await obtenerSesionActual();
  if (!sesion || sesion.usuario.tipoUsuario !== "seller") {
    redirect("/login");
  }

  const resultado = await listarMisCouriersAction();

  if (!resultado.ok) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="font-heading text-2xl font-semibold">Cambiar de courier</h1>
        <Alert variant="destructive">
          <AlertDescription>{resultado.mensaje}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (resultado.couriers.length <= 1) {
    redirect("/portal");
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold">Cambiar de courier</h1>
        <p className="text-sm text-muted-foreground">
          Eres seller de {resultado.couriers.length} couriers en Rutax. Elige con cuál quieres
          operar ahora — puedes volver a cambiar cuando quieras.
        </p>
      </div>

      <SelectorCourier couriers={resultado.couriers} />
    </div>
  );
}
