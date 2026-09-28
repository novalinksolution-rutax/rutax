import type { Metadata } from "next";

import { DistintivoEstado } from "@/components/ui/distintivo-estado";

import { Maqueta, Pasos, PreguntasPagina, Rasgos, Seccion, VerTambien } from "../../_componentes/bloques";
import { Cierre, EncabezadoPagina, MarcoSitio } from "../../_componentes/sitio";

/**
 * `/integraciones/shopify` — el courier cuyos clientes venden en su propia tienda.
 *
 * Hechos que sostienen el copy (CLAUDE.md, «Shopify»): la tienda se conecta
 * pegando el dominio y una clave de acceso (sin OAuth), los pedidos se leen cada
 * pocos minutos, en Shopify la prueba de entrega de Rutax es la autoritativa, y
 * al entregar Rutax marca el pedido como cumplido en la tienda, con su
 * seguimiento (`jobs/marcar-cumplido-shopify.ts`).
 */
export const metadata: Metadata = {
  title: "Shopify para couriers · recibe los pedidos de tus clientes · Rutax",
  description:
    "Tu cliente conecta su tienda Shopify en minutos y sus pedidos llegan solos a tu operación, con la dirección lista. Sin digitar nada.",
  alternates: { canonical: "/integraciones/shopify" },
};

export default function PaginaShopify() {
  return (
    <MarcoSitio>
      <EncabezadoPagina
        rotulo="Integración · Shopify"
        titulo="Los pedidos de Shopify de tus clientes, directo a tu operación"
        bajada="Tu cliente conecta su tienda en minutos y sus pedidos llegan solos, listos para asignar y repartir."
      >
        <Maqueta titulo="Conectar tienda">
          <div className="grid gap-4 p-4">
            <div className="grid gap-1.5">
              <span className="text-[13px] font-semibold">Dirección de la tienda</span>
              <span className="flex min-h-11 items-center rounded-ctrl border border-line bg-bg px-3 font-mono text-[13.5px]">
                tutienda.myshopify.com
              </span>
            </div>
            <div className="grid gap-1.5">
              <span className="text-[13px] font-semibold">Clave de acceso</span>
              <span className="flex min-h-11 items-center rounded-ctrl border border-line bg-bg px-3 font-mono text-[13.5px] tracking-[0.2em]">
                ••••••••••••
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line-subtle bg-bg-sunken px-4 py-3">
            <span className="flex items-center gap-2 text-[14px] font-semibold">
              <span className="inline-block size-2.5 rounded-full bg-[#95BF47]" aria-hidden="true" />
              Shopify
            </span>
            <DistintivoEstado tono="balanced" etiqueta="Conectada" />
          </div>
        </Maqueta>
      </EncabezadoPagina>

      <Seccion titulo="Cómo funciona" bajada="Tu cliente lo hace solo, desde su portal." alterna>
        <Pasos
          pasos={[
            { titulo: "Tu cliente conecta su tienda", texto: "Pega la dirección de su tienda y una clave que saca de su panel de Shopify." },
            { titulo: "Los pedidos llegan solos", texto: "Cada pocos minutos, con la dirección ubicada en el mapa." },
            { titulo: "Entregas con evidencia", texto: "Tu conductor confirma con foto y ubicación en la app." },
            { titulo: "La tienda se actualiza", texto: "Al entregar, el pedido queda cumplido en la tienda, con su seguimiento." },
          ]}
        />
      </Seccion>

      <Seccion titulo="Lo que resuelve">
        <Rasgos
          items={[
            { titulo: "Sin copiar pedidos", texto: "Nada de exportar planillas desde la tienda ni reescribir direcciones." },
            { titulo: "Una sola app", texto: "En Shopify, la entrega que registra tu conductor en Rutax es la confirmación final." },
            { titulo: "Seguimiento para el comprador", texto: "Cada pedido tiene su página de seguimiento para compartir." },
            { titulo: "Junto a tus otros pedidos", texto: "Shopify convive con Mercado Libre y tus pedidos del día en el mismo panel." },
          ]}
        />
      </Seccion>

      <Seccion titulo="Preguntas frecuentes" alterna>
        <PreguntasPagina
          preguntas={[
            { p: "¿Mi cliente necesita instalar una app en su tienda?", r: "No. Conecta su tienda pegando la dirección y una clave de acceso desde su panel." },
            { p: "¿Qué pedidos llegan?", r: "Los que tu cliente vende con despacho, listos para retirar y repartir." },
            { p: "¿Se actualiza el pedido en Shopify?", r: "Sí. Al entregarlo queda cumplido en la tienda, con su seguimiento, y Shopify avisa al comprador." },
          ]}
        />
      </Seccion>

      <VerTambien
        enlaces={[
          { href: "/integraciones/mercado-libre-flex", titulo: "Mercado Libre Flex", texto: "Tus pedidos Flex, sin digitar una dirección." },
          { href: "/cobros-y-liquidaciones", titulo: "Cobros y liquidaciones", texto: "Cada entrega deja listo lo que cobras y lo que pagas." },
        ]}
      />
      <Cierre titulo="Suma las tiendas de tus clientes" />
    </MarcoSitio>
  );
}
