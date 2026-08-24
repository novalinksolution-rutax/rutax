import { cn } from "@/lib/utils"
import { formatearFechaHora } from "@/lib/formato-cl"
import type { HechoTrazable } from "@/modules/identidad/trazabilidad"

/**
 * BloqueTrazabilidad — autor, fecha y motivo. Por fila y por objeto.
 *
 * QUÉ PROBLEMA CIERRA
 * ---------------------------------------------------------------------------
 * El producto ya exige motivo en sus actos irreversibles y ya los registra con
 * autor, pero **eso no se veía en ninguna pantalla**: había que salir a la
 * bitácora —otra pantalla, otro permiso— para saber quién descontó $8.000 de la
 * liquidación de un conductor y por qué. Un motivo que nadie lee es un trámite,
 * no un control.
 *
 * DOS FORMAS, UNA REGLA
 * ---------------------------------------------------------------------------
 * · `por objeto` — la lista de hechos, para el detalle. Cada hecho es una línea
 *   con su acto, su autor y su fecha, y el motivo debajo si lo hubo.
 * · `por fila` — una sola línea, para meter dentro de una tabla sin romperle la
 *   altura. Muestra el hecho más reciente.
 *
 * La regla en las dos: **el motivo va con el hecho, nunca aparte** (regla 20).
 * Un motivo que hay que ir a buscar a otra parte no cumple.
 *
 * SIN AUTOR NO ES UN AGUJERO, ES UN DATO
 * ---------------------------------------------------------------------------
 * Cuando `autorNombre` es `null` y el actor fue el sistema, se dice «Rutax»: un
 * job que cierra un período automáticamente no tiene nombre y fingir uno sería
 * peor. Cuando el actor era una persona que ya no está en el tenant, se dice
 * «usuario dado de baja» — que es distinto, y la diferencia importa cuando
 * alguien audita.
 */

/**
 * Vocabulario de actos. Vive acá y no en cada pantalla.
 *
 * ⚠️ Cada llave tiene que ser una acción que el dominio **realmente emite**.
 * `bloque-trazabilidad.test.ts` lo comprueba leyendo `modules/dinero/acciones.ts`:
 * una etiqueta para una acción inexistente es código muerto que se ve bien y no
 * se ejecuta nunca, y la primera versión de este archivo tenía **seis**.
 */
export const ACTO: Record<string, string> = {
  "dinero.periodo_cerrado_manual": "Cerró el período",
  "dinero.periodo_reabierto": "Volvió a abrir el período",
  "dinero.emision_dte_solicitada": "Pidió emitir la factura",
  "dinero.nc_emision_solicitada": "Pidió anular la factura",
  "dinero.liquidacion_ajustada": "Ajustó la liquidación",
  "dinero.liquidacion_marcada_pagada": "Marcó la liquidación como pagada",
  "dinero.pago_liquidacion_solicitado": "Pidió transferir el pago",
  "dinero.linea_cobro_anulada_manual": "Anuló una línea de cobro",
  "dinero.linea_liquidacion_anulada_manual": "Anuló una línea de liquidación",
  "dinero.preflight_omitido": "Siguió sin la verificación previa",
  "dinero.pago_atribuido_manual": "Atribuyó un pago a mano",
  "dinero.pago_descartado": "Descartó un movimiento",
  "dinero.pago_recuperado": "Devolvió el movimiento a la bandeja",
  "manifiesto.cancelado": "Canceló el manifiesto",
  "manifiesto.parada_quitada": "Quitó una parada",
  "operacion.conductor_caido": "Marcó al conductor no disponible",
  "operacion.redistribucion_completada": "Redistribuyó sus paradas",
}

function nombreDelActo(accion: string): string {
  // Sin traducción, se muestra la acción cruda antes que un texto inventado:
  // un acto sin nombre se nota y se agrega; uno con nombre equivocado, no.
  return ACTO[accion] ?? accion
}

function autorLegible(hecho: HechoTrazable): string {
  if (hecho.autorNombre) return hecho.autorNombre
  if (hecho.actorTipo === "sistema") return "Rutax"
  return "usuario dado de baja"
}

export function BloqueTrazabilidad({
  hechos,
  forma = "por objeto",
  className,
  /** Texto cuando no hay ni un hecho registrado. */
  vacio = "Todavía no hay movimientos registrados.",
}: {
  hechos: HechoTrazable[]
  forma?: "por objeto" | "por fila"
  className?: string
  vacio?: string
}) {
  if (hechos.length === 0) {
    return forma === "por fila" ? null : (
      <p className={cn("text-xs text-fg-subtle", className)}>{vacio}</p>
    )
  }

  if (forma === "por fila") {
    const h = hechos[0]
    return (
      <span className={cn("text-xs text-fg-muted", className)}>
        {nombreDelActo(h.accion)} <span className="text-fg">{autorLegible(h)}</span> el{" "}
        {formatearFechaHora(h.cuando)}
        {h.motivo ? <> · «{h.motivo}»</> : null}
      </span>
    )
  }

  return (
    <ul className={cn("flex flex-col divide-y divide-line-subtle border border-line", className)}>
      {hechos.map((h, i) => (
        <li key={`${h.accion}-${h.cuando}-${i}`} className="flex flex-col gap-1 px-3 py-2.5">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[12.5px]">
            <span className="text-fg">
              {nombreDelActo(h.accion)} · <strong className="font-medium">{autorLegible(h)}</strong>
            </span>
            <span className="font-mono text-[11px] text-fg-subtle tabular-nums">
              {formatearFechaHora(h.cuando)}
            </span>
          </span>
          {/* El motivo pegado a su hecho, no en una columna aparte: es lo que
              explica por qué ese acto existió. */}
          {h.motivo ? (
            <span className="text-xs leading-relaxed text-fg-muted">«{h.motivo}»</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
