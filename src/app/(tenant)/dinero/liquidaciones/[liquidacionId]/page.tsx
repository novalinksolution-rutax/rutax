/**
 * Pantalla D-3.1 — Detalle de liquidación (sentido inverso de la trazabilidad
 * financiera bidireccional, §1.1 P1 del audit externo jul 2026).
 *
 * Server Component. Calca el patrón de `dinero/periodos/[periodoId]/page.tsx`:
 * breadcrumb, encabezado con conductor/período/estado/monto, bloque de payout
 * (si existe) y tabla de líneas con link a cada pedido + Popover "por qué".
 * 100% de solo lectura — ninguna acción de mutación nueva.
 */

import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  obtenerTrazabilidad,
  type HechoTrazable,
} from "@/modules/identidad/trazabilidad";
import { BloqueTrazabilidad } from "@/components/ui/bloque-trazabilidad";
import { puedeVerLiquidaciones } from "@/modules/identidad/capacidades";
import { obtenerLiquidacion, obtenerPayoutPorLiquidacion } from "@/modules/dinero/index";
import type { LineaLiquidacion, PayoutConductor, MetodoPayout } from "@/modules/dinero/tipos";
import {
  traducirEstadoLiquidacion,
  BADGE_ESTADO_LIQUIDACION,
  traducirEstadoPayout,
  BADGE_ESTADO_PAYOUT,
} from "@/lib/ui/traduccion-estados";
import { formatearCLP, formatearCLPOGuion, formatearAjuste } from "@/lib/ui/formato-moneda";
import { referenciaLineaLiquidacion } from "@/lib/ui/referencia-linea-liquidacion";

import { BadgeEstado } from "@/components/ui/badge-estado";
import { PopoverSnapshotRegla } from "@/components/dinero/popover-snapshot-regla";
import { BotonDescargaPdfLiquidacion } from "../boton-descarga-pdf-liquidacion";
import { formatearFechaHora as formatearFechaHoraCl, formatearFecha } from "@/lib/formato-cl";
import { Retorno, destinoRetorno } from "@/components/app-shell/retorno";
import { TablaFinanciera } from "@/components/ui/tabla-financiera";
import { agruparLiquidacion } from "@/modules/dinero/agrupacion-liquidacion";
import { BloqueComposicion } from "@/components/ui/bloque-composicion";
import { etiquetaPeriodo } from "@/modules/dinero/listado-periodos";
import { DialogAjustarLiquidacion } from "../dialog-ajustar";
import { DialogEmitirPago } from "../dialog-emitir-pago";
import { DialogMarcarPagada } from "../dialog-marcar-pagada";

export const metadata: Metadata = {
  title: "Detalle de liquidación",
};

const TEXTO_METODO_PAYOUT: Record<MetodoPayout, string> = {
  fintoc: "Transferencia (Fintoc)",
  manual: "Pago manual",
  nomina: "Nómina",
};

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function formatearFechaHora(fechaIso: string | null): string | null {
  if (!fechaIso) return null;
  const fecha = new Date(fechaIso);
  if (Number.isNaN(fecha.getTime())) return fechaIso;
  return formatearFechaHoraCl(fecha);
}

interface PageProps {
  params: Promise<{ liquidacionId: string }>;
  searchParams: Promise<{ volver?: string; lineas?: string }>;
}

export default async function PaginaDetalleLiquidacion({ params, searchParams }: PageProps) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  // Lectura: el detalle de la liquidación se ve aunque no se pueda pagar.
  if (!puedeVerLiquidaciones(sesion.usuario)) redirect("/dashboard");

  const { liquidacionId } = await params;
  const { volver, lineas: vistaLineas } = await searchParams;
  const verUnaPorUna = vistaLineas === "detalle";
  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  let liquidacion;
  let payout: PayoutConductor | null = null;
  let conductorNombre = "—";
  let conductorRut: string | null = null;
  let conductorRelacion: string | null = null;
  let errorCarga = false;

  try {
    liquidacion = await obtenerLiquidacion(cliente, tenantId, liquidacionId);
    if (!liquidacion) redirect("/dinero/liquidaciones");

    const [{ data: conductorData }, payoutData] = await Promise.all([
      cliente
        .from("conductores")
        .select("nombre_completo, rut, tipo_relacion")
        .eq("id", liquidacion.driverId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      obtenerPayoutPorLiquidacion(cliente, tenantId, liquidacionId),
    ]);
    conductorNombre = (conductorData?.nombre_completo as string) ?? liquidacion.driverId;
    // RUT y régimen: el régimen decide si hay retención y qué documento
    // respalda el pago (boleta de honorarios o liquidación de sueldo). Sin
    // ellos hay que salir a la ficha del conductor para saber qué se firma.
    conductorRut = (conductorData?.rut as string | null) ?? null;
    conductorRelacion = (conductorData?.tipo_relacion as string | null) ?? null;
    payout = payoutData;
  } catch (error) {
    // `redirect()` (arriba, cuando la liquidación no existe o es de otro
    // tenant) funciona lanzando una excepción interna de Next.js con un
    // digest especial que el framework intercepta más arriba en el árbol.
    // Un `catch` genérico como este la atraparía como si fuera un error de
    // datos real y la convertiría en el mensaje "no se pudo cargar" en vez
    // de redirigir — `unstable_rethrow` reenvía esa excepción de control de
    // Next.js intacta y solo trata como error real lo que de verdad lo es.
    unstable_rethrow(error);
    errorCarga = true;
  }

  // ⚠️ FALLA DE LECTURA. Sin la liquidación no hay cabecera ni neto que
  // conservar, así que reemplazar la pantalla es correcto; lo que cambia es el
  // texto: dice qué NO hacer. Emitir un pago sobre un neto que no se pudo leer
  // es la única forma de perder plata desde esta pantalla.
  if (errorCarga || !liquidacion) {
    return (
      <div className="space-y-4">
        <Retorno
          href={destinoRetorno("/dinero/liquidaciones", volver)}
          etiqueta="Volver a liquidaciones"
        />
        <div
          role="alert"
          className="border border-fault-line bg-fault-bg px-4 py-3.5 text-sm leading-relaxed text-fault-fg"
        >
          <strong className="font-medium">No se pudo leer esta liquidación.</strong> Existe y
          puede tener líneas: esta pantalla no las está viendo. No emitas el pago ni la marques
          como pagada hasta poder verlas — recarga en unos segundos.
        </div>
      </div>
    );
  }

  const lineas: LineaLiquidacion[] = liquidacion.lineas ?? [];
  const agrupacion = agruparLiquidacion(lineas, {
    bonoClp: liquidacion.bonoClp,
    penalizacionClp: liquidacion.penalizacionClp,
    notaAjuste: liquidacion.notaAjuste,
  });
  // Quién ajustó esta liquidación y por qué. Un fallo acá no puede tumbar la
  // pantalla: el ajuste se sigue viendo, solo que sin autor.
  let hechosAjuste: HechoTrazable[] = [];
  try {
    hechosAjuste = await obtenerTrazabilidad(cliente, tenantId, "liquidacion", liquidacionId, {
      acciones: ["dinero.liquidacion_ajustada"],
      limite: 1,
    });
  } catch {
    hechosAjuste = [];
  }

  const montoConAjustes =
    liquidacion.montoTotalClp !== null
      ? liquidacion.montoTotalClp + liquidacion.bonoClp - liquidacion.penalizacionClp
      : null;

  // La firma del ajuste, para ponerla dentro de su fila. Sale de la bitácora
  // —`dinero.liquidaciones` guarda el motivo y no el autor, y eso está bien: la
  // bitácora es el registro, la tabla es el estado.
  // La bitácora completa de la liquidación. Esta pantalla ahora ofrece emitir
  // el pago —irreversible desde acá— y ajustar el monto, así que muestra su
  // registro, igual que el detalle del período y el del manifiesto.
  const bitacora = await obtenerTrazabilidad(cliente, tenantId, "liquidacion", liquidacionId, {
    limite: 8,
  }).catch(() => []);

  const hechoAjuste = hechosAjuste[0];
  const firmaDelAjuste = hechoAjuste
    ? `Aplicó ${hechoAjuste.autorNombre ?? "Rutax"} el ${formatearFecha(hechoAjuste.cuando)}`
    : null;

  return (
    <div className="space-y-6">
      {/* Una sola salida: antes había migas Y un «Volver» debajo, al mismo
          destino. Con dos niveles de jerarquía las migas no agregan nada. */}
      <Retorno href={destinoRetorno("/dinero/liquidaciones", volver)} etiqueta="Volver a liquidaciones" />

      {/* Sección A — Encabezado */}
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="font-heading text-2xl font-semibold">
              <Link href={`/conductores/${liquidacion.driverId}`} className="hover:underline">
                {conductorNombre}
              </Link>
            </h1>
            <p className="rx-num text-xs text-fg-muted">
              {etiquetaPeriodo(liquidacion.fechaInicio, liquidacion.fechaFin)}
              {conductorRut ? ` · ${conductorRut}` : ""}
              {conductorRelacion
                ? ` · ${conductorRelacion}${
                    conductorRelacion === "independiente" ? " · boleta de honorarios" : ""
                  }`
                : ""}
            </p>
            <BadgeEstado variante={BADGE_ESTADO_LIQUIDACION[liquidacion.estado]} eje="liquidacion" valor={liquidacion.estado} texto={traducirEstadoLiquidacion(liquidacion.estado)} />

            {/* ⚠️ LA CIFRA VA ROTULADA (regla 18). Era un número pelado de 3xl,
                y más abajo la misma pantalla muestra el monto BRUTO del payout:
                dos cifras grandes distintas para la misma liquidación, ninguna
                diciendo cuál es cuál. */}
            <div className="pt-1">
              <p className="rx-num text-[10px] tracking-[0.12em] text-fg-muted uppercase">
                Neto a pagar
              </p>
              <p className="rx-num text-3xl font-semibold">
                {formatearCLPOGuion(montoConAjustes)}
              </p>
              {/* Regla 21: la resta a la vista. Antes el desglose iba en prosa
                  —«Base: X · Bono: +Y»— que no se alinea ni se compara. */}
              {liquidacion.bonoClp > 0 || liquidacion.penalizacionClp > 0 ? (
                <BloqueComposicion
                  className="mt-1"
                  sumandos={[
                    { concepto: "base", monto: liquidacion.montoTotalClp ?? 0 },
                    ...(liquidacion.bonoClp > 0
                      ? [{ concepto: "bono", monto: liquidacion.bonoClp }]
                      : []),
                    ...(liquidacion.penalizacionClp > 0
                      ? [
                          {
                            concepto: "penalización",
                            monto: liquidacion.penalizacionClp,
                            resta: true,
                          },
                        ]
                      : []),
                  ]}
                />
              ) : null}
            </div>
            {/* ⚠️ Acá había una cita suelta: el motivo del ajuste, sin autor y
                sin fecha. Un descuento de $8.000 en la liquidación de un
                conductor con un texto que no dice **quién** lo aplicó ni
                **cuándo** no es una explicación, es una nota anónima — y el
                autor sí existe, solo que en la bitácora.
                `dinero.liquidaciones` guarda `nota_ajuste` y no el autor, y eso
                está bien: la bitácora es el registro, la tabla es el estado. */}
            {/* El motivo y su autor ya NO van acá: bajaron a la fila del ajuste
                en la tabla, que es donde está el «−$8.000» que explican. Acá
                quedaban a media pantalla de distancia de la cifra. */}
          </div>

          {/* --- Lo que se puede hacer con esta liquidación ------------------
              El ajuste manual y el pago vivían SOLO en el listado. Acá es donde
              se lee el descuento que se está discutiendo y la composición del
              neto: tener que volver a la lista para actuar sobre lo que se
              acaba de leer es la separación exacta que hay que cerrar. */}
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:w-56">
            <p className="text-[10px] font-medium tracking-[0.12em] text-fg-muted uppercase">
              {liquidacion.estado === "borrador" ? "Ajuste" : "Pago"}
            </p>

            {liquidacion.estado === "borrador" ? (
              <DialogAjustarLiquidacion
                liquidacionId={liquidacion.id}
                montoBaseClp={liquidacion.montoTotalClp ?? 0}
                bonoActual={liquidacion.bonoClp}
                penalizacionActual={liquidacion.penalizacionClp}
                notaActual={liquidacion.notaAjuste}
              />
            ) : null}

            {liquidacion.estado === "emitida" &&
            !(
              payout &&
              (payout.estado === "pendiente" ||
                payout.estado === "enviado" ||
                payout.estado === "confirmado")
            ) ? (
              <>
                <DialogEmitirPago
                  autorNombre={sesion.nombreCompleto ?? "Tu cuenta"}
                  liquidacionId={liquidacion.id}
                  conductorNombre={conductorNombre}
                  fechaInicio={liquidacion.fechaInicio}
                  fechaFin={liquidacion.fechaFin}
                  montoTotalClp={liquidacion.montoTotalClp}
                />
                <DialogMarcarPagada
                  liquidacionId={liquidacion.id}
                  conductorNombre={conductorNombre}
                  fechaInicio={liquidacion.fechaInicio}
                  fechaFin={liquidacion.fechaFin}
                  montoTotalClp={liquidacion.montoTotalClp}
                />
              </>
            ) : null}

            {liquidacion.pdfRef && <BotonDescargaPdfLiquidacion pdfRef={liquidacion.pdfRef} />}
          </div>
        </div>
      </section>

      {/* Sección B — Bloque de payout (si existe) */}
      {payout && (
        <section aria-labelledby="payout-titulo" className="rounded-lg border bg-card p-5 shadow-sm">
          <h2
            id="payout-titulo"
            className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Pago al conductor
          </h2>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <BadgeEstado variante={BADGE_ESTADO_PAYOUT[payout.estado]} eje="payout" valor={payout.estado} texto={traducirEstadoPayout(payout.estado)} />

              {/* ⚠️ ACÁ SÍ HAY UNA CIFRA BRUTA, Y VA ROTULADA. La regla 18 pide
                  una sola cifra por pantalla y, si hiciera falta una bruta, que
                  vaya rotulada con su propio desglose: es justo este caso. No
                  es un impuesto que calcule Rutax — es la retención que se le
                  aplicó a la boleta del conductor, y el courier la necesita para
                  cuadrar. Decisión del usuario, 23-08. */}
              <div className="pt-1">
                <p className="rx-num text-[10px] tracking-[0.12em] text-fg-muted uppercase">
                  Lo que se transfirió
                </p>
                <div className="mt-1 flex flex-wrap gap-6">
                  <div>
                    <p className="text-xs text-fg-muted">Bruto</p>
                    <p className="rx-num text-sm font-semibold">
                      {formatearCLP(payout.montoBrutoClp)}
                    </p>
                  </div>
                  {payout.montoRetencionClp > 0 && (
                    <div>
                      <p className="text-xs text-fg-muted">Retención</p>
                      <p className="rx-num text-sm font-semibold">
                        −{formatearCLP(payout.montoRetencionClp)}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-fg-muted">Líquido a la cuenta</p>
                    <p className="rx-num text-sm font-bold">
                      {formatearCLP(payout.montoLiquidoClp)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-fg-muted">Método</p>
                    <p className="text-sm font-semibold">
                      {TEXTO_METODO_PAYOUT[payout.metodo] ?? payout.metodo}
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Solicitado el {formatearFechaHora(payout.solicitadoEn)}
                {payout.confirmadoEn && <> · Confirmado el {formatearFechaHora(payout.confirmadoEn)}</>}
              </p>

              {(payout.estado === "rechazado" || payout.estado === "fallido") && payout.errorDescripcion && (
                <div className="mt-2 flex items-start gap-1.5 rounded-md bg-destructive-subtle px-2.5 py-2 text-xs text-destructive-subtle-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 flex-shrink-0" aria-hidden="true" />
                  <span>{payout.errorDescripcion}</span>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Sección C — Tabla de líneas */}
      <section aria-labelledby="lineas-titulo">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="lineas-titulo"
            className="font-mono text-[10px] font-medium tracking-[0.1em] text-fg-subtle uppercase"
          >
            Lo que se le paga ·{" "}
            {verUnaPorUna ? "una por una" : "agrupado por concepto"}
          </h2>
          {lineas.length > 0 ? (
            <Link
              href={
                (() => {
                  const q = new URLSearchParams({
                    ...(volver ? { volver } : {}),
                    ...(verUnaPorUna ? {} : { lineas: "detalle" }),
                  }).toString();
                  return q ? `?${q}` : `/dinero/liquidaciones/${liquidacion.id}`;
                })()
              }
              className="text-xs font-medium text-accent-text hover:underline"
            >
              {verUnaPorUna
                ? "← Volver a la vista agrupada"
                : `Ver las ${lineas.length} una por una ›`}
            </Link>
          ) : null}
        </div>

        {lineas.length === 0 ? (
          <div className="rounded-lg border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Esta liquidación no tiene líneas todavía. Se agregarán automáticamente a medida que
              se registren entregas del conductor.
            </p>
          </div>
        ) : !verUnaPorUna ? (
          <div className="overflow-hidden rounded-lg border bg-card">
            <TablaFinanciera
              rotulo="neto"
              cabeceras={["Concepto", "Cantidad", "Unitario", "Monto"]}
              filas={[
                ...agrupacion.entregas.map((f) => ({
                  tipo: "linea" as const,
                  concepto: f.concepto,
                  entregas: f.cantidad,
                  tarifa: f.unitario,
                  monto: f.monto,
                })),
                // El subtotal de entregas solo aparece si hay algo más abajo con
                // lo que confundirlo. Con una sola clase de línea y sin ajustes,
                // un subtotal idéntico al total es ruido.
                ...(agrupacion.entregas.length > 0 &&
                (agrupacion.visitas.length > 0 || agrupacion.ajustes.length > 0)
                  ? [
                      {
                        tipo: "subtotal" as const,
                        concepto: "Subtotal de entregas",
                        entregas: agrupacion.cantidadEntregas,
                        monto: agrupacion.subtotalEntregas,
                      },
                    ]
                  : []),
                ...agrupacion.visitas.map((f) => ({
                  tipo: "linea" as const,
                  concepto: `Visitas a bodega · ${f.concepto}`,
                  entregas: f.cantidad,
                  tarifa: f.unitario,
                  monto: f.monto,
                })),
                ...(agrupacion.visitas.length > 0
                  ? [
                      {
                        tipo: "subtotal" as const,
                        concepto: "Subtotal de visitas a bodega",
                        entregas: agrupacion.cantidadVisitas,
                        monto: agrupacion.subtotalVisitas,
                      },
                    ]
                  : []),
                ...agrupacion.ajustes.map((aj) => ({
                  tipo: "ajuste" as const,
                  concepto: aj.concepto,
                  monto: aj.monto,
                  // El motivo lo lee el conductor, en su liquidación y en su PDF.
                  motivo: aj.motivo,
                  // Y la firma va EN LA FILA, no en la cabecera. Un «−$8.000»
                  // con motivo pero sin autor se lee como una decisión del
                  // sistema; con el nombre al lado, como lo que es.
                  autor: firmaDelAjuste ?? undefined,
                })),
                {
                  tipo: "total" as const,
                  // «Total a pagar» y no «Neto a pagar»: `TablaFinanciera` le
                  // agrega su rótulo al concepto, y quedaba «Neto a pagar
                  // (neto)». Visto en pantalla.
                  concepto: "Total a pagar",
                  entregas: agrupacion.cantidadEntregas + agrupacion.cantidadVisitas,
                  monto: agrupacion.neto,
                },
              ]}
            />
          </div>
        ) : null}

        {/* La resta completa bajo la tabla: entregas + visitas ± ajustes = neto.
            La tabla la muestra en filas; esto la muestra como una línea que se
            puede leer de un vistazo y copiar en un correo — que es lo que hoy se
            hace a mano en una planilla. */}
        {!verUnaPorUna && lineas.length > 0 ? (
          <BloqueComposicion
            className="mt-2"
            sumandos={[
              ...(agrupacion.cantidadEntregas > 0
                ? [{ concepto: "entregas", monto: agrupacion.subtotalEntregas }]
                : []),
              ...(agrupacion.cantidadVisitas > 0
                ? [{ concepto: "visitas", monto: agrupacion.subtotalVisitas }]
                : []),
              ...agrupacion.ajustes.map((aj) => ({
                concepto: aj.concepto.toLowerCase(),
                monto: Math.abs(aj.monto),
                resta: aj.monto < 0,
              })),
            ]}
          />
        ) : null}

        {verUnaPorUna && lineas.length > 0 ? (
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Líneas de liquidación">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2">Pedido</th>
                    <th className="hidden px-4 py-2 sm:table-cell">Fecha entrega</th>
                    <th className="px-4 py-2">Concepto</th>
                    <th className="hidden px-4 py-2 text-right lg:table-cell">Monto base</th>
                    <th className="hidden px-4 py-2 text-right lg:table-cell">Ajuste</th>
                    <th className="px-4 py-2 text-right">Monto final</th>
                    <th className="hidden px-4 py-2 text-center xl:table-cell">Por qué</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lineas.map((linea) => (
                    <FilaLinea key={linea.id} linea={linea} />
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/40">
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-sm font-semibold">
                      Total: {lineas.length} línea{lineas.length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">
                      {formatearCLPOGuion(lineas.reduce((acc, l) => acc + l.montoFinalClp, 0))}
                    </td>
                    <td className="hidden xl:table-cell" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      {/* Sección D — Bitácora */}
      <section aria-labelledby="bitacora-titulo" className="space-y-2 border-t border-line pt-4">
        <h2
          id="bitacora-titulo"
          className="text-[10px] font-medium tracking-[0.12em] text-fg-muted uppercase"
        >
          Bitácora
        </h2>
        <BloqueTrazabilidad
          hechos={bitacora}
          vacio="Todavía no hay movimientos registrados en esta liquidación."
        />
      </section>
    </div>
  );
}

// =============================================================================
// Fila de línea de liquidación
// =============================================================================

function FilaLinea({ linea }: { linea: LineaLiquidacion }) {
  const ajuste = formatearAjuste(linea.ajusteIncidenciaClp);
  const referencia = referenciaLineaLiquidacion(linea);

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        {referencia.href ? (
          <Link
            href={referencia.href}
            title={referencia.titulo ?? undefined}
            className="font-mono text-xs text-primary hover:underline"
          >
            {referencia.etiqueta}
          </Link>
        ) : (
          // Una línea de retiro no lleva a ningún pedido: no se pinta un enlace
          // muerto ni un id que no existe.
          <span title={referencia.titulo ?? undefined} className="text-xs text-muted-foreground">
            {referencia.etiqueta}
          </span>
        )}
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
        {formatearFechaCorta(linea.fechaHecho)}
      </td>
      <td className="px-4 py-3 text-muted-foreground max-w-[220px] truncate">{linea.concepto}</td>
      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground lg:table-cell">
        {formatearCLP(linea.montoBaseClp)}
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums lg:table-cell">
        <span
          className={
            ajuste.esNegativo ? "text-destructive" : ajuste.esPositivo ? "text-success" : "text-muted-foreground"
          }
        >
          {ajuste.texto}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatearCLP(linea.montoFinalClp)}</td>
      <td className="hidden px-4 py-3 text-center xl:table-cell">
        <PopoverSnapshotRegla snapshotRegla={linea.snapshotRegla} iconoSolo />
      </td>
    </tr>
  );
}
