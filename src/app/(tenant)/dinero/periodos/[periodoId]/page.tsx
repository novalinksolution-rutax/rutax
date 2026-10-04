/**
 * Pantalla D-2 — Detalle de período de cobro.
 *
 * Server Component. Lee el período y sus líneas.
 * Criterios C-1 (montos CLP), C-3 (signed URLs PDF/XML), C-5 (badge SII), C-7 (folio).
 */

import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import Link from "next/link";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeVerPeriodosCobro } from "@/modules/identidad/capacidades";
import { obtenerPeriodoCobro } from "@/modules/dinero/index";
import type { LineaCobro } from "@/modules/dinero/tipos";
import {
  formatearCLP,
  formatearCLPOGuion,
  formatearAjuste,
} from "@/lib/ui/formato-moneda";
import { etiquetaTipoEntrega } from "@/lib/ui/etiqueta-fuente-pedido";
import { PopoverSnapshotRegla } from "@/components/dinero/popover-snapshot-regla";
import { Retorno, destinoRetorno } from "@/components/app-shell/retorno";
import { TablaFinanciera } from "@/components/ui/tabla-financiera";
import { MasAccionesLineas } from "./mas-acciones-lineas";
import { codigoVisible } from "@/modules/dinero/reporteria/consolidado";
import { agruparLineasCobro } from "@/modules/dinero/agrupacion-lineas";
import { etiquetaPeriodo } from "@/modules/dinero/listado-periodos";

export const metadata: Metadata = {
  title: "Detalle de período",
};

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}-${mes}-${anio}`;
}

const LIMITE_LINEAS = 50;

interface PageProps {
  params: Promise<{ periodoId: string }>;
  searchParams: Promise<{ pagina?: string; volver?: string; lineas?: string }>;
}

export default async function PaginaDetallePeriodo({
  params,
  searchParams,
}: PageProps) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  // Lectura: el detalle del período se ve aunque no se pueda emitir.
  if (!puedeVerPeriodosCobro(sesion.usuario)) redirect("/dashboard");

  const { periodoId } = await params;
  const { volver, lineas: vistaLineas } = await searchParams;
  // La vista agrupada es la de por defecto: 285 filas no se auditan. La línea
  // por línea sigue existiendo, un clic más allá.
  const verUnaPorUna = vistaLineas === "detalle";
  const sp = await searchParams;
  const pagina = Math.max(1, parseInt(sp.pagina ?? "1", 10));
  const tenantId = sesion.usuario.tenantId;

  const cliente = crearClienteServiceRole();

  // Modo de emisión DTE efectivo: define el copy y el badge de los diálogos de
  // emisión (que una simulación no parezca real). Defecto conservador: sandbox si
  // la resolución falla.
  //
  // No depende del período, así que se lanza ahora y se recoge después de cargarlo:
  // encadenado costaba un round-trip antes siquiera de empezar a leer el período.

  let periodo;
  let sellerNombre = "—";
  let sellerRut: string | null = null;
  let errorCarga = false;

  try {
    periodo = await obtenerPeriodoCobro(cliente, tenantId, periodoId);
    if (!periodo) redirect("/dinero/periodos");

    // Obtener nombre del seller
    const { data: sellerData } = await cliente
      .from("sellers")
      .select("razon_social, rut")
      .eq("id", periodo.sellerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    sellerNombre = (sellerData?.razon_social as string) ?? periodo.sellerId;
    // El RUT va en la cabecera porque es lo que sale impreso en la factura: si
    // está mal, se descubre acá o se descubre en el SII.
    sellerRut = (sellerData?.rut as string | null) ?? null;
  } catch (error) {
    // Ver el comentario equivalente en `dinero/liquidaciones/[liquidacionId]/page.tsx`:
    // `redirect()` (arriba, cuando el período no existe o es de otro tenant)
    // depende de una excepción interna de Next.js que este `catch` genérico
    // atraparía y convertiría en el mensaje de error en vez de redirigir.
    unstable_rethrow(error);
    errorCarga = true;
  }

  // ⚠️ FALLA DE LECTURA. Antes esto reemplazaba la pantalla entera por un
  // `role="alert"`: se perdía el encabezado, el neto y el estado, o sea todo lo
  // que permite decidir si hay que llamar a alguien. Cuando el período NO se
  // pudo leer no hay nada que mostrar y esto es correcto; lo que cambia —más
  // abajo— es la falla PARCIAL, donde la cabecera se conserva y lo que se
  // deshabilita son las acciones, con su motivo escrito.
  if (errorCarga || !periodo) {
    return (
      <div className="space-y-4">
        <Retorno
          href={destinoRetorno("/dinero/periodos", volver)}
          etiqueta="Volver a períodos"
        />
        <div
          role="alert"
          className="border border-fault-line bg-fault-bg px-4 py-3.5 text-sm leading-relaxed text-fault-fg"
        >
          <strong className="font-medium">No se pudo leer este período.</strong>{" "}
          Existe y puede tener líneas: esta pantalla no las está viendo. No lo
          cierres, no lo factures y no lo anules hasta poder verlas — recarga en
          unos segundos.
        </div>
      </div>
    );
  }

  const lineas: LineaCobro[] = periodo.lineas ?? [];
  const agrupacion = agruparLineasCobro(lineas);
  const totalPaginas = Math.ceil(lineas.length / LIMITE_LINEAS);
  const offset = (pagina - 1) * LIMITE_LINEAS;
  const lineasPaginadas = lineas.slice(offset, offset + LIMITE_LINEAS);

  // El código del pedido de cada ajuste. Sin esto la causa dice «ver el pedido»
  // —el mismo texto en las cinco filas— y no se puede saber cuál sin abrirlas
  // una por una. El tablero enlaza «incidencia RX-5M7T»: nombrar el pedido es lo
  // más cerca que se puede estar hoy, porque no existe una ruta por incidencia.
  // El código visible del pedido, para los ajustes y las líneas de esta
  // página: un UUID no le dice nada a nadie.
  const idsPedidosAjuste = [
    ...new Set([
      ...agrupacion.ajustes
        .map((a) => a.pedidoId)
        .filter((x): x is string => !!x),
      ...(verUnaPorUna ? lineasPaginadas.map((l) => l.pedidoId) : []),
    ]),
  ];
  const codigoPorPedido = new Map<string, string>();
  if (idsPedidosAjuste.length > 0) {
    // El código se elige con `codigoVisible`, la misma regla de la
    // reportería: referencia de la fuente, venta ML, RX-…, envío ML. Nunca el
    // UUID (decisión del usuario). Va por `operacion` directo, como el resto
    // del código con service_role.
    const { data: pedidosAjuste } = await cliente
      .schema("operacion")
      .from("pedidos")
      .select(
        "id, referencia_externa, ml_order_id, codigo_interno, ml_shipment_id",
      )
      .eq("tenant_id", tenantId)
      .in("id", idsPedidosAjuste);
    for (const p of (pedidosAjuste ?? []) as {
      id: string;
      referencia_externa: string | null;
      ml_order_id: string | null;
      codigo_interno: string | null;
      ml_shipment_id: string | null;
    }[]) {
      const codigo = codigoVisible(p);
      if (codigo !== "—") codigoPorPedido.set(p.id, codigo);
    }
  }

  const urlVista = (vista: "resumen" | "detalle") => {
    const q = new URLSearchParams({
      ...(volver ? { volver } : {}),
      ...(vista === "detalle" ? { lineas: "detalle" } : {}),
    }).toString();
    return q ? `?${q}` : `/dinero/periodos/${periodo.id}`;
  };

  return (
    <div className="space-y-5">
      <Retorno
        href={destinoRetorno(`/dinero/periodos?periodo=${periodo.id}`, volver)}
        etiqueta="Volver a la ficha"
      />

      {/* Esta página queda SOLO para las líneas, que pueden ser cientos
          (decisión del usuario, 2026-09-27). Todo lo demás —cifras, factura,
          pago, acciones, bitácora— vive en la ficha lateral del listado. */}
      <div>
        <h1 className="font-heading text-2xl font-semibold">{sellerNombre}</h1>
        <p className="rx-num mt-0.5 text-xs text-fg-muted">
          {etiquetaPeriodo(periodo.fechaInicio, periodo.fechaFin)}
          {sellerRut ? ` · ${sellerRut}` : ""} ·{" "}
          {formatearCLPOGuion(agrupacion.total)} neto
        </p>
      </div>

      {lineas.length === 0 ? (
        <p className="text-sm text-fg-muted">Sin líneas.</p>
      ) : (
        <section aria-label="Líneas de cobro" className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-2">
            {/* Dos vistas del mismo dinero: el resumen por concepto (lo que va a
                la factura) y el detalle, una línea por entrega. */}
            <div
              className="inline-flex rounded-md border border-line p-0.5"
              role="tablist"
            >
              {(["resumen", "detalle"] as const).map((v) => {
                const activo = (v === "detalle") === verUnaPorUna;
                return (
                  <Link
                    key={v}
                    href={urlVista(v)}
                    role="tab"
                    aria-selected={activo}
                    className={`flex min-h-11 items-center rounded px-3 text-sm md:min-h-8 ${
                      activo
                        ? "bg-accent-bg text-accent-text"
                        : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    {v === "resumen" ? "Resumen" : `Detalle · ${lineas.length}`}
                  </Link>
                );
              })}
            </div>
            <MasAccionesLineas periodoId={periodo.id} />
          </div>

          {!verUnaPorUna ? (
            <>
              {/* Teléfono: lista. La tabla financiera pide 34rem y se deslizaba. */}
              <ul className="divide-y divide-line-subtle rounded-md border border-line md:hidden">
                {agrupacion.conceptos.map((c) => (
                  <li
                    key={c.concepto}
                    className="flex items-baseline justify-between gap-3 px-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-fg">
                        {c.concepto}
                      </span>
                      <span className="rx-num block text-xs text-fg-muted">
                        {c.entregas} {c.entregas === 1 ? "entrega" : "entregas"}
                        {c.tarifa !== undefined
                          ? ` × ${formatearCLP(c.tarifa)}`
                          : ""}
                      </span>
                    </span>
                    <span className="rx-num shrink-0 text-sm">
                      {formatearCLP(c.monto)}
                    </span>
                  </li>
                ))}
                {agrupacion.ajustes.map((aj, i) => (
                  <li
                    key={`aj-${i}`}
                    className="flex items-baseline justify-between gap-3 px-3 py-2.5"
                  >
                    <span className="min-w-0 text-sm text-fg">
                      Ajuste
                      {aj.pedidoId ? (
                        <Link
                          href={`/operaciones/${aj.pedidoId}`}
                          className="rx-num ms-1 text-xs text-accent-text hover:underline"
                        >
                          {codigoPorPedido.get(aj.pedidoId) ?? "pedido"}
                        </Link>
                      ) : null}
                    </span>
                    <span
                      className={`rx-num shrink-0 text-sm ${aj.monto < 0 ? "text-fault-fg" : "text-balanced-fg"}`}
                    >
                      {formatearAjuste(aj.monto).texto}
                    </span>
                  </li>
                ))}
                <li className="flex items-baseline justify-between gap-3 bg-bg-sunken/50 px-3 py-2.5">
                  <span className="text-sm font-medium">Total neto</span>
                  <span className="rx-num text-sm font-semibold">
                    {formatearCLP(agrupacion.total)}
                  </span>
                </li>
              </ul>
              <div className="hidden overflow-hidden rounded-md border border-line bg-card md:block">
                <TablaFinanciera
                  rotulo="neto"
                  filas={[
                    ...agrupacion.conceptos.map((c) => ({
                      tipo: "linea" as const,
                      concepto: c.concepto,
                      entregas: c.entregas,
                      tarifa: c.tarifa,
                      monto: c.monto,
                    })),
                    ...(agrupacion.ajustes.length > 0
                      ? [
                          {
                            tipo: "subtotal" as const,
                            concepto: "Subtotal de entregas",
                            entregas: agrupacion.entregasTotales,
                            monto: agrupacion.subtotalEntregas,
                          },
                        ]
                      : []),
                    ...agrupacion.ajustes.map((aj) => ({
                      tipo: "ajuste" as const,
                      concepto: aj.concepto,
                      monto: aj.monto,
                      causa: aj.pedidoId
                        ? {
                            texto:
                              codigoPorPedido.get(aj.pedidoId) ??
                              "ver el pedido",
                            href: `/operaciones/${aj.pedidoId}`,
                          }
                        : undefined,
                    })),
                    {
                      tipo: "total" as const,
                      concepto: "Total del período",
                      entregas: agrupacion.entregasTotales,
                      monto: agrupacion.total,
                    },
                  ]}
                />
              </div>
            </>
          ) : (
            <>
              {/* Teléfono: una tarjeta por línea. */}
              <ul className="divide-y divide-line-subtle rounded-md border border-line md:hidden">
                {lineasPaginadas.map((l) => {
                  const ajuste = formatearAjuste(l.ajusteIncidenciaClp);
                  return (
                    <li
                      key={l.id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="min-w-0">
                        <Link
                          href={`/operaciones/${l.pedidoId}`}
                          className="rx-num flex min-h-8 items-center text-sm text-accent-text hover:underline"
                        >
                          {codigoPorPedido.get(l.pedidoId) ?? "Ver pedido"}
                        </Link>
                        <span className="rx-num block text-xs text-fg-muted">
                          {formatearFechaCorta(l.fechaHecho)} ·{" "}
                          {etiquetaTipoEntrega(l.tipoPedido)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="rx-num block text-sm font-medium">
                          {formatearCLP(l.montoFinalClp)}
                        </span>
                        {l.ajusteIncidenciaClp !== 0 ? (
                          <span
                            className={`rx-num block text-xs ${ajuste.esNegativo ? "text-fault-fg" : "text-balanced-fg"}`}
                          >
                            {ajuste.texto}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="hidden overflow-hidden rounded-md border border-line bg-card md:block">
                <table
                  className="w-full text-sm"
                  aria-label="Líneas de cobro del período"
                >
                  <thead>
                    <tr className="border-b border-line bg-muted/40 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      <th className="px-4 py-2">Pedido</th>
                      <th className="px-4 py-2">Fecha</th>
                      <th className="px-4 py-2">Tipo</th>
                      <th className="hidden px-4 py-2 text-right lg:table-cell">
                        Base
                      </th>
                      <th className="hidden px-4 py-2 text-right lg:table-cell">
                        Ajuste
                      </th>
                      <th className="px-4 py-2 text-right">Monto</th>
                      <th className="hidden px-4 py-2 text-center xl:table-cell">
                        Regla
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle">
                    {lineasPaginadas.map((linea) => (
                      <FilaLinea
                        key={linea.id}
                        linea={linea}
                        codigo={codigoPorPedido.get(linea.pedidoId) ?? null}
                      />
                    ))}
                  </tbody>
                  <tfoot className="border-t border-line bg-muted/40">
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-sm font-medium">
                        {lineas.length}{" "}
                        {lineas.length === 1 ? "línea" : "líneas"}
                      </td>
                      <td className="hidden lg:table-cell" />
                      <td className="hidden lg:table-cell" />
                      <td className="rx-num px-4 py-3 text-right font-semibold">
                        {formatearCLPOGuion(
                          lineas.reduce((acc, l) => acc + l.montoFinalClp, 0),
                        )}
                      </td>
                      <td className="hidden xl:table-cell" />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {totalPaginas > 1 ? (
                <div className="flex items-center justify-end gap-2 text-sm">
                  {/* 🔴 La paginación conserva la vista: antes perdía
                      `lineas=detalle` y la página 2 volvía al resumen. */}
                  {pagina > 1 ? (
                    <Link
                      href={`${urlVista("detalle")}&pagina=${pagina - 1}`}
                      className="flex min-h-11 items-center px-3 text-accent-text hover:underline md:min-h-8"
                    >
                      Anterior
                    </Link>
                  ) : null}
                  <span className="rx-num text-fg-muted">
                    {pagina} / {totalPaginas}
                  </span>
                  {pagina < totalPaginas ? (
                    <Link
                      href={`${urlVista("detalle")}&pagina=${pagina + 1}`}
                      className="flex min-h-11 items-center px-3 text-accent-text hover:underline md:min-h-8"
                    >
                      Siguiente
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      )}
    </div>
  );
}

// =============================================================================
// Componentes auxiliares
// =============================================================================

function FilaLinea({
  linea,
  codigo,
}: {
  linea: LineaCobro;
  codigo: string | null;
}) {
  const ajuste = formatearAjuste(linea.ajusteIncidenciaClp);

  return (
    <tr className="transition-colors hover:bg-muted/30">
      <td className="px-4 py-2.5">
        <Link
          href={`/operaciones/${linea.pedidoId}`}
          className="rx-num text-xs text-accent-text hover:underline"
        >
          {codigo ?? "Ver pedido"}
        </Link>
      </td>
      <td className="rx-num px-4 py-2.5 text-muted-foreground">
        {formatearFechaCorta(linea.fechaHecho)}
      </td>
      <td className="px-4 py-2.5 text-muted-foreground">
        {etiquetaTipoEntrega(linea.tipoPedido)}
      </td>
      <td className="rx-num hidden px-4 py-2.5 text-right text-muted-foreground lg:table-cell">
        {formatearCLP(linea.montoBaseClp)}
      </td>
      <td
        className={`rx-num hidden px-4 py-2.5 text-right lg:table-cell ${
          ajuste.esNegativo
            ? "text-destructive"
            : ajuste.esPositivo
              ? "text-success"
              : "text-muted-foreground"
        }`}
      >
        {ajuste.texto}
      </td>
      <td className="rx-num px-4 py-2.5 text-right font-medium">
        {formatearCLP(linea.montoFinalClp)}
      </td>
      <td className="hidden px-4 py-2.5 text-center xl:table-cell">
        <PopoverSnapshotRegla snapshotRegla={linea.snapshotRegla} iconoSolo />
      </td>
    </tr>
  );
}
