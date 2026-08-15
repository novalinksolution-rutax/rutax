/**
 * Punto de término de ruta del conductor — pantalla C-4 (PWA).
 *
 * Server Component: lee la sesión (el layout ya la validó — tipo conductor +
 * `driverId`) y el punto propio con `service_role`, y entrega todo a
 * `<FlujoPuntoTermino>`, que decide qué pantalla del copy mostrar.
 *
 * Fuente de verdad: `docs/seguridad/punto-de-termino-conductor.md` y
 * `docs/ux/copy-consentimiento-punto-termino.md`.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  obtenerPuntoTerminoPropio,
  type PuntoTerminoConductor,
} from "@/modules/operacion/punto-termino-conductor";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FlujoPuntoTermino } from "./_componentes/flujo-punto-termino";

export const metadata: Metadata = {
  title: "Punto de término",
};

export default async function PaginaPuntoTermino() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId || !sesion.usuario.driverId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "conductor") redirect("/conductor/manifiesto");

  const cliente = crearClienteServiceRole();

  let punto: PuntoTerminoConductor | null = null;
  let errorCarga = false;

  try {
    punto = await obtenerPuntoTerminoPropio(cliente, sesion.usuario.tenantId, sesion.usuario.driverId);
  } catch {
    errorCarga = true;
  }

  if (errorCarga) {
    return (
      <EmptyState
        icon={AlertTriangle}
        titulo="No pudimos cargar tu punto de término"
        descripcion="Revisa tu conexión e inténtalo de nuevo."
        accion={
          <form action="/conductor/punto-termino">
            <Button type="submit" size="lg">
              Reintentar
            </Button>
          </form>
        }
      />
    );
  }

  return <FlujoPuntoTermino puntoInicial={punto} />;
}
