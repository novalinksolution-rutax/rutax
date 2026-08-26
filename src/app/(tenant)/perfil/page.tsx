import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListaCapacidades } from "@/components/ui/bloque-capacidades";
import { formatearTelefonoLegible } from "@/lib/telefono-cl";
import { capacidadesLegiblesDeRol, describirRol } from "@/modules/identidad/capacidades-legibles";
import { DESCRIPCIONES_ROLES_INTERNOS } from "@/modules/identidad/descripciones-roles";
import { esRolInterno } from "@/modules/identidad/roles";
import { PantallaConfiguracion } from "../configuracion/_componentes/pantalla-configuracion";
import { FormularioPerfil } from "./formulario-perfil";

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
 * -----------------------------------------------------------------------------
 * QUÉ SE EDITA Y QUÉ SOLO SE MIRA
 * -----------------------------------------------------------------------------
 * · **Se edita:** nombre y teléfono. Son suyos y no cambian lo que puede hacer.
 * · **Se mira:** el correo —es la identidad y la llave de entrada; cambiarlo
 *   pasa por re-verificación y por la regla «un correo, una cuenta»—, el rol
 *   —que lo cambia el dueño, no uno mismo— y los permisos que ese rol trae.
 * · **Se delega:** la contraseña, al flujo de recuperación que ya existe. Un
 *   segundo camino para lo mismo son dos sitios donde equivocarse, y ése ya
 *   manda su correo y tiene su rastro.
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
  // `public` a propósito: es dato personal (ver la migración 20260826000001).
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
      <section className="space-y-4 border border-line bg-bg-raised px-5 py-5">
        <h2 className="font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">
          Tus datos
        </h2>
        <FormularioPerfil
          nombreInicial={(perfil?.nombre_completo as string | null) ?? sesion.nombreCompleto ?? ""}
          telefonoInicial={telefonoE164 ? formatearTelefonoLegible(telefonoE164) : ""}
        />
      </section>

      <section className="space-y-3 border border-line bg-bg-raised px-5 py-5">
        <h2 className="font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">
          Tu cuenta
        </h2>

        <dl className="space-y-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt className="text-sm text-fg-muted">Correo</dt>
            <dd className="rx-num text-sm text-fg">{sesion.email ?? "Sin correo registrado"}</dd>
          </div>
          {/* Por qué no se puede editar, dicho donde se pregunta. Un campo
              deshabilitado sin explicación se lee como algo roto. */}
          <p className="text-xs leading-relaxed text-fg-muted">
            Es con lo que entras, así que no se cambia desde acá: hacerlo exige verificar el correo
            nuevo y hay un rato en que podrías quedarte fuera de tu propia cuenta. Si necesitas
            cambiarlo, escríbenos.
          </p>

          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line pt-2.5">
            <dt className="text-sm text-fg-muted">Rol</dt>
            <dd className="flex items-center gap-2">
              <Badge variant="outline">
                {interno ? DESCRIPCIONES_ROLES_INTERNOS[rol].etiqueta : rol}
              </Badge>
            </dd>
          </div>
          <p className="text-xs leading-relaxed text-fg-muted">{describirRol(rol)}</p>

          {perfil?.creado_en ? (
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line pt-2.5">
              <dt className="text-sm text-fg-muted">En este courier desde</dt>
              <dd className="rx-num text-sm text-fg">
                {new Date(perfil.creado_en as string).toLocaleDateString("es-CL", {
                  timeZone: "America/Santiago",
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="space-y-3 border border-line bg-bg-raised px-5 py-5">
        <h2 className="font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">
          Qué puedes hacer
        </h2>
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
      </section>

      <section className="space-y-3 border border-line bg-bg-raised px-5 py-5">
        <h2 className="font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">
          Tu contraseña
        </h2>
        <p className="text-sm leading-relaxed text-fg-muted">
          Se cambia por el mismo camino que si la olvidaras: te mandamos un enlace a{" "}
          {sesion.email ?? "tu correo"} y la defines ahí. Así nadie puede cambiártela por tenerte la
          sesión abierta en un computador prestado.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/recuperar-contrasena">Cambiar mi contraseña</Link>
        </Button>
      </section>
    </PantallaConfiguracion>
  );
}
