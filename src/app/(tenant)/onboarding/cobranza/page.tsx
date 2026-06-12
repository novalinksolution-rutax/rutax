import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeVerConciliacion } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { obtenerEstadoConfiguracionCobranza } from "./actions";
import { FormularioConexionCobranza } from "./formulario-conexion-cobranza";

export const metadata: Metadata = {
  title: "Conectar banco para cobranza",
};

/**
 * Onboarding — "Conectar banco para cobranza" (flujo 1 de Fintoc).
 *
 * Server component "cascarón": resuelve sesión + capacidad + estado inicial, y
 * delega la interacción (widget de Fintoc, canje del exchange_token) al
 * formulario de cliente. Misma frontera y mismo guard de capacidad que la
 * pantalla de configuración DTE.
 *
 * Gating: usa la MISMA capacidad financiera que gobierna `dinero/conciliacion`
 * (`puedeVerConciliacion` → dueño o administración). El guard se repite aquí
 * porque la pantalla puede alcanzarse por enlace directo ("ocultar no basta").
 *
 * La PUBLIC key de Fintoc (`pk_test_…`) es segura para el cliente — se lee en el
 * servidor y se pasa como prop, así no se necesita una variable `NEXT_PUBLIC_*`.
 */
export default async function PaginaConectarBancoCobranza() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  if (!puedeVerConciliacion(sesion.usuario)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">No tienes permiso para ver esta sección</p>
          <p className="text-sm text-muted-foreground">
            La conexión del banco para cobranza solo la pueden ver y modificar el dueño de la cuenta o administración.
            Si necesitas conectar tu banco, pídele a esa persona que lo haga o que te dé acceso.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/onboarding">Volver al panel de activación</Link>
        </Button>
      </div>
    );
  }

  const resultado = await obtenerEstadoConfiguracionCobranza();
  const publicKey = process.env.FINTOC_PUBLIC_KEY ?? process.env.FINTOC_PUBLIC_KEY_TEST ?? null;

  // El widget de "movements" de Fintoc EXIGE `webhookUrl` (a dónde enviará los
  // movimientos/transferencias). Es la URL de webhook POR-TENANT. Preferimos la
  // URL pública canónica (APP_PUBLIC_URL, https) que Fintoc puede alcanzar; si no
  // está, derivamos el origen del request (en local será http://localhost — sirve
  // para que el widget abra, aunque Fintoc no pueda entregar webhooks ahí).
  const tenantId = sesion.usuario.tenantId;
  let baseUrl = process.env.APP_PUBLIC_URL ?? null;
  if (!baseUrl) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    baseUrl = host ? `${proto}://${host}` : null;
  }
  const webhookUrl = baseUrl
    ? `${baseUrl.replace(/\/+$/, "")}/api/webhooks/fintoc/${tenantId}`
    : null;

  // El courier es una empresa → `business` es lo correcto para PRODUCCIÓN. Pero
  // el sandbox de Fintoc simula la fricción real de las cuentas empresa (el
  // titular debe habilitar permisos en el banco), lo que impide completar la
  // conexión y obtener el exchange token en pruebas. Para validar el pipeline en
  // local, se puede forzar el flujo `individual` (conecta limpio con los RUT de
  // prueba 41614850-3 / jonsnow) vía `FINTOC_HOLDER_TYPE=individual` en .env.local.
  const holderType: "business" | "individual" =
    process.env.FINTOC_HOLDER_TYPE === "individual" ? "individual" : "business";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Cobranza a tus sellers</h1>
        <p className="text-sm text-muted-foreground">
          Conecta tu cuenta bancaria para que reconozcamos solos los pagos que te hacen tus sellers y los crucemos
          con sus facturas. La conexión se guarda cifrada — nunca verás aquí las credenciales de tu banco.
        </p>
      </div>

      <FormularioConexionCobranza
        estadoInicial={resultado.ok ? resultado.estado : null}
        errorInicial={resultado.ok ? null : resultado.mensaje}
        publicKey={publicKey}
        webhookUrl={webhookUrl}
        holderType={holderType}
      />
    </div>
  );
}
