"use client";

/**
 * La vista previa del período, al tocar la fila.
 * =============================================================================
 *
 * El chasis —movimiento, arrastre para cerrar, `Escape`, los tres estados— vive
 * en `@/components/ui/vista-previa-lateral`. Acá va **solo lo que es de esta
 * pantalla**: qué se lee y qué se muestra.
 *
 * -----------------------------------------------------------------------------
 * QUÉ NO LLEVA, Y NO ES OLVIDO
 * -----------------------------------------------------------------------------
 * **Ninguna acción irreversible.** Emitir la factura es peldaño 3 —irreversible
 * ante el SII y hoy sin nota de crédito— y vive en el detalle, con su ceremonia
 * y su verificación previa. Un panel que se abre con un toque no es lugar para
 * algo que no se deshace. Lo mismo con cerrar el período.
 *
 * Lo que sí está es la salida hacia donde SÍ se decide: el detalle completo, y
 * la bandeja de conciliación filtrada cuando hay algo que bloquea.
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
  BADGE_ESTADO_PERIODO,
  BADGE_ESTADO_SII,
  BADGE_ESTADO_COBRO_PERIODO,
  traducirEstadoPeriodoCobro,
  traducirEstadoSiiTexto,
  traducirEstadoCobroPeriodo,
} from "@/lib/ui/traduccion-estados";
import { etiquetaPeriodo } from "@/modules/dinero/listado-periodos";
import type { VistaPreviaPeriodo } from "@/modules/dinero/vista-previa-periodo";

import { accionVistaPreviaPeriodo } from "./vista-previa-actions";

export function ProveedorVistaPreviaPeriodo({ children }: { children: ReactNode }) {
  return (
    <ProveedorVistaPreviaLateral<VistaPreviaPeriodo>
      etiqueta="Vista previa del período de cobro"
      cargar={accionVistaPreviaPeriodo}
      tituloFalla="No pudimos abrir el período"
      textoFalla="No es que el período no exista: no lo pudimos leer. Ciérralo y vuelve a tocarlo, o abre su detalle completo."
      render={{ encabezado: Encabezado, cuerpo: Cuerpo, pie: Pie }}
    >
      {children}
    </ProveedorVistaPreviaLateral>
  );
}

function Encabezado(d: VistaPreviaPeriodo) {
  return (
    <>
      <p className="truncate font-heading text-base font-semibold">{d.sellerNombre}</p>
      <p className="rx-num mt-0.5 text-xs text-fg-muted">
        {etiquetaPeriodo(d.fechaInicio, d.fechaFin)}
        {d.sellerRut ? ` · ${d.sellerRut}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <BadgeEstado
          variante={BADGE_ESTADO_PERIODO[d.estado]}
          eje="periodo"
          valor={d.estado}
          texto={traducirEstadoPeriodoCobro(d.estado)}
        />
        {/* El bloqueo es un eje aparte del estado: un período cerrado puede
            tener una excepción encima, y fundirlos perdería justo el dato que
            hace falta para arreglarlo. */}
        {d.excepcionesBloqueantes > 0 ? (
          <span className="border border-attention-line bg-attention-bg px-1.5 py-0.5 text-[11px] font-medium text-attention-fg">
            Bloqueado
          </span>
        ) : null}
      </div>
    </>
  );
}

function Cuerpo(d: VistaPreviaPeriodo, cerrar: () => void) {
  // 🔴 El total guardado envejece: se escribe al cerrar y no se vuelve a tocar
  // aunque después se anule una línea. Se muestra SOLO cuando discrepa — dos
  // cifras iguales una al lado de la otra no informan, preocupan.
  const discrepa = d.netoGuardado !== null && d.netoGuardado !== d.netoDesdeLineas;

  return (
    <>
      <BloqueVistaPrevia titulo="El cobro">
        <p className="rx-num text-2xl font-semibold text-fg">{formatearCLP(d.netoDesdeLineas)}</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          neto, sumado desde {d.lineasVigentes}{" "}
          {d.lineasVigentes === 1 ? "línea vigente" : "líneas vigentes"}
        </p>
        {discrepa ? (
          <p className="mt-2 border border-attention-line bg-attention-bg px-2.5 py-1.5 text-xs leading-snug text-attention-fg">
            Al cerrarlo quedó guardado {formatearCLP(d.netoGuardado ?? 0)}. La diferencia sale de
            lo que se anuló después; el detalle y la factura usan la suma de las líneas.
          </p>
        ) : null}
      </BloqueVistaPrevia>

      <BloqueVistaPrevia titulo="De qué se compone">
        {d.porTipoPedido.flex > 0 ? (
          <DatoVistaPrevia rotulo="Flex">{d.porTipoPedido.flex}</DatoVistaPrevia>
        ) : null}
        {d.porTipoPedido.sameDay > 0 ? (
          <DatoVistaPrevia rotulo="Same-day">{d.porTipoPedido.sameDay}</DatoVistaPrevia>
        ) : null}
        {/* Las líneas con ajuste son lo que uno viene a revisar antes de
            facturar: es la plata que NO es la tarifa. */}
        {d.lineasConAjuste > 0 ? (
          <DatoVistaPrevia rotulo="Con ajuste por incidencia" tono="atencion">
            {d.lineasConAjuste} · {formatearCLP(d.ajusteTotalClp)}
          </DatoVistaPrevia>
        ) : null}
        {d.lineasAnuladas > 0 ? (
          <DatoVistaPrevia rotulo="Anuladas">{d.lineasAnuladas}</DatoVistaPrevia>
        ) : null}
        {d.primerHecho && d.ultimoHecho ? (
          <DatoVistaPrevia rotulo="Hechos entre">
            {formatearFechaCivilCorta(d.primerHecho)} y {formatearFechaCivilCorta(d.ultimoHecho)}
          </DatoVistaPrevia>
        ) : null}
        {d.lineasVigentes === 0 ? (
          <p className="text-sm text-fg-muted">
            Sin líneas todavía. Se escriben solas con cada entrega.
          </p>
        ) : null}
      </BloqueVistaPrevia>

      {d.folio !== null || d.estadoSii ? (
        <BloqueVistaPrevia titulo="El documento">
          {d.folio !== null ? (
            <DatoVistaPrevia rotulo="Folio">
              <span className="rx-num">{d.folio}</span>
            </DatoVistaPrevia>
          ) : null}
          {d.estadoSii ? (
            <div className="mt-1.5">
              <BadgeEstado
                variante={BADGE_ESTADO_SII[d.estadoSii]}
                eje="sii"
                valor={d.estadoSii}
                texto={traducirEstadoSiiTexto(d.estadoSii)}
              />
            </div>
          ) : null}
        </BloqueVistaPrevia>
      ) : null}

      <BloqueVistaPrevia titulo="El pago del seller">
        <div className="mb-1.5">
          <BadgeEstado
            variante={BADGE_ESTADO_COBRO_PERIODO[d.estadoCobro]}
            eje="cobro-periodo"
            valor={d.estadoCobro}
            texto={traducirEstadoCobroPeriodo(d.estadoCobro)}
          />
        </div>
        {d.montoPagadoClp !== null && d.montoPagadoClp > 0 ? (
          <>
            <DatoVistaPrevia rotulo="Pagado">{formatearCLP(d.montoPagadoClp)}</DatoVistaPrevia>
            <DatoVistaPrevia
              rotulo="Saldo"
              tono={d.netoDesdeLineas - d.montoPagadoClp > 0 ? "atencion" : "normal"}
            >
              {formatearCLP(d.netoDesdeLineas - d.montoPagadoClp)}
            </DatoVistaPrevia>
          </>
        ) : (
          <p className="text-sm text-fg-muted">Sin pagos atribuidos.</p>
        )}
      </BloqueVistaPrevia>

      {/* 🔴 El bloqueo, con su salida. Decir «bloqueado» sin decir dónde se
          arregla obliga a buscarlo, y la bandeja acepta el filtro por seller. */}
      {d.excepcionesBloqueantes > 0 ? (
        <BloqueVistaPrevia titulo="Qué lo bloquea">
          <p className="text-sm leading-snug text-attention-fg">
            {d.excepcionesBloqueantes}{" "}
            {d.excepcionesBloqueantes === 1
              ? "excepción de conciliación abierta impide"
              : "excepciones de conciliación abiertas impiden"}{" "}
            emitir la factura.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-2">
            <EnlaceQueCierra href={`/dinero/conciliacion?seller=${d.sellerId}`} onCerrar={cerrar}>
              Ver las excepciones de este seller
            </EnlaceQueCierra>
          </Button>
        </BloqueVistaPrevia>
      ) : null}
    </>
  );
}

function Pie(d: VistaPreviaPeriodo, cerrar: () => void) {
  return (
    <Button asChild variant="outline" size="sm" className="w-full">
      <EnlaceQueCierra href={`/dinero/periodos/${d.id}`} onCerrar={cerrar}>
        Abrir el detalle completo
      </EnlaceQueCierra>
    </Button>
  );
}
