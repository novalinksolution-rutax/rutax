import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  armarVistaPreviaPeriodo,
  type VistaPreviaPeriodo,
} from "@/modules/dinero/vista-previa-periodo";
import { obtenerPeriodoCobro, listarDocumentosDte } from "@/modules/dinero/consultas";
import { agruparLineasCobro } from "@/modules/dinero/agrupacion-lineas";
import { loQueVeElSeller } from "@/modules/dinero/vista-seller-periodo";
import { resolverModoDteTenant, type ModoDte } from "@/modules/dinero/modo-dte";
import { obtenerTrazabilidad, type HechoTrazable } from "@/modules/identidad/trazabilidad";

/**
 * La ficha del período, entera, para el panel lateral.
 *
 * Suma a la vista previa lo que tenía la página de detalle salvo la tabla de
 * líneas —que sigue en `/dinero/periodos/[id]` porque puede tener cientos—:
 * documento, nota de crédito, qué ve el seller, bitácora y los datos que
 * necesitan los diálogos de acción (decisión del usuario, 2026-09-27).
 */
export interface FichaPeriodo extends VistaPreviaPeriodo {
  /** `emitir_facturas`: decide si el ⋯ ofrece las acciones de dinero. */
  puedeEmitir: boolean;
  autorNombre: string;
  modoDte: ModoDte;
  totalLineas: number;
  montoTotalClp: number | null;
  montoPagado: number;
  documento: { folio: number; pdfRef: string | null; xmlRef: string | null } | null;
  notaCredito: { folio: number; pdfRef: string | null; xmlRef: string | null } | null;
  /** El desglose del total para el diálogo de emisión (regla 21). */
  composicion: { concepto: string; monto: number; resta?: boolean }[] | null;
  vistaSeller: { ve: string; noVe: string | null };
  bitacora: HechoTrazable[];
}

export async function cargarFichaPeriodo(
  cliente: SupabaseClient,
  tenantId: string,
  periodoId: string,
  contexto: { puedeEmitir: boolean; autorNombre: string },
): Promise<FichaPeriodo | null> {
  const [base, periodo, modoDte] = await Promise.all([
    armarVistaPreviaPeriodo(cliente, tenantId, periodoId),
    obtenerPeriodoCobro(cliente, tenantId, periodoId),
    resolverModoDteTenant(tenantId).catch(() => "sandbox" as ModoDte),
  ]);
  if (!base || !periodo) return null;

  const [dtes, bitacora] = await Promise.all([
    periodo.documentoDteId
      ? listarDocumentosDte(cliente, tenantId, periodo.sellerId)
      : Promise.resolve([]),
    obtenerTrazabilidad(cliente, tenantId, "periodo_cobro", periodoId, { limite: 5 }).catch(
      () => [] as HechoTrazable[],
    ),
  ]);
  const factura = dtes.find((d) => d.periodoCobroidId === periodoId && d.tipoDocumento === 33);
  const nc = dtes.find((d) => d.periodoCobroidId === periodoId && d.tipoDocumento === 61);
  const agrupacion = agruparLineasCobro(periodo.lineas ?? []);
  const vista = loQueVeElSeller(periodo.estado, {
    folio: factura?.folio ?? null,
    tieneDocumento: Boolean(factura?.pdfRef),
  });

  return {
    ...base,
    ...contexto,
    modoDte,
    totalLineas: periodo.totalLineas,
    montoTotalClp: periodo.montoTotalClp,
    montoPagado: periodo.montoPagadoClp ?? 0,
    documento: factura
      ? { folio: factura.folio, pdfRef: factura.pdfRef, xmlRef: factura.xmlDteRef }
      : null,
    notaCredito: nc ? { folio: nc.folio, pdfRef: nc.pdfRef, xmlRef: nc.xmlDteRef } : null,
    // Solo con ajustes: sin ellos el neto ES el subtotal (mismo criterio que
    // tenía la página de detalle).
    composicion:
      agrupacion.ajustes.length > 0
        ? [
            { concepto: "entregas", monto: agrupacion.subtotalEntregas },
            ...agrupacion.ajustes.map((aj) => ({
              concepto: "ajustes",
              monto: Math.abs(aj.monto),
              resta: aj.monto < 0,
            })),
          ]
        : null,
    vistaSeller: { ve: vista.ve, noVe: vista.noVe ?? null },
    bitacora,
  };
}
