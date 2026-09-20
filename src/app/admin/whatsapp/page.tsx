import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerPanelDestinatarios } from "@/modules/plataforma/whatsapp-destinatarios";
import { obtenerTodasSuscripciones } from "@/modules/plataforma/consultas";
import { obtenerPanelCanalConsulta } from "@/modules/conversacion";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { tieneSesionAdmin } from "../sesion-admin";
import { TablaDestinatarios } from "./tabla-destinatarios";
import { PanelCanalConsulta } from "./panel-canal-consulta";

export const metadata: Metadata = {
  title: "WhatsApp · Rutax Admin",
};

// Refleja consentimientos en vivo; nunca cachear.
export const dynamic = "force-dynamic";

/**
 * `/admin/whatsapp` — a quién le escribe Rutax, en todos los couriers.
 *
 * WhatsApp lo administra Rutax y no el courier (decisión del usuario,
 * 2026-08-25): el emisor es nuestro número, la calidad que Meta le asigna es
 * compartida por todos los tenants, y quien responde por un mensaje no deseado
 * somos nosotros. Esta es la única pantalla desde la que se ve el conjunto.
 */
export default async function PaginaWhatsAppAdmin() {
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  let panel: Awaited<ReturnType<typeof obtenerPanelDestinatarios>> | null = null;
  try {
    panel = await obtenerPanelDestinatarios();
  } catch {
    panel = null;
  }

  // Ventana de contadores del canal de consulta: últimas 24 h, igual que el
  // resto de contadores "en vivo" del backstage (sin asumir el día calendario
  // de Santiago, que no aporta nada acá).
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - 24 * 60 * 60 * 1000);

  let canalConsulta: Awaited<ReturnType<typeof obtenerPanelCanalConsulta>> | null = null;
  try {
    const suscripciones = await obtenerTodasSuscripciones();
    const cliente = crearClienteServiceRole();
    canalConsulta = await obtenerPanelCanalConsulta(
      cliente,
      suscripciones.map((s) => ({
        tenantId: s.tenantId,
        nombreCourier: s.nombreFantasiaTenant ?? `${s.tenantId.slice(0, 8)}…`,
      })),
      desde,
      hasta,
    );
  } catch {
    canalConsulta = null;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Consultas</h2>
        {canalConsulta === null ? (
          <div role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm">
            No se pudo cargar el canal de consulta.
          </div>
        ) : (
          <PanelCanalConsulta couriers={canalConsulta.couriers} globales={canalConsulta.globales} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Destinatarios de avisos de retiro</h2>
        <p className="text-sm text-muted-foreground">
          El número propio lo pone cada seller en su portal; acá se pueden sumar otros —su pareja,
          su jefe de bodega— y detener los que reclamen.
        </p>

        {panel === null ? (
          <div role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm">
            No se pudieron cargar los destinatarios.
          </div>
        ) : (
          <>
            {panel.sellersSinDestinatario > 0 ? (
              <div className="rounded-lg border border-warning/50 bg-warning/5 p-4 text-sm">
                <p className="font-medium">
                  {panel.sellersSinDestinatario}{" "}
                  {panel.sellersSinDestinatario === 1
                    ? "seller no recibe avisos"
                    : "sellers no reciben avisos"}
                  .
                </p>
                <p className="mt-1 text-muted-foreground">
                  De esos, {panel.sellersInvitadosSinNumero} nunca ha entrado al portal.
                </p>
              </div>
            ) : null}

            <TablaDestinatarios sellers={panel.sellers} />
          </>
        )}
      </section>
    </div>
  );
}
