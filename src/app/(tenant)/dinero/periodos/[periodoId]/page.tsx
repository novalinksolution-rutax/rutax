/**
 * Pantalla D-2 — Detalle de período de cobro.
 *
 * Server Component. Lee el período y sus líneas.
 * Criterios C-1 (montos CLP), C-3 (signed URLs PDF/XML), C-5 (badge SII), C-7 (folio).
 */

import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import Link from "next/link";
import { Settings, PenLine } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeVerPeriodosCobro } from "@/modules/identidad/capacidades";
import { obtenerPeriodoCobro } from "@/modules/dinero/index";
import type { LineaCobro } from "@/modules/dinero/tipos";
import { formatearCLP, formatearCLPOGuion, formatearAjuste } from "@/lib/ui/formato-moneda";
import { etiquetaTipoEntrega } from "@/lib/ui/etiqueta-fuente-pedido";
import { Badge } from "@/components/ui/badge";
import { PopoverSnapshotRegla } from "@/components/dinero/popover-snapshot-regla";
import { Retorno, destinoRetorno } from "@/components/app-shell/retorno";
import { TablaFinanciera } from "@/components/ui/tabla-financiera";
import { agruparLineasCobro } from "@/modules/dinero/agrupacion-lineas";
import { etiquetaPeriodo } from "@/modules/dinero/listado-periodos";

export const metadata: Metadata = {
  title: "Detalle de período",
};

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

const LIMITE_LINEAS = 50;

interface PageProps {
  params: Promise<{ periodoId: string }>;
  searchParams: Promise<{ pagina?: string; volver?: string; lineas?: string }>;
}

export default async function PaginaDetallePeriodo({ params, searchParams }: PageProps) {
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
        <Retorno href={destinoRetorno("/dinero/periodos", volver)} etiqueta="Volver a períodos" />
        <div
          role="alert"
          className="border border-fault-line bg-fault-bg px-4 py-3.5 text-sm leading-relaxed text-fault-fg"
        >
          <strong className="font-medium">No se pudo leer este período.</strong> Existe y puede
          tener líneas: esta pantalla no las está viendo. No lo cierres, no lo factures y no lo
          anules hasta poder verlas — recarga en unos segundos.
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
  const idsPedidosAjuste = [
    ...new Set(agrupacion.ajustes.map((a) => a.pedidoId).filter((x): x is string => !!x)),
  ];
  const codigoPorPedido = new Map<string, string>();
  if (idsPedidosAjuste.length > 0) {
    const { data: pedidosAjuste } = await cliente
      .from("pedidos")
      .select("id, codigo_interno, ml_shipment_id")
      .eq("tenant_id", tenantId)
      .in("id", idsPedidosAjuste);
    for (const p of (pedidosAjuste ?? []) as Record<string, unknown>[]) {
      const codigo =
        (p.codigo_interno as string | null) ?? (p.ml_shipment_id as string | null) ?? null;
      if (codigo) codigoPorPedido.set(p.id as string, codigo);
    }
  }


  return (
    <div className="space-y-6">
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
          {sellerRut ? ` · ${sellerRut}` : ""} · {formatearCLPOGuion(agrupacion.total)} neto
        </p>
      </div>

      {/* Sección C — Tabla de líneas */}
      {/* --- Las dos columnas ------------------------------------------------
          Ancha: las líneas. Angosta: emisión, qué ve el seller y bitácora. Las
          acciones vivían colgando del encabezado, apretadas contra el borde
          derecho de una fila que también lleva la cifra grande. */}
      <div>
      <section aria-labelledby="lineas-titulo" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="lineas-titulo"
            className="font-mono text-[10px] font-medium tracking-[0.1em] text-fg-subtle uppercase"
          >
            Líneas de cobro ·{" "}
            {verUnaPorUna ? "una por una" : "agrupadas por concepto"}
          </h2>
          {lineas.length > 0 ? (
            <Link
              // Sin parámetros el href queda en `?`, que funciona pero ensucia
              // la barra: en ese caso se vuelve a la ruta pelada.
              href={
                (() => {
                  const q = new URLSearchParams({
                    ...(volver ? { volver } : {}),
                    ...(verUnaPorUna ? {} : { lineas: "detalle" }),
                  }).toString();
                  return q ? `?${q}` : `/dinero/periodos/${periodo.id}`;
                })()
              }
              className="text-xs font-medium text-accent-text hover:underline"
            >
              {verUnaPorUna
                ? "← Volver a la vista agrupada"
                : `Ver las ${lineas.length} una por una ›`}
            </Link>
          ) : null}
          {/* Exportar, al lado de «ver una por una» y no escondido en un menú.
              El sistema dice por qué existe: «un total sin composición es la
              cifra que Administración no puede rastrear — y por la que
              exportaría a Excel». Negar la exportación no evita el Excel; evita
              que salga de una fuente confiable. */}
          {lineas.length > 0 ? (
            <a
              href={`/dinero/periodos/${periodo.id}/exportar`}
              className="text-xs font-medium text-fg-muted hover:text-fg hover:underline"
            >
              Exportar CSV
            </a>
          ) : null}
          {/* Entrada a la Reportería con las fechas de ESTE período ya puestas.
              Es el otro camino que pidió el usuario, además del rango libre: acá
              se ve lo que se le cobra al seller, y allá lo mismo cruzado con lo
              que se le pagó al conductor por cada una de esas entregas — que es
              lo que hay que mirar antes de facturar. */}
          <Link
            href={`/dinero/reporteria?periodo=${periodo.id}`}
            className="text-xs font-medium text-fg-muted hover:text-fg hover:underline"
          >
            Ver con el pago al conductor ›
          </Link>
        </div>

        {lineas.length === 0 ? (
          <div className="rounded-lg border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Este período no tiene líneas todavía. Se agregarán automáticamente a medida que
              se registren entregas.
            </p>
          </div>
        ) : !verUnaPorUna ? (
          <div className="overflow-hidden rounded-lg border bg-card">
            <TablaFinanciera
              // «neto» y no «bruto»: los impuestos los calcula y los muestra el
              // documento tributario, no Rutax (regla 22).
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
                        texto: codigoPorPedido.get(aj.pedidoId) ?? "ver el pedido",
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
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Líneas de cobro del período">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2">Pedido</th>
                    <th className="hidden px-4 py-2 sm:table-cell">Fecha entrega</th>
                    <th className="hidden px-4 py-2 md:table-cell">Tipo</th>
                    <th className="px-4 py-2">Concepto</th>
                    <th className="hidden px-4 py-2 text-right lg:table-cell">Monto base</th>
                    <th className="hidden px-4 py-2 text-right lg:table-cell">Ajuste</th>
                    <th className="px-4 py-2 text-right">Monto final</th>
                    <th className="hidden px-4 py-2 text-center xl:table-cell">Origen</th>
                    <th className="hidden px-4 py-2 text-center xl:table-cell">Por qué</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lineasPaginadas.map((linea) => (
                    <FilaLinea key={linea.id} linea={linea} />
                  ))}
                </tbody>
                {/* Fila de totales sticky al pie */}
                <tfoot className="border-t bg-muted/40">
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-3 text-sm font-semibold"
                    >
                      Total: {lineas.length} línea{lineas.length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">
                      {formatearCLPOGuion(
                        lineas.reduce((acc, l) => acc + l.montoFinalClp, 0),
                      )}
                    </td>
                    <td className="hidden xl:table-cell" />
                    <td className="hidden xl:table-cell" />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Paginación de líneas */}
            {totalPaginas > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  Página {pagina} de {totalPaginas}
                </span>
                <div className="flex gap-2">
                  {pagina > 1 && (
                    <Link
                      href={`/dinero/periodos/${periodoId}?pagina=${pagina - 1}`}
                      className="rounded border px-3 py-1 text-xs hover:bg-muted transition-colors"
                    >
                      Anterior
                    </Link>
                  )}
                  {pagina < totalPaginas && (
                    <Link
                      href={`/dinero/periodos/${periodoId}?pagina=${pagina + 1}`}
                      className="rounded border px-3 py-1 text-xs hover:bg-muted transition-colors"
                    >
                      Siguiente
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      </div>
    </div>
  );
}


// =============================================================================
// Componentes auxiliares
// =============================================================================


function FilaLinea({ linea }: { linea: LineaCobro }) {
  const ajuste = formatearAjuste(linea.ajusteIncidenciaClp);

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <Link
          href={`/operaciones/${linea.pedidoId}`}
          title={linea.pedidoId}
          className="font-mono text-xs text-primary hover:underline"
        >
          {linea.pedidoId.slice(0, 8)}…
        </Link>
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
        {formatearFechaCorta(linea.fechaHecho)}
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        <Badge variant="neutral" className="capitalize">
          {etiquetaTipoEntrega(linea.tipoPedido)}
        </Badge>
      </td>
      <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
        {linea.concepto}
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground lg:table-cell">
        {formatearCLP(linea.montoBaseClp)}
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums lg:table-cell">
        <span
          className={
            ajuste.esNegativo
              ? "text-destructive"
              : ajuste.esPositivo
              ? "text-success"
              : "text-muted-foreground"
          }
        >
          {ajuste.texto}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums font-semibold">
        {formatearCLP(linea.montoFinalClp)}
      </td>
      <td className="hidden px-4 py-3 text-center xl:table-cell">
        {linea.origenGeneracion === "motor_automatico" ? (
          <span title="Generado automáticamente por el motor">
            <Settings className="size-4 text-muted-foreground mx-auto" aria-label="Motor automático" />
          </span>
        ) : (
          <span title="Ajuste manual">
            <PenLine className="size-4 text-muted-foreground mx-auto" aria-label="Ajuste manual" />
          </span>
        )}
      </td>
      <td className="hidden px-4 py-3 text-center xl:table-cell">
        <PopoverSnapshotRegla snapshotRegla={linea.snapshotRegla} iconoSolo />
      </td>
    </tr>
  );
}
