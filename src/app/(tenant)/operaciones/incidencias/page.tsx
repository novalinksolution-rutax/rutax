/**
 * Incidencias — la bandeja (tablero B1b).
 *
 * «Es la bandeja de P6, no un listado nuevo.» El supervisor **aterriza acá desde
 * un aviso**, así que la pantalla tiene que explicarse sola en la primera línea:
 * cuántas hay abiertas y cuántas llevan más de cuatro horas sin que nadie las
 * mire. Ese subtítulo no es adorno — es lo que reemplaza al contexto que el
 * aviso no trajo.
 *
 * El estado dejó de ser un `Select` de la barra de filtros y pasó a ser cajones
 * con su cuenta: es un filtro con memoria de cuántos hay en cada lado, y el de
 * `cerradas` queda fuera de la suma a propósito.
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarIncidencias } from "@/modules/identidad/capacidades";
import { cargarBandejaIncidencias } from "@/modules/operacion/bandeja-incidencias";
import { listarConductores } from "@/modules/operacion/conductores";
import { esIncidenciaSinGestion, UMBRAL_INCIDENCIA_SIN_GESTION_HORAS } from "@/lib/ui/traduccion-estados";
import type { EstadoIncidencia, TipoIncidencia } from "@/modules/operacion/tipos";
import { Bandeja } from "./bandeja";
import { FiltrosIncidencias } from "./filtros-incidencias";
import { IndicadorEnVivo } from "@/components/tiempo-real/indicador-en-vivo";
import { obtenerSellersDelTenant, type SellerFiltro } from "@/lib/datos-tenant/sellers";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import { parsearRangoFecha, ventanaFechaSantiago } from "@/lib/filtros/fecha";

interface SearchParams {
  seller?: string;
  tipo?: string;
  estado?: string;
  conductor?: string;
  fecha?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
}

export default async function PaginaIncidencias({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  const params = await searchParams;
  const tenantId = sesion.usuario.tenantId;
  const puedeGestionar = puedeGestionarIncidencias(sesion.usuario);

  const filtroSeller = params.seller ?? "";
  const filtroTipo = (params.tipo as TipoIncidencia | "") ?? "";
  const filtroConductor = params.conductor ?? "";
  const cajon = (params.estado as EstadoIncidencia | "") || null;
  const rangoFecha = parsearRangoFecha({
    exacto: params.fecha,
    desde: params.fecha_desde,
    hasta: params.fecha_hasta,
  });
  const hoyIso = hoyEnSantiago();
  const hayFiltro = !!(filtroSeller || filtroTipo || filtroConductor || rangoFecha.hayFecha);

  const ventana = rangoFecha.hayFecha ? ventanaFechaSantiago(rangoFecha) : { gte: null, lt: null };

  const cliente = crearClienteServiceRole();
  const [bandeja, sellers, conductores] = await Promise.all([
    cargarBandejaIncidencias(cliente, tenantId, {
      sellerId: filtroSeller || undefined,
      tipo: (filtroTipo as TipoIncidencia) || undefined,
      conductorId: filtroConductor || undefined,
      estado: cajon ?? undefined,
      desde: ventana.gte ?? undefined,
      hasta: ventana.lt ?? undefined,
    }).catch(() => null),
    obtenerSellersDelTenant(tenantId).catch(() => [] as SellerFiltro[]),
    listarConductores(cliente, tenantId).catch(() => []),
  ]);

  if (!bandeja) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold">Incidencias</h1>
        <div
          role="alert"
          className="border border-attention-line bg-attention-bg px-4 py-3 text-sm text-attention-fg"
        >
          No pudimos cargar las incidencias. Vuelve a intentarlo recargando la página.
        </div>
      </div>
    );
  }

  const nombreSellerPorId = Object.fromEntries(sellers.map((s) => [s.id, s.nombre]));

  // El subtítulo que explica la pantalla a quien llegó desde un aviso. Se cuenta
  // sobre lo que está VIVO —abiertas y en gestión—, no sobre el cajón elegido:
  // si el supervisor está mirando las resueltas, igual tiene que ver que hay una
  // sin gestionar hace cinco horas.
  const vivas = bandeja.conteos.abierta + bandeja.conteos.en_gestion;
  const sinGestionar = bandeja.incidencias.filter((i) =>
    esIncidenciaSinGestion(i.estado, i.abiertaEn),
  ).length;

  return (
    <div className="space-y-5">
      {/* ⚠️ **Acá había un «‹ Pedidos» y se retiró (26-08-2026).** Parecía un
          «volver» y no lo era: es un enlace fijo, así que le prometía a
          cualquiera que llegó desde el dashboard, desde la barra inferior del
          teléfono o por un enlace directo que estaba «volviendo» a una pantalla
          en la que nunca estuvo.

          Incidencias no es una sub-pantalla de Pedidos: es un destino propio,
          está en la navegación lateral y es uno de los cuatro de la barra
          inferior en teléfono. No hay ningún camino que dependa de esta miga. */}
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-heading text-2xl font-semibold">Incidencias</h1>
          <IndicadorEnVivo
            tenantId={tenantId}
            tablas={[{ schema: "operacion", tabla: "incidencias" }]}
          />
        </div>
        <p className="rx-num mt-1 text-xs text-fg-muted">
          {vivas} {vivas === 1 ? "abierta" : "abiertas"}
          {sinGestionar > 0
            ? ` · ${sinGestionar} ${sinGestionar === 1 ? "lleva" : "llevan"} más de ${UMBRAL_INCIDENCIA_SIN_GESTION_HORAS} h sin gestionar`
            : " · ninguna sin gestionar"}
        </p>
      </div>

      <FiltrosIncidencias
        sellers={sellers}
        conductores={conductores.map((c) => ({ id: c.id, nombre: c.nombre }))}
        hoy={hoyIso}
        filtroSeller={filtroSeller}
        filtroTipo={filtroTipo}
        filtroConductor={filtroConductor}
        filtroFecha={rangoFecha.exacto}
        filtroFechaDesde={rangoFecha.desde}
        filtroFechaHasta={rangoFecha.hasta}
        hayFiltro={hayFiltro}
      />

      <Bandeja
        incidencias={bandeja.incidencias}
        contexto={bandeja.contexto}
        conteos={bandeja.conteos}
        nombreSellerPorId={nombreSellerPorId}
        cajonActivo={cajon}
        puedeGestionar={puedeGestionar}
      />
    </div>
  );
}
