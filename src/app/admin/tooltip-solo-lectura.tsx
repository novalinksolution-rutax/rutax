"use client";

/**
 * Envuelve un control de ESCRITURA deshabilitado por rol (`soporte_lectura`)
 * con un tooltip que explica por qué — UX únicamente: el gate real vive en el
 * servidor (`exigirSuperAdminEscritura`, `@/modules/plataforma/autorizacion-admin`),
 * cada Server Action lo exige por su cuenta sin importar lo que esta pantalla
 * muestre u oculte.
 *
 * El `<div tabIndex={0}>` (en vez de apoyarse en el `<button disabled>` como
 * trigger) es a propósito: los botones `disabled` no reciben eventos de mouse
 * ni foco de teclado en la mayoría de navegadores, lo que rompería el hover/
 * focus del tooltip de Radix. Un `div` (no `span`) porque algunos llamadores
 * envuelven MÁS de un control (p. ej. "Generar link" + "Marcar pagado" juntos
 * en `cobros-periodos.tsx`) — un `span` (inline) no puede contener válidamente
 * ese `div` interno de layout.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function TooltipSoloLectura({
  children,
  mensaje = "Requiere rol Administrador.",
}: {
  children: React.ReactNode;
  mensaje?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="inline-flex">
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent>{mensaje}</TooltipContent>
    </Tooltip>
  );
}
