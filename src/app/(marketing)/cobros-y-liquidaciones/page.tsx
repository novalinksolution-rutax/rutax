import type { Metadata } from "next";

import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { formatearCLP } from "@/lib/ui/formato-moneda";

import { Maqueta, Pasos, PreguntasPagina, Rasgos, Seccion, VerTambien } from "../_componentes/bloques";
import { Cierre, EncabezadoPagina, MarcoSitio } from "../_componentes/sitio";

/**
 * `/cobros-y-liquidaciones` — el motor entrega→dinero, contado para el dueño.
 *
 * ⚠️ Lo que NO se promete aquí, a propósito: la emisión de factura electrónica
 * ante el SII. Hoy corre en simulación y se habilita por courier con revisión
 * (ver CLAUDE.md, «Adaptador DTE en modo sandbox»). La página habla del cierre
 * del período y del detalle que queda listo, no de folios emitidos.
 */
export const metadata: Metadata = {
  title: "Cobros a sellers y liquidación de conductores · Rutax",
  description:
    "Cada entrega suma a lo que le cobras a tu cliente y a lo que le pagas a tu conductor. A fin de mes revisas, cierras y listo.",
  alternates: { canonical: "/cobros-y-liquidaciones" },
};

const LINEAS = [
  { quien: "Cobro a tu cliente", detalle: "Tienda Ñuñoa · tarifa por comuna", monto: 2900 },
  { quien: "Pago al conductor", detalle: "Camila · entrega", monto: 1450 },
];

export default function PaginaCobros() {
  return (
    <MarcoSitio>
      <EncabezadoPagina
        rotulo="Cobros y liquidaciones"
        titulo="Cada entrega deja listo lo que cobras y lo que pagas"
        bajada="Rutax anota el cobro a tu cliente y el pago a tu conductor en el momento de la entrega. A fin de mes no sumas: revisas y cierras."
      >
        <Maqueta titulo="Una entrega, dos cuentas">
          <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-4 py-3.5">
            <span className="text-[15px] font-semibold">Entrega en Ñuñoa</span>
            <DistintivoEstado tono="balanced" etiqueta="Entregado" />
          </div>
          <div className="grid sm:grid-cols-2">
            {LINEAS.map((l, i) => (
              <div key={l.quien} className={i === 1 ? "border-t border-line-subtle sm:border-t-0 sm:border-l" : ""}>
                <div className="grid gap-1 px-4 py-4">
                  <span className="font-mono text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase">{l.quien}</span>
                  <span className="rx-num font-mono text-[28px] leading-none font-semibold tracking-tight">{formatearCLP(l.monto)}</span>
                  <span className="text-[13px] text-fg-muted">{l.detalle}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line-subtle bg-bg-sunken px-4 py-3 text-[13px] text-fg-muted">
            <DistintivoEstado tono="balanced" etiqueta="Cuadradas" />
            <span>Período de septiembre</span>
          </div>
        </Maqueta>
      </EncabezadoPagina>

      <Seccion titulo="Cómo funciona" bajada="Sin planillas en el medio." alterna>
        <Pasos
          pasos={[
            { titulo: "Defines tus tarifas", texto: "Lo que cobras a cada cliente y lo que pagas a tus conductores, por zona." },
            { titulo: "Tus conductores entregan", texto: "Cada entrega confirmada suma a las dos cuentas, sola." },
            { titulo: "Revisas lo que no cuadra", texto: "Si algo no calza, aparece para que lo resuelvas antes de cerrar." },
            { titulo: "Cierras el mes", texto: "Queda el detalle de cada cliente y la liquidación de cada conductor." },
          ]}
        />
      </Seccion>

      <Seccion titulo="Lo que cambia en tu fin de mes">
        <Rasgos
          items={[
            { titulo: "Cobros a tus clientes", texto: "Cada cliente acumula sus entregas con su tarifa. Lo ve en su portal, al día." },
            { titulo: "Pago a tus conductores", texto: "Entregas y retiros suman a su liquidación. El conductor la ve en su app." },
            { titulo: "Cuentas que cuadran", texto: "Una entrega sin cobro o un pago de más salta a la vista antes de cerrar." },
            { titulo: "Ajustes con su motivo", texto: "Descuentos y bonos quedan anotados, con quién los hizo y por qué." },
            { titulo: "Todo con respaldo", texto: "Cada monto se puede rastrear hasta la entrega que lo generó." },
            { titulo: "En pesos chilenos", texto: "Montos en CLP, fechas de Santiago y datos de tus clientes con su RUT." },
          ]}
        />
      </Seccion>

      <Seccion titulo="Preguntas frecuentes" alterna>
        <PreguntasPagina
          preguntas={[
            { p: "¿Tengo que dejar mi planilla?", r: "No de un día para otro. Puedes comparar los dos cierres hasta que confíes en el de Rutax." },
            { p: "¿Puedo tener tarifas distintas por cliente?", r: "Sí. Cada cliente tiene las suyas, por zona." },
            { p: "¿Los retiros también se pagan?", r: "Sí. Además de sus entregas, tus conductores suman por cada visita a bodega." },
            { p: "¿Mis conductores ven lo que van a recibir?", r: "Sí, en su app." },
          ]}
        />
      </Seccion>

      <VerTambien
        enlaces={[
          { href: "/precios", titulo: "Precios", texto: "Un precio simple, por envío procesado." },
          { href: "/integraciones/mercado-libre-flex", titulo: "Mercado Libre Flex", texto: "Tus pedidos Flex, sin digitar una dirección." },
        ]}
      />
      <Cierre titulo="Cierra el mes sin sumar a mano" />
    </MarcoSitio>
  );
}
