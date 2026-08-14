/**
 * Tarjeta de una visita a bodega — Server Component. El único hijo de cliente
 * es `RelojVisita` (visitas abiertas); todo lo demás se calcula acá, en el
 * servidor, en cada render.
 *
 * Vivos vs. acta (§7): una visita ABIERTA solo muestra "vivos" — la palabra
 * "acta" nunca se usa para una visita abierta, porque no existe todavía. Una
 * visita CERRADA muestra el acta como cifra principal, y si el conteo vivo
 * (que se sigue calculando en caliente) superó al acta congelada —un escaneo
 * que llegó después del cierre—, se agrega una línea aparte, en tono NEUTRO:
 * no es un descuadre, es comportamiento esperado del sistema.
 *
 * NINGÚN dato personal del destinatario en esta tarjeta: ni nombre, ni
 * dirección, ni teléfono — solo comuna de la bodega y nombres de
 * conductor/seller/bodega, que son datos operativos del courier.
 */

import type { VisitaRetiroResumenCourier } from "@/modules/operacion/retiro/preparacion";
import { textoCerradaA } from "../_lib/reloj-inactividad";
import { pluralizar } from "../_lib/estado-preparacion";
import { RelojVisita } from "./reloj-visita";

export function TarjetaVisita({ visita }: { visita: VisitaRetiroResumenCourier }) {
  const cerrada = visita.estado === "cerrada";
  const ubicacion = [visita.bodega.nombre, visita.bodega.comuna].filter(Boolean).join(" · ");
  // Solo cuando el acta ya existe Y el conteo vivo (que sigue en caliente)
  // superó lo congelado: la cola sin conexión de la app drenando después del
  // cierre. Nunca se reescribe el número del acta ni se suma un total ad-hoc.
  const escaneadosDespuesDeCerrar =
    cerrada && visita.acta ? Math.max(0, visita.vivos.total - visita.acta.total) : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-xs">
      <p className="text-sm font-medium">{visita.conductor.nombre ?? "Conductor sin nombre"}</p>
      {ubicacion ? <p className="mt-0.5 text-xs text-muted-foreground">{ubicacion}</p> : null}
      {visita.seller.nombre ? (
        <p className="text-xs text-muted-foreground">{visita.seller.nombre}</p>
      ) : null}

      <div className="mt-2 space-y-1">
        {cerrada ? (
          <>
            <p className="text-sm font-medium tabular-nums">
              Acta: {visita.acta?.total ?? 0} {pluralizar(visita.acta?.total ?? 0, "bulto", "bultos")}
            </p>
            {visita.acta && visita.acta.sinResolver > 0 ? (
              <p className="text-xs text-muted-foreground">{visita.acta.sinResolver} sin pedido</p>
            ) : null}
            {visita.cerradaEn ? (
              <p className="text-xs text-muted-foreground">{textoCerradaA(visita.cerradaEn)}</p>
            ) : null}
            {escaneadosDespuesDeCerrar > 0 ? (
              <p className="text-xs text-muted-foreground">
                + {escaneadosDespuesDeCerrar}{" "}
                {pluralizar(escaneadosDespuesDeCerrar, "escaneado", "escaneados")} después de cerrar · no se
                suman al acta
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-sm font-medium tabular-nums">
              {visita.vivos.total} {pluralizar(visita.vivos.total, "escaneado", "escaneados")}
            </p>
            {visita.vivos.sinResolver > 0 ? (
              <p className="text-xs text-muted-foreground">{visita.vivos.sinResolver} sin pedido</p>
            ) : null}
            <RelojVisita ultimoEscaneoEn={visita.ultimoEscaneoEn} abiertaEn={visita.abiertaEn} />
          </>
        )}

        {visita.bultosDeOtroSeller > 0 ? (
          <p className="text-xs text-muted-foreground">
            {visita.bultosDeOtroSeller}{" "}
            {pluralizar(visita.bultosDeOtroSeller, "bulto de otro seller", "bultos de otro seller")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
