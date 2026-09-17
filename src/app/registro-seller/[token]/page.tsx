import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";
import { Button } from "@/components/ui/button";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { resolverEnlaceSellerPublicoAction } from "./actions";
import { FormularioContinuarGoogle } from "./formulario-continuar-google";

export const metadata: Metadata = {
  title: "Súmate como seller",
  // Un enlace con token no tiene por qué terminar en un buscador — mismo
  // criterio que `/invitacion/[token]` y `/tracking/[token]`.
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
  /** `error` llega de vuelta desde `/auth/callback` (correo ya ocupado, etc.). */
  searchParams: Promise<{ error?: string }>;
}

/**
 * `/registro-seller/[token]` — landing pública del enlace permanente de un
 * courier (RF-010 rediseño).
 * =============================================================================
 * REEMPLAZA la invitación de a uno por correo: el courier comparte ESTE
 * enlace (lo pega en su propio WhatsApp) y cualquier seller que lo abre entra
 * solo — Google, wizard, activo al instante.
 *
 * La resolución del token es SERVIDOR, igual que `/invitacion/[token]`:
 * quien va a ver «este enlace no sirve» no necesita bajarse el bundle del
 * botón de Google.
 *
 * ⚠️ Regla 45 (ni confirma ni niega): un token que no resuelve puede ser
 * inexistente, anulado o de un courier que ya no existe — se muestra el mismo
 * mensaje neutro para los tres casos, porque no hay nada que ganar
 * distinguiéndolos ante quien no tiene sesión.
 */
export default async function PaginaRegistroSeller({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { error } = await searchParams;

  const resultado = await resolverEnlaceSellerPublicoAction(token);

  if (!resultado.ok) {
    return (
      <PantallaSinSesion marca={{ tipo: "neutra" }}>
        <div className="w-full max-w-sm border border-line bg-bg-raised p-6">
          <DistintivoEstado tono="neutral" etiqueta="Enlace no disponible" />
          <h1 className="font-heading mt-4 text-xl leading-tight font-semibold">
            Este enlace no está disponible
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">{resultado.mensaje}</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            Pídele a tu courier que te comparta su enlace vigente.
          </p>
          <div className="mt-5">
            <Button asChild variant="outline">
              <Link href="/login">¿Ya tienes cuenta? Inicia sesión</Link>
            </Button>
          </div>
        </div>
      </PantallaSinSesion>
    );
  }

  return (
    <PantallaSinSesion
      marca={{ tipo: "courier", nombre: resultado.nombreFantasia }}
      pie={
        <span className="flex items-center justify-center gap-1.5">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          Si no esperabas este enlace, ciérralo: sin continuar no se crea ninguna cuenta.
        </span>
      }
    >
      <FormularioContinuarGoogle token={token} errorInicial={error} />
    </PantallaSinSesion>
  );
}
