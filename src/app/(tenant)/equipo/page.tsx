import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarUsuariosYRoles, puedeInvitarUsuarios, puedeRevocarInvitaciones } from "@/modules/identidad/capacidades";
import { obtenerEstadoEquipo } from "./actions";
import {
  PantallaConfiguracion,
  SinPermisoConfiguracion,
} from "../configuracion/_componentes/pantalla-configuracion";
import { PanelEquipo } from "./panel-equipo";

export const metadata: Metadata = {
  title: "Equipo",
};

/**
 * Pantalla H — Lista de usuarios e invitaciones (RF-005, §2.2).
 *
 * "Una sola tabla con dos grupos visuales" — el dueño/admin necesita ver, en
 * un vistazo, "quién tiene acceso, con qué rol, y qué invitaciones están en
 * el aire" sin ir a buscar en dos lugares distintos. El server component
 * resuelve sesión + capacidades; el panel de cliente arma pestañas/filtro y
 * abre la Pantalla I (formulario de invitación) en un panel lateral.
 */
export default async function PaginaEquipo() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  if (!puedeGestionarUsuariosYRoles(sesion.usuario)) {
    return (
      <SinPermisoConfiguracion frase="El equipo y sus roles solo los pueden ver y cambiar el dueño de la cuenta o administración." />
    );
  }

  const resultado = await obtenerEstadoEquipo();

  // El recuento en la cabecera: cuánta gente tiene acceso y cuántas invitaciones
  // siguen sin aceptarse. Es lo que se viene a mirar, y estaba solo dentro de la
  // tabla.
  const personas = resultado.ok ? resultado.estado.usuarios.length : null;
  const pendientes = resultado.ok
    ? resultado.estado.invitaciones.filter((i) => i.estado === "pendiente").length
    : 0;

  return (
    <PantallaConfiguracion
      titulo="Equipo"
      bajada={
        personas === null
          ? "Quién tiene acceso a tu cuenta, con qué rol, y qué invitaciones siguen pendientes."
          : `${personas} ${personas === 1 ? "persona" : "personas"} con acceso${
              pendientes > 0
                ? ` · ${pendientes} ${pendientes === 1 ? "invitación pendiente" : "invitaciones pendientes"}`
                : ""
            }.`
      }
      ancho="tabla"
    >

      <PanelEquipo
        estadoInicial={resultado.ok ? resultado.estado : null}
        errorInicial={resultado.ok ? null : resultado.mensaje}
        puedeInvitar={puedeInvitarUsuarios(sesion.usuario)}
        puedeRevocar={puedeRevocarInvitaciones(sesion.usuario)}
        puedeGestionar={puedeGestionarUsuariosYRoles(sesion.usuario)}
      />
    </PantallaConfiguracion>
  );
}
