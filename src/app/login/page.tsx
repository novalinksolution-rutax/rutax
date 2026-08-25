import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { MarcaRutax } from "@/components/ui/marca-rutax";
import { FormularioLogin } from "./formulario-login";
import { LienzoLogin } from "./lienzo-login";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

/**
 * La puerta del producto.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * COLUMNA DE 400 PX + LIENZO, Y NO ES DECORACIÓN REPARTIDA
 * -----------------------------------------------------------------------------
 * Un formulario de dos campos necesita 400 px y ni uno más. El resto del ancho
 * no se rellena estirando la tarjeta —eso da un formulario gordo, no una
 * pantalla mejor—: se le da a un lienzo de marca **sin una palabra**.
 *
 * **Bajo `lg` el lienzo desaparece y la columna se centra.** No hay que
 * reubicar nada porque nada de lo que hay ahí es información; ésa es justo la
 * ventaja de un lienzo sobre un panel con contenido.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ POR QUÉ ESTA PANTALLA NO USA `PantallaSinSesion`
 * -----------------------------------------------------------------------------
 * Es la única de las trece con dos paneles. `PantallaSinSesion` es una columna
 * centrada, y meterle un modo de dos paneles la volvería un componente con dos
 * anatomías para un solo caso. La marca y el tema se resuelven igual —el símbolo
 * arriba de la columna, el tema desde el sistema operativo— así que lo que se
 * comparte es la regla, no el envoltorio.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ MARCA RUTAX COMPLETA, AUNQUE POR ACÁ ENTREN TRES PERSONAS DISTINTAS
 * -----------------------------------------------------------------------------
 * El tablero diseña **tres puertas** —backoffice con marca Rutax, portal con la
 * del courier, backstage con segundo factor— y el producto tiene **una**: por
 * `/login` entran el equipo del courier, sus sellers y sus conductores, y `/`
 * los enruta después según su tipo.
 *
 * La marca completa es **decisión del usuario (24-08-2026)**, sabiendo eso. Lo
 * que sí se cambió del tablero es la salida secundaria: «¿Tu courier todavía no
 * usa Rutax? Agenda una demostración» le habla solo al dueño y le afirma a un
 * seller algo que no le consta. En su lugar va algo que le sirve a los tres.
 */
export default async function PaginaLogin() {
  const sesion = await obtenerSesionActual();
  if (sesion?.usuario.tenantId) {
    redirect("/");
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-[400px_1fr]">
      {/* La columna. En teléfono se ancla arriba —`justify-start` con su
          respiro— en vez de centrarse: centrada, el botón queda bajo el pliegue
          en cuanto aparece el teclado. */}
      <div className="flex flex-col items-center justify-start gap-8 bg-bg px-6 pt-16 pb-10 lg:justify-center lg:pt-10">
        <MarcaRutax version="reducida" />
        <FormularioLogin />
      </div>

      {/* `hidden lg:block`: bajo 1024 no se reubica, se va. */}
      <div className="hidden lg:block">
        <LienzoLogin />
      </div>
    </div>
  );
}
