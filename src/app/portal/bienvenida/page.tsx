import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, PackageSearch, Receipt, TriangleAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
          seguir tus pedidos, revisar tu estado de cuenta y reportar incidencias sin tener que escribir por WhatsApp.
        </p>
      </div>

      <Card className="w-full text-left">
        <CardContent className="space-y-4 pt-6">
          <div className="flex gap-3">
            <PackageSearch className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-sm text-foreground">Sigue el estado de tus envíos en tiempo real, sin pedirle datos a nadie.</p>
          </div>
          <div className="flex gap-3">
            <Receipt className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-sm text-foreground">Revisa tu estado de cuenta y tus documentos cuando los necesites.</p>
          </div>
          <div className="flex gap-3">
            <TriangleAlert className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-sm text-foreground">Reporta incidencias directo desde aquí — quedan registradas y con seguimiento.</p>
          </div>
        </CardContent>
      </Card>

      <div className="w-full rounded-lg border border-border bg-muted/30 px-4 py-3 text-left">
        <p className="text-sm text-foreground">
          <span className="font-medium">Antes de empezar:</span> para sincronizar tus pedidos vamos a necesitar que
          conectes tu cuenta de Mercado Libre. En el siguiente paso te explicamos exactamente cómo hacerlo.
        </p>
      </div>

      <Button asChild size="lg" className="w-full sm:w-auto">
        <Link href="/portal/conectar-ml">Continuar</Link>
      </Button>
    </div>
  );
}
