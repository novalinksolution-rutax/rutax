/**
 * Mis incidencias — bandeja, detalle y alta, en una pantalla.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🐞 LA RESOLUCIÓN SE LEÍA DE LA BASE Y SE TIRABA
 * -----------------------------------------------------------------------------
 * `notas_resolucion` y `afecta_cobro` se cargaban en el mapeo y **no se dibujaban
 * en ninguna parte**. O sea: el courier escribía cómo resolvió el problema, el
 * dato viajaba hasta esta pantalla, y el seller nunca lo veía — así que llamaba
 * por teléfono a preguntar. Es la brecha que hace sonar el teléfono, y estaba a
 * una línea de distancia.
 *
 * -----------------------------------------------------------------------------
 * TARJETAS Y NO TABLA
 * -----------------------------------------------------------------------------
 * Una incidencia no se compara con otra en columnas: se lee entera. La tabla de
 * cuatro columnas obligaba a truncar la descripción a una línea y no tenía dónde
 * poner la resolución. Cada tarjeta se despliega en su lugar.
 *
 * -----------------------------------------------------------------------------
 * Y EL ALTA, QUE LA BIENVENIDA YA PROMETÍA
 * -----------------------------------------------------------------------------
 * «Reportar un problema» no existía —ni botón, ni formulario, ni Server Action—
 * mientras `portal/bienvenida` decía textualmente que sí. Ahora está, y por eso
 * la bajada ya no dice «solo lectura».
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, SearchX } from "lucide-react";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  BADGE_ESTADO_INCIDENCIA,
  esIncidenciaSinGestion,
  horasDesde,
} from "@/lib/ui/traduccion-estados";
import {
  estadoIncidenciaParaSeller,
  tipoIncidenciaParaSeller,
} from "@/lib/ui/vocabulario-portal";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { formatearFechaHora } from "@/lib/formato-cl";
import type { Incidencia, TipoIncidencia, EstadoIncidencia } from "@/modules/operacion/tipos";
import { FiltrosIncidenciasSeller } from "./filtros-incidencias-seller";
import { DialogoReportar, type PedidoReportable } from "./dialogo-reportar";
import { hoyEnSantiago, limitesDelDiaSantiago } from "@/lib/fecha-santiago";
import { parsearRangoFecha, ventanaFechaSantiago } from "@/lib/filtros/fecha";

export const metadata: Metadata = {
  title: "Mis incidencias",
};

const LIMITE = 25;

interface SearchParams {
  tipo?: string;
  estado?: string;
  fecha?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
  pagina?: string;
}

export default async function PaginaIncidenciasSeller({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) redirect("/portal");

  const params = await searchParams;
  const sellerId = sesion.usuario.sellerId;
  const tenantId = sesion.usuario.tenantId;

  const filtroTipo = (params.tipo as TipoIncidencia | "") ?? "";
  const filtroEstado = (params.estado as EstadoIncidencia | "") ?? "";
  const rangoFecha = parsearRangoFecha({
    exacto: params.fecha,
    desde: params.fecha_desde,
    hasta: params.fecha_hasta,
  });
  const hoyIso = hoyEnSantiago();
  const pagina = Math.max(1, parseInt(params.pagina ?? "1", 10));
  const offset = (pagina - 1) * LIMITE;

  const cliente = crearClienteServiceRole();
  let incidencias: Incidencia[] = [];
  let total = 0;
  let abiertas = 0;
  let resueltasMes = 0;
  let errorCarga = false;
  let pedidosReportables: PedidoReportable[] = [];
  let nombreCourier = "tu courier";

  try {
    let query = cliente
      .from("incidencias")
      .select("*", { count: "exact" })
      .eq("seller_id", sellerId)
      .eq("tenant_id", tenantId)
      .order("abierta_en", { ascending: false })
      .range(offset, offset + LIMITE - 1);

    if (filtroTipo) query = query.eq("tipo", filtroTipo);
    if (filtroEstado) query = query.eq("estado", filtroEstado);
    if (rangoFecha.hayFecha) {
      // `abierta_en` es `timestamptz`: se filtra por el día CIVIL de Santiago.
      const { gte, lt } = ventanaFechaSantiago(rangoFecha);
      if (gte) query = query.gte("abierta_en", gte);
      if (lt) query = query.lt("abierta_en", lt);
    }

    // Los conteos del encabezado van sobre TODAS las incidencias del seller, no
    // sobre la página ni sobre el filtro: son el estado de su cuenta, no del
    // filtro que tenga puesto. El del mes se acota al mes civil en curso.
    // ⚠️ El mes civil chileno NO empieza a medianoche UTC: empieza a las 04:00
    // UTC. Escribir `${mes}-01T00:00:00Z` metería en el conteo las últimas
    // cuatro horas del mes anterior. `limitesDelDiaSantiago` lo resuelve, y el
    // guard de `fecha-santiago.guard.test.ts` rechaza la versión ingenua.
    const inicioDeMes = limitesDelDiaSantiago(`${hoyIso.slice(0, 7)}-01`).desde.toISOString();
    const [res, cAbiertas, cResueltas, pedidos, tenant] = await Promise.all([
      query,
      cliente
        .from("incidencias")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", sellerId)
        .eq("tenant_id", tenantId)
        .in("estado", ["abierta", "en_gestion"]),
      cliente
        .from("incidencias")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", sellerId)
        .eq("tenant_id", tenantId)
        .in("estado", ["resuelta", "cerrada"])
        .gte("resuelta_en", inicioDeMes),
      // Los pedidos sobre los que se puede reportar: los recientes que todavía
      // no están cancelados. Un selector con toda la historia del seller es
      // inusable, y un problema sobre un pedido de hace tres meses ya no se
      // reporta: se llama.
      cliente
        .from("pedidos")
        .select("id, codigo_interno, ml_shipment_id, destinatario_nombre, destinatario_comuna")
        .eq("seller_id", sellerId)
        .eq("tenant_id", tenantId)
        .neq("estado", "cancelado")
        .order("creado_en", { ascending: false })
        .limit(40),
      cliente.from("tenants").select("nombre_fantasia").eq("id", tenantId).maybeSingle(),
    ]);

    if (res.error) throw res.error;

    total = res.count ?? 0;
    abiertas = cAbiertas.count ?? 0;
    resueltasMes = cResueltas.count ?? 0;
    nombreCourier = (tenant.data?.nombre_fantasia as string | undefined) ?? "tu courier";

    pedidosReportables = ((pedidos.data ?? []) as Record<string, unknown>[]).map((p) => ({
      id: p.id as string,
      etiqueta: `${
        (p.codigo_interno as string | null) ?? (p.ml_shipment_id as string | null) ?? "Pedido"
      } · ${p.destinatario_nombre as string}${
        p.destinatario_comuna ? `, ${p.destinatario_comuna as string}` : ""
      }`,
    }));

    incidencias = ((res.data ?? []) as Record<string, unknown>[]).map((inc) => ({
      id: inc.id as string,
      tenantId: inc.tenant_id as string,
      pedidoId: inc.pedido_id as string,
      sellerId: inc.seller_id as string,
      tipo: inc.tipo as TipoIncidencia,
      estado: inc.estado as EstadoIncidencia,
      descripcion: (inc.descripcion as string | null) ?? null,
      notasResolucion: (inc.notas_resolucion as string | null) ?? null,
      afectaCobro: (inc.afecta_cobro as boolean) ?? false,
      afectaLiquidacion: (inc.afecta_liquidacion as boolean) ?? false,
      abiertaPorUsuarioId: (inc.abierta_por_usuario_id as string | null) ?? null,
      resueltaPorUsuarioId: (inc.resuelta_por_usuario_id as string | null) ?? null,
      abiertaEn: inc.abierta_en as string,
      resueltaEn: (inc.resuelta_en as string | null) ?? null,
      creadoEn: inc.creado_en as string,
      actualizadoEn: inc.actualizado_en as string,
    }));
  } catch {
    errorCarga = true;
  }

  const hayFiltros = !!(filtroTipo || filtroEstado || rangoFecha.hayFecha);
  const totalPaginas = Math.ceil(total / LIMITE);

  function urlConFiltros(overrides: Record<string, string>) {
    const sp = new URLSearchParams();
    if (filtroTipo) sp.set("tipo", filtroTipo);
    if (filtroEstado) sp.set("estado", filtroEstado);
    if (rangoFecha.exacto) {
      sp.set("fecha", rangoFecha.exacto);
    } else {
      if (rangoFecha.desde) sp.set("fecha_desde", rangoFecha.desde);
      if (rangoFecha.hasta) sp.set("fecha_hasta", rangoFecha.hasta);
    }
    if (pagina > 1) sp.set("pagina", String(pagina));
    Object.entries(overrides).forEach(([k, v]) => {
      if (v) sp.set(k, v);
      else sp.delete(k);
    });
    const s = sp.toString();
    return `/portal/incidencias${s ? `?${s}` : ""}`;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold">Mis incidencias</h1>
          {/* Los conteos van acá y no dentro de la tabla: es lo que se viene a
              saber. Y la bajada ya no dice «solo lectura», porque dejó de serlo. */}
          <p className="mt-0.5 text-sm text-fg-muted">
            {errorCarga
              ? "Problemas registrados en tus pedidos."
              : `${abiertas} ${abiertas === 1 ? "abierta" : "abiertas"} · ${resueltasMes} ${
                  resueltasMes === 1 ? "resuelta" : "resueltas"
                } este mes.`}
          </p>
        </div>
        <DialogoReportar pedidos={pedidosReportables} nombreCourier={nombreCourier} />
      </div>

      <FiltrosIncidenciasSeller
        hoy={hoyIso}
        filtroTipo={filtroTipo}
        filtroEstado={filtroEstado}
        filtroFecha={rangoFecha.exacto}
        filtroFechaDesde={rangoFecha.desde}
        filtroFechaHasta={rangoFecha.hasta}
        hayFiltros={hayFiltros}
      />

      {errorCarga ? (
        <div
          role="alert"
          className="border border-fault-line bg-fault-bg px-4 py-3.5 text-sm leading-relaxed text-fault-fg"
        >
          No se pudo cargar tus incidencias. Recarga en unos segundos — si tienes un problema
          urgente, escríbele a {nombreCourier}.
        </div>
      ) : incidencias.length === 0 ? (
        hayFiltros ? (
          <EmptyState
            icon={SearchX}
            tono="filtro"
            titulo="Ninguna incidencia coincide"
            descripcion="No hay incidencias con estos filtros. Prueba cambiando el tipo o el estado."
            accion={
              <Button asChild variant="outline" size="sm">
                <Link href="/portal/incidencias">Limpiar filtros</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={CheckCircle2}
            tono="buen-estado"
            titulo="Sin incidencias — todo va bien"
            descripcion="No hay problemas registrados en tus pedidos. Si te llega un reclamo, repórtalo desde acá."
          />
        )
      ) : (
        <>
          <ul className="space-y-2">
            {incidencias.map((inc) => (
              <li key={inc.id}>
                <TarjetaIncidencia incidencia={inc} nombreCourier={nombreCourier} />
              </li>
            ))}
          </ul>

          {totalPaginas > 1 ? (
            <Pagination
              pagina={pagina}
              totalPaginas={totalPaginas}
              hrefPagina={(p) => urlConFiltros({ pagina: String(p) })}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Una incidencia, entera.
 *
 * Se despliega en su lugar y no navega a otra ruta: son objetos cortos, y sacar
 * al seller de la bandeja para leer tres líneas le hace perder la vista de las
 * otras. `<details>` nativo — sin estado de cliente que sincronizar.
 */
function TarjetaIncidencia({
  incidencia,
  nombreCourier,
}: {
  incidencia: Incidencia;
  nombreCourier: string;
}) {
  const horas = Math.floor(horasDesde(incidencia.abiertaEn));
  const sinGestion = esIncidenciaSinGestion(incidencia.estado, incidencia.abiertaEn);
  const resuelta = incidencia.estado === "resuelta" || incidencia.estado === "cerrada";

  return (
    <details className="group border border-line bg-bg-raised">
      <summary className="cursor-pointer list-none px-4 py-3">
        <span className="flex flex-wrap items-center gap-2">
          <BadgeEstado
            variante={BADGE_ESTADO_INCIDENCIA[incidencia.estado]}
            eje="incidencia"
            valor={incidencia.estado}
            /* El idioma del seller: «{courier} la está viendo» dice de quién es
               la pelota; «En gestión» suena a que avanza sola. */
            texto={estadoIncidenciaParaSeller(incidencia.estado, nombreCourier)}
          />
          {/* «1813 h» es correcto y no se lee. Pasadas dos jornadas se cuenta
              en días, que es como se piensa el tiempo de espera. */}
          {sinGestion ? (
            <Badge variant="error">
              Sin respuesta hace {horas >= 48 ? `${Math.floor(horas / 24)} días` : `${horas} h`}
            </Badge>
          ) : null}
          <span className="font-medium text-fg">{tipoIncidenciaParaSeller(incidencia.tipo)}</span>
        </span>
        <span className="rx-num mt-0.5 block text-xs text-fg-muted">
          Reportada el {formatearFechaHora(incidencia.abiertaEn)}
        </span>
        {incidencia.descripcion ? (
          <span className="mt-1 block text-sm leading-snug text-fg-muted group-open:hidden">
            {incidencia.descripcion}
          </span>
        ) : null}
      </summary>

      <div className="space-y-3 border-t border-line px-4 py-3">
        {incidencia.descripcion ? (
          <div>
            <p className="text-[10px] font-medium tracking-[0.12em] text-fg-muted uppercase">
              Lo que se reportó
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-fg">{incidencia.descripcion}</p>
          </div>
        ) : null}

        {/* 🐞 ESTO SE LEÍA DE LA BASE Y NO SE DIBUJABA. El courier escribía cómo
            lo resolvió y el seller nunca lo veía. */}
        <div>
          <p className="text-[10px] font-medium tracking-[0.12em] text-fg-muted uppercase">
            Cómo se resolvió
          </p>
          {incidencia.notasResolucion ? (
            <p className="mt-0.5 text-sm leading-relaxed text-fg">
              {incidencia.notasResolucion}
              {incidencia.resueltaEn ? (
                <span className="rx-num mt-0.5 block text-xs text-fg-muted">
                  {formatearFechaHora(incidencia.resueltaEn)}
                </span>
              ) : null}
            </p>
          ) : (
            <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">
              {resuelta
                ? `${nombreCourier} la cerró sin dejar una nota.`
                : `${nombreCourier} todavía no la resuelve.`}
            </p>
          )}
        </div>

        <div>
          <p className="text-[10px] font-medium tracking-[0.12em] text-fg-muted uppercase">
            Efecto en tu cobro
          </p>
          {/* Solo la mitad que le importa al seller: lo que se le paga o no al
              conductor es asunto del courier (regla 66 del sistema). */}
          {/* Solo la mitad que le importa al seller. La frase completa del
              sistema nombra también la liquidación del conductor, y eso el
              seller no lo ve — ni siquiera en el texto para lectores de
              pantalla, que también es la interfaz (regla 66). */}
          <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">
            {incidencia.afectaCobro
              ? "Esta entrega no se te cobra."
              : "No cambia lo que se te cobra por esta entrega."}
          </p>
        </div>

        <Link
          href={`/portal/pedidos/${incidencia.pedidoId}`}
          className="inline-block text-sm font-medium text-accent-text hover:underline"
        >
          Ver el pedido ›
        </Link>
      </div>
    </details>
  );
}
