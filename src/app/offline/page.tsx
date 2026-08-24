import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";
import { AccionesSinConexion } from "./acciones-sin-conexion";

export const metadata: Metadata = {
  title: "Sin conexión",
};

/**
 * La pantalla que sirve el service worker cuando una navegación falla por falta
 * de conexión (T-4).
 *
 * -----------------------------------------------------------------------------
 * MARCA NEUTRA, Y NO ES UN DESCUIDO
 * -----------------------------------------------------------------------------
 * Quien la ve es el conductor, que es gente del courier — y por la regla 42 eso
 * pediría la marca del courier. **Pero acá no se puede saber cuál es**: esta
 * página se sirve desde el caché, sin sesión y sin una sola consulta, porque si
 * dependiera de un dato no podría mostrarse justo cuando hace falta.
 *
 * Y el tablero lo zanja igual por el otro lado: sin conexión y error general van
 * neutras. **Un problema no es el momento de hacer marca** — ni la nuestra ni la
 * del courier.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ LO PRIMERO QUE DICE ES QUE NO SE PERDIÓ NADA
 * -----------------------------------------------------------------------------
 * Quien la lee está en la calle a mitad de ruta, y su primera pregunta no es qué
 * pasó: es **si perdió lo que acaba de registrar**. La app encola las entregas y
 * las manda cuando vuelve la señal; si la pantalla no lo dice, la reacción
 * razonable —volver a marcar la entrega— es justo la que duplica registros.
 *
 * Estática y sin datos, para que sea segura de cachear. Lo único vivo es el
 * botón, que mira el estado de la red del navegador.
 */
export default function PaginaOffline() {
  return (
    <PantallaSinSesion marca={{ tipo: "neutra" }}>
      <div className="text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full border border-line">
          <WifiOff className="size-5 text-fg-muted" aria-hidden="true" />
        </div>

        <h1 className="mt-4 font-heading text-xl font-semibold text-fg">Te quedaste sin señal</h1>

        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          Lo que ya marcaste está guardado en el teléfono y se envía solo cuando vuelva la
          conexión. No hace falta que lo vuelvas a marcar.
        </p>

        <AccionesSinConexion />
      </div>
    </PantallaSinSesion>
  );
}
