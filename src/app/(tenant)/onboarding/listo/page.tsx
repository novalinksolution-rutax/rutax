import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, Store, Truck, LayoutDashboard } from "lucide-react";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { resolverModoDteTenant } from "@/modules/dinero/modo-dte";
import { Button } from "@/components/ui/button";
import { SimboloRutax } from "@/components/ui/marca-rutax";

import { resolverEstadoOnboarding } from "../estado";
import { pasosDelAsistente } from "../pasos";

export const metadata: Metadata = {
  title: "Ya puedes operar",
};

/**
 * El final del asistente — «Ya puedes operar».
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ES UNA PANTALLA Y NO UNA TARJETA VERDE
 * -----------------------------------------------------------------------------
 * Lo que había era una `Card` verde **encima de las cinco tarjetas, que seguían
 * ahí**: el momento en que el courier queda listo se veía igual que cualquier
 * otro estado del checklist. Y era inalcanzable, porque colgaba de un valor que
 * nadie escribe (ver `estado.ts`).
 *
 * Este es el único momento del producto en que se puede decir «terminaste», y
 * merece la pantalla. Pero no es una felicitación: es un **resumen con los datos
 * reales** —«3 rangos vigentes», «Banco de Chile conectado»— más lo que todavía
 * NO está resuelto (la emisión al SII sigue simulada) y **los tres primeros
 * trabajos de verdad**. Un cierre que solo felicita deja al dueño en una
 * pantalla sin salida.
 *
 * -----------------------------------------------------------------------------
 * NO SE ENTRA ACÁ SIN HABER TERMINADO
 * -----------------------------------------------------------------------------
 * Si falta un paso crítico, se redirige al asistente. Una pantalla que dice «ya
 * puedes operar» a alguien que no puede es peor que no tenerla.
 */
export default async function PaginaOnboardingListo() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  const tenantId = sesion.usuario.tenantId;
  const estado = await resolverEstadoOnboarding(tenantId).catch(() => null);
  if (!estado) redirect("/onboarding");
  if (!estado.completo) redirect("/onboarding");

  const pasos = pasosDelAsistente(estado);
  const modoDte = await resolverModoDteTenant(tenantId).catch(() => "sandbox" as const);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-3">
        <SimboloRutax className="size-8" titulo="Rutax" />
        <h1 className="font-heading text-3xl font-semibold">Ya puedes operar</h1>
        <p className="text-sm leading-relaxed text-fg-muted">
          {estado.nombreFantasia} tiene lo que necesita para facturar a sus sellers y liquidar a
          sus conductores. El aviso de configuración pendiente desapareció del marco y{" "}
          <strong className="font-medium text-fg">no vuelve</strong> — salvo que algo se rompa
          después, y en ese caso vuelve nombrando ese paso, no el asistente completo.
        </p>
      </div>

      {/* El resumen con el DATO de cada paso. No es un checklist con ticks: es
          lo que quedó configurado, para poder revisarlo de un vistazo. */}
      <section className="space-y-2">
        <h2 className="rx-num text-[10px] tracking-[0.12em] text-fg-muted uppercase">
          Lo que quedó configurado
        </h2>
        <ul className="divide-y divide-line border border-line">
          {pasos.map((p) => (
            <li key={p.clave} className="flex items-start gap-3 px-4 py-2.5">
              <span
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center border ${
                  p.listo
                    ? "border-balanced-line bg-balanced-bg text-balanced-fg"
                    : "border-line text-fg-subtle"
                }`}
              >
                {p.listo ? (
                  <Check className="size-3" aria-hidden="true" />
                ) : (
                  <span className="rx-num text-[10px]">{p.numero}</span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium text-fg">{p.titulo}</span>
                <span className="block text-sm leading-snug text-fg-muted">{p.resumen}</span>
              </span>
              <Link
                href={p.href}
                className="shrink-0 text-xs font-medium text-accent-text hover:underline"
              >
                Ver
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Lo que NO está resuelto, dicho acá y no escondido. Un courier que cree
          que ya está emitiendo al SII y no lo está se entera con el primer
          reclamo de un seller. */}
      {modoDte !== "real" ? (
        <section className="border border-attention-line bg-attention-bg px-4 py-3.5">
          <p className="text-sm leading-relaxed text-attention-fg">
            <strong className="font-medium">Sigues en modo de pruebas.</strong> Las facturas que
            emitas no llegan al Servicio de Impuestos Internos todavía: se simulan de punta a
            punta para que puedas probar el flujo completo sin consumir folios de verdad. Activar
            la emisión real es una decisión aparte, y la habilitamos contigo.
          </p>
        </section>
      ) : null}

      {/* Las tres acciones son los tres primeros trabajos reales, en el orden en
          que ocurren: primero hay a quién despacharle, después quién lo lleve,
          y recién ahí hay algo que mirar en el panel. */}
      <section className="space-y-2">
        <h2 className="rx-num text-[10px] tracking-[0.12em] text-fg-muted uppercase">
          Y ahora
        </h2>
        <div className="flex flex-col gap-2">
          <AccionDeEstreno
            href="/sellers/invitar"
            icono={<Store className="size-4" aria-hidden="true" />}
            titulo="Invita a tu primer seller"
            detalle="Conecta su cuenta de Mercado Libre o su tienda y sus pedidos empiezan a entrar solos."
          />
          <AccionDeEstreno
            href="/conductores"
            icono={<Truck className="size-4" aria-hidden="true" />}
            titulo="Da de alta a tus conductores"
            detalle="Cada uno entra a la app con su cuenta y ve su ruta del día."
          />
          <AccionDeEstreno
            href="/dashboard"
            icono={<LayoutDashboard className="size-4" aria-hidden="true" />}
            titulo="Ir al panel"
            detalle="El día de hoy, con lo que falta por entregar y lo que ya se cobró."
          />
        </div>
      </section>
    </div>
  );
}

function AccionDeEstreno({
  href,
  icono,
  titulo,
  detalle,
}: {
  href: string;
  icono: React.ReactNode;
  titulo: string;
  detalle: string;
}) {
  return (
    <Button
      asChild
      variant="outline"
      className="h-auto justify-start gap-3 px-4 py-3 text-left whitespace-normal"
    >
      <Link href={href}>
        <span className="shrink-0 text-fg-muted">{icono}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-fg">{titulo}</span>
          <span className="block text-xs leading-snug font-normal text-fg-muted">{detalle}</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
      </Link>
    </Button>
  );
}
