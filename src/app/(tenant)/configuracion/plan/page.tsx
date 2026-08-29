import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarSuscripcion } from "@/modules/identidad/capacidades";
import {
  obtenerMiPlan,
  obtenerEntitlementsTenant,
  type VistaMiPlan,
  type Entitlements,
} from "@/modules/plataforma/superficie-courier";
import { obtenerConsumoTenant, type ConsumoTenant } from "@/modules/plataforma/consumo";
import { EstadoError } from "@/components/onboarding/estado-pantalla";
import { obtenerContadorDelMes, type ContadorDelMes } from "@/modules/plataforma/contador-comision";
import { MiPlan } from "./mi-plan";

export const metadata: Metadata = {
  title: "Mi plan",
};

type ResultadoCarga =
  | { tipo: "sin-suscripcion" }
  | {
      tipo: "mi-plan";
      miPlan: VistaMiPlan;
      entitlements: Entitlements;
      consumo: ConsumoTenant;
      contador: ContadorDelMes | null;
    }
  | { tipo: "error" };

/**
 * `configuracion/plan` — una sola ruta, dos pantallas (RF suscripción SaaS,
 * F1/F2): sin suscripción → Selector de planes (alta self-serve); con
 * suscripción → Mi plan (lectura + cambio de plan/periodicidad self-serve y
 * cobro automático). El servidor decide cuál renderizar según `obtenerMiPlan`
 * — nunca hay un estado intermedio ambiguo en el cliente.
 */
export default async function PaginaMiPlan() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (!puedeGestionarSuscripcion(sesion.usuario)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Sin permiso para ver esta sección</p>
          <p className="text-sm text-muted-foreground">
            La gestión del plan y la facturación de Rutax es exclusiva del dueño.
          </p>
        </div>
      </div>
    );
  }

  const tenantId = sesion.usuario.tenantId;

  // Toda la obtención de datos (que puede lanzar) vive aquí, SIN construir
  // JSX dentro del try/catch (react-hooks/error-boundaries): React difiere el
  // render de JSX, así que un `return <X/>` dentro del try no garantiza que
  // los errores de render queden atrapados — solo los `await` de arriba sí.
  let resultado: ResultadoCarga;
  try {
    const miPlan = await obtenerMiPlan(tenantId);

    if (!miPlan) {
      // 🔴 Ya no se ofrece un catálogo para elegir. Con una sola modalidad no hay
      // entre qué decidir, y la tarifa de cada courier la fija Rutax al armar su
      // suscripción desde el backstage. Mostrarle una lista con una sola opción
      // sería pedirle que confirme algo que ya está decidido.
      resultado = { tipo: "sin-suscripcion" };
    } else {
      // El catálogo ya no se pide: alimentaba el cambio de plan self-serve, que
      // se retiró con la cuota plana. Lo que sí se pide es el contador del mes,
      // cacheado cinco minutos por tenant.
      const [entitlements, consumo, contador] = await Promise.all([
        obtenerEntitlementsTenant(tenantId),
        obtenerConsumoTenant(tenantId),
        obtenerContadorDelMes({
          tenantId,
          suscripcionId: miPlan.suscripcionId,
          precioPorPedidoClp: miPlan.plan.precioPorPedidoClp,
          minimoMensualClp: miPlan.plan.minimoMensualClp,
        }),
      ]);
      resultado = { tipo: "mi-plan", miPlan, entitlements, consumo, contador };
    }
  } catch (error) {
    console.error("Error al cargar la pantalla de plan:", error);
    resultado = { tipo: "error" };
  }

  if (resultado.tipo === "error") {
    return (
      <EstadoError descripcion="No pudimos cargar la información de tu plan. Intenta recargar la página." />
    );
  }

  if (resultado.tipo === "sin-suscripcion") {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="font-heading text-2xl font-semibold">Tu plan en Rutax</h1>
        <p className="border border-line bg-bg-sunken px-4 py-3.5 text-sm leading-relaxed text-fg-muted">
          Todavía no tienes un plan asignado. Rutax te cobra una tarifa por cada pedido que
          entregas, y esa tarifa la acordamos contigo — escríbenos a{" "}
          <a href="mailto:admin@rutax.io" className="font-medium underline underline-offset-4">
            admin@rutax.io
          </a>{" "}
          y la dejamos configurada. Mientras tanto puedes operar con normalidad.
        </p>
      </div>
    );
  }

  return (
    <MiPlan
      miPlan={resultado.miPlan}
      entitlements={resultado.entitlements}
      consumo={resultado.consumo}
      contador={resultado.contador}
    />
  );
}
