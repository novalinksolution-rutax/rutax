import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { cn } from "@/lib/utils";

import { CalculadoraPrecio } from "./_componentes/calculadora-precio";
import { Cabeza, Cierre, ENVOLTURA, MarcoSitio } from "./_componentes/sitio";
import { BotonVentas } from "./_componentes/ventas";
import { FlujoOperativo } from "./_componentes/flujo-operativo";
import { PRECIO_POR_ENVIO_CLP } from "./_lib/precio";

/**
 * La portada de Rutax — sitio v2 (2026-09-27).
 * =============================================================================
 *
 * Calca la ESTRUCTURA y el relato de rushmile.app —hero · beneficios · cómo
 * funciona · precios · preguntas · cierre— con copy propio y la identidad de
 * Rutax. Maqueta aprobada: https://claude.ai/artifact/3rBPrCvWSryJMVndfwnYnY.
 *
 * Decisiones del usuario que la gobiernan:
 * · **Precio público y por envío**: $120 + IVA, único (`_lib/precio.ts`).
 * · **«Comenzar» abre al asesor**, no un autoregistro: el alta de un courier la
 *   hace Rutax desde el backstage. Los tres botones abren el mismo modal.
 * · **WhatsApp de ventas propio**, distinto del número de avisos de la Cloud API.
 *
 * El encabezado, el cierre y el pie viven en `_componentes/sitio.tsx`, compartidos
 * con las páginas de producto.
 */
export function Portada() {
  return (
    <MarcoSitio>
      <Hero />
      <Beneficios />
      <ComoFunciona />
      <Precios />
      <Preguntas />
      <Cierre />
    </MarcoSitio>
  );
}

/* ─── Hero ─────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="py-11 sm:py-[clamp(44px,7vw,88px)]">
      <div
        className={cn(
          ENVOLTURA,
          "grid items-center gap-9 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14"
        )}
      >
        <div>
          <h1 className="text-[36px] leading-[1.06] font-bold tracking-[-0.036em] text-balance sm:text-[50px]">
            Tu operación de reparto, <span className="text-accent-text">de la colecta a la entrega.</span>
          </h1>
          <p className="mt-5 max-w-[42ch] text-lg text-fg-muted">
            Recibe los pedidos de las tiendas de tus clientes y gestiona el retiro, las rutas y
            las entregas desde un solo lugar.
          </p>
          <p className="mt-3 max-w-[42ch] text-lg text-fg-muted">
            Súmate a Rutax y haz crecer tu operación.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <BotonVentas motivo="comenzar">Comenzar</BotonVentas>
            <BotonVentas motivo="demo" variante="secundario">
              Agendar demo
            </BotonVentas>
          </div>
        </div>
        <FlujoOperativo />
      </div>
    </section>
  );
}

/* ─── Beneficios ───────────────────────────────────────────────────────── */

const BENEFICIOS = [
  {
    titulo: "Escaneo rápido",
    texto: "Nuestra app escanea cada paquete en segundos para que el retiro no se atrase.",
  },
  {
    titulo: "Pedidos centralizados",
    texto: "Los pedidos de las tiendas online de tus clientes llegan solos a un mismo lugar.",
  },
  {
    titulo: "Colectas",
    texto: "Sabe en todo momento cuántos paquetes se retiraron en cada tienda.",
  },
  {
    titulo: "Finanzas",
    texto: "Calcula el pago de cada repartidor según sus entregas, zonas y retiros.",
  },
  {
    titulo: "Sin costos de implementación",
    texto: "Sin cobro de alta ni licencias por usuario. Pagas solo por lo que usas.",
  },
  {
    titulo: "Cuenta corriente",
    texto: "Tus clientes ven el detalle de sus envíos entregados y lo que consumen, en pesos.",
  },
];

function Beneficios() {
  return (
    <section id="beneficios" className="scroll-mt-16 py-[clamp(60px,8vw,104px)]">
      <div className={ENVOLTURA}>
        <Cabeza
          titulo="Beneficios para tu negocio"
          bajada="Lo que cambia cuando tu operación corre en Rutax."
        />
        <div className="grid border-t-2 border-line-strong sm:grid-cols-2 lg:grid-cols-3">
          {BENEFICIOS.map((b, i) => (
            <article
              key={b.titulo}
              className={cn(
                "grid content-start gap-2.5 border-b border-line-subtle py-6 sm:pr-6",
                // Regla vertical entre columnas: 2 por fila en tablet, 3 en escritorio.
                i % 2 === 1 && "sm:max-lg:border-l sm:max-lg:border-line-subtle sm:max-lg:pl-6",
                i % 3 !== 0 && "lg:border-l lg:border-line-subtle lg:pl-6"
              )}
            >
              <h3 className="text-[19px] font-bold tracking-[-0.018em]">{b.titulo}</h3>
              <p className="text-[15px] text-fg-muted">{b.texto}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Cómo funciona ────────────────────────────────────────────────────── */

const PASOS = [
  {
    titulo: "Habla con un asesor",
    texto: "Te acompaña en la contratación y deja tu cuenta lista para trabajar.",
  },
  { titulo: "Configura tu cuenta", texto: "Define tus zonas, tarifas, repartidores y usuarios." },
  {
    titulo: "Conecta a tus clientes",
    texto: "Invítalos a vincular sus tiendas de Mercado Libre y Shopify.",
  },
  { titulo: "Empieza a operar", texto: "Todo listo para despachar desde el primer día." },
];

function ComoFunciona() {
  return (
    <section
      id="como-funciona"
      className="scroll-mt-16 border-y border-line-subtle bg-bg-raised py-[clamp(60px,8vw,104px)]"
    >
      <div className={ENVOLTURA}>
        <Cabeza titulo="¿Cómo funciona?" bajada="Empieza a operar en cuatro pasos simples." />
        <ol className="grid gap-y-9 border-t border-line sm:grid-cols-2 lg:grid-cols-4">
          {PASOS.map((p, i) => (
            <li key={p.titulo} className="relative grid content-start gap-2 pt-5 pr-5">
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -top-px left-0 h-0.5 w-9",
                  i === PASOS.length - 1 ? "bg-brand" : "bg-line-strong"
                )}
              />
              <span className="rx-num font-mono text-[13px] font-semibold text-fg-muted">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="text-[19px] font-bold tracking-[-0.018em]">{p.titulo}</h3>
              <p className="text-[15px] text-fg-muted">{p.texto}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ─── Precios ──────────────────────────────────────────────────────────── */

function Precios() {
  return (
    <section id="precios" className="scroll-mt-16 py-[clamp(60px,8vw,104px)]">
      <div className={ENVOLTURA}>
        <Cabeza
          titulo="Plan de precios"
          bajada="Implementación sin costo. Cobramos por envío procesado."
        />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-ctrl border border-line bg-bg-raised px-5 py-6">
            <span className="text-[17px] font-semibold">Por envío</span>
            <span className="flex items-baseline gap-2">
              <span className="rx-num font-mono text-[44px] leading-none font-semibold tracking-tight">
                {formatearCLP(PRECIO_POR_ENVIO_CLP)}
              </span>
              <span className="text-fg-muted">+ IVA</span>
            </span>
          </div>
          <CalculadoraPrecio />
        </div>
      </div>
    </section>
  );
}

/* ─── Preguntas ────────────────────────────────────────────────────────── */

// Solo lo que Rutax hace hoy: no hay carga masiva ni API pública activa, así que
// ninguna respuesta las promete aunque la referencia sí las mencione.
const PREGUNTAS = [
  {
    p: "¿Qué integraciones ofrecen?",
    r: "Nos conectamos con Mercado Libre y con las principales plataformas de comercio electrónico, como Shopify.",
  },
  {
    p: "¿Cómo cargo mis envíos?",
    r: "Puedes crearlos a mano o dejar que lleguen solos desde las tiendas online de tus clientes.",
  },
  {
    p: "¿Cómo sigo el estado de mis envíos?",
    r: "Desde un panel ves en tiempo real el estado de cada envío y el avance de tu operación.",
  },
  {
    p: "¿Qué aplicaciones incluye el servicio?",
    r: "Una app móvil para tus repartidores y una plataforma web para tu equipo y tus clientes.",
  },
  {
    p: "¿En qué moneda se paga el servicio?",
    r: "En pesos chilenos, con factura electrónica.",
  },
  {
    p: "¿Para quién está pensado el servicio?",
    r: "Para empresas de última milla que quieren profesionalizar su operación y manejar con eficiencia los envíos de comercio electrónico, tiendas online y entregas en el día.",
  },
];

function Preguntas() {
  return (
    <section
      id="preguntas"
      className="scroll-mt-16 border-y border-line-subtle bg-bg-raised py-[clamp(60px,8vw,104px)]"
    >
      <div
        className={cn(
          ENVOLTURA,
          "grid gap-7 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-20"
        )}
      >
        <div className="grid content-start gap-3">
          <h2 className="text-[28px] leading-[1.12] font-bold tracking-[-0.03em] sm:text-[40px]">
            Preguntas frecuentes
          </h2>
          <p className="text-[17px] text-fg-muted">Respuestas a lo que más nos preguntan.</p>
        </div>
        <Accordion
          type="single"
          collapsible
          defaultValue={PREGUNTAS[0]?.p}
          className="border-t-2 border-line-strong"
        >
          {PREGUNTAS.map((q) => (
            <AccordionItem key={q.p} value={q.p}>
              <AccordionTrigger className="min-h-16 text-[17px] font-semibold">
                {q.p}
              </AccordionTrigger>
              <AccordionContent className="max-w-[62ch] pr-9 pb-5 text-[15px] text-fg-muted">
                {q.r}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
