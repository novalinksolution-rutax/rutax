import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileClock, SearchX } from "lucide-react";
import { consultarBitacoraPlataforma } from "@/modules/plataforma/bitacora-consulta";
import {
  obtenerTodasSuscripciones,
  obtenerTodosLosTenantsSinSuscripcion,
} from "@/modules/plataforma/consultas";
import { combinarFechaHoraSantiago } from "@/lib/fecha-santiago";
import { tieneSesionAdmin, obtenerSuperAdminsActivos } from "../sesion-admin";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { FiltrosBitacora } from "./filtros-bitacora";
import { TablaBitacora } from "./tabla-bitacora";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Bitácora · Rutax Admin",
};

// El visor lee auditoría en vivo; nunca cachear.
export const dynamic = "force-dynamic";

/** Filas por página del visor — tope duro del backend es 500 (ver `bitacora-consulta.ts`). */
const LIMITE_PAGINA = 50;

interface SearchParams {
  tenant?: string;
  accion?: string;
  actor?: string;
  desde?: string;
  hasta?: string;
  offset?: string;
}

export default async function PaginaBitacora({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Doble verificación (mismo patrón que el resto de `/admin/*`): el código
  // server que lee datos cross-tenant vía service_role NUNCA corre sin sesión
  // admin válida.
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  const params = await searchParams;
  const filtroTenant = params.tenant ?? "";
  const filtroAccion = params.accion ?? "";
  const filtroActor = params.actor ?? "";
  const filtroDesde = params.desde ?? "";
  const filtroHasta = params.hasta ?? "";
  const offset = Math.max(Number.parseInt(params.offset ?? "0", 10) || 0, 0);

  // Rango de fechas: los filtros son días en hora local Santiago; se convierten
  // al instante UTC del inicio/fin de ese día para que `gte`/`lte` comparen
  // correctamente contra `creado_en` (timestamptz) — ver CLAUDE.md, Chile-only.
  let desdeIso: string | undefined;
  let hastaIso: string | undefined;
  try {
    if (filtroDesde) desdeIso = combinarFechaHoraSantiago(filtroDesde, "00:00:00").toISOString();
    if (filtroHasta) hastaIso = combinarFechaHoraSantiago(filtroHasta, "23:59:59").toISOString();
  } catch {
    // Fecha con formato inválido (no debería ocurrir vía <input type="date">) — se ignora el filtro.
    desdeIso = undefined;
    hastaIso = undefined;
  }

  let filas: Awaited<ReturnType<typeof consultarBitacoraPlataforma>>["filas"] = [];
  let total = 0;
  let tenants: { id: string; nombreFantasia: string | null }[] = [];
  let actores: Awaited<ReturnType<typeof obtenerSuperAdminsActivos>> = [];
  let errorCarga = false;

  try {
    const [resultado, admins, suscripciones, tenantsSinSuscripcion] = await Promise.all([
      consultarBitacoraPlataforma({
        tenantId: filtroTenant || undefined,
        accion: filtroAccion || undefined,
        actorUsuarioId: filtroActor || undefined,
        desde: desdeIso,
        hasta: hastaIso,
        limite: LIMITE_PAGINA,
        offset,
      }),
      obtenerSuperAdminsActivos(),
      obtenerTodasSuscripciones(),
      obtenerTodosLosTenantsSinSuscripcion(),
    ]);

    filas = resultado.filas;
    total = resultado.total;
    actores = admins;

    // Lista de couriers para el filtro: unión de tenants con y sin suscripción
    // (la bitácora puede tener eventos de cualquier tenant, no solo los que
    // ya tienen un plan asignado).
    const tenantsMap = new Map<string, string | null>();
    for (const s of suscripciones) tenantsMap.set(s.tenantId, s.nombreFantasiaTenant);
    for (const t of tenantsSinSuscripcion) tenantsMap.set(t.id, t.nombreFantasia);
    tenants = [...tenantsMap.entries()]
      .map(([id, nombreFantasia]) => ({ id, nombreFantasia }))
      .sort((a, b) => (a.nombreFantasia ?? a.id).localeCompare(b.nombreFantasia ?? b.id));
  } catch {
    errorCarga = true;
  }

  const hayFiltroActivo = !!(filtroTenant || filtroAccion || filtroActor || filtroDesde || filtroHasta);

  // Query string sin `offset` — insumo para armar los links de paginación.
  const queryStringSinOffset = (() => {
    const sp = new URLSearchParams();
    if (filtroTenant) sp.set("tenant", filtroTenant);
    if (filtroAccion) sp.set("accion", filtroAccion);
    if (filtroActor) sp.set("actor", filtroActor);
    if (filtroDesde) sp.set("desde", filtroDesde);
    if (filtroHasta) sp.set("hasta", filtroHasta);
    return sp.toString();
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Bitácora</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Auditoría de acciones de plataforma: quién hizo qué, cuándo y sobre
          qué courier. El detalle ya viene sin secretos ni tokens.
        </p>
      </div>

      <FiltrosBitacora
        tenants={tenants}
        actores={actores}
        filtroTenant={filtroTenant}
        filtroAccion={filtroAccion}
        filtroActor={filtroActor}
        filtroDesde={filtroDesde}
        filtroHasta={filtroHasta}
        hayFiltroActivo={hayFiltroActivo}
      />

      {errorCarga ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          No se pudo cargar la bitácora. Intenta recargar la página.
        </div>
      ) : filas.length === 0 ? (
        <EmptyState
          icon={hayFiltroActivo ? SearchX : FileClock}
          tono={hayFiltroActivo ? "filtro" : "arranque"}
          titulo={hayFiltroActivo ? "Sin registros para estos filtros" : "Aún no hay registros"}
          descripcion={
            hayFiltroActivo
              ? "Prueba ajustando el rango de fechas o quitando algún filtro."
              : "Las acciones de plataforma (suscripciones, cobros, soporte) van a aparecer aquí a medida que ocurran."
          }
          accion={
            hayFiltroActivo ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/bitacora">Limpiar filtros</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TablaBitacora
          filas={filas}
          total={total}
          limite={LIMITE_PAGINA}
          offset={offset}
          queryStringSinOffset={queryStringSinOffset}
        />
      )}
    </div>
  );
}
