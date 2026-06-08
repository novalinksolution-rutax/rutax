import type { Metadata } from "next";
import { resolverInvitacionPorToken } from "./actions";
import { FormularioAceptacion } from "./formulario-aceptacion";

export const metadata: Metadata = {
  title: "Aceptar invitación",
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ dueno?: string }>;
}

/**
 * Pantallas C (primer login del dueño) y J (aceptación de invitación interna /
 * seller). Ambas resuelven por el mismo token de `invitaciones` — esta página
 * decide, en servidor, qué variante mostrar (criterio: nunca pedir lo que el
 * sistema ya sabe).
 *
 * `?dueno=1` distingue el saludo de la Pantalla C ("Hola, [nombre]. Estás a un
 * paso de activar...") del genérico de la Pantalla J — ambas comparten
 * componente, pero el primer dueño de un tenant recién creado merece un
 * encabezado que reconozca que es SU empresa, no "fuiste invitado por...".
 */
export default async function PaginaAceptarInvitacion({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { dueno } = await searchParams;

  const estado = await resolverInvitacionPorToken(token);

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <FormularioAceptacion token={token} estadoInicial={estado} esPrimerDueno={dueno === "1"} />
    </div>
  );
}
