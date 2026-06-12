/**
 * Bandeja de revisión de pagos — cobranza Fintoc (capa "pagado").
 *
 * Server Component. Lista `pagos_recibidos` que requieren revisión
 * (`sin_atribuir | sobrante | parcial | atribuido`) con menú de acciones por
 * fila (atribuir manualmente / descartar), más una sección de solo lectura con
 * los `conciliado` recientes como confirmación. Gating financiero
 * (`puedeVerConciliacion`), patrón EXACTO de la pantalla de conciliación.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeVerConciliacion } from "@/modules/identidad/capacidades";
import { listarPagosRecibidos } from "@/modules/dinero/index";
import type { PagoRecibido, EstadoMatchPago } from "@/modules/dinero/tipos";
import {
  traducirEstadoMatchPago,
  COLOR_ESTADO_MATCH_PAGO,
} from "@/lib/ui/traduccion-estados";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { MenuAccionesPago } from "./menu-acciones-pago";

export const metadata: Metadata = {
  title: "Revisión de pagos",
};

// Estados que requieren revisión humana (la cola de trabajo de la bandeja).
const ESTADOS_REVISION: EstadoMatchPago[] = ["sin_atribuir", "sobrante", "parcial", "atribuido"];
const LIMITE_CONCILIADOS = 10;

interface PagoConSeller extends PagoRecibido {
  sellerNombre: string | null;
}

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function formatearRut(rut: string | null): string | null {
  if (!rut) return null;
  // El RUT viene normalizado (solo dígitos + DV). Lo presentamos con guion.
  const cuerpo = rut.slice(0, -1);
  const dv = rut.slice(-1);
  return `${cuerpo}-${dv}`;
}

export default async function PaginaBandejaCobranza() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  if (!puedeVerConciliacion(sesion.usuario)) redirect("/dashboard");

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  let pagosRevision: PagoConSeller[] = [];
  let pagosConciliados: PagoConSeller[] = [];
  let sellers: { id: string; nombre: string }[] = [];
  let errorCarga = false;

  try {
    const { data: sellersData } = await cliente
      .from("sellers")
      .select("id, razon_social")
      .eq("tenant_id", tenantId)
      .order("razon_social");
    sellers = (sellersData ?? []).map((s: Record<string, unknown>) => ({
      id: s.id as string,
      nombre: s.razon_social as string,
    }));
    const sellersMap = new Map(sellers.map((s) => [s.id, s.nombre]));

    const [revision, conciliados] = await Promise.all([
      listarPagosRecibidos(cliente, tenantId, ESTADOS_REVISION),
      listarPagosRecibidos(cliente, tenantId, ["conciliado"]),
    ]);

    pagosRevision = revision.map((p) => ({
      ...p,
      sellerNombre: p.sellerId ? (sellersMap.get(p.sellerId) ?? null) : null,
    }));
    pagosConciliados = conciliados.slice(0, LIMITE_CONCILIADOS).map((p) => ({
      ...p,
      sellerNombre: p.sellerId ? (sellersMap.get(p.sellerId) ?? null) : null,
    }));
  } catch {
    errorCarga = true;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Revisión de pagos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pagos recibidos de tus sellers que aún no calzan solos con una factura. Atribúyelos al seller y período
          correctos, o descártalos si no son cobranzas.
        </p>
      </div>

      {errorCarga && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          No se pudo cargar la bandeja de pagos. Intenta recargar la página.
        </div>
      )}

      {/* Bandeja de revisión */}
      {!errorCarga && pagosRevision.length === 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center justify-center gap-4 rounded-xl border border-green-200 bg-green-50 px-6 py-16 text-center"
        >
          <CheckCircle2 className="size-12 text-green-500" aria-hidden="true" />
          <div>
            <p className="text-lg font-semibold text-green-800">No hay pagos por revisar.</p>
            <p className="mt-1 text-sm text-green-700">
              Todos los pagos recibidos se atribuyeron y conciliaron solos.
            </p>
          </div>
        </div>
      ) : (
        !errorCarga && (
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Pagos por revisar">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2" style={{ width: "16%" }}>Fecha</th>
                    <th className="px-4 py-2 text-right" style={{ width: "16%" }}>Monto</th>
                    <th className="px-4 py-2" style={{ width: "30%" }}>Contraparte</th>
                    <th className="hidden px-4 py-2 sm:table-cell" style={{ width: "16%" }}>Seller</th>
                    <th className="px-4 py-2" style={{ width: "12%" }}>Estado</th>
                    <th className="px-4 py-2 text-right" style={{ width: "10%" }}>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pagosRevision.map((pago) => (
                    <FilaPago key={pago.id} pago={pago} sellers={sellers} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Conciliados recientes — solo lectura, como confirmación */}
      {!errorCarga && pagosConciliados.length > 0 && (
        <section aria-labelledby="conciliados-titulo" className="space-y-3">
          <h2
            id="conciliados-titulo"
            className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Conciliados recientemente
          </h2>
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Pagos conciliados recientes">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2">Fecha</th>
                    <th className="px-4 py-2 text-right">Monto</th>
                    <th className="hidden px-4 py-2 sm:table-cell">Contraparte</th>
                    <th className="px-4 py-2">Seller</th>
                    <th className="px-4 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pagosConciliados.map((pago) => (
                    <tr key={pago.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {formatearFechaCorta(pago.fechaMovimiento)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {formatearCLP(pago.montoClp)}
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                        {pago.contraparteNombre ?? formatearRut(pago.contraparteRutNormalizado) ?? "Sin remitente"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{pago.sellerNombre ?? "—"}</td>
                      <td className="px-4 py-3">
                        <BadgeEstadoMatch estado={pago.estadoMatch} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Para ver el estado de cobro de cada período, ve a{" "}
            <Link href="/dinero/periodos" className="text-primary hover:underline">
              Períodos de cobro
            </Link>
            .
          </p>
        </section>
      )}
    </div>
  );
}

// =============================================================================
// Fila de pago por revisar
// =============================================================================

function FilaPago({ pago, sellers }: { pago: PagoConSeller; sellers: { id: string; nombre: string }[] }) {
  const contraparteNombre = pago.contraparteNombre;
  const contraparteRut = formatearRut(pago.contraparteRutNormalizado);

  return (
    <tr className="group hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 tabular-nums text-muted-foreground">
        {formatearFechaCorta(pago.fechaMovimiento)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatearCLP(pago.montoClp)}</td>
      <td className="px-4 py-3">
        {contraparteNombre || contraparteRut ? (
          <div className="flex flex-col">
            {contraparteNombre && <span className="text-foreground">{contraparteNombre}</span>}
            {contraparteRut && (
              <span className="font-mono text-xs text-muted-foreground">{contraparteRut}</span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">Sin remitente</span>
        )}
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{pago.sellerNombre ?? "—"}</td>
      <td className="px-4 py-3">
        <BadgeEstadoMatch estado={pago.estadoMatch} />
      </td>
      <td className="px-4 py-3 text-right">
        <MenuAccionesPago pagoId={pago.id} estadoActual={pago.estadoMatch} sellers={sellers} />
      </td>
    </tr>
  );
}

function BadgeEstadoMatch({ estado }: { estado: EstadoMatchPago }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO_MATCH_PAGO[estado]}`}
    >
      {traducirEstadoMatchPago(estado)}
    </span>
  );
}
