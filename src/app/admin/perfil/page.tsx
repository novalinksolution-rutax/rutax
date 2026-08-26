import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BloqueCorreo,
  ContenidoContrasena,
  DatoDesdeCuando,
  DatoPerfil,
  NotaPerfil,
} from "@/components/perfil/secciones-perfil";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  exigirSuperAdmin,
  type ActorSuperAdmin,
} from "@/modules/plataforma/autorizacion-admin";
import { FormularioNombreAdmin } from "./formulario-nombre-admin";

export const metadata: Metadata = {
  title: "Mi perfil · Backstage",
};

// El AAL de la sesión cambia entre requests (login nuevo, step-up); nunca cachear.
export const dynamic = "force-dynamic";

/**
 * `/admin/perfil` — los datos propios del super-admin de Rutax.
 * =============================================================================
 *
 * El usuario pidió (26-08-2026) que «Mi perfil» valga para todos los roles. El
 * backstage era el que no tenía nada: el bloque de cuenta del sidebar mostraba
 * el **correo** en el sitio del nombre —el nombre existía en la base y no se
 * usaba en ninguna parte— y no llevaba a ningún lado.
 *
 * -----------------------------------------------------------------------------
 * EN QUÉ SE PARECE Y EN QUÉ NO A LA DEL PRODUCTO
 * -----------------------------------------------------------------------------
 * Se parece en lo que importa: el correo se muestra y no se edita, la contraseña
 * se delega al flujo de recuperación, y el texto de las dos cosas sale de las
 * mismas piezas compartidas — para que la explicación sea una sola.
 *
 * Cambia en tres:
 * · **No hay teléfono.** `plataforma.super_admins` no tiene esa columna, y no se
 *   agrega una para que la pantalla calce con las otras.
 * · **No hay lista de capacidades.** El backstage no se gobierna con el catálogo
 *   RBAC del courier: son dos roles, `admin_total` y `soporte_lectura`, y lo que
 *   los separa se dice en una frase mejor que en dos listas.
 * · **Sí hay un bloque de seguridad.** Es la única superficie donde el segundo
 *   factor es obligatorio para trabajar, así que su estado se muestra acá y no
 *   solo escondido en otra pantalla.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ Un `soporte_lectura` TAMBIÉN entra y edita su nombre
 * -----------------------------------------------------------------------------
 * «Solo lectura» describe su poder sobre el negocio de un courier, no sobre su
 * propio nombre mal escrito. El razonamiento completo, y por qué el cambio se
 * audita, está en `actions.ts`.
 */
export default async function PaginaPerfilAdmin() {
  let actor: ActorSuperAdmin;
  try {
    actor = await exigirSuperAdmin();
  } catch {
    redirect("/admin/login");
  }

  // `creado_en` no viaja en el actor —éste se resuelve en cada request y carga
  // solo lo que los gates necesitan—, así que se lee acá.
  const { data: fila } = await crearClienteServiceRole()
    .schema("plataforma")
    .from("super_admins")
    .select("creado_en")
    .eq("usuario_id", actor.usuarioId)
    .maybeSingle();

  const esAdminTotal = actor.rolAdmin === "admin_total";
  const conMfa = actor.aal === "aal2" || actor.aalSiguiente === "aal2";

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Mi perfil</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tu cuenta de administrador de la plataforma. No es una cuenta de ningún courier.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">Tus datos</h2>
        <FormularioNombreAdmin nombreInicial={actor.nombre} />
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">Tu cuenta</h2>
        <dl className="space-y-2.5">
          <BloqueCorreo email={actor.email} />

          <DatoPerfil termino="Rol" conSeparador>
            <Badge variant={esAdminTotal ? "outline" : "neutral"}>
              {esAdminTotal ? "Administrador total" : "Soporte (solo lectura)"}
            </Badge>
          </DatoPerfil>
          <NotaPerfil>
            {esAdminTotal
              ? "Puedes ver y cambiar cualquier cosa del backstage: planes, suscripciones, cobros y accesos."
              : "Puedes ver todo el backstage, pero no cambiar nada: los controles que escriben están apagados para tu rol. Tu nombre sí lo puedes corregir."}
          </NotaPerfil>
          <NotaPerfil>
            Quién es administrador y con qué rol lo decide la gobernanza de la plataforma, no esta
            pantalla.
          </NotaPerfil>

          <DatoDesdeCuando
            rotulo="En Rutax desde"
            fechaIso={fila?.creado_en as string | undefined}
          />
        </dl>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">Tu segundo factor</h2>
        {/* No se dice solo «activo/inactivo»: se dice qué significa. En el
            backstage el MFA no es un ajuste opcional — sin él no se entra, así
            que quien lo ve apagado tiene que entender que le falta un paso, no
            que se perdió una comodidad. */}
        <p className="text-sm leading-relaxed text-fg-muted">
          {conMfa
            ? "Tienes la verificación en dos pasos configurada. Es obligatoria: el backstage no se abre sin ella."
            : "Todavía no tienes segundo factor. Es obligatorio para entrar al backstage, así que hasta configurarlo no vas a poder trabajar acá."}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/seguridad">
            {conMfa ? "Ver mi verificación en dos pasos" : "Configurar mi segundo factor"}
          </Link>
        </Button>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">Tu contraseña</h2>
        <ContenidoContrasena email={actor.email} />
      </section>
    </div>
  );
}
