import type { Metadata } from "next";

import { formatearCLP, formatearMiles } from "@/lib/ui/formato-moneda";

import { PreguntasPagina, Rasgos, Seccion, VerTambien } from "../_componentes/bloques";
import { CalculadoraPrecio } from "../_componentes/calculadora-precio";
import { Cierre, EncabezadoPagina, MarcoSitio } from "../_componentes/sitio";
import { TablaTramos } from "../_componentes/tabla-tramos";
import { MINIMO_MENSUAL_CLP, PRECIO_BASE_CLP, PRECIO_MINIMO_CLP, TRAMOS } from "../_lib/precio";

/**
 * `/precios` — el precio publicado: por entrega efectiva, en tramos que bajan con
 * el volumen, con mínimo mensual (decisión del usuario, 2026-09-28). Esconder el
 * precio detrás de «contáctanos» le dice a un dueño pyme que va a ser caro; aquí
 * están los números y lo que incluye. Todo sale de `_lib/precio.ts`.
 */
export const metadata: Metadata = {
  title: "Precios · Rutax",
  description: `Rutax cobra por entrega efectiva: desde ${formatearCLP(PRECIO_BASE_CLP)} hasta ${formatearCLP(PRECIO_MINIMO_CLP)} + IVA según tu volumen, con un mínimo de ${formatearCLP(MINIMO_MENSUAL_CLP)} al mes. Sin costo de implementación.`,
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
  { p: "¿Qué cuenta como entrega?", r: "Solo las entregas efectivas. Si un pedido se cancela o no se entrega, no se cobra." },
  {
    p: "¿Cómo funcionan los tramos?",
    r: `Cada entrega paga el precio del tramo en que cae. Las primeras ${formatearMiles(TRAMOS[0].hasta ?? 0)} del mes van a ${formatearCLP(TRAMOS[0].precio)}, las siguientes a ${formatearCLP(TRAMOS[1].precio)}, y así. Crecer nunca te sale más caro.`,
  },
  { p: "¿Qué pasa si un mes reparto poco?", r: `Pagas por lo que entregas, con un mínimo de ${formatearCLP(MINIMO_MENSUAL_CLP)} al mes.` },
  { p: "¿En qué moneda se paga?", r: "En pesos chilenos, con factura electrónica." },
  { p: "¿Cómo empiezo?", r: "Hablas con un asesor, que crea tu cuenta y te acompaña en la puesta en marcha." },
];

export default function PaginaPrecios() {
  return (
    <MarcoSitio>
      <EncabezadoPagina
        rotulo="Precios"
        titulo="Pagas por entrega, y menos mientras más haces"
        bajada="Sin costo de implementación ni licencias por usuario. Solo se cobran las entregas efectivas."
      >
        <div className="grid gap-4">
          <TablaTramos />
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
