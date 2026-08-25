import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerPanelCuentas } from "@/modules/plataforma/panel-cuentas";
import { tieneSesionAdmin } from "../sesion-admin";
import { TablaCuentas } from "./tabla-cuentas";

export const metadata: Metadata = {
  title: "Cuentas · Rutax Admin",
};

// Refleja estados de cuenta en vivo; nunca cachear.
export const dynamic = "force-dynamic";

/**
 * `/admin/cuentas` — todas las cuentas de Rutax, de todos los couriers.
 *
 * Nace de un incidente concreto (2026-08-25): una cuenta de seller quedó
 * destruida porque se invitó al mismo correo como conductor, y `aceptarInvitacion`
 * le sobrescribió el perfil. Nadie se enteró — el listado del courier decía
 * «Invitado» y la invitación decía «aceptada» a la vez.
 *
 * Desde entonces `crearInvitacion` lo impide. Esta pantalla existe para lo que
 * la barrera NO puede hacer: encontrar lo que ya está mal, y las invitaciones
 * creadas antes de la barrera que siguen vivas y siguen siendo peligrosas.
 */
export default async function PaginaCuentasAdmin() {
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  let panel: Awaited<ReturnType<typeof obtenerPanelCuentas>> | null = null;
  try {
    panel = await obtenerPanelCuentas();
  } catch {
    panel = null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Cuentas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quién puede entrar a Rutax, en todos los couriers. Y lo que está mal: cuentas sin perfil,
          fichas sin cuenta, e invitaciones pendientes que van a sobrescribir una cuenta existente.
        </p>
      </div>

      {panel === null ? (
        <div role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm">
          No se pudieron cargar las cuentas.
        </div>
      ) : (
        <>
          {panel.resumen.invitacionesEnConflicto > 0 ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm">
              <p className="font-medium">
                {panel.resumen.invitacionesEnConflicto}{" "}
                {panel.resumen.invitacionesEnConflicto === 1
                  ? "invitación pendiente va a sobrescribir una cuenta"
                  : "invitaciones pendientes van a sobrescribir una cuenta"}
                .
              </p>
              <p className="mt-1 text-muted-foreground">
                Son anteriores a la barrera que hoy lo impide. Al canjearse, el perfil de la cuenta
                actual se pierde. Revócalas antes de que alguien abra ese enlace.
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-4">
            <Dato rotulo="Cuentas" valor={panel.resumen.total} />
            <Dato rotulo="Con algo que revisar" valor={panel.resumen.conMarca} />
            <Dato rotulo="Sin perfil" valor={panel.resumen.sinPerfil} />
            <Dato rotulo="Nunca activaron" valor={panel.resumen.invitadosSinActivar} />
          </div>

          <TablaCuentas cuentas={panel.cuentas} sinCuenta={panel.sinCuenta} />
        </>
      )}
    </div>
  );
}

function Dato({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-2xl font-semibold tabular-nums">{valor}</div>
      <div className="text-sm text-muted-foreground">{rotulo}</div>
    </div>
  );
}
