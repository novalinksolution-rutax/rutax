import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldAlert, Tag } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DialogTarifa } from "./dialog-tarifa";
import { BotonInactivarTarifa } from "./boton-inactivar";

export const metadata: Metadata = {
  title: "Tarifas",
};

interface TarifaFila {
  id: string;
  sellerId: string | null;
  sellerNombre: string | null;
  tipoEntrega: "flex" | "same_day";
  modoCalculo: "monto_fijo" | "por_zona";
  zona: string | null;
  montoClp: number;
  vigenteDesdeFecha: string;
  vigenteHasta: string | null;
  estado: "activa" | "inactiva";
  minimoFacturacionClp: number | null;
  minimoRetiroClp: number | null;
  recargoReprogramacionClp: number | null;
}

function formatearFecha(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export default async function PaginaTarifas() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (!puedeGestionarTarifas(sesion.usuario)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Sin permiso para ver esta sección</p>
          <p className="text-sm text-muted-foreground">
            La gestión de tarifas es exclusiva del dueño o administración.
          </p>
        </div>
      </div>
    );
  }

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  const { data: sellersData } = await supabase
    .schema("identidad")
    .from("sellers")
    .select("id, razon_social")
    .eq("tenant_id", tenantId)
    .order("razon_social");

  const sellers = (sellersData ?? []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    nombre: s.razon_social as string,
  }));
  const sellersMap = new Map(sellers.map((s) => [s.id, s.nombre]));

  const { data: tarifasData } = await supabase
    .schema("identidad")
    .from("tarifas")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("estado", { ascending: true })  // activas primero (a < i)
    .order("vigente_desde", { ascending: false });

  const tarifas: TarifaFila[] = (tarifasData ?? []).map((t: Record<string, unknown>) => ({
    id: t.id as string,
    sellerId: (t.seller_id as string | null) ?? null,
    sellerNombre: t.seller_id ? (sellersMap.get(t.seller_id as string) ?? null) : null,
    tipoEntrega: t.tipo_entrega as "flex" | "same_day",
    modoCalculo: t.modo_calculo as "monto_fijo" | "por_zona",
    zona: (t.zona as string | null) ?? null,
    montoClp: Number(t.monto_clp),
    vigenteDesdeFecha: t.vigente_desde as string,
    vigenteHasta: (t.vigente_hasta as string | null) ?? null,
    estado: t.estado as "activa" | "inactiva",
    minimoFacturacionClp: t.minimo_facturacion_clp != null ? Number(t.minimo_facturacion_clp) : null,
    minimoRetiroClp: t.minimo_retiro_clp != null ? Number(t.minimo_retiro_clp) : null,
    recargoReprogramacionClp: t.recargo_reprogramacion_clp != null ? Number(t.recargo_reprogramacion_clp) : null,
  }));

  const activas = tarifas.filter((t) => t.estado === "activa");
  const inactivas = tarifas.filter((t) => t.estado === "inactiva");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tarifas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rate cards por seller. Define base, mínimos y recargos que usa el motor de cobro.
          </p>
        </div>
        <DialogTarifa sellers={sellers} />
      </div>

      {tarifas.length === 0 ? (
        <EmptyState
          icon={Tag}
          tono="arranque"
          titulo="Sin tarifas configuradas"
          descripcion="Crea la primera tarifa para que el motor pueda generar líneas de cobro al seller."
          accion={<DialogTarifa sellers={sellers} />}
        />
      ) : (
        <>
          {/* Activas */}
          {activas.length > 0 && (
            <section aria-label="Tarifas activas" className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Activas ({activas.length})
              </h2>
              <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" aria-label="Tarifas activas">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2">Seller / Scope</th>
                        <th className="px-4 py-2">Tipo</th>
                        <th className="hidden px-4 py-2 sm:table-cell">Zona</th>
                        <th className="px-4 py-2 text-right">Base (CLP)</th>
                        <th className="hidden px-4 py-2 text-right md:table-cell">Mín. factura</th>
                        <th className="hidden px-4 py-2 text-right md:table-cell">Mín. retiro</th>
                        <th className="hidden px-4 py-2 text-right lg:table-cell">Recargo reprog.</th>
                        <th className="hidden px-4 py-2 sm:table-cell">Vigencia</th>
                        <th className="px-4 py-2 text-right">
                          <span className="sr-only">Acciones</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {activas.map((t) => (
                        <FilaTarifa key={t.id} tarifa={t} sellers={sellers} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* Inactivas */}
          {inactivas.length > 0 && (
            <section aria-label="Tarifas inactivas" className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Inactivas ({inactivas.length})
              </h2>
              <div className="overflow-hidden rounded-xl border bg-card opacity-60 shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" aria-label="Tarifas inactivas">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2">Seller / Scope</th>
                        <th className="px-4 py-2">Tipo</th>
                        <th className="hidden px-4 py-2 sm:table-cell">Zona</th>
                        <th className="px-4 py-2 text-right">Base (CLP)</th>
                        <th className="hidden px-4 py-2 sm:table-cell">Vigencia</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {inactivas.map((t) => (
                        <FilaTarifaInactiva key={t.id} tarifa={t} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================
// Filas
// =============================================================================

function FilaTarifa({ tarifa, sellers }: { tarifa: TarifaFila; sellers: { id: string; nombre: string }[] }) {
  const tarifaParaDialog = {
    id: tarifa.id,
    sellerId: tarifa.sellerId,
    tipoEntrega: tarifa.tipoEntrega,
    modoCalculo: tarifa.modoCalculo,
    zona: tarifa.zona,
    montoClp: tarifa.montoClp,
    vigenteDesdeFecha: tarifa.vigenteDesdeFecha,
    vigenteHasta: tarifa.vigenteHasta,
    minimoFacturacionClp: tarifa.minimoFacturacionClp,
    minimoRetiroClp: tarifa.minimoRetiroClp,
    recargoReprogramacionClp: tarifa.recargoReprogramacionClp,
  };

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        {tarifa.sellerNombre ? (
          <span className="font-medium">{tarifa.sellerNombre}</span>
        ) : (
          <span className="text-muted-foreground italic">Tenant (todos los sellers)</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge variant="outline" className="text-xs">
          {tarifa.tipoEntrega === "flex" ? "Flex" : "Same-day"}
        </Badge>
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
        {tarifa.zona ?? "—"}
      </td>
      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
        {formatearCLP(tarifa.montoClp)}
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground md:table-cell">
        {tarifa.minimoFacturacionClp != null ? formatearCLP(tarifa.minimoFacturacionClp) : "—"}
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground md:table-cell">
        {tarifa.minimoRetiroClp != null ? formatearCLP(tarifa.minimoRetiroClp) : "—"}
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground lg:table-cell">
        {tarifa.recargoReprogramacionClp != null ? formatearCLP(tarifa.recargoReprogramacionClp) : "—"}
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
        <span className="tabular-nums text-xs">
          {formatearFecha(tarifa.vigenteDesdeFecha)}
          {tarifa.vigenteHasta ? ` → ${formatearFecha(tarifa.vigenteHasta)}` : " →"}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <DialogTarifa
            sellers={sellers}
            tarifa={tarifaParaDialog}
            trigger={
              <Button variant="ghost" size="sm">
                Editar
              </Button>
            }
          />
          <BotonInactivarTarifa tarifaId={tarifa.id} />
        </div>
      </td>
    </tr>
  );
}

function FilaTarifaInactiva({ tarifa }: { tarifa: TarifaFila }) {
  return (
    <tr className="text-muted-foreground">
      <td className="px-4 py-2.5">
        {tarifa.sellerNombre ?? <span className="italic">Tenant</span>}
      </td>
      <td className="px-4 py-2.5 text-xs">
        {tarifa.tipoEntrega === "flex" ? "Flex" : "Same-day"}
      </td>
      <td className="hidden px-4 py-2.5 sm:table-cell">{tarifa.zona ?? "—"}</td>
      <td className="px-4 py-2.5 text-right tabular-nums font-mono">
        {formatearCLP(tarifa.montoClp)}
      </td>
      <td className="hidden px-4 py-2.5 sm:table-cell text-xs tabular-nums">
        {formatearFecha(tarifa.vigenteDesdeFecha)}
        {tarifa.vigenteHasta ? ` → ${formatearFecha(tarifa.vigenteHasta)}` : ""}
      </td>
      <td className="px-4 py-2.5" />
    </tr>
  );
}
