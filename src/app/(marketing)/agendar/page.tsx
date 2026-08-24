import type { Metadata } from "next";
import Link from "next/link";

import { FirmadoPorRutax } from "@/components/ui/marca-rutax";

import { FormularioAgendar } from "./formulario";

export const metadata: Metadata = {
  title: "Agendar una demostración · Rutax",
  description:
    "Media hora con tus propios pedidos en pantalla. Sin tarjeta, sin compromiso y sin vendedor detrás.",
};

/**
 * `/agendar` — el único destino del sitio (regla 80).
 * =============================================================================
 *
 * Todas las páginas llevan acá. Un sitio con tres destinos distintos —«contacto»,
 * «pedir demo», «hablar con ventas»— reparte la intención en tres formularios
 * que nadie mantiene igual, y el visitante elige el que suena menos comprometido
 * en vez del que le sirve.
 *
 * -----------------------------------------------------------------------------
 * LA PÁGINA REPITE LA PROMESA ARRIBA DEL FORMULARIO
 * -----------------------------------------------------------------------------
 * Quien llega acá ya decidió; lo que necesita es confirmar **qué está pidiendo
 * exactamente**. «Media hora con tus propios pedidos en pantalla» dice las tres
 * cosas que un comprador escéptico quiere saber antes de dar su WhatsApp:
 * cuánto dura, con qué datos, y con quién habla.
 */
export default function PaginaAgendar() {
  // El teléfono directo se lee del entorno y **solo se usa en la falla de
  // envío**. Sin variable, esa pantalla sale sin él en vez de inventar un
  // número: un teléfono que no contesta es peor que ninguno.
  const telefono = process.env.RUTAX_WHATSAPP_COMERCIAL ?? null;

  return (
    <div className="mx-auto max-w-2xl px-5 py-12 sm:py-20">
      <Link
        href="/"
        className="text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
      >
        ← Rutax
      </Link>

      <h1 className="font-heading mt-6 text-3xl leading-tight font-semibold sm:text-4xl">
        Media hora, con tus propios pedidos en pantalla
      </h1>
      <p className="mt-3 text-base leading-relaxed text-fg-muted">
        Conectamos una de tus fuentes en la misma reunión y ves tus pedidos reales entrando. Sin
        tarjeta, sin compromiso y sin vendedor detrás:{" "}
        <strong className="font-medium text-fg">contesta quien construye el producto</strong>.
      </p>

      <div className="mt-10">
        <FormularioAgendar telefonoDirecto={telefono} />
      </div>

      <div className="mt-16">
        <FirmadoPorRutax />
      </div>
    </div>
  );
}
