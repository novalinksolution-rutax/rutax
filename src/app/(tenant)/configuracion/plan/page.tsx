import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarSuscripcion } from "@/modules/identidad/capacidades";
import {
  obtenerCatalogoPlanesPublico,
  obtenerMiPlan,
  obtenerEntitlementsTenant,
  type PlanPublico,
  type VistaMiPlan,
  type Entitlements,
} from "@/modules/plataforma/superficie-courier";
import { obtenerConsumoTenant, type ConsumoTenant } from "@/modules/plataforma/consumo";
import { EstadoError } from "@/components/onboarding/estado-pantalla";
import { SelectorDePlanes } from "./selector-de-planes";
import { MiPlan } from "./mi-plan";

export const metadata: Metadata = {
  title: "Mi plan",
};

type ResultadoCarga =
  | { tipo: "selector"; planes: PlanPublico[] }
  | {
      tipo: "mi-plan";
      miPlan: VistaMiPlan;
      entitlements: Entitlements;
      consumo: ConsumoTenant;
      planes: PlanPublico[];
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
      const planes = await obtenerCatalogoPlanesPublico();
      resultado = { tipo: "selector", planes };
    } else {
      // Catálogo también en "Mi plan": alimenta el cambio de plan self-serve
      // (F2, item I) y resuelve el nombre del plan destino de un downgrade
      // pendiente. Nota: si un plan se desactivó DESPUÉS de que el courier lo
      // contratara (p. ej. su propio plan actual, o el destino de un downgrade
      // ya programado), no aparece aquí — ver el fallback en `mi-plan.tsx`.
      const [entitlements, consumo, planes] = await Promise.all([
        obtenerEntitlementsTenant(tenantId),
        obtenerConsumoTenant(tenantId),
        obtenerCatalogoPlanesPublico(),
      ]);
      resultado = { tipo: "mi-plan", miPlan, entitlements, consumo, planes };
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

  if (resultado.tipo === "selector") {
    return <SelectorDePlanes planes={resultado.planes} />;
  }

  return (
    <MiPlan
      miPlan={resultado.miPlan}
      entitlements={resultado.entitlements}
      consumo={resultado.consumo}
      planes={resultado.planes}
    />
  );
}
