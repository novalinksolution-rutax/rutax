import type { Metadata } from "next";

import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";

import { resolverInvitacionPorToken } from "./actions";
import { EstadosFinales } from "./estados-finales";
import { FormularioAceptacion } from "./formulario-aceptacion";

export const metadata: Metadata = {
  title: "Aceptar invitación",
  // Un enlace con token no tiene por qué terminar en un buscador, igual que el
  // seguimiento público.
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ dueno?: string }>;
}

/**
 * `/invitacion/[token]` — la puerta de entrada de todo el que no es del courier.
 * =============================================================================
 *
 * Pantallas C (primer login del dueño) y J (aceptación de invitación interna /
 * seller). Ambas resuelven por el mismo token de `invitaciones` — esta página
 * decide, en servidor, qué variante mostrar (criterio: nunca pedir lo que el
 * sistema ya sabe).
 *
 * `?dueno=1` distingue el saludo de la Pantalla C («Hola, [nombre]. Estás a un
 * paso de activar…») del genérico de la Pantalla J — ambas comparten componente,
 * pero el primer dueño de un tenant recién creado merece un encabezado que
 * reconozca que es SU empresa, no «fuiste invitado por…».
 *
 * -----------------------------------------------------------------------------
 * LA BIFURCACIÓN VIVE ACÁ, EN EL SERVIDOR
 * -----------------------------------------------------------------------------
 * Los cinco finales de error son servidor puro y el formulario es cliente. Antes
 * las seis ramas estaban dentro del componente de cliente, así que **quien iba a
 * ver un mensaje de tres líneas se bajaba igual el formulario de contraseñas
 * entero**, con su medidor de fortaleza y sus tres campos. Se abre en el teléfono
 * de alguien que no eligió abrirlo.
 *
 * -----------------------------------------------------------------------------
 * LA MARCA LA PONE EL COURIER (regla 42)
 * -----------------------------------------------------------------------------
 * El invitado es cliente **del courier**, no nuestro: es su seller, su conductor
 * o alguien de su equipo. Por eso arriba va el nombre del courier y no el de
 * Rutax — para esa persona «Rutax» no significa nada todavía. En los finales de
 * error la marca es **neutra**, porque en varios de ellos no hay forma de saber
 * de qué courier venía el enlace.
 */
export default async function PaginaAceptarInvitacion({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { dueno } = await searchParams;

  const estado = await resolverInvitacionPorToken(token);

  if (estado.estado !== "valida") {
    return <EstadosFinales estado={estado} token={token} />;
  }

  return (
    <PantallaSinSesion
      marca={{ tipo: "courier", nombre: estado.nombreTenant }}
      pie="Si no esperabas esta invitación, ignórala: sin abrirla no se crea ninguna cuenta."
    >
      <FormularioAceptacion token={token} info={estado} esPrimerDueno={dueno === "1"} />
    </PantallaSinSesion>
  );
}
