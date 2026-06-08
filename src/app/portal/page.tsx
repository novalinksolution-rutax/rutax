import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { obtenerEstadoConexionPropia } from "./actions";
import { PanelConexionMl } from "./panel-conexion-ml";

export const metadata: Metadata = {
  title: "Mi portal",
};

/**
 * Pantalla O — Portal del seller, estado de conexión persistente (§3.2, RF-048).
 *
 * "El seller necesita, de un vistazo, saber '¿está todo bien con mi conexión?'
 * sin tener que entender qué es un token o un OAuth" — el server component
 * resuelve sesión + datos; el panel de cliente traduce `estado_salud` a
 * lenguaje humano y aloja el único control disponible: "Reconectar".
 */
export default async function PaginaPortalSeller() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    redirect("/");
  }

  const resultado = await obtenerEstadoConexionPropia();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Mi portal</h1>
        <p className="text-sm text-muted-foreground">El estado de tu conexión con Mercado Libre, de un vistazo.</p>
      </div>

      <PanelConexionMl
        estadoInicial={resultado.ok ? resultado.conexion : null}
        errorInicial={resultado.ok ? null : resultado.mensaje}
      />
    </div>
  );
}
