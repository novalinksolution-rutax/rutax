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
          <Cifras />
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

function Rotulo({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "font-mono text-[11.5px] font-medium tracking-[0.12em] text-fg-muted uppercase",
        className
      )}
    >
      {children}
    </span>
  );
}

function Cabeza({ rotulo, titulo }: { rotulo: string; titulo: string }) {
  return (
    <div className="mb-9 grid max-w-[680px] gap-3 lg:mb-13">
      <Rotulo>{rotulo}</Rotulo>
      <h2 className="text-[28px] leading-[1.12] font-bold tracking-[-0.03em] text-balance sm:text-[40px]">
        {titulo}
      </h2>
    </div>
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
          <p className="mt-5 max-w-[40ch] text-lg text-fg-muted">
            Pedidos de Mercado Libre, Shopify y same-day en un solo panel. Cada entrega deja
            hecho el cobro al seller y el pago al conductor.
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

/* ─── Cifras ───────────────────────────────────────────────────────────── */

const CIFRAS = [
  { valor: "0", texto: "direcciones digitadas a mano" },
  { valor: "390 → 185 km", texto: "un día real de 87 paradas, ruteado" },
  { valor: formatearCLP(0), texto: "implementación y licencias" },
  { valor: "CLP · DTE · RUT", texto: "hecho para Chile" },
];

function Cifras() {
  return (
    <div className="border-y border-line">
      <dl className={cn(ENVOLTURA, "grid grid-cols-2 lg:grid-cols-4")}>
        {CIFRAS.map((c, i) => (
          <div
            key={c.texto}
            className={cn(
              "grid gap-1 py-6 pr-5",
              i % 2 === 1 && "border-l border-line-subtle pl-5",
              i >= 2 && "max-lg:border-t max-lg:border-line-subtle",
              i === 2 && "lg:border-l lg:border-line-subtle lg:pl-5"
            )}
          >
            <dt className="order-2 text-[13.5px] text-fg-muted">{c.texto}</dt>
            <dd className="rx-num order-1 font-mono text-[clamp(18px,1.9vw,24px)] font-semibold tracking-tight">
              {c.valor}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ─── Beneficios ───────────────────────────────────────────────────────── */

const BENEFICIOS = [
  {
    rotulo: "App del conductor",
    titulo: "Escaneo en el retiro",
    texto: "El conductor escanea cada bulto en la bodega del seller. Lo que faltó salta solo.",
  },
  {
    rotulo: "Mercado Libre · Shopify",
    titulo: "Pedidos que entran solos",
    texto:
      "Flex, Shopify y same-day llegan al mismo panel con su dirección ubicada. Hasta 10 cuentas de Mercado Libre por seller.",
  },
  {
    rotulo: "En vivo",
    titulo: "Colectas",
    texto: "Cuántos bultos retiró cada conductor en cada bodega, al momento.",
  },
  {
    rotulo: "Liquidaciones",
    titulo: "Pago a conductores",
    texto: "Cada entrega y cada retiro suman a la liquidación del conductor.",
  },
  {
    rotulo: "Portal del seller",
    titulo: "Cuenta corriente",
    texto: "Tus sellers ven sus envíos entregados, lo que te deben y su factura electrónica.",
  },
];

function Beneficios() {
  return (
    <section id="beneficios" className="scroll-mt-16 py-[clamp(60px,8vw,104px)]">
      <div className={ENVOLTURA}>
        <Cabeza rotulo="Beneficios" titulo="Lo que cambia en tu negocio" />
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
              <Rotulo>{b.rotulo}</Rotulo>
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
  { titulo: "Habla con nosotros", texto: "Un asesor crea tu cuenta." },
  { titulo: "Configura tu cuenta", texto: "Zonas, tarifas, bodegas, conductores y usuarios." },
  { titulo: "Suma a tus sellers", texto: "Cada uno conecta sus cuentas de Mercado Libre y Shopify." },
  { titulo: "Sal a repartir", texto: "Los pedidos ya están adentro." },
];

function ComoFunciona() {
  return (
    <section
      id="como-funciona"
      className="scroll-mt-16 border-y border-line-subtle bg-bg-raised py-[clamp(60px,8vw,104px)]"
    >
      <div className={ENVOLTURA}>
        <Cabeza rotulo="Cómo funciona" titulo="Operando en cuatro pasos" />
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
        <Cabeza rotulo="Precios" titulo="Pagas por envío procesado" />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="rounded-ctrl border border-line bg-bg-raised">
            <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-6">
              <span className="text-[17px] font-semibold">Por envío</span>
              <span className="flex items-baseline gap-2">
                <span className="rx-num font-mono text-[44px] leading-none font-semibold tracking-tight">
                  {formatearCLP(PRECIO_POR_ENVIO_CLP)}
                </span>
                <span className="text-fg-muted">+ IVA</span>
              </span>
            </div>
            <ul className="border-t-2 border-line-strong text-[15px]">
              {[
                "Implementación sin costo",
                "Factura en pesos chilenos",
              ].map((t) => (
                <li
                  key={t}
                  className="flex min-h-13 items-center border-b border-line-subtle px-5 last:border-b-0"
                >
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <CalculadoraPrecio />
        </div>
      </div>
    </section>
  );
}

/* ─── Preguntas ────────────────────────────────────────────────────────── */

const PREGUNTAS = [
  {
    p: "¿Con qué se integra?",
    r: "Mercado Libre Flex y Shopify. Tus pedidos same-day los creas en Rutax.",
  },
  {
    p: "¿Cómo cargo mis envíos?",
    r: "Los de Mercado Libre y Shopify entran solos cuando tu seller conecta su cuenta. Los same-day se ingresan desde el panel.",
  },
  {
    p: "¿Cómo sigo mis envíos?",
    r: "En la Torre de control ves cuántos paquetes faltan, en qué comunas y qué se atascó. Tu cliente final tiene su propia página de seguimiento.",
  },
  {
    p: "¿Qué aplicaciones incluye?",
    r: "Una app para Android con la que el conductor retira, sigue su ruta y cierra cada entrega, incluso sin señal. Tu equipo y tus sellers entran desde el navegador.",
  },
  {
    p: "¿Mis conductores van a usar dos apps?",
    r: "En Flex, sí: la prueba de entrega la sigue gobernando Mercado Envíos. La app de Rutax le dice al conductor cuál manda en cada pedido.",
  },
  {
    p: "¿Para quién es?",
    r: "Para couriers de última milla en Chile que operan Mercado Libre Flex, same-day o tiendas online.",
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
          <Rotulo>Preguntas frecuentes</Rotulo>
          <h2 className="text-[28px] leading-[1.12] font-bold tracking-[-0.03em] sm:text-[40px]">
            Antes de empezar
          </h2>
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
          <p className="mt-3 text-[17px] text-fg-muted">Te mostramos Rutax con tus propios pedidos.</p>
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
