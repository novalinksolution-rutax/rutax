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
import { BotonSincronizarCuenta } from "./boton-sincronizar-cuenta";
import { VentanasCorteSeller } from "./_ficha/ventanas-corte-seller";
import { MenuSeller } from "./menu-seller";

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
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-heading text-lg font-semibold">{d.razonSocial}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2">
          <span className="rx-num text-xs text-fg-muted">{d.rut}</span>
          {d.estado !== "activo" ? (
            <BadgeEstado
              variante={BADGE_ESTADO_SELLER[d.estado as EstadoSeller] ?? "neutral"}
              eje="seller"
              valor={d.estado}
              texto={traducirEstadoSeller(d.estado)}
            />
          ) : null}
        </p>
      </div>
      <MenuSeller
        enFicha
        puedeSincronizar={d.puedeSincronizar}
        puedeInvitar={d.puedeInvitar}
        seller={{
          id: d.id,
          razonSocial: d.razonSocial,
          cuentasMl: d.cuentas
            .filter((c) => c.tipo === "ml" && !c.apagadaPorSeller)
            .map((c) => ({ id: c.id, etiqueta: c.nombre })),
          invitacionPendiente: d.invitacionPendiente,
          membresia: d.membresia,
        }}
      />
    </div>
  );
}

/** Una sección de la ficha: recuadro con título y, si hace falta, su acción. */
function Tarjeta({
  titulo,
  accion,
  children,
}: {
  titulo: string;
  accion?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-line bg-bg-raised">
      <div className="flex min-h-10 items-center justify-between gap-2 border-b border-line-subtle px-3">
        <h3 className="text-sm font-medium text-fg">{titulo}</h3>
        {accion}
      </div>
      <div className="px-3 py-2.5">{children}</div>
    </section>
  );
}

function Cifra({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <p className="text-[10px] font-medium tracking-[0.1em] text-fg-muted uppercase">{rotulo}</p>
      <p className="rx-num mt-1 truncate text-lg font-semibold text-fg">{children}</p>
    </div>
  );
}

function Vacio({ children }: { children: ReactNode }) {
  return <p className="text-sm text-fg-muted">{children}</p>;
}

function Cuerpo(d: FichaSeller) {
  const hayBotonSincronizar =
    d.puedeSincronizar && d.cuentas.some((c) => c.tipo === "ml" && !c.apagadaPorSeller);
  return (
    <div className="space-y-3">
      {/* Las tres cifras que responden «cuánto pesa este seller hoy». */}
      <div className="grid grid-cols-3 divide-x divide-line rounded-md border border-line bg-bg-raised">
        <Cifra rotulo="Hoy">{d.hayMetricas ? d.pedidosHoy : "—"}</Cifra>
        <Cifra rotulo="Por semana">{d.hayMetricas ? `~${Math.round(d.promedioSemanal)}` : "—"}</Cifra>
        <Cifra rotulo="Por cobrar">
          {d.hayDinero ? formatearCLPOGuion(d.periodoVivoClp) : "—"}
        </Cifra>
      </div>

      {d.nombreContacto || d.emailContacto ? (
        <Tarjeta titulo="Contacto">
          {d.nombreContacto ? <p className="text-sm text-fg">{d.nombreContacto}</p> : null}
          {d.emailContacto ? (
            <a
              href={`mailto:${d.emailContacto}`}
              className="flex min-h-11 items-center text-sm break-all text-accent-text hover:underline lg:min-h-0"
            >
              {d.emailContacto}
            </a>
          ) : null}
        </Tarjeta>
      ) : null}

      <Tarjeta titulo="Cuentas de pedidos">
        {d.cuentas.length === 0 ? (
          <Vacio>Sin cuentas conectadas.</Vacio>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {d.cuentas.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1">
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
                ) : (
                  <BadgeEstado
                    variante={BADGE_SALUD_CONEXION[c.estadoSalud as EstadoSaludConexion] ?? "neutral"}
                    eje="conexion"
                    valor={c.estadoSalud}
                    texto={c.estadoSalud === "sana" ? "Conectada" : traducirSaludConexion(c.estadoSalud)}
                  />
                )}
                {/* Por cuenta: la sincronización es de UNA conexión. Solo ML
                    (Shopify barre sola cada 15 min) y no la que apagó el seller. */}
                {d.puedeSincronizar && c.tipo === "ml" && !c.apagadaPorSeller ? (
                  <BotonSincronizarCuenta conexionId={c.id} etiqueta={c.nombre} />
                ) : hayBotonSincronizar ? (
                  // Mismo ancho que el botón: que los estados queden en columna.
                  <span className="size-11 shrink-0 md:size-8" aria-hidden="true" />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta titulo="Tarifa">
        {d.tarifas.length === 0 ? (
          <Vacio>La general del courier.</Vacio>
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
      </Tarjeta>

      {d.periodos.length > 0 ? (
        <Tarjeta titulo="Períodos">
          <ul className="divide-y divide-line-subtle">
            {d.periodos.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <Link
                  href={`/dinero/periodos/${p.id}`}
                  className="flex min-h-11 items-center text-sm hover:underline lg:min-h-9"
                >
                  {p.etiqueta}
                </Link>
                <span className="flex items-center gap-2">
                  <span className="rx-num text-sm text-fg-muted">{formatearCLPOGuion(p.montoClp)}</span>
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
        </Tarjeta>
      ) : null}

      <Tarjeta titulo="Bodegas">
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
      </Tarjeta>

      <Tarjeta titulo="Hora de corte">
        <VentanasCorteSeller key={d.id} sellerId={d.id} zonas={d.zonas} />
      </Tarjeta>
    </div>
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
