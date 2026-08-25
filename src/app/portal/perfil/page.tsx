import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { obtenerWhatsAppDelSeller } from "./actions";
import { PanelWhatsAppDelSeller } from "./panel-whatsapp";

export const metadata: Metadata = {
  title: "Mi perfil",
};

/**
 * `/portal/perfil` — los datos que el seller administra de sí mismo.
 *
 * Hoy solo su WhatsApp. Existe porque el campo se pide al activar la cuenta, y
 * quien la activó antes de que ese campo existiera no vuelve a pasar por ahí:
 * sin esta pantalla se quedaban sin número para siempre. Y porque un
 * consentimiento que no se puede retirar desde donde se dio no es un
 * consentimiento.
 */
export default async function PaginaPerfilSeller() {
  const sesion = await obtenerSesionActual();
  if (!sesion || sesion.usuario.tipoUsuario !== "seller") redirect("/portal");

  const whatsapp = await obtenerWhatsAppDelSeller();
  if (!whatsapp) redirect("/portal");

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-fg">Mi perfil</h1>
        <p className="text-fg-muted">Cómo te contactamos.</p>
      </header>

      <PanelWhatsAppDelSeller datos={whatsapp} />
    </div>
  );
}
