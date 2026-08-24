import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";
import { ReenviarCorreo } from "./reenviar-correo";

export const metadata: Metadata = {
  title: "Revisa tu correo",
};

interface PageProps {
  searchParams: Promise<{ email?: string }>;
}

/**
 * «Revisa tu correo» — el alta quedó a medias y hay que decirlo.
 *
 * ⚠️ **Marca Rutax** (regla 42): quien llega acá acaba de registrar SU courier,
 * así que es cliente nuestro y sabe perfectamente qué es Rutax.
 *
 * Es un estado intermedio sin acción posible, y por eso lo importante es que
 * **no deje esperando en blanco**: dice a qué correo se mandó, cuánto dura el
 * enlace, y ofrece reenviarlo. Sin eso, la pregunta «¿y si no llega?» no tiene
 * respuesta en pantalla y termina en un correo a soporte.
 *
 * ⚠️ **Se retira el enlace a `/soporte`, que NO EXISTE.** Mandaba a un 404 justo
 * a quien ya está atascado — y era la única salida que la pantalla ofrecía. La
 * regla del bloque es una acción principal y a lo más un enlace secundario; acá
 * la acción es reenviar, y un segundo enlace roto no es un secundario, es un
 * callejón.
 */
export default async function PaginaRevisaTuCorreo({ searchParams }: PageProps) {
  const { email } = await searchParams;
  const correo = email?.trim() || "el correo que ingresaste";

  return (
    <PantallaSinSesion marca={{ tipo: "rutax" }}>
      <div className="text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full border border-line">
          <Mail className="size-5 text-fg-muted" aria-hidden="true" />
        </div>

        <h1 className="mt-4 font-heading text-xl font-semibold text-fg">Revisa tu correo</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          Enviamos un enlace a <span className="font-medium text-fg">{correo}</span> para que
          actives tu cuenta y crees tu contraseña. El enlace vence en 7 días.
        </p>

        {email ? (
          <div className="mt-6">
            <ReenviarCorreo email={correo} />
          </div>
        ) : null}
      </div>
    </PantallaSinSesion>
  );
}
