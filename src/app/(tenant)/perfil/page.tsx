import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { Badge } from "@/components/ui/badge";
import { ListaCapacidades } from "@/components/ui/bloque-capacidades";
import { FormularioMiPerfil } from "@/components/perfil/formulario-mi-perfil";
import {
  BloqueCorreo,
  DatoDesdeCuando,
  DatoPerfil,
  NotaPerfil,
  SeccionContrasena,
  SeccionPerfil,
} from "@/components/perfil/secciones-perfil";
import { formatearTelefonoLegible } from "@/lib/telefono-cl";
import { capacidadesLegiblesDeRol, describirRol } from "@/modules/identidad/capacidades-legibles";
import { DESCRIPCIONES_ROLES_INTERNOS } from "@/modules/identidad/descripciones-roles";
import { esRolInterno } from "@/modules/identidad/roles";
import { PantallaConfiguracion } from "../configuracion/_componentes/pantalla-configuracion";

export const metadata: Metadata = {
  title: "Mi perfil",
};

/**
 * `/perfil` — los datos propios de quien tiene la sesión abierta.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EXISTE
 * -----------------------------------------------------------------------------
 * El bloque de cuenta del pie del sidebar mostraba el nombre y el rol y **no
 * llevaba a ninguna parte**: solo abría el selector de tema y «Cerrar sesión».
 * No había una sola pantalla donde una persona pudiera corregirse el nombre, ni
 * ver con qué correo entró, ni saber qué le permite su rol.
 *
 * ⚠️ **Vale para los cuatro roles internos, no solo para el dueño.** No hay un
 * gate de capacidad acá y no es un olvido: todo el mundo puede ver y corregir lo
 * suyo. Lo que se gobierna con capacidades es tocar lo de OTRO, y eso vive en
 * `/equipo`.
 *
 * Y desde el 26-08-2026 no es la única: el seller, el conductor y el super-admin
 * tienen la suya. Las cuatro se arman con las mismas piezas
 * (`components/perfil/secciones-perfil.tsx`) para que la explicación de por qué
 * el correo no se edita sea UNA, no cuatro que se van separando.
 *
 * -----------------------------------------------------------------------------
 * QUÉ SE EDITA Y QUÉ SOLO SE MIRA
 * -----------------------------------------------------------------------------
 * · **Se edita:** nombre y teléfono. Son suyos y no cambian lo que puede hacer.
 * · **Se mira:** el correo, el rol —que lo cambia el dueño, no uno mismo— y los
 *   permisos que ese rol trae.
 * · **Se delega:** la contraseña, al flujo de recuperación que ya existe.
 *
 * -----------------------------------------------------------------------------
 * 🔴 LOS PERMISOS SALEN DEL CATÁLOGO
 * -----------------------------------------------------------------------------
 * `capacidadesLegiblesDeRol`, igual que Equipo. Una lista escrita a mano acá
 * diría lo que el rol permitía el día que se escribió. Y el lado «no puedes» va
 * acotado a la familia del rol: a un dueño no se le dice que «no puede ver su
 * ruta del día», porque eso es del conductor.
 */
export default async function PaginaMiPerfil() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  // El teléfono NO viaja en la sesión —no está en los claims— así que se lee.
  // Y se lee con `service_role` porque la columna está fuera de la vista de
  // `public` a propósito: es dato personal (ver la migración 20260826000003).
  const { data: perfil } = await crearClienteServiceRole()
    .schema("identidad")
    .from("usuarios_perfil")
    .select("nombre_completo, telefono, creado_en")
    .eq("id", sesion.usuarioId)
    .eq("tenant_id", sesion.usuario.tenantId)
    .maybeSingle();

  const telefonoE164 = (perfil?.telefono as string | null) ?? null;
  const rol = sesion.usuario.rol;
  const interno = esRolInterno(rol);
  const { vaAPoder, noVaAPoder } = capacidadesLegiblesDeRol(rol);

  return (
    <PantallaConfiguracion
      titulo="Mi perfil"
      bajada="Tus datos y lo que tu rol te permite hacer. Para cambiar el rol de alguien —incluido el tuyo— hace falta el dueño de la cuenta."
    >
      <SeccionPerfil titulo="Tus datos" className="space-y-4">
        <FormularioMiPerfil
          nombreInicial={(perfil?.nombre_completo as string | null) ?? sesion.nombreCompleto ?? ""}
          telefonoInicial={telefonoE164 ? formatearTelefonoLegible(telefonoE164) : ""}
          ayudaNombre="Es el nombre con el que te ve tu equipo, y el que queda en la bitácora junto a cada cosa que hagas."
          ayudaTelefono="Opcional. Déjalo en blanco para quitarlo."
        />
      </SeccionPerfil>

      <SeccionPerfil titulo="Tu cuenta">
        <dl className="space-y-2.5">
          <BloqueCorreo email={sesion.email} />

          <DatoPerfil termino="Rol" conSeparador>
            <Badge variant="outline">
              {interno ? DESCRIPCIONES_ROLES_INTERNOS[rol].etiqueta : rol}
            </Badge>
          </DatoPerfil>
          <NotaPerfil>{describirRol(rol)}</NotaPerfil>

          <DatoDesdeCuando
            rotulo="En este courier desde"
            fechaIso={perfil?.creado_en as string | undefined}
          />
        </dl>
      </SeccionPerfil>

      <SeccionPerfil titulo="Qué puedes hacer">
        <ListaCapacidades
          rotulo="Puedes"
          tono="balanced"
          items={vaAPoder}
          vacio="Tu rol no habilita ninguna acción."
          colapsable
          umbral={8}
        />
        <ListaCapacidades
          rotulo="No puedes"
          tono="muted"
          items={noVaAPoder}
          vacio="Nada queda fuera de tu rol."
          colapsable
        />
      </SeccionPerfil>

      <SeccionContrasena email={sesion.email} />
    </PantallaConfiguracion>
  );
}
