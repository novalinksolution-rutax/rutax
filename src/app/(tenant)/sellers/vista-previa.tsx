"use client";

/**
 * La ficha del seller, en el panel lateral.
 * =============================================================================
 *
 * Era una vista previa con un botón «Ficha completa» que llevaba a otra página,
 * y cada una mostraba cosas distintas del mismo seller. Ahora el panel ES la
 * ficha (decisión del usuario, 2026-09-27): se abre al tocar la fila o el
 * nombre, sin salir del listado. `/sellers/[id]` redirige a `?seller=` y abre
 * este mismo panel, porque hay correos y pantallas que enlazan ahí.
 *
 * Poco texto a propósito: cada bloque dice el dato, y el vacío dice solo que
 * falta — no narra la consecuencia.
 *
 * 🔴 Las cifras que no se pudieron leer no se dibujan en cero: un «0» que en
 * realidad es una consulta caída se lee como una buena noticia.
 */

import { Suspense, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { BadgeEstado } from "@/components/ui/badge-estado";
import {
  BloqueVistaPrevia,
  EnlaceQueCierra,
  ProveedorVistaPreviaLateral,
  useVistaPreviaLateral,
} from "@/components/ui/vista-previa-lateral";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import {
  BADGE_ESTADO_PERIODO,
  BADGE_ESTADO_SELLER,
  BADGE_SALUD_CONEXION,
  traducirEstadoPeriodoCobro,
  traducirEstadoSeller,
  traducirSaludConexion,
  type EstadoSaludConexion,
  type EstadoSeller,
} from "@/lib/ui/traduccion-estados";

import type { FichaSeller } from "./_ficha/datos";
import { accionVistaPreviaSeller } from "./vista-previa-actions";
import { ControlSincronizarMl } from "./control-sincronizar-ml";
import { VentanasCorteSeller } from "./_ficha/ventanas-corte-seller";
import { ControlMembresiaAutoservicio } from "./_ficha/control-membresia-autoservicio";

export function ProveedorVistaPreviaSeller({ children }: { children: ReactNode }) {
  return (
    <ProveedorVistaPreviaLateral<FichaSeller>
      etiqueta="Ficha del seller"
      cargar={accionVistaPreviaSeller}
      tituloFalla="No se pudo abrir"
      textoFalla="Vuelve a intentarlo."
      render={RENDER_FICHA_SELLER}
    >
      <Suspense fallback={null}>
        <AbrirDesdeUrl />
      </Suspense>
      {children}
    </ProveedorVistaPreviaLateral>
  );
}

/** `?seller=<id>` abre la ficha: es el destino de la ruta vieja y de los correos. */
function AbrirDesdeUrl() {
  const params = useSearchParams();
  const vista = useVistaPreviaLateral();
  const id = params.get("seller");
  const abrir = vista?.abrir;
  useEffect(() => {
    if (id && abrir) abrir(id);
  }, [id, abrir]);
  return null;
}

function Encabezado(d: FichaSeller) {
  return (
    <>
      <p className="truncate font-heading text-base font-semibold">{d.razonSocial}</p>
      <p className="rx-num mt-0.5 truncate text-xs text-fg-muted">
        {[d.rut, d.nombreContacto, d.emailContacto].filter(Boolean).join(" · ")}
      </p>
      {d.estado !== "activo" ? (
        <div className="mt-2">
          <BadgeEstado
            variante={BADGE_ESTADO_SELLER[d.estado as EstadoSeller] ?? "neutral"}
            eje="seller"
            valor={d.estado}
            texto={traducirEstadoSeller(d.estado)}
          />
        </div>
      ) : null}
    </>
  );
}

function Vacio({ children }: { children: ReactNode }) {
  return <p className="text-sm text-fg-muted">{children}</p>;
}

function Cuerpo(d: FichaSeller) {
  const cuentasMl = d.cuentas.filter((c) => c.tipo === "ml" && !c.apagadaPorSeller);

  return (
    <>
      <BloqueVistaPrevia titulo="Cuentas">
        {d.cuentas.length === 0 ? (
          <Vacio>Sin cuentas conectadas.</Vacio>
        ) : (
          <ul className="space-y-2">
            {d.cuentas.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-fg">{c.nombre}</span>
                  <span className="block text-xs text-fg-muted">
                    {c.tipo === "ml" ? "Mercado Libre" : "Shopify"}
                  </span>
                </span>
                {c.apagadaPorSeller ? (
                  <BadgeEstado
                    variante="neutral"
                    eje="conexion"
                    valor="desconectada_a_proposito"
                    texto="La apagó el seller"
                  />
                ) : c.estadoSalud === "sana" ? null : (
                  <BadgeEstado
                    variante={BADGE_SALUD_CONEXION[c.estadoSalud as EstadoSaludConexion] ?? "neutral"}
                    eje="conexion"
                    valor={c.estadoSalud}
                    texto={traducirSaludConexion(c.estadoSalud)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {d.puedeSincronizar && cuentasMl.length > 0 ? (
          <div className="mt-2">
            <ControlSincronizarMl
              razonSocial={d.razonSocial}
              conexiones={cuentasMl.map((c) => ({ id: c.id, etiqueta: c.nombre }))}
            />
          </div>
        ) : null}
      </BloqueVistaPrevia>

      <BloqueVistaPrevia titulo="Pedidos">
        {d.hayMetricas ? (
          <p className="rx-num text-sm text-fg">
            <span className="text-lg font-semibold">{d.pedidosHoy}</span> hoy
            <span className="text-fg-muted"> · ~{d.promedioSemanal.toLocaleString("es-CL")} por semana</span>
          </p>
        ) : (
          <p className="text-xs text-fault-fg">No se pudieron leer.</p>
        )}
      </BloqueVistaPrevia>

      <BloqueVistaPrevia titulo="Cobro">
        {d.tarifas.length === 0 ? (
          <Vacio>Sin tarifa propia.</Vacio>
        ) : (
          <ul className="space-y-1">
            {d.tarifas.map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-fg">{t.tipoEntrega}</span>
                <span className="rx-num text-fg-muted">
                  {formatearCLPOGuion(t.montoClp)} · paga {formatearCLPOGuion(t.montoConductorClp)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {d.periodos.length > 0 ? (
          <ul className="mt-2 divide-y divide-line border-t border-line">
            {d.periodos.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-1.5">
                <Link
                  href={`/dinero/periodos/${p.id}`}
                  className="rx-num flex min-h-11 items-center text-sm hover:underline lg:min-h-0"
                >
                  {p.etiqueta}
                </Link>
                <span className="flex items-center gap-2">
                  <span className="rx-num text-sm text-fg-muted">
                    {formatearCLPOGuion(p.montoClp)}
                  </span>
                  <BadgeEstado
                    variante={BADGE_ESTADO_PERIODO[p.estado as "abierto"] ?? "neutral"}
                    eje="periodo"
                    valor={p.estado}
                    texto={traducirEstadoPeriodoCobro(p.estado as "abierto")}
                  />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </BloqueVistaPrevia>

      <BloqueVistaPrevia titulo="Bodegas">
        {d.bodegas.length === 0 ? (
          <Vacio>Sin bodegas.</Vacio>
        ) : (
          <ul className="space-y-1.5">
            {d.bodegas.map((b) => (
              <li key={b.id}>
                <span className="block text-sm text-fg">{b.nombre}</span>
                <span className="block text-xs text-fg-muted">
                  {b.direccion}
                  {b.comuna ? `, ${b.comuna}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </BloqueVistaPrevia>

      <BloqueVistaPrevia titulo="Hora de corte">
        <VentanasCorteSeller key={d.id} sellerId={d.id} zonas={d.zonas} />
      </BloqueVistaPrevia>

      {/* Al fondo: es la única acción con consecuencia de la ficha. */}
      {d.membresia ? (
        <BloqueVistaPrevia titulo="Acceso a Rutax">
          <ControlMembresiaAutoservicio
            key={d.id}
            sellerId={d.id}
            razonSocial={d.razonSocial}
            estadoInicial={d.membresia}
          />
        </BloqueVistaPrevia>
      ) : null}
    </>
  );
}

function Pie(d: FichaSeller, cerrar: () => void) {
  return (
    <Button asChild variant="outline" className="min-h-11 w-full lg:min-h-9">
      <EnlaceQueCierra href={`/operaciones?seller=${d.id}`} onCerrar={cerrar}>
        Ver sus pedidos
      </EnlaceQueCierra>
    </Button>
  );
}

export const RENDER_FICHA_SELLER = { encabezado: Encabezado, cuerpo: Cuerpo, pie: Pie };
