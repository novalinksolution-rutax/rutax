import Link from "next/link";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { MarcaRutax } from "@/components/ui/marca-rutax";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { cn } from "@/lib/utils";

import { CalculadoraPrecio } from "./_componentes/calculadora-precio";
import { BotonVentas, VentasProvider } from "./_componentes/ventas";
import { VitrinaPedidos } from "./_componentes/vitrina-pedidos";
import { PRECIO_POR_ENVIO_CLP, WHATSAPP_VENTAS } from "./_lib/precio";

/**
 * La portada de Rutax — sitio v2 (2026-09-27).
 * =============================================================================
 *
 * Calca la ESTRUCTURA y el relato de rushmile.app —hero · beneficios · cómo
 * funciona · precios · preguntas · cierre— con copy propio y la identidad de
 * Rutax. Maqueta aprobada: https://claude.ai/artifact/3rBPrCvWSryJMVndfwnYnY.
 *
 * Decisiones del usuario que la gobiernan:
 * · **Precio público y por envío**: $60 + IVA, único (`_lib/precio.ts`).
 * · **«Comenzar» abre al asesor**, no un autoregistro: el alta de un courier la
 *   hace Rutax desde el backstage. Los tres botones abren el mismo modal.
 * · **WhatsApp de ventas propio**, distinto del número de avisos de la Cloud API.
 * · **Vercel Analytics solo aquí y en `/agendar`**, no en el layout raíz: en el
 *   raíz mediría también `/tracking/[token]`, y ese token es público y viaja en
 *   la URL que se comparte con el destinatario.
 *
 * Todo es servidor salvo tres islas: la vitrina del hero, la calculadora y el
 * modal de ventas.
 */
export function Portada() {
  return (
    <VentasProvider whatsapp={WHATSAPP_VENTAS}>
      <div className="flex min-h-full flex-col bg-bg text-fg">
        <Navegacion />
        <main className="flex-1">
          <Hero />
          <Beneficios />
          <ComoFunciona />
          <Precios />
          <Preguntas />
          <Cierre />
        </main>
        <Pie />
      </div>
      <Analytics />
    </VentasProvider>
  );
}

const ENVOLTURA = "mx-auto w-full max-w-[1200px] px-4 sm:px-8 lg:px-[52px]";

/**
 * Título + bajada de cada sección, en el registro de la referencia (decisión del
 * usuario, 2026-09-27): el copy habla de lo que el servicio hace, en general, sin
 * nombrar módulos internos ni detalles del sistema.
 */
function Cabeza({ titulo, bajada }: { titulo: string; bajada: string }) {
  return (
    <div className="mb-9 grid max-w-[680px] gap-3 lg:mb-13">
      <h2 className="text-[28px] leading-[1.12] font-bold tracking-[-0.03em] text-balance sm:text-[40px]">
        {titulo}
      </h2>
      <p className="text-[17px] text-fg-muted">{bajada}</p>
    </div>
  );
}

/** Rótulo en mono de las columnas del pie. */
function Rotulo({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11.5px] font-medium tracking-[0.12em] text-fg-muted uppercase">
      {children}
    </span>
  );
}

/* ─── Navegación ───────────────────────────────────────────────────────── */

const SECCIONES = [
  { href: "#beneficios", texto: "Beneficios" },
  { href: "#como-funciona", texto: "Cómo funciona" },
  { href: "#precios", texto: "Precios" },
  { href: "#preguntas", texto: "Preguntas" },
];

function Navegacion() {
  return (
    <header className="sticky top-0 z-20 border-b border-line-subtle bg-bg">
      <div className={cn(ENVOLTURA, "flex h-16 items-center gap-8")}>
        <Link href="/" aria-label="Rutax, inicio" className="rounded-ctrl">
          <MarcaRutax />
        </Link>
        <nav aria-label="Secciones" className="max-lg:hidden">
          <ul className="flex gap-6 text-[14.5px] font-medium text-fg-muted">
            {SECCIONES.map((s) => (
              <li key={s.href}>
                <a href={s.href} className="transition-colors hover:text-fg">
                  {s.texto}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <Link
            href="/login"
            className="text-[14.5px] font-semibold text-fg-muted hover:text-fg max-[460px]:hidden"
          >
            Ingresar
          </Link>
          <BotonVentas motivo="ventas" tamano="chico">
            Hablar con ventas
          </BotonVentas>
        </div>
      </div>
    </header>
  );
}

/* ─── Hero ─────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="py-11 sm:py-[clamp(44px,7vw,88px)]">
      <div
        className={cn(
          ENVOLTURA,
          "grid items-center gap-9 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16"
        )}
      >
        <div>
          <h1 className="text-[36px] leading-[1.06] font-bold tracking-[-0.036em] text-balance sm:text-[50px]">
            Tu operación Flex, <span className="text-accent-text">de la colecta al pago.</span>
          </h1>
          <p className="mt-5 max-w-[42ch] text-lg text-fg-muted">
            Gestionamos la cadena completa de Mercado Libre Flex y same-day para que muevas
            grandes volúmenes de paquetes sin perder el control.
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
        <VitrinaPedidos />
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

/* ─── Cierre ───────────────────────────────────────────────────────────── */

function Cierre() {
  return (
    // Siempre en el tema oscuro del producto, en los dos temas del sitio.
    <section id="contacto" data-rx-theme="dark" className="border-t-2 border-brand bg-bg text-fg">
      <div
        className={cn(
          ENVOLTURA,
          "grid items-end gap-7 py-[clamp(60px,8vw,100px)] md:grid-cols-[minmax(0,1fr)_auto]"
        )}
      >
        <div>
          <h2 className="text-[30px] leading-[1.12] font-bold tracking-[-0.032em] sm:text-[44px]">
            ¿Listo para ordenar tu operación?
          </h2>
          <p className="mt-3 text-[17px] text-fg-muted">Súmate a Rutax y haz crecer tu operación.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <BotonVentas motivo="comenzar">Comenzar</BotonVentas>
          <BotonVentas motivo="ventas" variante="secundario">
            Hablar con ventas
          </BotonVentas>
        </div>
      </div>
    </section>
  );
}

/* ─── Pie ──────────────────────────────────────────────────────────────── */

function Pie() {
  const columnas: { titulo: string; enlaces: { href: string; texto: string; externo?: boolean }[] }[] = [
    {
      titulo: "Producto",
      enlaces: [
        { href: "#beneficios", texto: "Beneficios" },
        { href: "#como-funciona", texto: "Cómo funciona" },
        { href: "#precios", texto: "Precios" },
      ],
    },
    {
      titulo: "Empresa",
      enlaces: [
        { href: "/agendar", texto: "Agendar demo" },
        { href: "/login", texto: "Ingresar" },
      ],
    },
    {
      titulo: "Soporte",
      enlaces: [
        { href: "#preguntas", texto: "Preguntas frecuentes" },
        { href: `https://wa.me/${WHATSAPP_VENTAS}`, texto: "WhatsApp", externo: true },
      ],
    },
  ];

  return (
    <footer data-rx-theme="dark" className="bg-bg pt-11 pb-13 text-sm text-fg-muted">
      <div className={ENVOLTURA}>
        <div className="grid grid-cols-2 gap-8 md:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" aria-label="Rutax, inicio" className="text-fg">
              <MarcaRutax version="completa" />
            </Link>
          </div>
          {columnas.map((c) => (
            <div key={c.titulo}>
              <Rotulo>{c.titulo}</Rotulo>
              <ul className="mt-3 grid gap-2">
                {c.enlaces.map((e) => (
                  <li key={e.texto}>
                    <a
                      href={e.href}
                      className="hover:text-fg"
                      {...(e.externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    >
                      {e.texto}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap justify-between gap-3 border-t border-line-subtle pt-5 text-[12.5px] text-fg-subtle">
          <span>© 2026 Rutax · Santiago, Chile</span>
          <span className="flex gap-4">
            <Link href="/terminos" className="hover:text-fg">
              Términos
            </Link>
            <Link href="/privacidad" className="hover:text-fg">
              Privacidad
            </Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
