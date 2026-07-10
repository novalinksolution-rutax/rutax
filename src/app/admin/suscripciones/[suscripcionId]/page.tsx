import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { tieneSesionAdmin } from "../../sesion-admin";
import {
  obtenerSuscripcionPorId,
  obtenerPeriodosConPago,
} from "@/modules/plataforma/consultas";
import { CobrosPeriodos } from "./cobros-periodos";

export const metadata: Metadata = {
  title: "Cobros de suscripción · Rutax Admin",
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
        <h1 className="mt-2 text-2xl font-bold">
          Cobros · {suscripcion.nombreFantasiaTenant ?? suscripcion.tenantId.slice(0, 8)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Plan {suscripcion.plan.nombre}. Genera el link de cobro Fintoc por período,
          o registra un pago manual. La factura se emite por fuera.
        </p>
      </div>

      <CobrosPeriodos periodos={periodos} />
    </div>
  );
}
