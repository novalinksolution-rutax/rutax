import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { FirmadoPorRutax } from "@/components/ui/marca-rutax";

import { BotonBorrarPuntoTermino } from "./boton-borrar-punto-termino";

export const metadata: Metadata = {
  title: "Rutax Conductor",
};

/**
 * Lo único que queda de la PWA del conductor.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ SE RETIRÓ, Y QUÉ SE PERDIÓ CON ELLO
 * -----------------------------------------------------------------------------
 * Acá vivían cinco pantallas —inicio, manifiesto del día, detalle de parada,
 * liquidaciones y punto de término— que sumaban ~1.900 líneas. Se retiran por
 * decisión del usuario (24-08-2026): el conductor trabaja en la app nativa, y
 * mantener dos superficies operativas es mantener dos veces cada regla.
 *
 * ✅ **Los dos huecos que dejó el retiro ya están cerrados** (verificado el
 * 24-08-2026 contra `Desktop/rutax-conductor`). Se anotan porque la nota
 * anterior decía lo contrario y alguien podría creerle:
 *
 * · **Mis liquidaciones** (brecha #19) — existe: `app/(main)/liquidaciones/`,
 *   con su detalle.
 * · **Punto de término** — existe: `app/(main)/punto-termino.tsx`, con el
 *   consentimiento de tres pasos **y el borrado**.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTA PÁGINA SÍ EXISTE, Y POR QUÉ TIENE UN BOTÓN
 * -----------------------------------------------------------------------------
 * Sin ella, un conductor que entre a la web queda en un 404 o en un bucle de
 * redirecciones: `/` y el layout de `(tenant)` lo mandan acá.
 *
 * Y el botón de borrar el punto de término se queda **porque revocar no es una
 * funcionalidad, es una condición**. La Ley 21.431 exige que el dato personal
 * que alguien entregó se pueda retirar cuando quiera; quitar la pantalla que lo
 * captura es una decisión de producto, quitar la que lo borra es dejar sin
 * salida a quien ya dijo que sí.
 *
 * ⚠️ **Desde el 24-08-2026 ya NO es el único acceso humano**: la app nativa
 * tiene su propio «Borrar mi punto de término». O sea que este botón pasó a ser
 * un **segundo camino**, y se conserva a propósito: quitar una vía de revocación
 * de un dato personal por ahorrar cien líneas es un cambio que se decide, no uno
 * que se hace de paso. Si alguna vez se retira, que sea con
 * `docs/seguridad/punto-de-termino-conductor.md` delante.
 */
export default async function PaginaConductorRetirada() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "conductor") redirect("/");

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-10">
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">Tu trabajo está en la app</h1>
        {/* 🐞 «Hola {nombre}.» imprimía «Hola .» — `nombreCompleto` sale de
            `user_metadata` del JWT y muchos conductores no lo tienen ahí (su
            nombre vive en `usuarios_perfil`). El saludo con nombre es un adorno
            y la frase funciona igual sin él, así que se omite el saludo entero
            en vez de leer la base para decir «hola». */}
        <p className="text-sm leading-relaxed text-fg-muted">
          {sesion.nombreCompleto ? `Hola ${sesion.nombreCompleto}. ` : ""}Tu ruta del día, los
          retiros en bodega y la prueba de entrega se hacen desde{" "}
          <strong className="font-medium text-fg">Rutax Conductor</strong>, la app que tienes
          instalada en el teléfono. Esta página ya no muestra tus paradas.
        </p>
        <p className="text-sm leading-relaxed text-fg-muted">
          Si no la tienes instalada, pídesela a tu coordinador.
        </p>
      </div>

      <div className="border border-line bg-bg-raised p-4">
        <h2 className="font-mono text-[10px] font-medium tracking-[0.1em] text-fg-subtle uppercase">
          Tu punto de término
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          Es la dirección donde terminas tu jornada, si alguna vez la diste. Se usa para armar tu
          ruta con la última parada cerca de ahí, y para nada más. Puedes borrarla cuando quieras.
        </p>
        <div className="mt-3">
          <BotonBorrarPuntoTermino />
        </div>
      </div>

      <FirmadoPorRutax />
    </div>
  );
}
