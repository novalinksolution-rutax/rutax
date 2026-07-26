import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { tieneSesionAdmin, obtenerRolAdminActual } from "../../sesion-admin";
import {
  obtenerSuscripcionPorId,
  obtenerPeriodosConPago,
  obtenerConfigDteTenant,
} from "@/modules/plataforma/consultas";
import { CobrosPeriodos } from "./cobros-periodos";
import { EntitlementsOverrides } from "./entitlements-overrides";

export const metadata: Metadata = {
  title: "Detalle de suscripción · Rutax Admin",
};

export const dynamic = "force-dynamic";

export default async function PaginaCobrosSuscripcion({
  params,
}: {
  params: Promise<{ suscripcionId: string }>;
}) {
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  const { suscripcionId } = await params;
  const [suscripcion, periodos] = await Promise.all([
    obtenerSuscripcionPorId(suscripcionId),
    obtenerPeriodosConPago(suscripcionId),
  ]);

  if (!suscripcion) notFound();

  // Lector agregado por `frontend` (no existía en `modules/plataforma/consultas.ts`
  // antes de esta pantalla) — ver nota de revisión en el reporte de la tarea.
  const dte = await obtenerConfigDteTenant(suscripcion.tenantId);
  const puedeEscribir = (await obtenerRolAdminActual()) === "admin_total";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/suscripciones"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Suscripciones
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {suscripcion.nombreFantasiaTenant ?? suscripcion.tenantId.slice(0, 8)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Plan {suscripcion.plan.nombre}.
        </p>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Cobros</h2>
          <p className="text-sm text-muted-foreground">
            Genera el link de cobro Fintoc por período, o registra un pago manual. La factura se
            emite por fuera.
          </p>
        </div>
        <CobrosPeriodos periodos={periodos} puedeEscribir={puedeEscribir} />
      </section>

      <section>
        <EntitlementsOverrides
          tenantId={suscripcion.tenantId}
          plan={suscripcion.plan}
          overrideActual={suscripcion.caracteristicasOverride}
          dte={dte}
          puedeEscribir={puedeEscribir}
        />
      </section>
    </div>
  );
}
