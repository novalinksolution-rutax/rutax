"use client";

/**
 * `formulario de configuración` — la sección con guardado explícito y acuse.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * REGLA 25 · EN CONFIGURACIÓN NO HAY AUTOGUARDADO
 * -----------------------------------------------------------------------------
 * **Nada se guarda al salir del campo: un botón por sección, con acuse de
 * recibo.** En configuración el autoguardado es una trampa — quien entra a
 * *mirar* cuánto le cobra a un seller toca una tecla sin querer, se va, y acaba
 * de cambiar una tarifa. Lo que en una libreta es cómodo, acá mueve plata.
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL ACUSE NO ES OPCIONAL, Y EL TIPO LO IMPONE
 * -----------------------------------------------------------------------------
 * `onGuardar` devuelve `{ ok: true; acuse: string }`: **no hay forma de tener
 * éxito sin escribir qué pasó.** Es deliberado. Un formulario que guarda en su
 * sitio y no dice nada deja a la persona mirando exactamente lo mismo que antes
 * de pulsar, y la reacción razonable es volver a pulsar — que es como se
 * duplican registros.
 *
 * Y el acuse **dice la consecuencia, no el trámite**. «Guardado» informa de la
 * mecánica; «desde ahora cada visita a bodega liquida $4.500 al conductor»
 * informa del efecto, que es lo que la persona vino a conseguir y lo único que
 * le permite darse cuenta de que se equivocó de tecla.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL ACUSE SE BORRA EN CUANTO SE VUELVE A ESCRIBIR
 * -----------------------------------------------------------------------------
 * Si se quedara, un «cada visita liquida $4.500» seguiría en pantalla mientras
 * el campo ya dice 5.200 sin guardar. Eso no es un acuse viejo: es una
 * afirmación falsa sobre lo que hay en la base, y en la única pantalla donde la
 * persona no tiene cómo comprobarlo.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ES UN `<form>` Y NO UN BOTÓN CON `onClick`
 * -----------------------------------------------------------------------------
 * Para que Enter guarde y para que los campos viajen como `FormData` sin que
 * cada pantalla mantenga su propio estado controlado. Es el mismo contrato que
 * ya usan las Server Actions de configuración.
 */

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ResultadoGuardado =
  | {
      ok: true;
      /**
       * Qué cambió, en consecuencia y no en trámite. Obligatorio: ver la nota
       * de arriba.
       */
      acuse: string;
    }
  | { ok: false; mensaje: string };

export function SeccionConfiguracion({
  titulo,
  descripcion,
  etiquetaAccion = "Guardar",
  onGuardar,
  children,
  className,
}: {
  /** Se omite cuando la pantalla ya pone el título y la sección es única. */
  titulo?: string;
  descripcion?: ReactNode;
  etiquetaAccion?: string;
  onGuardar: (datos: FormData) => Promise<ResultadoGuardado>;
  children: ReactNode;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [acuse, setAcuse] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    setError(null);
    setAcuse(null);
    iniciar(async () => {
      const r = await onGuardar(datos);
      if (r.ok) setAcuse(r.acuse);
      else setError(r.mensaje);
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={manejarEnvio}
      // Cualquier edición invalida el acuse: ver la nota de arriba. Va en
      // `onInput` y no en `onChange` para que también lo borre un `select`.
      onInput={() => {
        if (acuse !== null) setAcuse(null);
      }}
      className={cn("space-y-4", className)}
    >
      {(titulo || descripcion) && (
        <div className="space-y-1">
          {titulo && <h2 className="font-heading text-base font-semibold text-fg">{titulo}</h2>}
          {descripcion && (
            <div className="text-sm leading-relaxed text-fg-muted">{descripcion}</div>
          )}
        </div>
      )}

      {children}

      {error && (
        <p
          role="alert"
          className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg"
        >
          {error}
        </p>
      )}

      {/* `role="status"` y no `alert`: es una buena noticia, y `alert`
          interrumpe al lector de pantalla en medio de lo que esté diciendo. */}
      {acuse && !error && (
        <p
          role="status"
          className="border border-balanced-line bg-balanced-bg px-3 py-2 text-sm text-balanced-fg"
        >
          {acuse}
        </p>
      )}

      <Button type="submit" disabled={pendiente}>
        {pendiente ? "Guardando…" : etiquetaAccion}
      </Button>
    </form>
  );
}
