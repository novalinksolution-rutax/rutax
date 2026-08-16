import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { obtenerConexionesPropia } from "./actions";
import { obtenerConexionesShopifyPropia } from "./acciones-shopify";
import { PanelConexionesMl } from "./panel-conexion-ml";
import { PanelConexionesShopify } from "./panel-conexion-shopify";
import { WidgetSlaSeller } from "./widget-sla-seller";
import { TablaHistorialSla } from "./tabla-historial-sla";

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

  const [resultado, conexionesShopify] = await Promise.all([
    obtenerConexionesPropia(),
    obtenerConexionesShopifyPropia(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Mi portal</h1>
        <p className="text-sm text-muted-foreground">El estado de tu cuenta y cómo van tus entregas, de un vistazo.</p>
      </div>

      {/* Semáforo SLA — el seller ve solo su propio % (F7, ítem 1.2) */}
      <WidgetSlaSeller
        tenantId={sesion.usuario.tenantId}
        sellerId={sesion.usuario.sellerId}
      />

      {/* Historial de SLA — últimas 4 semanas (F13) */}
      <TablaHistorialSla
        tenantId={sesion.usuario.tenantId}
        sellerId={sesion.usuario.sellerId}
      />

      <PanelConexionesMl
        conexionesIniciales={resultado.ok ? resultado.conexiones : []}
        errorInicial={resultado.ok ? null : resultado.mensaje}
      />

      <PanelConexionesShopify conexionesIniciales={conexionesShopify} />
    </div>
  );
}
