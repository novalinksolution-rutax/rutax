import Link from "next/link";
import type { ReactNode } from "react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

import { Cabeza, ENVOLTURA } from "./sitio";

/**
 * Bloques de las páginas de producto. Mismo lenguaje que la portada: reglas en
 * vez de tarjetas, un acento teal por sección y nada que no se lea en un teléfono.
 */

export function Seccion({
  id,
  titulo,
  bajada,
  alterna,
  children,
}: {
  id?: string;
  titulo: string;
  bajada?: string;
  alterna?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn("scroll-mt-16 py-[clamp(56px,8vw,96px)]", alterna && "border-y border-line-subtle bg-bg-raised")}
    >
      <div className={ENVOLTURA}>
        <Cabeza titulo={titulo} bajada={bajada} />
        {children}
      </div>
    </section>
  );
}

/** Pasos en orden: el número es información, no adorno. */
export function Pasos({ pasos }: { pasos: { titulo: string; texto: string }[] }) {
  return (
    <ol
      className={cn(
        "grid gap-y-9 border-t border-line sm:grid-cols-2",
        pasos.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"
      )}
    >
      {pasos.map((p, i) => (
        <li key={p.titulo} className="relative grid content-start gap-2 pt-5 pr-5">
          <span
            aria-hidden="true"
            className={cn("absolute -top-px left-0 h-0.5 w-9", i === pasos.length - 1 ? "bg-brand" : "bg-line-strong")}
          />
          <span className="rx-num font-mono text-[13px] font-semibold text-fg-muted">{String(i + 1).padStart(2, "0")}</span>
          <h3 className="text-[19px] font-bold tracking-[-0.018em]">{p.titulo}</h3>
          <p className="text-[15px] text-fg-muted">{p.texto}</p>
        </li>
      ))}
    </ol>
  );
}

/** Grilla de rasgos separada por reglas, como los beneficios de la portada. */
export function Rasgos({ items }: { items: { titulo: string; texto: string }[] }) {
  const tres = items.length % 3 === 0;
  return (
    <div className={cn("grid border-t-2 border-line-strong sm:grid-cols-2", tres && "lg:grid-cols-3")}>
      {items.map((b, i) => (
        <article
          key={b.titulo}
          className={cn(
            "grid content-start gap-2.5 border-b border-line-subtle py-6 sm:pr-6",
            tres
              ? cn(
                  i % 2 === 1 && "sm:max-lg:border-l sm:max-lg:border-line-subtle sm:max-lg:pl-6",
                  i % 3 !== 0 && "lg:border-l lg:border-line-subtle lg:pl-6"
                )
              : i % 2 === 1 && "sm:border-l sm:border-line-subtle sm:pl-6"
          )}
        >
          <h3 className="text-[19px] font-bold tracking-[-0.018em]">{b.titulo}</h3>
          <p className="text-[15px] text-fg-muted">{b.texto}</p>
        </article>
      ))}
    </div>
  );
}

export function PreguntasPagina({ preguntas }: { preguntas: { p: string; r: string }[] }) {
  return (
    <Accordion type="single" collapsible defaultValue={preguntas[0]?.p} className="max-w-[820px] border-t-2 border-line-strong">
      {preguntas.map((q) => (
        <AccordionItem key={q.p} value={q.p}>
          <AccordionTrigger className="min-h-16 text-[17px] font-semibold">{q.p}</AccordionTrigger>
          <AccordionContent className="max-w-[62ch] pr-9 pb-5 text-[15px] text-fg-muted">{q.r}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

/** Marco de una maqueta de pantalla: borde fino con el acento arriba, rotulada como ejemplo. */
export function Maqueta({ titulo, children, className }: { titulo: string; children: ReactNode; className?: string }) {
  return (
    <figure className={cn("m-0 min-w-0 border border-line border-t-2 border-t-brand bg-bg-raised", className)}>
      <figcaption className="flex items-center justify-between gap-3 border-b border-line-subtle px-4 py-3">
        <b className="text-sm font-semibold">{titulo}</b>
        <span className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-fg-muted uppercase">Ejemplo</span>
      </figcaption>
      {children}
    </figure>
  );
}

/** Enlaces cruzados al final de una página de producto. */
export function VerTambien({ enlaces }: { enlaces: { href: string; titulo: string; texto: string }[] }) {
  return (
    <section className="py-[clamp(48px,6vw,72px)]">
      <div className={cn(ENVOLTURA, "grid gap-4 sm:grid-cols-2")}>
        {enlaces.map((e) => (
          <Link
            key={e.href}
            href={e.href}
            className="group grid gap-1.5 border border-line p-5 transition-colors hover:border-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text"
          >
            <span className="text-[17px] font-bold">
              {e.titulo} <span aria-hidden="true" className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
            </span>
            <span className="text-[15px] text-fg-muted">{e.texto}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
