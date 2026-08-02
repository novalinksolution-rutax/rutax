/**
 * Job 7 · notificacion/conexion-caida
 * =====================================================================
 * Trigger: evento `notificacion/conexion-caida`
 * (publicado por `sondeo-salud.ts` cuando una conexión escala a 'desvinculada')
 *
 * MVP: loguea la notificación y la registra en bitácora de auditoría para
 * deduplicación. El envío de email real (Resend) se configura en Fase C/devops.
 * La estructura del job está lista para que la única pieza faltante sea el
 * llamado al proveedor de email — ver TODO marcado abajo.
 *
 * Deduplicación: máximo una notificación por `(seller_id, fecha)` por día.
 * Usa la bitácora de auditoría de identidad para registrar y verificar.
 *
 * SEGURIDAD: el payload del evento no contiene tokens, access_token_ref ni
 * ningún secreto — solo sellerId, tenantId y nombreSeller. Verificado en
 * `sondeo-salud.ts` donde se publica.
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { hoyEnSantiago, limitesDelDiaSantiago } from "@/lib/fecha-santiago";

interface EventoConexionCaida {
  sellerId: string;
  tenantId: string;
  nombreSeller: string;
  conexionId: string;
}


export const jobNotificacionConexionCaida = inngest.createFunction(
  {
    id: "notificacion/conexion-caida",
    name: "Notificación · Conexión ML caída",
    triggers: [{ event: "notificacion/conexion-caida" }],
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const payload = event.data as EventoConexionCaida;
    const { sellerId, tenantId, nombreSeller, conexionId } = payload;

    // Paso 1: verificar deduplicación — máximo una notificación por (seller_id, fecha).
    const debeNotificar = await step.run("verificar-deduplicacion", async () => {
      const supabase = crearClienteServiceRole();
      const fechaHoy = hoyEnSantiago();

      // Buscar si ya existe una notificación para este seller hoy.
      // Usamos la bitácora de auditoría (tabla `identidad.bitacora_auditoria`).
      // Columnas: accion='notificacion.conexion_caida', entidad_tipo='seller',
      // entidad_id=sellerId (uuid), creado_en dentro del día de hoy en Santiago.
      // Límites absolutos del día civil de hoy en Santiago.
      // Antes esto hardcodeaba el offset `-03:00`, que solo es correcto en
      // verano: Santiago es −04:00 de abril a septiembre. En invierno la ventana
      // quedaba corrida una hora, así que una notificación enviada entre las
      // 23:00 y la medianoche no se encontraba y el seller recibía un duplicado.
      // `limitesDelDiaSantiago` deja el DST en manos de IANA vía Intl.
      const { desde, hasta } = limitesDelDiaSantiago(fechaHoy);

      const { data, error } = await supabase
        .schema("identidad")
        .from("bitacora_auditoria")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("accion", "notificacion.conexion_caida")
        .eq("entidad_tipo", "seller")
        .eq("entidad_id", sellerId)
        .gte("creado_en", desde.toISOString())
        .lt("creado_en", hasta.toISOString())
        .limit(1);

      if (error) {
        // Error leyendo la bitácora → asumir que no hay notificación y proceder
        logger.warn(`No se pudo verificar deduplicación para seller ${sellerId}: ${error.message}`);
        return true;
      }

      return !data || data.length === 0;
    });

    if (!debeNotificar) {
      logger.info(
        `Notificación de conexión caída para seller ${sellerId} ya enviada hoy. Saltando.`,
      );
      return { resultado: "deduplicado", sellerId };
    }

    // Paso 2: registrar en bitácora de auditoría.
    await step.run("registrar-en-bitacora", async () => {
      const supabase = crearClienteServiceRole();

      // Columnas según esquema de identidad.bitacora_auditoria (migración 0004):
      // actor_usuario_id (nullable), actor_tipo, accion, entidad_tipo, entidad_id, detalle
      await supabase.schema("identidad").from("bitacora_auditoria").insert({
        tenant_id: tenantId,
        actor_usuario_id: null, // Evento de sistema, sin usuario actor
        actor_tipo: "sistema", // Valor del enum actor_tipo_auditoria
        accion: "notificacion.conexion_caida",
        entidad_tipo: "seller",
        entidad_id: sellerId,
        detalle: {
          // Solo datos operativos — nunca tokens, access_token_ref ni secretos
          conexion_id: conexionId,
          nombre_seller: nombreSeller,
          motivo: "Sondeo de salud: segundo fallo consecutivo de token ML.",
        },
      });
    });

    // Paso 3: preparar y (eventualmente) enviar la notificación.
    await step.run("enviar-notificacion", async () => {
      // Datos del destinatario — en MVP buscamos el nombre del tenant y el
      // email del primer usuario interno tipo 'dueno' o 'admin' del tenant.
      const supabase = crearClienteServiceRole();

      const { data: tenantData } = await supabase
        .schema("identidad")
        .from("tenants")
        .select("nombre_fantasia")
        .eq("id", tenantId)
        .maybeSingle();

      // Buscar el email del usuario interno principal (dueño o admin del courier)
      // via auth.users. Los usuarios internos tienen su email en auth.users.
      const { data: usuarioData } = await supabase
        .schema("identidad")
        .from("usuarios_perfil")
        .select("id, tipo_usuario")
        .eq("tenant_id", tenantId)
        .eq("tipo_usuario", "interno")
        .limit(1)
        .maybeSingle();

      // El email real está en auth.users — con service_role podemos leerlo.
      let emailDestino: string | null = null;
      if (usuarioData?.id) {
        const { data: authUser } = await supabase.auth.admin.getUserById(usuarioData.id);
        emailDestino = authUser?.user?.email ?? null;
      }

      const nombreTenant = tenantData?.nombre_fantasia ?? "Courier";

      // En MVP: solo loguear con los datos necesarios para el humano que revise.
      // En Fase C/devops: descomentar el llamado a Resend y eliminar el TODO.
      logger.info(
        `[NOTIFICACION] Conexión ML caída para seller '${nombreSeller}' ` +
          `(tenant: ${nombreTenant}). ` +
          `Email destino: ${emailDestino ?? "no configurado"}. ` +
          "Acción requerida: reconectar la cuenta ML del seller.",
      );

      // TODO (Fase C/devops): implementar envío de email con Resend.
      // Estructura lista para ser completada:
      //
      // if (emailDestino) {
      //   await resend.emails.send({
      //     from: "noreply@tu-dominio.cl",
      //     to: emailDestino,
      //     subject: `Conexión ML caída — ${nombreSeller}`,
      //     html: plantillaConexionCaida({
      //       nombreSeller,
      //       nombreTenant,
      //       urlReconectar: `${process.env.NEXT_PUBLIC_APP_URL}/portal/conectar-ml`,
      //     }),
      //   });
      // }
      //
      // Resend se configura en Fase C (ver docs/arquitectura/fase-c-dinero.md
      // y skill pagos-chile para variables de entorno necesarias).

      return {
        emailDestino,
        notificado: false, // true cuando Resend esté implementado
      };
    });

    return {
      resultado: "procesado",
      sellerId,
      nombreSeller,
      // Nota: en MVP la notificación solo queda en logs y bitácora.
      // El envío de email está pendiente de implementar con Resend (Fase C).
    };
  },
);
