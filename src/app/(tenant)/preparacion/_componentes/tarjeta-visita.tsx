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
import { DistintivoEstado } from "@/components/ui/distintivo-estado";

export function TarjetaVisita({
  visita,
  esperados,
}: {
  visita: VisitaRetiroResumenCourier;
  /** Bultos que se esperan de este seller hoy. `null` si no se pudo saber. */
  esperados?: number | null;
}) {
  const cerrada = visita.estado === "cerrada";
  const ubicacion = [visita.bodega.nombre, visita.bodega.comuna].filter(Boolean).join(" · ");
  // Solo cuando el acta ya existe Y el conteo vivo (que sigue en caliente)
  // superó lo congelado: la cola sin conexión de la app drenando después del
  // cierre. Nunca se reescribe el número del acta ni se suma un total ad-hoc.
  const escaneadosDespuesDeCerrar =
    cerrada && visita.acta ? Math.max(0, visita.vivos.total - visita.acta.total) : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-xs">
      {/* ⚠️ La jerarquía es SELLER · BODEGA arriba y conductor debajo, no al
          revés. La visita es a una bodega: el coordinador busca «¿ya llegó lo de
          Vega Norte?», no «¿dónde anda Muñoz?» — para eso está la Torre. Poner
          el conductor de título hacía que dos visitas al mismo seller se vieran
          como cosas distintas y dos visitas del mismo conductor como la misma. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {visita.seller.nombre ?? "Seller sin nombre"}
            {ubicacion ? (
              <span className="font-normal text-muted-foreground"> · {ubicacion}</span>
            ) : null}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {visita.conductor.nombre ?? "Conductor sin nombre"}
          </p>
        </div>
        {/* El estado, dicho. Antes había que deducirlo de si la cifra decía
            «escaneados» o «Acta». */}
        <DistintivoEstado
          tono={cerrada ? "neutral" : "progress"}
          etiqueta={cerrada ? "Cerrada" : "Abierta"}
          className="shrink-0"
        />
      </div>

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
              {visita.vivos.total}
              {/* El denominador convierte el conteo en una conciliación: sin él
                  «42 escaneados» no dice si falta la mitad o dos bultos. */}
              {esperados != null && esperados > 0 ? (
                <span className="font-normal text-muted-foreground"> de ~{esperados}</span>
              ) : null}{" "}
              {pluralizar(visita.vivos.total, "escaneado", "escaneados")}
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
