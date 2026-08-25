import type { ReactNode } from "react";

import { MarcaRutax } from "@/components/ui/marca-rutax";
import { LienzoLogin } from "./lienzo-login";

/**
 * El marco de la puerta: columna de 400 px + lienzo.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ RECUPERAR Y RESTABLECER COMPARTEN ESTO CON EL LOGIN
 * -----------------------------------------------------------------------------
 * Porque el tablero es explícito: **«no es un flujo aparte: es la misma puerta
 * con otro cuerpo»**. Misma columna, mismo lienzo, misma cabecera de marca; lo
 * único que cambia son los campos.
 *
 * Antes esas dos pantallas usaban `PantallaSinSesion` —columna centrada, sin
 * lienzo—, así que pedir un enlace se sentía como haberse ido a otra parte del
 * producto. Con el marco compartido, cambiar la contraseña es una escala del
 * mismo viaje.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ ESTE MARCO NO ES `PantallaSinSesion`, Y NO ES DUPLICACIÓN
 * -----------------------------------------------------------------------------
 * `PantallaSinSesion` es **una columna centrada**, y lo usan las otras diez
 * pantallas públicas. Éste es de **dos paneles**. Meterle un segundo modo al
 * primero lo dejaría con dos anatomías para servir a tres rutas, y cada cambio
 * en cualquiera de las dos obligaría a mirar la otra.
 *
 * Lo que sí se comparte con él es la regla, no el envoltorio: la marca arriba y
 * el tema decidido fuera de la pantalla.
 *
 * -----------------------------------------------------------------------------
 * BAJO `lg` EL LIENZO SE VA
 * -----------------------------------------------------------------------------
 * No se reubica: nada de lo que hay ahí es información. Y la columna se **ancla
 * arriba** en vez de centrarse — centrada, el botón queda bajo el pliegue en
 * cuanto aparece el teclado del teléfono.
 */
export function MarcoPuerta({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[400px_1fr]">
      <div className="flex flex-col items-center justify-start gap-8 bg-bg px-6 pt-16 pb-10 lg:justify-center lg:pt-10">
        <MarcaRutax version="reducida" tamano="grande" />
        {children}
      </div>

      <div className="hidden lg:block">
        <LienzoLogin />
      </div>
    </div>
  );
}

/**
 * El retorno al login, al pie y centrado.
 *
 * ⚠️ **Va en las cuatro pantallas del flujo y siempre en el mismo sitio**, y no
 * es una cortesía: **el caso más común de este flujo no es haber olvidado la
 * contraseña — es acordarse de ella a mitad de camino.** Ahí el retorno es la
 * acción más valiosa de la pantalla, y donde más importa es en la de crear la
 * nueva, que es la única con un campo donde escribir.
 */
export function VolverAEntrar() {
  return (
    <a
      href="/login"
      className="mt-6 block text-center text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
    >
      ‹ Volver a entrar
    </a>
  );
}
