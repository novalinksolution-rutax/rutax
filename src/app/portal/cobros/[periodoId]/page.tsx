/**
 * Pantalla S-2 — Detalle de período (vista seller).
 *
 * Server Component. Solo lectura. RLS garantiza que el seller solo ve sus datos.
 * Criterios C-1, C-2 (sin datos de conductor), C-3 (signed URL), C-5, C-7.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerPeriodoCobro, listarDocumentosDte } from "@/modules/dinero/index";
import type { DocumentoDte, LineaCobro } from "@/modules/dinero/tipos";
import {
  BADGE_ESTADO_SII,
  traducirEstadoSiiTexto,
  traducirEstadoPeriodoCobro,
  BADGE_ESTADO_PERIODO,
  traducirEstadoCobroPeriodo,
  BADGE_ESTADO_COBRO_PERIODO,
} from "@/lib/ui/traduccion-estados";
import { formatearCLP, formatearCLPOGuion } from "@/lib/ui/formato-moneda";

import { BadgeEstado } from "@/components/ui/badge-estado";
import { DataTable } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { BotonDescargaFacturaPdf } from "./boton-descarga-factura-pdf";
import { TablaFinanciera } from "@/components/ui/tabla-financiera";
import { BloqueComposicion } from "@/components/ui/bloque-composicion";
import { agruparLineasCobro } from "@/modules/dinero/agrupacion-lineas";

export const metadata: Metadata = {
  title: "Detalle de período",
};

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

interface PageProps {
  params: Promise<{ periodoId: string }>;
}

export default async function PaginaDetallePeriodoSeller({ params }: PageProps) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) redirect("/portal");

  const { periodoId } = await params;
  const sellerId = sesion.usuario.sellerId;
  const tenantId = sesion.usuario.tenantId;

  const cliente = crearClienteServiceRole();
  let periodo;
  let dte: DocumentoDte | null = null;
  // Si el período fue anulado, la nota de crédito (61) que referencia al 33.
  let notaCredito: DocumentoDte | null = null;
  let errorCarga = false;

  try {
    periodo = await obtenerPeriodoCobro(cliente, tenantId, periodoId);

    // Verificar que el período pertenece al seller autenticado
    // (RLS lo garantiza en BD, pero verificamos también en la app)
    if (!periodo || periodo.sellerId !== sellerId) {
      redirect("/portal/cobros");
    }

    // El seller debe poder cuadrar AMBOS documentos del SII: la factura (33) y,
    // si la hubo, su nota de crédito (61). Por eso se buscan los dos por tipo.
    const dtes = await listarDocumentosDte(cliente, tenantId, sellerId);
    dte = dtes.find((d) => d.periodoCobroidId === periodoId && d.tipoDocumento === 33) ?? null;
    notaCredito = dtes.find((d) => d.periodoCobroidId === periodoId && d.tipoDocumento === 61) ?? null;
  } catch {
    errorCarga = true;
  }

  if (errorCarga || !periodo) {
    return (
      <div className="mx-auto max-w-4xl">
        <div
          role="alert"
          className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
        >
          No se pudo cargar el período. Intenta recargar la página.
        </div>
      </div>
    );
  }

  const textoBadge = traducirEstadoPeriodoCobro(
    periodo.estado,
    periodo.estado === "facturado" && dte ? dte.folio : undefined,
  );

  const lineas: LineaCobro[] = periodo.lineas ?? [];
  // La misma agrupación que usa el detalle del período del courier: una sola
  // aritmética para las dos pantallas. Si el seller y el courier sumaran por
  // caminos distintos, un día darían cifras distintas del mismo período.
  const agrupacion = agruparLineasCobro(lineas);

  // El nombre del courier, para poder decir «cuando Andes Express cierre…» en
  // vez de «cuando tu empresa de despacho…». Si falla, se cae a un genérico.
  const { data: tenantFila } = await cliente
    .from("tenants")
    .select("nombre_fantasia")
    .eq("id", tenantId)
    .maybeSingle();
  const nombreCourier =
    (tenantFila?.nombre_fantasia as string | undefined) ?? "tu empresa de despacho";

  // El nombre del propio seller, para PODARLO del concepto de cada línea.
  // El motor escribe «Entrega Flex – FalabellaTech Ltda.», que es correcto en la
  // pantalla del courier —donde un período junta a varios sellers— y en el
  // portal repite el nombre del que está mirando en cada fila de su propia
  // tabla. Se poda solo si coincide: si no, el concepto queda tal cual.
  const { data: sellerFila } = await cliente
    .from("sellers")
    .select("razon_social")
    .eq("id", sellerId)
    .maybeSingle();
  const nombreSeller = (sellerFila?.razon_social as string | undefined) ?? "";
  const podarNombreSeller = (concepto: string): string => {
    if (!nombreSeller) return concepto;
    for (const guion of [" – ", " - ", " — "]) {
      const sufijo = `${guion}${nombreSeller}`;
      if (concepto.endsWith(sufijo)) return concepto.slice(0, -sufijo.length);
    }
    return concepto;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <nav aria-label="Migajas de pan" className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/portal/cobros" className="hover:text-foreground hover:underline">
          Mis cobros
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">Detalle</span>
      </nav>

      {/* Sección A — Encabezado */}
      <section>
        <div className="space-y-2">
          {/* El encabezado dice en qué estado está, hasta cuándo corre y
              cuántas entregas lleva: las tres cosas que se preguntan antes de
              mirar la cifra. Antes era solo el rango de fechas. */}
          <h1 className="font-heading text-2xl font-semibold">
            Período {formatearFechaCorta(periodo.fechaInicio)} –{" "}
            {formatearFechaCorta(periodo.fechaFin)}
          </h1>
          <p className="rx-num text-xs text-fg-muted">
            {periodo.estado === "abierto"
              ? `Abierto · cierra el ${formatearFechaCorta(periodo.fechaFin)}`
              : periodo.estado === "cerrado"
                ? "Cerrado · esperando la factura"
                : periodo.estado === "facturado"
                  ? "Facturado"
                  : "Anulado"}
            {" · "}
            {agrupacion.entregasTotales}{" "}
            {agrupacion.entregasTotales === 1 ? "entrega" : "entregas"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <BadgeEstado variante={BADGE_ESTADO_PERIODO[periodo.estado]} eje="periodo" valor={periodo.estado} texto={textoBadge} />
            {periodo.estadoCobro !== "no_aplica" && (
              <BadgeEstado
                variante={BADGE_ESTADO_COBRO_PERIODO[periodo.estadoCobro]} eje="cobro-periodo" valor={periodo.estadoCobro}
                texto={traducirEstadoCobroPeriodo(periodo.estadoCobro)}
              />
            )}
          </div>
          {/* La cifra sale de las LÍNEAS, no de `monto_total_clp`, y va rotulada
              (regla 18). Antes era un número pelado, y más abajo el pie decía
              «Total (con IVA)» con otra cifra: dos números grandes distintos
              para el mismo período. */}
          <div>
            <p className="rx-num text-[10px] tracking-[0.12em] text-fg-muted uppercase">
              Total neto
            </p>
            <p className="rx-num text-3xl font-semibold">{formatearCLP(agrupacion.total)}</p>
          </div>
          {periodo.estadoCobro === "parcial" && (
            <p className="text-sm text-muted-foreground">
              Pagado: <span className="font-medium tabular-nums">{formatearCLP(periodo.montoPagadoClp)}</span> · Saldo:{" "}
              <span className="font-medium tabular-nums">
                {formatearCLP(Math.max(0, (periodo.montoTotalClp ?? 0) - periodo.montoPagadoClp))}
              </span>
            </p>
          )}
          {periodo.estadoCobro === "pagado" && (
            <p className="text-sm font-medium text-success">Pago recibido. Gracias.</p>
          )}
        </div>
      </section>

      {/* Sección A.1 — Anulación con nota de crédito (RF-038) */}
      {periodo.estado === "anulado" && (
        <section
          aria-labelledby="anulacion-titulo"
          className="rounded-lg bg-warning-subtle p-5 text-warning-subtle-foreground"
        >
          <h2 id="anulacion-titulo" className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            Factura anulada con nota de crédito
          </h2>
          <p className="text-sm">
            Esta factura fue anulada por tu empresa de despacho. No tienes saldo por pagar de este
            período; las entregas se vuelven a facturar en el período en curso.
            {periodo.anuladoEn ? ` Anulada el ${formatearFechaCorta(periodo.anuladoEn)}.` : ""}
          </p>
          {periodo.motivoAnulacion && (
            <p className="mt-2 text-sm">
              <span className="font-medium">Motivo:</span> {periodo.motivoAnulacion}
            </p>
          )}
          {notaCredito ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">
                Nota de crédito{" "}
                <span className="font-semibold tabular-nums">Folio {notaCredito.folio}</span>
                {" · "}
                <span className="tabular-nums">{formatearCLP(notaCredito.montoTotalClp)}</span>
              </p>
              {notaCredito.pdfRef && (
                <div className="shrink-0">
                  <BotonDescargaFacturaPdf
                    pdfRef={notaCredito.pdfRef}
                    etiqueta="Descargar nota de crédito (PDF)"
                  />
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm opacity-80">
              La nota de crédito se está emitiendo. Recarga la página en unos segundos.
            </p>
          )}
        </section>
      )}

      {/* Sección B — Bloque "Factura" (solo si hay DTE) */}
      {/* La factura, en tono BUENA NOTICIA y no en tarjeta neutra: para el
          seller, que su período quedara facturado es el desenlace bueno del
          mes — sabe cuánto debe, contra qué documento y hasta cuándo. */}
      {dte && (
        <section
          aria-labelledby="factura-titulo"
          className="border border-balanced-line bg-balanced-bg p-5"
        >
          <h2
            id="factura-titulo"
            className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Tu factura
          </h2>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-2xl font-semibold tabular-nums">Folio {dte.folio}</p>
              <p className="text-sm text-fg-muted">
                Emitida el {formatearFechaCorta(dte.fechaEmision)} por {nombreCourier}
                {/* «Aceptada por el SII» como frase y no solo como distintivo:
                    es lo que el contador del seller necesita leer. */}
                {dte.estadoSii === "aceptado"
                  ? ` · aceptada por el Servicio de Impuestos Internos`
                  : ""}
              </p>
              <p className="text-xl font-semibold tabular-nums">
                {formatearCLP(dte.montoTotalClp)}
              </p>

              {/* Badge estado SII — criterio C-5 */}
              <BadgeEstadoSii estadoSii={dte.estadoSii} />

              {/* Mensajes contextuales (sin detalles técnicos para el seller) */}
              {dte.estadoSii === "aceptado_con_discrepancias" && (
                <p className="mt-2 rounded-lg bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground">
                  Esta factura fue aceptada por el SII con observaciones. Si tienes dudas,
                  contacta a tu empresa de despacho.
                </p>
              )}
              {dte.estadoSii === "rechazado" && (
                <p className="mt-2 rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">
                  Esta factura fue rechazada por el SII. Tu empresa de despacho está
                  trabajando en resolverlo.
                </p>
              )}
            </div>

            {/* Las DOS acciones del bloque, no una.
                --------------------------------------------------------------
                Descargar el PDF era la única salida, y la pregunta que trae al
                seller a esta pantalla no es «dame el PDF» sino «por qué me
                cobras esto». El detalle está más abajo en la misma hoja: el
                segundo botón lleva ahí y dice cuántas entregas va a encontrar,
                para que se vea que hay algo que mirar. */}
            <div className="flex shrink-0 flex-col gap-2">
              {dte.pdfRef && <BotonDescargaFacturaPdf pdfRef={dte.pdfRef} />}
              {agrupacion.entregasTotales > 0 ? (
                <Button asChild variant="outline" size="sm">
                  <a href="#lineas-titulo">
                    Ver el detalle de las {agrupacion.entregasTotales}{" "}
                    {agrupacion.entregasTotales === 1 ? "entrega" : "entregas"}
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {/* Sección C — Lo que se te cobra, agrupado por concepto.
          ------------------------------------------------------------------
          🐞 ACÁ HABÍA UN «IVA 19 %» QUE NO ERA IVA: era el residuo entre
          `monto_total_clp` y la suma de las líneas
          (`const ivaClp = (periodo.montoTotalClp ?? 0) - netoClp`). Con el
          período abierto —que es cuando el seller más lo mira— esa resta salía
          **negativa**, y la pantalla mostraba un impuesto en negativo.

          Rutax no muestra impuestos (regla 22): los calcula y los declara el
          documento tributario. Acá va el neto, y punto.

          Y la tabla pasó de una fila por PEDIDO a una fila por CONCEPTO
          (decisión del usuario). Un listado de 285 filas con un `#12345678`
          que al seller no le dice nada no se audita: se ignora. */}
      <section aria-labelledby="lineas-titulo">
        <h2
          id="lineas-titulo"
          // Con el ancla de arriba, el título tiene que quedar despegado del
          // borde superior al saltar; si no, aterriza pegado al marco.
          className="mb-3 scroll-mt-6 font-mono text-[10px] font-medium tracking-[0.1em] text-fg-subtle uppercase"
        >
          Lo que se te cobra
        </h2>

        {lineas.length === 0 ? (
          <div className="border border-line bg-bg-sunken px-6 py-10 text-center">
            <p className="text-sm text-fg-muted">
              Este período todavía no tiene entregas. Cada una que hagamos aparece acá.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden border border-line">
              <TablaFinanciera
                rotulo="neto"
                cabeceras={["Concepto", "Entregas", "Tarifa", "Monto"]}
                filas={[
                  ...agrupacion.conceptos.map((c) => ({
                    tipo: "linea" as const,
                    concepto: podarNombreSeller(c.concepto),
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

            {/* La resta a la vista. Es lo que el seller reconstruye a mano en
                una planilla cuando la pantalla no se la da. */}
            {agrupacion.ajustes.length > 0 ? (
              <BloqueComposicion
                className="mt-2"
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

            {/* El pie: qué va a pasar, y de quién son los impuestos.
                ----------------------------------------------------------------
                Eran DOS casos y los estados son TRES. Un período `cerrado` sin
                factura caía en el «cuando cierre y facture», con el encabezado
                diciendo «Cerrado» tres líneas más arriba: la pantalla se
                contradecía sola. El cerrado-sin-factura tiene su propia frase,
                porque es el único estado en que la cifra ya no se mueve y el
                documento todavía no existe. */}
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">
              {dte
                ? "Este período está cerrado: la factura de arriba es la definitiva y no se modifica. Si hubo un ajuste posterior, va con nota de crédito."
                : periodo.estado === "abierto"
                  ? `Este período sigue abierto: cada entrega que hagamos se suma acá. Cuando ${nombreCourier} lo cierre y lo facture, aparece la factura en PDF con su folio. Los impuestos los muestra el documento, no esta pantalla.`
                  : `Este período ya está cerrado, así que la cifra no se mueve más. Falta que ${nombreCourier} emita la factura; cuando lo haga, el PDF con su folio aparece acá. Los impuestos los muestra el documento, no esta pantalla.`}
            </p>
          </>
        )}
      </section>
    </div>
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
