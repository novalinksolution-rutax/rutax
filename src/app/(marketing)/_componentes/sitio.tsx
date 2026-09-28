import Link from "next/link";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { ChevronDownIcon } from "lucide-react";

import { MarcaRutax } from "@/components/ui/marca-rutax";
import { cn } from "@/lib/utils";

import { WHATSAPP_VENTAS } from "../_lib/precio";
import { MenuMovil } from "./menu-movil";
import { BotonVentas, VentasProvider } from "./ventas";

/**
 * El marco del sitio comercial: encabezado, cierre y pie, compartidos por la
 * portada y las páginas de producto. Todo es servidor salvo el menú del teléfono
 * y el modal de ventas.
 *
 * Vercel Analytics se monta aquí y no en el layout raíz: en el raíz mediría
 * también `/tracking/[token]`, cuyo token viaja en la URL que recibe el
 * destinatario.
 */

export const ENVOLTURA = "mx-auto w-full max-w-[1200px] px-4 sm:px-8 lg:px-[52px]";

export interface EnlaceSitio {
  href: string;
  texto: string;
}

export const INTEGRACIONES: EnlaceSitio[] = [
  { href: "/integraciones/mercado-libre-flex", texto: "Mercado Libre Flex" },
  { href: "/integraciones/shopify", texto: "Shopify" },
];

const ENLACES_MOVIL: EnlaceSitio[] = [
  { href: "/#como-funciona", texto: "Cómo funciona" },
  ...INTEGRACIONES,
  { href: "/cobros-y-liquidaciones", texto: "Cobros y liquidaciones" },
  { href: "/precios", texto: "Precios" },
];

export function MarcoSitio({ children }: { children: ReactNode }) {
  return (
    <VentasProvider whatsapp={WHATSAPP_VENTAS}>
      <div className="flex min-h-full flex-col bg-bg text-fg">
        <Navegacion />
        <main className="flex-1">{children}</main>
        <Pie />
      </div>
      <Analytics />
    </VentasProvider>
  );
}

/** Título + bajada de una sección. */
export function Cabeza({ titulo, bajada }: { titulo: string; bajada?: string }) {
  return (
    <div className="mb-9 grid max-w-[680px] gap-3 lg:mb-13">
      <h2 className="text-[28px] leading-[1.12] font-bold tracking-[-0.03em] text-balance sm:text-[40px]">
        {titulo}
      </h2>
      {bajada ? <p className="text-[17px] text-fg-muted">{bajada}</p> : null}
    </div>
  );
}

/** Rótulo en mono: columnas del pie y antetítulos. */
export function Rotulo({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11.5px] font-medium tracking-[0.12em] text-fg-muted uppercase">
      {children}
    </span>
  );
}

/** Encabezado de una página de producto: H1, bajada y los dos botones. */
export function EncabezadoPagina({
  rotulo,
  titulo,
  bajada,
  children,
}: {
  rotulo: string;
  titulo: ReactNode;
  bajada: string;
  children?: ReactNode;
}) {
  return (
    <section className="py-12 sm:py-[clamp(48px,7vw,88px)]">
      <div
        className={cn(
          ENVOLTURA,
          children ? "grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16" : ""
        )}
      >
        <div className="max-w-[640px]">
          <Rotulo>{rotulo}</Rotulo>
          <h1 className="mt-4 text-[34px] leading-[1.08] font-bold tracking-[-0.034em] text-balance sm:text-[48px]">
            {titulo}
          </h1>
          <p className="mt-5 max-w-[46ch] text-lg text-fg-muted">{bajada}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <BotonVentas motivo="comenzar">Comenzar</BotonVentas>
            <BotonVentas motivo="demo" variante="secundario">
              Agendar demo
            </BotonVentas>
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}

/* ─── Navegación ───────────────────────────────────────────────────────── */

function Navegacion() {
  const enlace = "whitespace-nowrap transition-colors hover:text-fg";
  return (
    <header className="sticky top-0 z-20 border-b border-line-subtle bg-bg">
      <div className={cn(ENVOLTURA, "flex h-16 items-center gap-8")}>
        <Link href="/" aria-label="Rutax, inicio" className="rounded-ctrl">
          <MarcaRutax />
        </Link>
        <nav aria-label="Páginas" className="max-lg:hidden">
          <ul className="flex items-center gap-6 text-[14.5px] font-medium text-fg-muted">
            <li>
              <Link href="/#como-funciona" className={enlace}>
                Cómo funciona
              </Link>
            </li>
            {/* Desplegable sin JavaScript: se abre con el puntero y con el foco del teclado. */}
            <li className="group relative">
              <button type="button" className={cn(enlace, "flex cursor-pointer items-center gap-1")} aria-haspopup="true">
                Integraciones
                <ChevronDownIcon className="size-3.5 transition-transform group-focus-within:rotate-180 group-hover:rotate-180" aria-hidden="true" />
              </button>
              <div className="invisible absolute top-full left-0 pt-3 opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                <ul className="w-56 rounded-ctrl border border-line bg-bg-raised p-1.5">
                  {INTEGRACIONES.map((i) => (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        className="block rounded-ctrl px-3 py-2.5 text-fg transition-colors hover:bg-bg-sunken focus-visible:bg-bg-sunken focus-visible:outline-none"
                      >
                        {i.texto}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
            <li>
              <Link href="/cobros-y-liquidaciones" className={enlace}>
                Cobros y liquidaciones
              </Link>
            </li>
            <li>
              <Link href="/precios" className={enlace}>
                Precios
              </Link>
            </li>
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          <Link href="/login" className="text-[14.5px] font-semibold text-fg-muted hover:text-fg max-lg:hidden">
            Ingresar
          </Link>
          <BotonVentas motivo="ventas" tamano="chico" className="max-[400px]:hidden">
            Hablar con ventas
          </BotonVentas>
          <MenuMovil enlaces={ENLACES_MOVIL} />
        </div>
      </div>
    </header>
  );
}

/* ─── Cierre ───────────────────────────────────────────────────────────── */

export function Cierre({
  titulo = "¿Listo para ordenar tu operación?",
  bajada = "Súmate a Rutax y haz crecer tu operación.",
}: {
  titulo?: string;
  bajada?: string;
}) {
  return (
    // Siempre en el tema oscuro del producto, en los dos temas del sitio.
    <section id="contacto" data-rx-theme="dark" className="border-t-2 border-brand bg-bg text-fg">
      <div
        className={cn(ENVOLTURA, "grid items-end gap-7 py-[clamp(60px,8vw,100px)] md:grid-cols-[minmax(0,1fr)_auto]")}
      >
        <div>
          <h2 className="text-[30px] leading-[1.12] font-bold tracking-[-0.032em] text-balance sm:text-[44px]">{titulo}</h2>
          <p className="mt-3 text-[17px] text-fg-muted">{bajada}</p>
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
  const columnas: { titulo: string; enlaces: (EnlaceSitio & { externo?: boolean })[] }[] = [
    {
      titulo: "Producto",
      enlaces: [
        { href: "/#como-funciona", texto: "Cómo funciona" },
        { href: "/cobros-y-liquidaciones", texto: "Cobros y liquidaciones" },
        { href: "/precios", texto: "Precios" },
      ],
    },
    { titulo: "Integraciones", enlaces: INTEGRACIONES },
    {
      titulo: "Empresa",
      enlaces: [
        { href: "/agendar", texto: "Agendar demo" },
        { href: `https://wa.me/${WHATSAPP_VENTAS}`, texto: "WhatsApp", externo: true },
        { href: "/login", texto: "Ingresar" },
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
                    {e.externo ? (
                      <a href={e.href} target="_blank" rel="noopener noreferrer" className="hover:text-fg">
                        {e.texto}
                      </a>
                    ) : (
                      <Link href={e.href} className="hover:text-fg">
                        {e.texto}
                      </Link>
                    )}
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
