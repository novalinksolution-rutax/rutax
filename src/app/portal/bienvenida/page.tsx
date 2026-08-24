import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { Button } from "@/components/ui/button";
import { EstadoError } from "@/components/onboarding/estado-pantalla";
import { obtenerDatosBienvenida } from "./actions";

export const metadata: Metadata = {
  title: "Bienvenida",
};

/**
 * Pantalla L — Bienvenida del seller (primera pantalla tras aceptar la
 * invitación, §3.2).
 *
 * "Cierra la brecha de contexto antes de pedir la acción más delicada":
 * explica qué es la plataforma, qué gana el seller (RF-048: tracking,
 * estado de cuenta, incidencias) y anticipa el paso de conexión con ML —
 * para que la Pantalla M no llegue como una sorpresa. Una sola variante
 * informativa, botón único "Continuar" → Pantalla M.
 */
export default async function PaginaBienvenidaSeller() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    // Esta pantalla es exclusiva del onboarding del seller — un usuario
    // interno o conductor que llegue aquí por error no debería ver una
    // pantalla en blanco ni un 404 ("ocultar no basta", recuerda CLAUDE.md).
    redirect("/");
  }

  const resultado = await obtenerDatosBienvenida();

  if (!resultado.ok) {
    return (
      <div className="mx-auto max-w-xl">
        <EstadoError descripcion={resultado.mensaje} />
      </div>
    );
  }

  const { nombreCourier, razonSocialSeller } = resultado.datos;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <CheckCircle2 className="size-7" aria-hidden="true" />
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {nombreCourier} te invitó a su portal de despachos
        </h1>
        <p className="text-sm text-muted-foreground">
          Hola {razonSocialSeller}, esta es la plataforma donde {nombreCourier} gestiona tus envíos. Aquí vas a poder
          seguir tus pedidos, ver lo que te cobran y reportar un problema sin tener que escribir por WhatsApp.
        </p>
      </div>

      {/* TRES PASOS CON DESTINO, no tres beneficios en prosa.
          ------------------------------------------------------------------
          Eran tres frases sueltas y un solo botón. Un seller que llega acá no
          quiere saber qué puede hacer: quiere saber **qué le toca hacer
          primero**. Cada paso lleva a su pantalla.

          Y la tercera frase decía «Reporta incidencias directo desde aquí —
          quedan registradas y con seguimiento» cuando esa acción NO EXISTÍA en
          ninguna parte del portal. Ahora existe, así que el texto se puede
          sostener. */}
      <ol className="w-full space-y-2 text-left">
        <PasoBienvenida
          numero={1}
          titulo="Conecta tus cuentas"
          detalle="Mercado Libre o tu tienda Shopify. Desde ahí tus pedidos entran solos, sin que tengas que copiar direcciones."
          href="/portal/conectar-ml"
          accion="Conectar"
        />
        <PasoBienvenida
          numero={2}
          titulo="Revisa tus bodegas de retiro"
          detalle={`Son las direcciones donde ${nombreCourier} va a pasar a buscar tus bultos. Si alguna está mal, avísales.`}
          href="/portal/bodegas"
          accion="Ver bodegas"
        />
        <PasoBienvenida
          numero={3}
          titulo="Mira tus cobros"
          detalle="Ahí ves lo que se te va cobrando por cada entrega, y la factura cuando se emita."
          href="/portal/cobros"
          accion="Ver cobros"
        />
      </ol>

      <Button asChild size="lg" className="w-full sm:w-auto">
        <Link href="/portal/conectar-ml">Empezar por conectar mis cuentas</Link>
      </Button>
    </div>
  );
}


/** Un paso de la bienvenida: número, qué es, y a dónde lleva. */
function PasoBienvenida({
  numero,
  titulo,
  detalle,
  href,
  accion,
}: {
  numero: number;
  titulo: string;
  detalle: string;
  href: string;
  accion: string;
}) {
  return (
    <li className="flex items-start gap-3 border border-line bg-bg-raised px-4 py-3">
      <span className="rx-num mt-0.5 flex size-6 shrink-0 items-center justify-center border border-line text-xs text-fg-muted">
        {numero}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-fg">{titulo}</span>
        <span className="mt-0.5 block text-sm leading-snug text-fg-muted">{detalle}</span>
      </span>
      <Link
        href={href}
        className="shrink-0 self-center text-sm font-medium text-accent-text hover:underline"
      >
        {accion} ›
      </Link>
    </li>
  );
}
