import type { Metadata } from "next";

import { formatearCLP } from "@/lib/ui/formato-moneda";

import { PreguntasPagina, Rasgos, Seccion, VerTambien } from "../_componentes/bloques";
import { CalculadoraPrecio } from "../_componentes/calculadora-precio";
import { Cierre, EncabezadoPagina, MarcoSitio } from "../_componentes/sitio";
import { PRECIO_POR_ENVIO_CLP } from "../_lib/precio";

/**
 * `/precios` — el precio publicado, en la unidad que decidió el usuario (por
 * envío, 2026-09-27). Esconder el precio detrás de «contáctanos» le dice a un
 * dueño pyme que va a ser caro; aquí está el número y lo que incluye.
 * El monto sale de `_lib/precio.ts`, el mismo que usa la portada.
 */
export const metadata: Metadata = {
  title: "Precios · Rutax",
  description: `Rutax cuesta ${formatearCLP(PRECIO_POR_ENVIO_CLP)} + IVA por envío procesado. Sin costo de implementación ni licencias por usuario.`,
  alternates: { canonical: "/precios" },
};

const INCLUYE = [
  { titulo: "Pedidos que entran solos", texto: "Mercado Libre y Shopify llegan a un mismo panel, con la dirección lista." },
  { titulo: "App para tus conductores", texto: "Retiro con escaneo, ruta ordenada y entrega con foto y ubicación." },
  { titulo: "Asignación y rutas", texto: "Repartes los pedidos por zona y cada conductor sale con su ruta." },
  { titulo: "Seguimiento", texto: "Tú ves el avance del día y tu cliente ve el estado de sus envíos." },
  { titulo: "Portal para tus clientes", texto: "Sus pedidos, sus entregas y lo que te deben, en un solo lugar." },
  { titulo: "Cobros y liquidaciones", texto: "Cada entrega suma a lo que cobras y a lo que pagas a cada conductor." },
];

const PREGUNTAS = [
  { p: "¿Hay costo de implementación?", r: "No. Tampoco cobramos alta ni licencias por usuario." },
  { p: "¿Qué pasa si un mes reparto menos?", r: "Pagas menos: el cobro es por envío procesado." },
  { p: "¿En qué moneda se paga?", r: "En pesos chilenos, con factura electrónica." },
  { p: "¿Cómo empiezo?", r: "Hablas con un asesor, que crea tu cuenta y te acompaña en la puesta en marcha." },
];

export default function PaginaPrecios() {
  return (
    <MarcoSitio>
      <EncabezadoPagina
        rotulo="Precios"
        titulo="Un precio simple: pagas por envío"
        bajada="Sin costo de implementación ni licencias por usuario. Pagas solo por los envíos que procesas."
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-ctrl border border-line border-t-2 border-t-brand bg-bg-raised px-5 py-6">
            <span className="text-[17px] font-semibold">Por envío</span>
            <span className="flex items-baseline gap-2">
              <span className="rx-num font-mono text-[48px] leading-none font-semibold tracking-tight">
                {formatearCLP(PRECIO_POR_ENVIO_CLP)}
              </span>
              <span className="text-fg-muted">+ IVA</span>
            </span>
          </div>
          <CalculadoraPrecio />
        </div>
      </EncabezadoPagina>

      <Seccion titulo="Todo incluido en el mismo precio" alterna>
        <Rasgos items={INCLUYE} />
      </Seccion>

      <Seccion titulo="Preguntas sobre el precio">
        <PreguntasPagina preguntas={PREGUNTAS} />
      </Seccion>

      <VerTambien
        enlaces={[
          { href: "/cobros-y-liquidaciones", titulo: "Cobros y liquidaciones", texto: "Cómo cada entrega deja listo lo que cobras y lo que pagas." },
          { href: "/integraciones/mercado-libre-flex", titulo: "Mercado Libre Flex", texto: "Tus pedidos Flex, sin digitar una dirección." },
        ]}
      />
      <Cierre />
    </MarcoSitio>
  );
}
