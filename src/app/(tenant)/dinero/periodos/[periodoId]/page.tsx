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
import { obtenerPeriodoCobro, listarDocumentosDte } from "@/modules/dinero/index";
import { resolverModoDteTenant, type ModoDte } from "@/modules/dinero/modo-dte";
import type { DocumentoDte, LineaCobro } from "@/modules/dinero/tipos";
import {
  BADGE_ESTADO_SII,
  traducirEstadoSiiTexto,
  traducirEstadoPeriodoCobro,
  BADGE_ESTADO_PERIODO,
  traducirEstadoCobroPeriodo,
  BADGE_ESTADO_COBRO_PERIODO,
} from "@/lib/ui/traduccion-estados";
import { formatearCLP, formatearCLPOGuion, formatearAjuste } from "@/lib/ui/formato-moneda";
import { etiquetaTipoEntrega } from "@/lib/ui/etiqueta-fuente-pedido";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { PopoverSnapshotRegla } from "@/components/dinero/popover-snapshot-regla";
import { DialogCerrarPeriodo } from "../dialog-cerrar-periodo";
import { DialogEmitirFactura } from "./dialog-emitir-factura";
import { DialogReabrirPeriodo } from "./dialog-reabrir-periodo";
import { DialogEmitirNotaCredito } from "./dialog-emitir-nota-credito";
import { BotonDescargaDocumento } from "./boton-descarga-documento";
import { Retorno, destinoRetorno } from "@/components/app-shell/retorno";
import { TablaFinanciera } from "@/components/ui/tabla-financiera";
import { agruparLineasCobro } from "@/modules/dinero/agrupacion-lineas";
import { BloqueComposicion } from "@/components/ui/bloque-composicion";
import { BloqueTrazabilidad } from "@/components/ui/bloque-trazabilidad";
import { obtenerTrazabilidad } from "@/modules/identidad/trazabilidad";
import { loQueVeElSeller } from "@/modules/dinero/vista-seller-periodo";
import { contarBloqueosDeFacturacion, etiquetaPeriodo } from "@/modules/dinero/listado-periodos";
import { mapaNombresUsuarios } from "@/modules/identidad/consultas";

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
  const modoDtePromesa: Promise<ModoDte> = resolverModoDteTenant(tenantId).catch(
    () => "sandbox" as ModoDte,
  );

  let periodo;
  let dte: DocumentoDte | null = null;
  let notaCredito: DocumentoDte | null = null;
  let sellerNombre = "—";
  let sellerRut: string | null = null;
  let cerradoPor: string | null = null;
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

    // Quién cerró el período. Un cierre lo puede hacer el cron de las 02:00 o
    // una persona, y la diferencia importa cuando alguien pregunta por qué se
    // cerró antes de tiempo.
    if (periodo.cerradoPorUsuarioId) {
      const nombres = await mapaNombresUsuarios(cliente, tenantId, [
        periodo.cerradoPorUsuarioId,
      ]).catch(() => ({}) as Record<string, { nombreCompleto: string }>);
      cerradoPor = nombres[periodo.cerradoPorUsuarioId]?.nombreCompleto ?? null;
    }

    // Obtener documentos del período: la factura (33) y, si el período fue
    // anulado, la nota de crédito (61) que la referencia.
    if (periodo.documentoDteId) {
      const dtes = await listarDocumentosDte(cliente, tenantId, periodo.sellerId);
      dte =
        dtes.find((d) => d.periodoCobroidId === periodoId && d.tipoDocumento === 33) ??
        null;
      notaCredito =
        dtes.find((d) => d.periodoCobroidId === periodoId && d.tipoDocumento === 61) ??
        null;
    }
  } catch (error) {
    // Ver el comentario equivalente en `dinero/liquidaciones/[liquidacionId]/page.tsx`:
    // `redirect()` (arriba, cuando el período no existe o es de otro tenant)
    // depende de una excepción interna de Next.js que este `catch` genérico
    // atraparía y convertiría en el mensaje de error en vez de redirigir.
    unstable_rethrow(error);
    errorCarga = true;
  }

  const modoDte = await modoDtePromesa;

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

  // La bitácora del período y sus excepciones bloqueantes. Van después de tener
  // el período: las dos cuelgan de él, y si el período no se leyó no hay nada
  // que consultar.
  const [bitacora, bloqueos] = await Promise.all([
    obtenerTrazabilidad(cliente, tenantId, "periodo_cobro", periodoId, { limite: 8 }).catch(
      () => [],
    ),
    contarBloqueosDeFacturacion(cliente, tenantId, [
      { id: periodo.id, sellerId: periodo.sellerId },
    ]).catch(() => ({}) as Record<string, number>),
  ]);
  const excepcionesBloqueantes = bloqueos[periodo.id] ?? 0;

  const lineas: LineaCobro[] = periodo.lineas ?? [];
  const agrupacion = agruparLineasCobro(lineas);
  const totalPaginas = Math.ceil(lineas.length / LIMITE_LINEAS);
  const offset = (pagina - 1) * LIMITE_LINEAS;
  const lineasPaginadas = lineas.slice(offset, offset + LIMITE_LINEAS);

  const textoBadge = traducirEstadoPeriodoCobro(
    periodo.estado,
    periodo.estado === "facturado" && dte ? dte.folio : undefined,
  );

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

  const vistaSeller = loQueVeElSeller(periodo.estado, {
    folio: dte?.folio ?? null,
    tieneDocumento: Boolean(dte?.pdfRef),
  });

  return (
    <div className="space-y-6">
      <Retorno href={destinoRetorno("/dinero/periodos", volver)} etiqueta="Volver a períodos" />

      {/* Sección A — Encabezado */}
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="font-heading text-2xl font-semibold">
              <Link href="/sellers" className="hover:underline">
                {sellerNombre}
              </Link>
            </h1>
            {/* Período, RUT y quién cerró, en una línea. El RUT porque es lo que
                sale impreso en la factura; el autor del cierre porque un cierre
                lo puede hacer el cron de las 02:00 o una persona, y cuando
                alguien pregunta «¿por qué se cerró antes?» esa es la respuesta. */}
            <p className="rx-num text-xs text-fg-muted">
              {etiquetaPeriodo(periodo.fechaInicio, periodo.fechaFin)}
              {sellerRut ? ` · ${sellerRut}` : ""}
              {" · "}
              {periodo.totalLineas} {periodo.totalLineas === 1 ? "línea" : "líneas"}
              {periodo.cerradoEn
                ? ` · cerrado el ${formatearFechaCorta(periodo.cerradoEn)}${
                    cerradoPor ? ` por ${cerradoPor}` : " automáticamente"
                  }`
                : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <BadgeEstado variante={BADGE_ESTADO_PERIODO[periodo.estado]} eje="periodo" valor={periodo.estado} texto={textoBadge} />
              {periodo.estadoCobro !== "no_aplica" && (
                <BadgeEstado variante={BADGE_ESTADO_COBRO_PERIODO[periodo.estadoCobro]} eje="cobro-periodo" valor={periodo.estadoCobro} texto={traducirEstadoCobroPeriodo(periodo.estadoCobro)} />
              )}
              {/* «Sin excepciones» es una afirmación, no un vacío: dice que se
                  miró y no había nada. Sin ella, la ausencia de aviso se
                  confunde con la ausencia de revisión. */}
              {excepcionesBloqueantes > 0 ? (
                <Link
                  href="/dinero/conciliacion?bloqueo=si"
                  className="rx-num border border-fault-line bg-fault-bg px-1.5 py-0.5 text-[10px] leading-none tracking-[0.1em] text-fault-fg uppercase hover:underline"
                >
                  {excepcionesBloqueantes}{" "}
                  {excepcionesBloqueantes === 1 ? "excepción" : "excepciones"} ›
                </Link>
              ) : (
                <span className="rx-num border border-line px-1.5 py-0.5 text-[10px] leading-none tracking-[0.1em] text-fg-muted uppercase">
                  Sin excepciones
                </span>
              )}
            </div>

            {/* ⚠️ LA CIFRA VA ROTULADA. Antes era un número pelado de 3xl: la
                misma pantalla muestra más abajo el total CON IVA del documento
                emitido, así que sin rótulo hay dos cifras grandes distintas
                para el mismo período y ninguna dice cuál es cuál (regla 18). */}
            <div className="pt-1">
              <p className="rx-num text-[10px] tracking-[0.12em] text-fg-muted uppercase">
                Total neto a facturar
              </p>
              {/* ⚠️ LA CIFRA SALE DE LAS LÍNEAS, NO DE `monto_total_clp`.
                  Son dos números distintos y la pantalla mostraba el segundo
                  mientras la tabla de abajo sumaba el primero — visto en
                  pantalla: «$13.566» arriba y «$11.400» en el total del período.
                  El que manda es el de las líneas: es el que va a la factura
                  (el preflight arma el DTE desde ellas) y el que ya excluye las
                  anuladas. `listarLineasCobroPorPeriodo` está paginada, así que
                  no hay riesgo de sumar una página. */}
              <p className="rx-num text-3xl font-semibold">
                {formatearCLPOGuion(agrupacion.total)}
              </p>
              {/* Y si el total guardado quedó viejo se dice, porque es el que
                  muestra el LISTADO: sin esta línea, dos pantallas del producto
                  dan cifras distintas del mismo período y ninguna avisa. */}
              {periodo.montoTotalClp !== null && periodo.montoTotalClp !== agrupacion.total ? (
                <p className="mt-1 text-xs leading-relaxed text-attention-fg">
                  El total guardado del período dice{" "}
                  <span className="rx-num">{formatearCLP(periodo.montoTotalClp)}</span> y quedó
                  viejo: el listado lo muestra así hasta que el motor lo recalcule. Lo que se
                  factura es lo de arriba.
                </p>
              ) : null}
              {/* Regla 21: la composición va junto a la cifra, no escondida
                  dentro del modal de emisión — que es donde vivía. */}
              {agrupacion.ajustes.length > 0 ? (
                <BloqueComposicion
                  className="mt-1"
                  sumandos={[
                    { concepto: "entregas", monto: agrupacion.subtotalEntregas },
                    ...agrupacion.ajustes.map((aj) => ({
                      concepto: "ajustes",
                      monto: Math.abs(aj.monto),
                      resta: aj.monto < 0,
                    })),
                  ]}
                />
              ) : null}
            </div>
            {periodo.estadoCobro === "parcial" && (
              <p className="text-sm text-muted-foreground">
                Pagado: <span className="font-medium tabular-nums">{formatearCLP(periodo.montoPagadoClp)}</span> ·
                Saldo:{" "}
                <span className="font-medium tabular-nums">
                  {formatearCLP(Math.max(0, (periodo.montoTotalClp ?? 0) - periodo.montoPagadoClp))}
                </span>
              </p>
            )}
            {periodo.estadoCobro === "pagado" && (
              <p className="text-sm font-medium text-success">
                Pagado en su totalidad{periodo.pagadoEn ? ` el ${formatearFechaCorta(periodo.pagadoEn)}` : ""}.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Sección A.1 — Bloque de anulación (solo si el período fue anulado) */}
      {periodo.estado === "anulado" && (
        <section
          aria-labelledby="anulacion-titulo"
          className="rounded-lg bg-destructive-subtle/50 p-5"
        >
          <h2
            id="anulacion-titulo"
            className="mb-4 text-sm font-semibold uppercase tracking-wide text-destructive-subtle-foreground"
          >
            Período anulado con nota de crédito
          </h2>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              {periodo.anuladoEn && (
                <p className="text-sm text-destructive-subtle-foreground">
                  Anulado el {formatearFechaCorta(periodo.anuladoEn)}.
                </p>
              )}
              <div>
                <p className="text-xs font-semibold text-destructive-subtle-foreground">Motivo:</p>
                <p className="mt-1 text-sm text-destructive-subtle-foreground">
                  {periodo.motivoAnulacion ?? "—"}
                </p>
              </div>

              {notaCredito ? (
                <p className="text-sm text-destructive-subtle-foreground">
                  Nota de crédito{" "}
                  <span className="font-bold tabular-nums">
                    Folio {notaCredito.folio}
                  </span>
                  , emitida el {formatearFechaCorta(notaCredito.fechaEmision)} por{" "}
                  <span className="font-semibold tabular-nums">
                    {formatearCLP(notaCredito.montoTotalClp)}
                  </span>
                  .
                </p>
              ) : (
                <p className="text-sm text-destructive-subtle-foreground">
                  La nota de crédito se está emitiendo. Recarga la página en unos
                  segundos para ver el folio y descargar el documento.
                </p>
              )}

              <p className="text-sm text-destructive-subtle-foreground">
                Las entregas de este período volvieron al período de facturación en
                curso del seller.
              </p>
            </div>

            {/* Descargas de la nota de crédito (mismo criterio C-3) */}
            {notaCredito && (
              <div className="flex flex-col gap-2 shrink-0">
                {notaCredito.pdfRef && (
                  <BotonDescargaDocumento
                    tipo="pdf-dte"
                    referencia={notaCredito.pdfRef}
                    etiqueta="Ver PDF de la NC"
                  />
                )}
                {notaCredito.xmlDteRef && (
                  <BotonDescargaDocumento
                    tipo="xml-dte"
                    referencia={notaCredito.xmlDteRef}
                    etiqueta="Ver XML de la NC"
                  />
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Sección B — Bloque DTE (solo si hay DTE) */}
      {dte && (
        <section
          aria-labelledby="dte-titulo"
          className="rounded-lg border bg-card p-5 shadow-sm"
        >
          <h2
            id="dte-titulo"
            className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {periodo.estado === "anulado" ? "Factura anulada" : "Factura emitida"}
          </h2>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-2xl font-semibold tabular-nums">
                Folio {dte.folio}
              </p>
              <p className="text-sm text-muted-foreground">
                Emitida el {formatearFechaCorta(dte.fechaEmision)}
              </p>

              {/* ⚠️ ACÁ SÍ APARECEN IMPUESTOS, Y NO CONTRADICE LA REGLA 22.
                  «Rutax no muestra impuestos» significa que Rutax no CALCULA un
                  IVA para mostrarlo: el neto de arriba es lo que factura el
                  motor. Estas tres cifras son las del documento tributario ya
                  emitido —las calculó y las declaró el proveedor DTE ante el
                  SII—, y el courier las necesita para cuadrar su contabilidad.
                  Van rotuladas como lo que son. Decisión del usuario, 23-08. */}
              <div className="pt-1">
                <p className="rx-num text-[10px] tracking-[0.12em] text-fg-muted uppercase">
                  Según el documento emitido
                </p>
                <div className="mt-1 flex flex-wrap gap-6">
                  <div>
                    <p className="text-xs text-fg-muted">Neto</p>
                    <p className="rx-num text-sm font-semibold">
                      {formatearCLP(dte.montoNetoclp)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-fg-muted">IVA</p>
                    <p className="rx-num text-sm font-semibold">
                      {formatearCLP(dte.montoIvaClp)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-fg-muted">Total</p>
                    <p className="rx-num text-sm font-bold">
                      {formatearCLP(dte.montoTotalClp)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Badge estado SII — criterio C-5 */}
              <BadgeEstadoSii estadoSii={dte.estadoSii} />

              {/* Mensaje de rechazo — sin datos técnicos */}
              {dte.estadoSii === "rechazado" && dte.errorDescripcion && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Motivo del rechazo:
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
                    {dte.errorDescripcion}
                  </p>
                </div>
              )}
            </div>

            {/* Botones descarga — criterio C-3 */}
            <div className="flex flex-col gap-2 shrink-0">
              {dte.pdfRef && (
                <BotonDescargaDocumento
                  tipo="pdf-dte"
                  referencia={dte.pdfRef}
                  etiqueta="Ver PDF"
                />
              )}
              {dte.xmlDteRef && (
                <BotonDescargaDocumento
                  tipo="xml-dte"
                  referencia={dte.xmlDteRef}
                  etiqueta="Ver XML"
                />
              )}
            </div>
          </div>
        </section>
      )}

      {/* Sección C — Tabla de líneas */}
      {/* --- Las dos columnas ------------------------------------------------
          Ancha: las líneas. Angosta: emisión, qué ve el seller y bitácora. Las
          acciones vivían colgando del encabezado, apretadas contra el borde
          derecho de una fila que también lleva la cifra grande. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
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

        <aside className="space-y-5">
          {/* --- Emisión ------------------------------------------------------ */}
          {periodo.estado === "abierto" ||
          (periodo.estado === "cerrado" && !dte) ||
          (periodo.estado === "facturado" && dte) ? (
            <section className="flex flex-col items-stretch gap-2">
              <RotuloAside>Emisión</RotuloAside>

              {periodo.estado === "abierto" && (
                <DialogCerrarPeriodo
                  periodoId={periodo.id}
                  sellerNombre={sellerNombre}
                  fechaInicio={periodo.fechaInicio}
                  fechaFin={periodo.fechaFin}
                  totalLineas={periodo.totalLineas}
                  montoTotalClp={periodo.montoTotalClp}
                />
              )}

              {/* Compuerta de aprobación (B1-1): período cerrado y aún sin DTE →
                  ofrecer emitir la factura como acción humana deliberada. */}
              {periodo.estado === "cerrado" && !dte && (
                <>
                  {/* Reabrir va JUNTO a emitir, no escondido: son las dos salidas
                      de un período cerrado. El dominio decide si se puede. */}
                  <DialogReabrirPeriodo periodoId={periodo.id} sellerNombre={sellerNombre} />
                  <DialogEmitirFactura
                    periodoId={periodo.id}
                    sellerNombre={sellerNombre}
                    // Regla 21: el total del modal lleva su composición. Sale de la
                    // misma agrupación que alimenta la tabla financiera de abajo —
                    // no hay una segunda aritmética que se pueda desincronizar.
                    // Solo se pasa cuando hay ajustes: sin ellos el neto ES el
                    // subtotal, y una composición de un término es ruido.
                    composicion={
                      agrupacion.ajustes.length > 0
                        ? [
                            { concepto: "entregas", monto: agrupacion.subtotalEntregas },
                            ...agrupacion.ajustes.map((aj) => ({
                              concepto: "ajustes",
                              monto: Math.abs(aj.monto),
                              resta: aj.monto < 0,
                            })),
                          ]
                        : undefined
                    }
                    autorNombre={sesion.nombreCompleto ?? "Tu cuenta"}
                    totalLineas={periodo.totalLineas}
                    montoTotalClp={periodo.montoTotalClp}
                    modoDte={modoDte}
                  />
                  {/* El motivo por el que NO se puede emitir, escrito al lado del
                      botón. Antes había que abrir la ceremonia para enterarse. */}
                  {excepcionesBloqueantes > 0 ? (
                    <p className="text-xs leading-relaxed text-fault-fg">
                      Hay {excepcionesBloqueantes}{" "}
                      {excepcionesBloqueantes === 1 ? "excepción abierta" : "excepciones abiertas"}{" "}
                      que bloquean la emisión. Resuélvelas en la{" "}
                      <Link href="/dinero/conciliacion?bloqueo=si" className="underline">
                        bandeja de conciliación
                      </Link>
                      .
                    </p>
                  ) : null}
                </>
              )}

              {/* Anulación total por nota de crédito (RF-038, B7): solo sobre un
                  período facturado con su DTE emitido. El gate `emitir_facturas`
                  lo valida la acción de dominio; la página ya filtra por capacidad. */}
              {periodo.estado === "facturado" && dte && (
                <DialogEmitirNotaCredito
                  periodoId={periodo.id}
                  sellerNombre={sellerNombre}
                  folioFactura={dte.folio}
                  montoTotalClp={periodo.montoTotalClp}
                  montoPagadoClp={periodo.montoPagadoClp}
                  modoDte={modoDte}
                />
              )}
            </section>
          ) : null}

          {/* --- Qué ve el seller ---------------------------------------------
              La pregunta que uno se hace antes de llamarlo. No es un espejo de
              su pantalla: declara lo que esa pantalla muestra, que es una
              decisión estable del producto. */}
          <section className="space-y-1.5">
            <RotuloAside>Qué ve el seller</RotuloAside>
            <p className="text-sm leading-relaxed text-fg">{vistaSeller.ve}</p>
            {vistaSeller.noVe ? (
              <p className="text-sm leading-relaxed text-fg-muted">{vistaSeller.noVe}</p>
            ) : null}
          </section>

          {/* --- Bitácora ----------------------------------------------------- */}
          <section className="space-y-2 border-t border-line pt-4">
            <RotuloAside>Bitácora</RotuloAside>
            <BloqueTrazabilidad
              hechos={bitacora}
              vacio="Todavía no hay movimientos registrados en este período."
            />
          </section>
        </aside>
      </div>
    </div>
  );
}

/** El rótulo en versalitas que encabeza cada región de la columna derecha. */
function RotuloAside({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium tracking-[0.12em] text-fg-muted uppercase">{children}</p>
  );
}

// =============================================================================
// Componentes auxiliares
// =============================================================================

function BadgeEstadoSii({ estadoSii }: { estadoSii: DocumentoDte["estadoSii"] }) {
  return (
    <BadgeEstado
      variante={BADGE_ESTADO_SII[estadoSii] ?? "neutral"}
      texto={traducirEstadoSiiTexto(estadoSii)}
      eje="sii"
      valor={estadoSii}
      className={"gap-1.5 px-2.5"}
    />
  );
}

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
