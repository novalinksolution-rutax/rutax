"use client";

/**
 * La vista previa de la liquidación, al tocar la fila.
 * =============================================================================
 *
 * El chasis vive en `@/components/ui/vista-previa-lateral`. Acá va solo lo que
 * es de esta pantalla.
 *
 * -----------------------------------------------------------------------------
 * LA PREGUNTA QUE RESPONDE
 * -----------------------------------------------------------------------------
 * **«¿Por qué le llegó esto?»** La liquidación la lee alguien que desconfía del
 * descuento, así que el panel se organiza como una resta a la vista: bruto, lo
 * que se sumó, lo que se restó, y el neto abajo con su nota. Sin el motivo
 * escrito, la cifra del ajuste no explica nada y la conversación vuelve al
 * teléfono.
 *
 * -----------------------------------------------------------------------------
 * QUÉ NO LLEVA, Y NO ES OLVIDO
 * -----------------------------------------------------------------------------
 * **Emitir el pago no está acá.** Mandar plata a la cuenta de alguien es peldaño
 * 3 y vive en el detalle, con su confirmación. Tampoco el ajuste: cambiar el
 * bono o la penalización es cambiar lo que se le paga a una persona.
 */

import type { ReactNode } from "react";

import { BadgeEstado } from "@/components/ui/badge-estado";
import { Button } from "@/components/ui/button";
import {
  BloqueVistaPrevia,
  DatoVistaPrevia,
  EnlaceQueCierra,
  ProveedorVistaPreviaLateral,
} from "@/components/ui/vista-previa-lateral";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { formatearFechaCivilCorta } from "@/lib/formato-cl";
import {
  BADGE_ESTADO_LIQUIDACION,
  BADGE_ESTADO_PAYOUT,
  traducirEstadoLiquidacion,
  traducirEstadoPayout,
} from "@/lib/ui/traduccion-estados";
import type { EstadoPayout } from "@/modules/dinero/tipos";
import { etiquetaPeriodo } from "@/modules/dinero/listado-periodos";
import { frasearRechazoDeBanco } from "@/modules/dinero/listado-liquidaciones";
import type { VistaPreviaLiquidacion } from "@/modules/dinero/vista-previa-liquidacion";

import { accionVistaPreviaLiquidacion } from "./vista-previa-actions";

export function ProveedorVistaPreviaLiquidacion({ children }: { children: ReactNode }) {
  return (
    <ProveedorVistaPreviaLateral<VistaPreviaLiquidacion>
      etiqueta="Vista previa de la liquidación"
      cargar={accionVistaPreviaLiquidacion}
      tituloFalla="No pudimos abrir la liquidación"
      textoFalla="No es que la liquidación no exista: no la pudimos leer. Ciérrala y vuelve a tocarla, o abre su detalle completo."
      render={{ encabezado: Encabezado, cuerpo: Cuerpo, pie: Pie }}
    >
      {children}
    </ProveedorVistaPreviaLateral>
  );
}

function Encabezado(d: VistaPreviaLiquidacion) {
  return (
    <>
      <p className="truncate font-heading text-base font-semibold">{d.conductorNombre}</p>
      <p className="rx-num mt-0.5 text-xs text-fg-muted">
        {etiquetaPeriodo(d.fechaInicio, d.fechaFin)}
        {d.tipoRelacion ? ` · ${d.tipoRelacion}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <BadgeEstado
          variante={BADGE_ESTADO_LIQUIDACION[d.estado]}
          eje="liquidacion"
          valor={d.estado}
          texto={traducirEstadoLiquidacion(d.estado)}
        />
        {/* El estado del pago es un eje aparte del de la liquidación: una
            rechazada por el banco sigue estando `emitida`. */}
        {d.payoutEstado ? (
          <BadgeEstado
            variante={BADGE_ESTADO_PAYOUT[d.payoutEstado as EstadoPayout]}
            eje="payout"
            valor={d.payoutEstado}
            texto={traducirEstadoPayout(d.payoutEstado as EstadoPayout)}
          />
        ) : null}
      </div>
    </>
  );
}

function Cuerpo(d: VistaPreviaLiquidacion) {
  const hayAjuste = d.bonoClp > 0 || d.penalizacionClp > 0;

  return (
    <>
      {/* 🔴 La resta a la vista. Es la anatomía entera de este panel: quien lo
          abre viene a reconstruir un número, no a leer un resumen. */}
      <BloqueVistaPrevia titulo="Cómo se llega al neto">
        <DatoVistaPrevia rotulo="Entregas">
          {d.entregas}
          {/* Las visitas a bodega van al lado y no sumadas: son OTRO hecho
              generador —el courier se lo paga al conductor pero NO se lo cobra
              al seller— y la fila del listado las escondía dentro del monto. */}
        </DatoVistaPrevia>
        {d.visitas > 0 ? (
          <DatoVistaPrevia rotulo="Visitas a bodega">{d.visitas}</DatoVistaPrevia>
        ) : null}
        {/* El bruto solo cuando hay algo que restarle. Sin ajustes es idéntico
            al neto de abajo, y dos cifras iguales pegadas no informan: hacen
            dudar de si una de las dos está mal. Es el mismo criterio que en la
            vista previa del período. */}
        {hayAjuste ? (
          <DatoVistaPrevia rotulo="Bruto">{formatearCLP(d.brutoClp)}</DatoVistaPrevia>
        ) : null}
        {d.bonoClp > 0 ? (
          <DatoVistaPrevia rotulo="Bono">+ {formatearCLP(d.bonoClp)}</DatoVistaPrevia>
        ) : null}
        {d.penalizacionClp > 0 ? (
          <DatoVistaPrevia rotulo="Penalización" tono="atencion">
            − {formatearCLP(d.penalizacionClp)}
          </DatoVistaPrevia>
        ) : null}

        <div className="mt-2 border-t border-line pt-2">
          {/* Regla 18: la cifra declara qué es. Acá es neto — una liquidación de
              conductor no lleva IVA. */}
          <p className="rx-num text-2xl font-semibold text-fg">{formatearCLP(d.netoClp)}</p>
          <p className="mt-0.5 text-xs text-fg-muted">neto a pagar</p>
        </div>

        {/* Sin el motivo escrito, la cifra del ajuste no explica nada — y es
            justo la que se discute. */}
        {hayAjuste && d.notaAjuste ? (
          <p className="mt-2 border-l-2 border-line-strong pl-2.5 text-xs leading-snug text-fg-muted">
            {d.notaAjuste}
          </p>
        ) : null}
        {hayAjuste && !d.notaAjuste ? (
          <p className="mt-2 text-xs leading-snug text-attention-fg">
            El ajuste no tiene motivo escrito. Si el conductor pregunta, no hay con qué responder.
          </p>
        ) : null}
      </BloqueVistaPrevia>

      <BloqueVistaPrevia titulo="Qué cubre">
        {d.primerHecho && d.ultimoHecho ? (
          <DatoVistaPrevia rotulo="Hechos entre">
            {formatearFechaCivilCorta(d.primerHecho)} y {formatearFechaCivilCorta(d.ultimoHecho)}
          </DatoVistaPrevia>
        ) : (
          <p className="text-sm text-fg-muted">Sin líneas todavía.</p>
        )}
        {d.lineasAnuladas > 0 ? (
          <DatoVistaPrevia rotulo="Líneas anuladas">{d.lineasAnuladas}</DatoVistaPrevia>
        ) : null}
        {/* El total guardado envejece igual que el del período: se escribe al
            generar y no se vuelve a tocar. Solo se muestra si discrepa. */}
        {d.montoGuardadoClp !== null && d.montoGuardadoClp !== d.brutoClp ? (
          <DatoVistaPrevia rotulo="Guardado al generar">
            {formatearCLP(d.montoGuardadoClp)}
          </DatoVistaPrevia>
        ) : null}
      </BloqueVistaPrevia>

      {/* El rechazo del banco, con su texto crudo enmarcado como lo que es. No
          se traduce: traducirlo de verdad exige que el adaptador persista un
          código, y adivinar el motivo de un rechazo de plata es peor que
          citarlo. */}
      {d.payoutEstado === "rechazado" ? (
        <BloqueVistaPrevia titulo="El pago">
          <p className="border border-fault-line bg-fault-bg px-2.5 py-1.5 text-xs leading-snug text-fault-fg">
            {frasearRechazoDeBanco(d.payoutErrorDescripcion)}
          </p>
        </BloqueVistaPrevia>
      ) : null}
    </>
  );
}

function Pie(d: VistaPreviaLiquidacion, cerrar: () => void) {
  return (
    <Button asChild variant="outline" size="sm" className="w-full">
      <EnlaceQueCierra href={`/dinero/liquidaciones/${d.id}`} onCerrar={cerrar}>
        Abrir el detalle completo
      </EnlaceQueCierra>
    </Button>
  );
}
