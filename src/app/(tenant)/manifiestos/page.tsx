/**
 * Lista de manifiestos — Flujo 2
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Truck } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGenerarManifiestos } from "@/modules/identidad/capacidades";
import { mapaNombresConductores } from "@/modules/identidad/consultas";
import {
  traducirEstadoManifiesto,
  BADGE_ESTADO_MANIFIESTO,
} from "@/lib/ui/traduccion-estados";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Manifiesto, EstadoManifiesto } from "@/modules/operacion/tipos";
import { FiltrosManifiestos } from "./filtros-manifiestos";
import { IndicadorEnVivo } from "@/components/tiempo-real/indicador-en-vivo";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import { formatearFechaCorta, formatearHora } from "@/lib/formato-cl";
import {
  cargarContextoManifiestos,
  contarManifiestosPorEstado,
  obtenerCoberturaDelDia,
  type ConteosManifiesto,
  type ContextoManifiestos,
} from "@/modules/operacion/listado-manifiestos";
import { CajonesManifiestos, CeldaAvance } from "./piezas-listado";
import { ChevronRight } from "lucide-react";
import { parsearRangoFecha } from "@/lib/filtros/fecha";
import { EnlaceDetalle } from "@/components/app-shell/enlace-detalle";

interface SearchParams {
  estado?: string;
  conductor?: string;
  fecha?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
}

export default async function PaginaManifiestos({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  const params = await searchParams;
  const tenantId = sesion.usuario.tenantId;
  const puedeCrear = puedeGenerarManifiestos(sesion.usuario);

  const filtroEstado = (params.estado as EstadoManifiesto | "") ?? "";
  const rangoFecha = parsearRangoFecha({
    exacto: params.fecha,
    desde: params.fecha_desde,
    hasta: params.fecha_hasta,
  });
  const hoyIso = hoyEnSantiago();

  const cliente = crearClienteServiceRole();
  let manifiestos: Manifiesto[] = [];
  let errorCarga = false;

  try {
    let query = cliente
      .from("manifiestos")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("fecha_operacion", { ascending: false })
      .limit(50);

    if (filtroEstado) query = query.eq("estado", filtroEstado);
    // `fecha_operacion` es columna `date`: día exacto o rango con gte/lte.
    if (rangoFecha.exacto) {
      query = query.eq("fecha_operacion", rangoFecha.exacto);
    } else {
      if (rangoFecha.desde) query = query.gte("fecha_operacion", rangoFecha.desde);
      if (rangoFecha.hasta) query = query.lte("fecha_operacion", rangoFecha.hasta);
    }

    const { data, error } = await query;
    if (error) throw error;
    manifiestos = (data ?? []).map((m: Record<string, unknown>) => ({
      id: m.id as string,
      tenantId: m.tenant_id as string,
      driverId: m.driver_id as string,
      nombre: m.nombre as string,
      fechaOperacion: m.fecha_operacion as string,
      estado: m.estado as EstadoManifiesto,
      notas: (m.notas as string | null) ?? null,
      creadoPorUsuarioId: (m.creado_por_usuario_id as string | null) ?? null,
      confirmadoEn: (m.confirmado_en as string | null) ?? null,
      completadoEn: (m.completado_en as string | null) ?? null,
      creadoEn: m.creado_en as string,
      actualizadoEn: m.actualizado_en as string,
    }));
  } catch {
    errorCarga = true;
  }

  // Paradas, avance y destino de lo cancelado. Va aparte y con su propio
  // manejo de error: si esta lectura falla, el listado sigue mostrando estado,
  // conductor y salida — que es la mitad que la tabla de manifiestos sí sabe.
  let contexto: ContextoManifiestos = { avance: {}, redistribucion: {} };
  let conteos: ConteosManifiesto = {
    borrador: 0,
    confirmado: 0,
    en_ruta: 0,
    completado: 0,
    cancelado: 0,
  };
  try {
    [contexto, conteos] = await Promise.all([
      cargarContextoManifiestos(cliente, tenantId, manifiestos),
      contarManifiestosPorEstado(cliente, tenantId, {
        fechaExacta: rangoFecha.exacto || undefined,
        desde: rangoFecha.desde || undefined,
        hasta: rangoFecha.hasta || undefined,
      }),
    ]);
  } catch {
    // best-effort, igual que los nombres de conductor.
  }

  // La hora de Santiago decide si un avance bajo es normal o es una alarma.
  const horaActual = Number(formatearHora(new Date()).split(":")[0]);

  // El subtítulo: lo primero que la pantalla dice, y lo que la convierte en una
  // respuesta —«¿está toda la flota con ruta?»— en vez de un índice.
  const cobertura = await obtenerCoberturaDelDia(cliente, tenantId, hoyIso).catch(() => null);

  // Nombres legibles para la columna Conductor (en vez del UUID).
  let nombreConductorPorId: Record<string, string> = {};
  try {
    const driverIds = Array.from(new Set(manifiestos.map((m) => m.driverId)));
    nombreConductorPorId = await mapaNombresConductores(cliente, tenantId, driverIds);
  } catch {
    // best-effort — si falla, la celda cae al UUID.
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold">Manifiestos</h1>
            <IndicadorEnVivo
              tenantId={tenantId}
              tablas={[{ schema: "operacion", tabla: "manifiestos" }]}
            />
          </div>
          {cobertura ? (
            <p className="rx-num mt-0.5 text-xs text-fg-muted">
              {formatearFechaCorta(new Date())} · {cobertura.conRuta} de{" "}
              {cobertura.disponibles}{" "}
              {cobertura.disponibles === 1 ? "conductor" : "conductores"} con ruta
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {puedeCrear && (
            <Button asChild>
              <Link href="/preparacion/asignar">
                <Plus className="size-4" aria-hidden="true" />
                Asignar pedidos
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Filtros */}
      <FiltrosManifiestos
        hoy={hoyIso}
        filtroEstado={filtroEstado}
        filtroFecha={rangoFecha.exacto}
        filtroFechaDesde={rangoFecha.desde}
        filtroFechaHasta={rangoFecha.hasta}
        hayFiltros={!!(filtroEstado || rangoFecha.hayFecha)}
      />

      {errorCarga && (
        <div role="alert" className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground">
          No pudimos cargar los manifiestos. Intenta recargar la página.
        </div>
      )}

      {!errorCarga && manifiestos.length === 0 ? (
        <EmptyState
          icon={Truck}
          titulo={
            filtroEstado || rangoFecha.hayFecha
              ? "Ningún manifiesto coincide"
              : "Aún no hay manifiestos hoy"
          }
          descripcion={
            filtroEstado || rangoFecha.hayFecha
              ? "Prueba cambiando el estado o la fecha."
              : "Asigna pedidos ya retirados a un conductor: el manifiesto se arma solo, como parte de la asignación."
          }
          tono={filtroEstado || rangoFecha.hayFecha ? "filtro" : "arranque"}
          accion={
            puedeCrear ? (
              <Button asChild size="sm" variant={filtroEstado || rangoFecha.hayFecha ? "outline" : "default"}>
                <Link href="/preparacion/asignar">Asignar pedidos</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        !errorCarga && (
          <DataTable
            toolbar={
              <CajonesManifiestos
                cajones={[
                  { clave: "en_ruta", etiqueta: "En ruta", conteo: conteos.en_ruta },
                  {
                    clave: "confirmado",
                    etiqueta: "Listos para salir",
                    conteo: conteos.confirmado,
                  },
                  { clave: "borrador", etiqueta: "Borrador", conteo: conteos.borrador },
                  {
                    clave: "completado",
                    etiqueta: "Completados",
                    conteo: conteos.completado,
                  },
                ]}
                // `cancelado` no pertenece al conjunto operativo —no está en
                // ruta, no está listo y no se completó—, así que va tras el
                // separador y en tono inerte, fuera de la suma.
                excluido={{
                  clave: "cancelado",
                  etiqueta: "Cancelados",
                  conteo: conteos.cancelado,
                }}
                activo={filtroEstado || null}
                total={Object.values(conteos).reduce((a, b) => a + b, 0)}
              />
            }
          >
            <Table densidad="comfortable" aria-label="Lista de manifiestos">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4">Estado</TableHead>
                  <TableHead className="px-4">Conductor</TableHead>
                  <TableHead className="hidden px-4 sm:table-cell">Paradas</TableHead>
                  <TableHead className="hidden px-4 md:table-cell">Avance</TableHead>
                  <TableHead className="hidden px-4 lg:table-cell">Salida</TableHead>
                  <TableHead className="w-8 px-4">
                    <span className="sr-only">Ver</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {manifiestos.map((m) => {
                  const avance = contexto.avance[m.id] ?? null;
                  const redis = contexto.redistribucion[m.id] ?? null;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="px-4">
                        <BadgeEstado
                          variante={BADGE_ESTADO_MANIFIESTO[m.estado]}
                          eje="manifiesto"
                          valor={m.estado}
                          texto={traducirEstadoManifiesto(m.estado)}
                        />
                      </TableCell>

                      {/* La identidad de la fila es el CONDUCTOR, no el nombre
                          del manifiesto. Nadie busca «Manifiesto 2026-08-21-03»:
                          se busca a quién le tocó qué. El nombre queda debajo,
                          que es donde sirve para hablar del documento. */}
                      <TableCell className="px-4">
                        <EnlaceDetalle
                          href={`/manifiestos/${m.id}`}
                          className="font-medium hover:underline"
                        >
                          {nombreConductorPorId[m.driverId] ?? m.driverId}
                        </EnlaceDetalle>
                        <span className="block truncate text-xs text-muted-foreground">
                          {m.nombre}
                        </span>
                      </TableCell>

                      <TableCell className="hidden px-4 tabular-nums sm:table-cell">
                        {avance ? avance.paradas : "—"}
                      </TableCell>

                      <TableCell className="hidden px-4 md:table-cell">
                        <CeldaAvance
                          estado={m.estado}
                          avance={avance}
                          redistribucion={redis}
                          horaActual={horaActual}
                        />
                      </TableCell>

                      <TableCell className="hidden px-4 text-muted-foreground tabular-nums lg:table-cell">
                        {m.confirmadoEn ? formatearHora(m.confirmadoEn) : "—"}
                      </TableCell>

                      {/* El chevrón es la afordancia de «esta fila entra»: sin
                          él, solo el nombre parece pulsable y el resto de la
                          fila se lee como texto. */}
                      <TableCell className="px-4 text-muted-foreground">
                        <ChevronRight className="size-4" aria-hidden="true" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTable>
        )
      )}
    </div>
  );
}
