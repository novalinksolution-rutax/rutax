import type { Metadata } from "next";
import { CheckIcon } from "lucide-react";

import { DistintivoEstado } from "@/components/ui/distintivo-estado";

import { Maqueta, Pasos, PreguntasPagina, Rasgos, Seccion, VerTambien } from "../../_componentes/bloques";
import { Cierre, EncabezadoPagina, MarcoSitio } from "../../_componentes/sitio";

/**
 * `/integraciones/mercado-libre-flex` — probablemente la página de mayor retorno
 * del sitio (búsqueda concreta: «mercado libre flex courier»).
 *
 * La objeción número uno va de frente y sin tecnicismos: en Flex la confirmación
 * oficial de la entrega sigue siendo la de Mercado Libre (restricción dura del
 * producto, CLAUDE.md). Rutax ordena todo lo demás.
 */
export const metadata: Metadata = {
  title: "Mercado Libre Flex para couriers · pedidos automáticos · Rutax",
  description:
    "Los pedidos Flex de tus clientes entran solos a tu operación, con la dirección lista. Asigna, sal a repartir y cobra sin digitar nada.",
  alternates: { canonical: "/integraciones/mercado-libre-flex" },
};

const CAMPOS = ["Destinatario", "Dirección ubicada en el mapa", "Comuna", "Fecha comprometida", "Cuenta de origen"];

export default function PaginaFlex() {
  return (
    <MarcoSitio>
      <EncabezadoPagina
        rotulo="Integración · Mercado Libre Flex"
        titulo="Tus pedidos de Mercado Libre Flex, sin digitar nada"
        bajada="Tus clientes conectan su cuenta una vez. Desde ahí, cada venta Flex llega a tu operación con la dirección lista para repartir."
      >
        <Maqueta titulo="Pedido nuevo">
          <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-4 py-3.5">
            <span className="flex items-center gap-2 text-[15px] font-semibold">
              <span className="inline-block size-2.5 rounded-full bg-[#FFE600]" aria-hidden="true" />
              Mercado Libre Flex
            </span>
            <DistintivoEstado tono="neutral" etiqueta="Sin asignar" />
          </div>
          <ul className="m-0 list-none p-0">
            {CAMPOS.map((c) => (
              <li key={c} className="flex min-h-11 items-center justify-between gap-3 border-b border-line-subtle px-4 text-[14.5px] last:border-b-0">
                {c}
                <span className="grid size-5 place-items-center rounded-full bg-accent-deep text-accent-text" aria-label="Llega solo">
                  <CheckIcon className="size-3.5" aria-hidden="true" />
                </span>
              </li>
            ))}
          </ul>
        </Maqueta>
      </EncabezadoPagina>

      <Seccion titulo="Cómo funciona" bajada="Tu cliente lo conecta una vez y no vuelve a pensar en ello." alterna>
        <Pasos
          pasos={[
            { titulo: "Tu cliente conecta su cuenta", texto: "Autoriza a Rutax desde Mercado Libre, en un par de clics." },
            { titulo: "Los pedidos llegan solos", texto: "Cada venta Flex entra con su dirección ubicada en el mapa." },
            { titulo: "Asignas y sales a repartir", texto: "Repartes por zona y cada conductor recibe su ruta ordenada." },
          ]}
        />
      </Seccion>

      <Seccion titulo="Lo que resuelve">
        <Rasgos
          items={[
            { titulo: "Cero direcciones a mano", texto: "Nadie vuelve a escribir una dirección en otra app para armar la ruta." },
            { titulo: "Varias cuentas por cliente", texto: "Un cliente puede conectar hasta 10 cuentas de Mercado Libre." },
            { titulo: "Cancelaciones a la vista", texto: "Si una venta se cancela, lo ves en Rutax antes de salir a repartir." },
            { titulo: "Retiro con escaneo", texto: "Tus conductores escanean la etiqueta de cada paquete en la bodega de tu cliente." },
            { titulo: "Todo en un panel", texto: "Flex convive con tus pedidos del día y con Shopify, en la misma pantalla." },
            { titulo: "Cobro de cada entrega", texto: "Cada entrega suma a lo que le cobras a tu cliente, sin planillas." },
          ]}
        />
      </Seccion>

      <Seccion titulo="Preguntas frecuentes" alterna>
        <PreguntasPagina
          preguntas={[
            {
              p: "¿Mis conductores siguen usando la app de Mercado Libre?",
              r: "Sí. En Flex, la confirmación oficial de la entrega sigue siendo la de Mercado Libre. Rutax ordena todo lo demás: retiro, asignación, ruta y cobros.",
            },
            { p: "¿Qué tiene que hacer mi cliente?", r: "Conectar su cuenta de Mercado Libre desde su portal, una sola vez." },
            { p: "¿Cada cuánto llegan los pedidos?", r: "Durante todo el día, a medida que tu cliente vende. También puede sincronizar en el momento." },
            { p: "¿Qué pasa si una cuenta se desconecta?", r: "Lo ves en Rutax, y tu cliente la vuelve a conectar desde su portal." },
          ]}
        />
      </Seccion>

      <VerTambien
        enlaces={[
          { href: "/integraciones/shopify", titulo: "Shopify", texto: "Los pedidos de las tiendas de tus clientes, directo a tu operación." },
          { href: "/cobros-y-liquidaciones", titulo: "Cobros y liquidaciones", texto: "Cada entrega deja listo lo que cobras y lo que pagas." },
        ]}
      />
      <Cierre titulo="Deja de digitar direcciones" />
    </MarcoSitio>
  );
}
