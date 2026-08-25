import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerPanelDestinatarios } from "@/modules/plataforma/whatsapp-destinatarios";
import { tieneSesionAdmin } from "../sesion-admin";
import { TablaDestinatarios } from "./tabla-destinatarios";

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A quién le avisamos cuando se retiran pedidos. El número propio lo pone cada seller en su
          portal; acá se pueden sumar otros —su pareja, su jefe de bodega— y detener los que
          reclamen.
        </p>
      </div>

      {panel === null ? (
        <div role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm">
          No se pudieron cargar los destinatarios.
        </div>
      ) : (
        <>
          {/*
            El contador que existe para que no sea un silencio: un seller sin
            número con consentimiento NO recibe su aviso de retiro y nada falla
            — el envío termina en `sin_destinatarios` y el run queda verde. Es
            la clase de agujero que se descubre tres semanas después.
          */}
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
                Sus retiros se cierran igual, pero nadie se entera. De esos,{" "}
                {panel.sellersInvitadosSinNumero} nunca ha entrado al portal, así que no ha tenido
                dónde dejar su número.
              </p>
            </div>
          ) : null}

          <TablaDestinatarios sellers={panel.sellers} />
        </>
      )}
    </div>
  );
}
