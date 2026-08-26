"use client";

/**
 * La vista previa del seller, al tocar su fila.
 * =============================================================================
 *
 * El chasis vive en `@/components/ui/vista-previa-lateral`. Acá va solo lo que
 * es de esta pantalla.
 *
 * -----------------------------------------------------------------------------
 * QUÉ RESPONDE
 * -----------------------------------------------------------------------------
 * La tabla ya dice quién es y si su conexión está sana. Este panel responde la
 * pregunta siguiente: **cuánto pesa este cliente y cómo se está portando**, que
 * es lo que uno necesita antes de llamarlo o de renegociar una tarifa.
 *
 * -----------------------------------------------------------------------------
 * 🔴 LAS CIFRAS QUE NO SE PUDIERON LEER NO SE DIBUJAN EN CERO
 * -----------------------------------------------------------------------------
 * Un «0 fallidos» que en realidad es una consulta caída se lee como una buena
 * noticia. Cuando la lectura falla, el bloque lo dice con todas las letras en
 * vez de mostrar un número. Es la misma regla de la barra de cajones de Pedidos.
 */

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  BloqueVistaPrevia,
  DatoVistaPrevia,
  EnlaceQueCierra,
  ProveedorVistaPreviaLateral,
} from "@/components/ui/vista-previa-lateral";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { formatearFechaCivilCorta, formatearFechaHora } from "@/lib/formato-cl";
import type { VistaPreviaSellerCourier } from "@/modules/identidad/vista-previa-seller-courier";
import { DIAS_VENTANA_SELLER } from "@/modules/identidad/vista-previa-seller-courier";

import { accionVistaPreviaSeller } from "./vista-previa-actions";

export function ProveedorVistaPreviaSeller({ children }: { children: ReactNode }) {
  return (
    <ProveedorVistaPreviaLateral<VistaPreviaSellerCourier>
      etiqueta="Vista previa del seller"
      cargar={accionVistaPreviaSeller}
      tituloFalla="No pudimos abrir el seller"
      textoFalla="No es que el seller no exista: no lo pudimos leer. Ciérralo y vuelve a tocarlo, o abre su ficha completa."
      render={{ encabezado: Encabezado, cuerpo: Cuerpo, pie: Pie }}
    >
      {children}
    </ProveedorVistaPreviaLateral>
  );
}

function Encabezado(d: VistaPreviaSellerCourier) {
  return (
    <>
      <p className="truncate font-heading text-base font-semibold">{d.razonSocial}</p>
      {d.rut ? <p className="rx-num mt-0.5 text-xs text-fg-muted">{d.rut}</p> : null}
      {d.estado !== "activo" ? (
        <p className="mt-2 text-xs font-medium text-attention-fg">
          Cuenta {d.estado}. No está operando.
        </p>
      ) : null}
    </>
  );
}

function Cuerpo(d: VistaPreviaSellerCourier, cerrar: () => void) {
  return (
    <>
      {/* ── Volumen ─────────────────────────────────────────────────────────
          Lo primero, porque es lo que decide si vale la pena el resto de la
          conversación. */}
      <BloqueVistaPrevia titulo={`Volumen · últimos ${DIAS_VENTANA_SELLER} días`}>
        {d.hayMetricas ? (
          <>
            <p className="rx-num text-2xl font-semibold text-fg">
              {d.promedioSemanal.toLocaleString("es-CL")}
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">
              pedidos por semana · {d.pedidosVentana} en total
            </p>
          </>
        ) : (
          // 🔴 Rayas, nunca ceros: «0 pedidos» es una afirmación —y falsa—;
          // «—» dice lo único que sabemos, que es que no lo sabemos.
          <>
            <p className="rx-num text-2xl font-semibold text-fg-subtle">—</p>
            <p className="mt-0.5 text-xs text-fault-fg">
              No pudimos leer sus pedidos. No son cero: no los pudimos leer.
            </p>
          </>
        )}
      </BloqueVistaPrevia>

      {d.hayMetricas && d.pedidosVentana > 0 ? (
        <BloqueVistaPrevia titulo="Cómo terminan">
          <DatoVistaPrevia rotulo="Entregados">
            {d.entregados}
            <span className="ms-1 text-xs text-fg-muted">
              ({Math.round((d.entregados / d.pedidosVentana) * 100)} %)
            </span>
          </DatoVistaPrevia>
          {/* Un fallido es una entrega que se hizo y no se cobra: es plata, no
              una estadística. Por eso va en tono de atención aunque sea uno. */}
          {d.fallidos > 0 ? (
            <DatoVistaPrevia rotulo="Fallidos o devueltos" tono="atencion">
              {d.fallidos}
              <span className="ms-1 text-xs">
                ({Math.round((d.fallidos / d.pedidosVentana) * 100)} %)
              </span>
            </DatoVistaPrevia>
          ) : (
            <DatoVistaPrevia rotulo="Fallidos o devueltos">0</DatoVistaPrevia>
          )}
          {d.cancelados > 0 ? (
            <DatoVistaPrevia rotulo="Cancelados">{d.cancelados}</DatoVistaPrevia>
          ) : null}
          {d.enCurso > 0 ? (
            <DatoVistaPrevia rotulo="Todavía en curso">{d.enCurso}</DatoVistaPrevia>
          ) : null}
          {d.incidenciasAbiertas > 0 ? (
            <div className="mt-2">
              <Button asChild variant="outline" size="sm">
                <EnlaceQueCierra
                  href={`/operaciones/incidencias?seller=${d.id}`}
                  onCerrar={cerrar}
                >
                  {d.incidenciasAbiertas}{" "}
                  {d.incidenciasAbiertas === 1
                    ? "incidencia abierta"
                    : "incidencias abiertas"}
                </EnlaceQueCierra>
              </Button>
            </div>
          ) : null}
        </BloqueVistaPrevia>
      ) : null}

      {/* ── Dinero ──────────────────────────────────────────────────────────
          El período abierto se suma desde las líneas y no del total guardado:
          ese se escribe al cerrar, así que en un período abierto siempre está
          desactualizado o vacío. */}
      <BloqueVistaPrevia titulo="Lo que le estás cobrando">
        {!d.hayDinero ? (
          <p className="text-xs text-fault-fg">No pudimos leer sus períodos de cobro.</p>
        ) : (
          <>
            {d.periodoAbiertoClp !== null ? (
              <DatoVistaPrevia rotulo="Período en curso">
                {formatearCLP(d.periodoAbiertoClp)}
                <span className="ms-1 text-xs text-fg-muted">
                  ({d.periodoAbiertoLineas}{" "}
                  {d.periodoAbiertoLineas === 1 ? "línea" : "líneas"})
                </span>
              </DatoVistaPrevia>
            ) : (
              <DatoVistaPrevia rotulo="Período en curso">sin período abierto</DatoVistaPrevia>
            )}
            {d.ultimoFacturadoClp !== null ? (
              <DatoVistaPrevia rotulo="Última factura">
                {formatearCLP(d.ultimoFacturadoClp)}
                {d.ultimoFacturadoHasta ? (
                  <span className="ms-1 text-xs text-fg-muted">
                    hasta {formatearFechaCivilCorta(d.ultimoFacturadoHasta)}
                  </span>
                ) : null}
              </DatoVistaPrevia>
            ) : (
              <DatoVistaPrevia rotulo="Última factura">todavía ninguna</DatoVistaPrevia>
            )}
          </>
        )}
      </BloqueVistaPrevia>

      <BloqueVistaPrevia titulo="De dónde entran sus pedidos">
        {d.conexiones.length === 0 ? (
          <p className="text-sm leading-snug text-attention-fg">
            Sin ninguna cuenta conectada. Sus pedidos no entran solos: hay que cargarlos a mano.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {d.conexiones.map((c, i) => (
              <li key={`${c.tipo}-${i}`} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-fg">{c.nombre}</span>
                <span
                  className={
                    c.estadoSalud === "conectada" || c.estadoSalud === "activa"
                      ? "shrink-0 text-xs text-fg-muted"
                      : "shrink-0 text-xs font-medium text-attention-fg"
                  }
                >
                  {c.tipo === "ml" ? "Mercado Libre" : "Shopify"} · {c.estadoSalud}
                </span>
              </li>
            ))}
          </ul>
        )}
        {/* La última sincronización de la conexión más fresca: es lo que dice si
            «no entran pedidos» es un problema de hoy o de hace una semana. */}
        {d.conexiones.some((c) => c.ultimaSyncEn) ? (
          <p className="mt-1.5 text-xs text-fg-subtle">
            Última sincronización:{" "}
            {formatearFechaHora(
              d.conexiones
                .map((c) => c.ultimaSyncEn)
                .filter((s): s is string => Boolean(s))
                .sort()
                .at(-1) as string,
            )}
          </p>
        ) : null}
      </BloqueVistaPrevia>

      <BloqueVistaPrevia titulo="A quién llamar">
        <DatoVistaPrevia rotulo="Contacto">{d.nombreContacto ?? "—"}</DatoVistaPrevia>
        <DatoVistaPrevia rotulo="Correo">{d.emailContacto ?? "—"}</DatoVistaPrevia>
      </BloqueVistaPrevia>
    </>
  );
}

function Pie(d: VistaPreviaSellerCourier, cerrar: () => void) {
  return (
    <div className="flex gap-2">
      <Button asChild variant="outline" size="sm" className="flex-1">
        <EnlaceQueCierra href={`/operaciones?seller=${d.id}`} onCerrar={cerrar}>
          Ver sus pedidos
        </EnlaceQueCierra>
      </Button>
      <Button asChild variant="outline" size="sm" className="flex-1">
        <EnlaceQueCierra href={`/sellers/${d.id}`} onCerrar={cerrar}>
          Ficha completa
        </EnlaceQueCierra>
      </Button>
    </div>
  );
}
