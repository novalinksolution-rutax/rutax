import "server-only";

/**
 * Acceso a la app — ¿tiene cuenta, invitación pendiente, o nada? El estado se
 * resuelve SIEMPRE en el servidor: invitar dos veces al mismo conductor, o no
 * saber si ya se invitó, es exactamente la fricción que la sección de acceso
 * viene a quitar (encargo).
 *
 * Vive aparte de `page.tsx` porque lo usan DOS superficies: la ficha
 * (`/conductores/[id]`) y el cajón de la nómina (`/conductores`, vía
 * `consultarAccesoAppConductor`). Una sola verdad para las dos.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { enmascararTelefono } from "@/lib/telefono-cl";
import type { EstadoAccesoAppConductor } from "./acceso-app-conductor";
import type { OrigenCorreo } from "./datos-contacto-conductor";

/**
 * Tope de cuentas a inspeccionar por conductor. Lo normal es UNA; dos ya es una
 * anomalía que hay que mostrar. El tope existe para que un dato corrupto no
 * dispare una ráfaga de llamadas a `auth.admin` en el render de una página.
 */
const MAX_CUENTAS_A_MOSTRAR = 5;

export async function resolverEstadoAccesoApp(
  cliente: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
  driverId: string,
): Promise<{ acceso: EstadoAccesoAppConductor; correo: OrigenCorreo }> {
  // ⚠️ NO lleva `.maybeSingle()`, y ese detalle era un bug real.
  //
  // Un conductor puede terminar con MÁS DE UNA cuenta —dos invitaciones al
  // mismo driver con correos distintos, que es justo lo que marca
  // `entidad_compartida` en el backstage—. Con dos filas, `maybeSingle()`
  // devuelve error, `data` queda en `null`, y como el error se descartaba la
  // pantalla concluía «sin acceso a la app» y ofrecía invitar… a alguien que ya
  // tenía DOS formas de entrar. El caso raro producía exactamente la respuesta
  // contraria a la verdad.
  const { data: perfiles } = await cliente
    .from("usuarios_perfil")
    .select("id, estado")
    .eq("driver_id", driverId)
    .eq("tenant_id", tenantId)
    .eq("tipo_usuario", "conductor")
    .order("creado_en", { ascending: true })
    .limit(MAX_CUENTAS_A_MOSTRAR);

  if (perfiles && perfiles.length > 0) {
    // Si hay varias, manda la activa: la pregunta que responde esta sección es
    // «¿puede entrar?», y basta con que una lo permita.
    const perfil = perfiles.find((p) => p.estado === "activo") ?? perfiles[0];
    const activo = perfil.estado === "activo";

    // El correo NO está en `usuarios_perfil`: el perfil cuelga de `auth.users`
    // por su `id`, y el correo vive ahí. De ahí este segundo salto por la API de
    // admin — no hay forma de traerlo en el select.
    const { data: cuentaAuth } = await cliente.auth.admin.getUserById(perfil.id as string);
    const email = cuentaAuth?.user?.email ?? null;

    return {
      acceso: activo ? { tipo: "cuenta_activa" } : { tipo: "cuenta_suspendida" },
      correo: email
        ? { tipo: "cuenta", email, cuentasDeMas: perfiles.length - 1 }
        : { tipo: "sin_cuenta" },
    };
  }

  // F4.a (2026-09-15): la invitación del conductor va por TELÉFONO, no por
  // correo — ya no se selecciona `email`/`email_estado`/`email_motivo` (WhatsApp
  // no se rastrea con esos campos; ver `enmascararTelefono`).
  const { data: invitacionData } = await cliente
    .from("invitaciones")
    .select("telefono, estado, expira_en")
    .eq("driver_id", driverId)
    .eq("tenant_id", tenantId)
    .eq("tipo_usuario", "conductor")
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!invitacionData) {
    return { acceso: { tipo: "sin_acceso", ultimaInvitacionVencida: null }, correo: { tipo: "sin_cuenta" } };
  }

  const invitacion = invitacionData as {
    telefono: string | null;
    estado: string;
    expira_en: string;
  };
  const expiraEnMs = new Date(invitacion.expira_en).getTime();
  const vigente = invitacion.estado === "pendiente" && expiraEnMs > Date.now();

  if (vigente) {
    return {
      acceso: {
        tipo: "invitacion_pendiente",
        // `telefono` puede faltar solo en una invitación RESIDUAL creada antes de
        // F4.a (por correo) — ver migración 20260915000001. No hay mascara que
        // mostrar en ese caso puntual, así que se degrada a "—".
        telefonoMascara: invitacion.telefono ? enmascararTelefono(invitacion.telefono) : "—",
        expiraEn: invitacion.expira_en,
      },
      // Una invitación por teléfono no es un contacto de correo: no hay email
      // que mostrar en la sección de datos de contacto.
      correo: { tipo: "sin_cuenta" },
    };
  }

  // Sin cuenta ni invitación vigente: si la última invitación quedó vencida
  // (pendiente cuyo plazo pasó, o ya marcada `expirada`) se lo decimos al
  // courier en vez de aparentar que nunca se invitó — pero NO para una
  // `revocada`, que es una decisión explícita, no un vencimiento.
  const vencida =
    (invitacion.estado === "pendiente" || invitacion.estado === "expirada") && expiraEnMs <= Date.now();

  return {
    acceso: { tipo: "sin_acceso", ultimaInvitacionVencida: vencida ? invitacion.expira_en : null },
    // Una invitación vencida o revocada NO es un correo que mostrar como
    // contacto: nadie puede entrar con él y ya no representa nada vigente.
    correo: { tipo: "sin_cuenta" },
  };
}
