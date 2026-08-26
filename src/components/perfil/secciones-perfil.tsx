/**
 * Las piezas de «Mi perfil», compartidas por las cuatro superficies.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTÁN ACÁ Y NO COPIADAS EN CADA PANTALLA
 * -----------------------------------------------------------------------------
 * «Mi perfil» nació para el equipo del courier y el usuario pidió extenderlo a
 * todos los roles (26-08-2026). Cuatro superficies distintas —equipo, seller,
 * conductor y el backstage de Rutax— con la MISMA pantalla debajo: tus datos, tu
 * cuenta, qué puedes hacer, tu contraseña.
 *
 * Lo que se comparte no es el maquetado, que es trivial: es **el texto**. «Es
 * con lo que entras, así que no se cambia desde acá…» explica una decisión de
 * producto, y cuatro copias de esa explicación se convierten en cuatro
 * respuestas distintas a la misma pregunta en cuanto una se edite.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL CONTENEDOR NO SE COMPARTE, Y ES A PROPÓSITO
 * -----------------------------------------------------------------------------
 * Lo que se exporta es el CONTENIDO; la caja la pone cada pantalla. El
 * backoffice del courier usa la caja cuadrada de configuración (`SeccionPerfil`)
 * y el portal del seller usa `Card` —redondeada, con sombra—, que es el idioma
 * del resto de SUS pantallas.
 *
 * Forzar una sola caja habría hecho que «Mi perfil» fuera la única pantalla del
 * portal con esquinas rectas, justo al lado del panel de WhatsApp que ya es una
 * `Card`. Una pantalla coherente consigo misma vale más que cuatro pantallas
 * idénticas entre sí.
 */

import Link from "next/link";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// =============================================================================
// La caja
// =============================================================================

export function SeccionPerfil({
  titulo,
  children,
  className,
}: {
  titulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3 border border-line bg-bg-raised px-5 py-5", className)}>
      <h2 className="font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">{titulo}</h2>
      {children}
    </section>
  );
}

/**
 * Una fila `término / valor`.
 *
 * El valor va a la derecha y con `rx-num` cuando es un dato que se lee carácter
 * a carácter —un correo, una fecha—: alinear los dígitos es lo que deja
 * comparar dos filas de un vistazo.
 */
export function DatoPerfil({
  termino,
  children,
  conSeparador = false,
}: {
  termino: string;
  children: React.ReactNode;
  conSeparador?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1",
        conSeparador && "border-t border-line pt-2.5",
      )}
    >
      <dt className="text-sm text-fg-muted">{termino}</dt>
      <dd className="flex items-center gap-2">{children}</dd>
    </div>
  );
}

/** La nota que explica por qué un dato no se toca desde acá. */
export function NotaPerfil({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-fg-muted">{children}</p>;
}

// =============================================================================
// El correo — la misma explicación en todas partes
// =============================================================================

/**
 * ⚠️ El texto de por qué el correo no se edita.
 *
 * Un campo deshabilitado sin explicación se lee como algo roto, y la
 * explicación no es un detalle de implementación: el correo **es la
 * identidad** —la llave de entrada, el destino de las invitaciones, y lo que
 * sostiene la regla «un correo, una cuenta»—, así que cambiarlo exige
 * re-verificación y abre un rato en que la persona puede quedarse fuera de su
 * propia cuenta.
 */
export function BloqueCorreo({ email }: { email: string | null }) {
  return (
    <>
      <DatoPerfil termino="Correo">
        <span className="rx-num text-sm text-fg">{email ?? "Sin correo registrado"}</span>
      </DatoPerfil>
      <NotaPerfil>
        Es con lo que entras, así que no se cambia desde acá: hacerlo exige verificar el correo
        nuevo y hay un rato en que podrías quedarte fuera de tu propia cuenta. Si necesitas
        cambiarlo, escríbenos.
      </NotaPerfil>
    </>
  );
}

// =============================================================================
// La contraseña — se delega, y se dice por qué
// =============================================================================

/**
 * ⚠️ **No hay un formulario de cambio de contraseña, y es una decisión.**
 *
 * Se delega en el flujo de recuperación que ya existe: un segundo camino para lo
 * mismo son dos sitios donde equivocarse, y ése ya manda su correo y deja su
 * rastro. Además cubre el caso que un formulario en pantalla no cubre — que
 * alguien te haya dejado la sesión abierta en un computador prestado y te cambie
 * la clave sin saber la anterior.
 */
export function ContenidoContrasena({
  email,
  href = "/recuperar-contrasena",
}: {
  email: string | null;
  href?: string;
}) {
  return (
    <>
      <p className="text-sm leading-relaxed text-fg-muted">
        Se cambia por el mismo camino que si la olvidaras: te mandamos un enlace a{" "}
        {email ?? "tu correo"} y la defines ahí. Así nadie puede cambiártela por tenerte la sesión
        abierta en un computador prestado.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href={href}>Cambiar mi contraseña</Link>
      </Button>
    </>
  );
}

/** El mismo contenido, ya dentro de la caja cuadrada de configuración. */
export function SeccionContrasena(props: { email: string | null; href?: string }) {
  return (
    <SeccionPerfil titulo="Tu contraseña">
      <ContenidoContrasena {...props} />
    </SeccionPerfil>
  );
}

// =============================================================================
// La fecha de alta
// =============================================================================

/**
 * El «desde cuándo», con su rótulo propio.
 *
 * El rótulo es prop porque «En este courier desde» y «En Rutax desde» son cosas
 * distintas según quién mire, y usar el mismo en las dos sería falso en una.
 */
export function DatoDesdeCuando({
  rotulo,
  fechaIso,
}: {
  rotulo: string;
  fechaIso: string | null | undefined;
}) {
  if (!fechaIso) return null;
  return (
    <DatoPerfil termino={rotulo} conSeparador>
      <span className="rx-num text-sm text-fg">
        {new Date(fechaIso).toLocaleDateString("es-CL", {
          timeZone: "America/Santiago",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })}
      </span>
    </DatoPerfil>
  );
}
