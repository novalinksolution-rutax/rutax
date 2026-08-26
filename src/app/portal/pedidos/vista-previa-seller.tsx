"use client";

/**
 * Vista previa de un pedido — el panel lateral del portal.
 * =============================================================================
 * Mismo gesto que en el listado del courier: se pulsa una fila y el pedido se
 * abre al lado, sin salir de la lista. En teléfono es una hoja inferior.
 *
 * 🔴 **Antes la fila navegaba al detalle.** Para mirar «¿ya llegó?» de tres
 * pedidos había que entrar y volver tres veces, perdiendo el filtro y el sitio
 * de la lista cada vez.
 *
 * ⚠️ **El panel muestra menos que el detalle, y eso es lo correcto.** No es un
 * recorte por espacio: el detalle tiene la foto de la prueba de entrega, la
 * ficha completa y las acciones que no se deshacen. El panel responde la
 * pregunta con la que se abre —«¿en qué va y qué me van a cobrar?»— y el pie
 * lleva al resto.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Camera, CircleAlert, Package } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { PanelAccion } from "@/components/ui/panel-accion";
import { BADGE_ESTADO_PEDIDO } from "@/lib/ui/traduccion-estados";
import { estadoPedidoParaSeller } from "@/lib/ui/vocabulario-portal";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { formatearFechaHora } from "@/lib/formato-cl";
import type { EstadoPedido } from "@/modules/operacion/tipos";
import type { VistaPreviaSeller } from "@/modules/operacion/vista-previa-seller";
import { accionVistaPreviaSeller } from "./accion-vista-previa";

const Ctx = createContext<{ abrir: (id: string) => void } | null>(null);

/** Lo usa cada fila del listado para abrir su pedido. */
export function useVistaPreviaSeller() {
  return useContext(Ctx);
}

export function ProveedorVistaPreviaSeller({ children }: { children: ReactNode }) {
  const [pedidoId, setPedidoId] = useState<string | null>(null);

  return (
    <Ctx.Provider value={{ abrir: setPedidoId }}>
      {children}
      <PanelAccion
        abierto={pedidoId !== null}
        onOpenChange={(a) => {
          if (!a) setPedidoId(null);
        }}
        titulo="Tu pedido"
        subtitulo="En qué va y qué se te cobra."
      >
        {/* `key`: al saltar de una fila a otra el panel se remonta y arranca en
            «cargando», en vez de mostrar los datos del pedido anterior mientras
            llegan los nuevos. */}
        {pedidoId && <Cuerpo key={pedidoId} pedidoId={pedidoId} />}
      </PanelAccion>
    </Ctx.Provider>
  );
}

function Cuerpo({ pedidoId }: { pedidoId: string }) {
  const [estado, setEstado] = useState<
    { fase: "cargando" } | { fase: "falla" } | { fase: "listo"; datos: VistaPreviaSeller }
  >({ fase: "cargando" });

  useEffect(() => {
    let vigente = true;
    void accionVistaPreviaSeller(pedidoId).then(
      (r) => {
        // Si se salta de fila más rápido que la consulta, la respuesta vieja
        // llega después: se descarta en vez de pintar el pedido equivocado.
        if (vigente) setEstado(r.ok ? { fase: "listo", datos: r.datos } : { fase: "falla" });
      },
      () => {
        if (vigente) setEstado({ fase: "falla" });
      },
    );
    return () => {
      vigente = false;
    };
  }, [pedidoId]);

  if (estado.fase === "cargando") {
    return (
      <div className="space-y-3">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-24 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (estado.fase === "falla") {
    return (
      <p role="alert" className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg">
        No pudimos cargar este pedido. Sigue estando en tu lista: lo que falló fue esta ficha.
      </p>
    );
  }

  const d = estado.datos;

  return (
    <div className="space-y-5">
      <div>
        <p className="font-heading text-base font-semibold text-fg">{d.destinatario}</p>
        <p className="rx-num mt-0.5 font-mono text-xs text-fg-muted">
          {d.codigo} · {etiquetaFuentePedido(d.fuente)}
        </p>
        <div className="mt-2">
          <BadgeEstado
            variante={BADGE_ESTADO_PEDIDO[d.estado as EstadoPedido]}
            texto={estadoPedidoParaSeller(d.estado as EstadoPedido)}
            eje="pedido"
            valor={d.estado}
          />
        </div>
      </div>

      {d.incidenciasAbiertas > 0 && (
        /* Lo único accionable del panel va arriba, en tono de atención: si hay
           una incidencia abierta, es lo que trajo al seller acá. */
        <div className="flex items-start gap-2 border border-attention-line bg-attention-bg px-3 py-2 text-sm text-attention-fg">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {d.incidenciasAbiertas === 1
              ? "Tiene un problema reportado."
              : `Tiene ${d.incidenciasAbiertas} problemas reportados.`}{" "}
            <Link href="/portal/incidencias" className="underline">
              Ver mis incidencias
            </Link>
          </span>
        </div>
      )}

      <Bloque titulo="Dónde va">
        <p className="text-sm text-fg">{d.donde.direccion}</p>
        <p className="text-sm text-fg-muted">{d.donde.comuna}</p>
        {d.fechaCompromiso && (
          <p className="rx-num mt-1 font-mono text-xs text-fg-muted">Llega el {d.fechaCompromiso}</p>
        )}
      </Bloque>

      {d.seguimiento.length > 0 && (
        <Bloque titulo="Seguimiento">
          <ul className="space-y-1">
            {d.seguimiento.map((h) => (
              <li key={`${h.texto}-${h.en}`} className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-fg">{h.texto}</span>
                <span className="rx-num shrink-0 font-mono text-xs text-fg-muted">
                  {formatearFechaHora(h.en)}
                </span>
              </li>
            ))}
          </ul>
        </Bloque>
      )}

      <Bloque titulo="Prueba de entrega">
        {d.prueba ? (
          <div className="space-y-1">
            <p className="text-sm text-fg">
              {d.prueba.resultado === "entregado" ? "Entregado" : "No se pudo entregar"}
              {d.prueba.tipoIncidencia ? ` · ${d.prueba.tipoIncidencia}` : ""}
            </p>
            <p className="rx-num font-mono text-xs text-fg-muted">
              {formatearFechaHora(d.prueba.capturadoEn)}
            </p>
            {d.prueba.tieneFoto && (
              /* La foto NO se trae al panel: exige una URL firmada de 15 min por
                 cada apertura, y este panel se abre decenas de veces al día. Se
                 dice que existe y dónde verla. */
              <p className="flex items-center gap-1.5 text-xs text-fg-muted">
                <Camera className="size-3.5 shrink-0" aria-hidden="true" />
                Con foto — se ve en el detalle completo.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">
            Todavía no hay: el conductor la registra al cerrar la parada.
          </p>
        )}
      </Bloque>

      {d.dinero && (
        <Bloque titulo="Lo que te van a cobrar">
          <p className="text-sm text-fg">
            <span className="rx-num font-medium tabular-nums">
              {d.dinero.montoClp !== null ? formatearCLP(d.dinero.montoClp) : "—"}
            </span>
            {d.dinero.periodoEtiqueta && (
              <span className="text-fg-muted"> · período {d.dinero.periodoEtiqueta}</span>
            )}
          </p>
          {/* Nada de lo que se le paga al conductor: es asunto del courier. */}
        </Bloque>
      )}

      <div className="border-t border-line pt-4">
        <Button asChild className="w-full">
          <Link href={`/portal/pedidos/${d.id}`}>Abrir el detalle completo</Link>
        </Button>
        <p className="mt-1.5 text-center text-xs text-fg-subtle">
          La foto de la entrega y el enlace de seguimiento, allá
        </p>
      </div>
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10px] font-medium tracking-[0.12em] text-fg-muted uppercase">
        {titulo}
      </p>
      {children}
    </div>
  );
}

/** El disparador de cada fila. */
export function BotonVerPedido({
  pedidoId,
  destinatario,
  children,
}: {
  pedidoId: string;
  destinatario: string;
  children: ReactNode;
}) {
  const ctx = useVistaPreviaSeller();

  // Sin proveedor arriba no se rompe: cae al enlace de siempre. Es la salida
  // segura para cualquier sitio que reuse la fila sin montar el panel.
  if (!ctx) {
    return (
      <Link href={`/portal/pedidos/${pedidoId}`} className="text-left hover:underline">
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => ctx.abrir(pedidoId)}
      aria-label={`Ver ${destinatario}`}
      className="cursor-pointer text-left hover:underline"
    >
      <Package className="mr-1 inline size-3.5 align-[-2px] text-fg-subtle" aria-hidden="true" />
      {children}
    </button>
  );
}
