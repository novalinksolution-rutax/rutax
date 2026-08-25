/**
 * Job 7 · notificacion/conexion-caida
 * =====================================================================
 * Trigger: evento `notificacion/conexion-caida`
 * (publicado por `sondeo-salud.ts` cuando una conexión escala a 'desvinculada')
 *
 * -----------------------------------------------------------------------------
 * EL CORREO QUE LLEVABA UN AÑO COMENTADO
 * -----------------------------------------------------------------------------
 * Este job registraba la caída en bitácora, la escribía en el log y **ahí se
 * quedaba**: el envío estaba comentado, apuntando a una `plantillaConexionCaida`
 * que nunca existió. O sea que una conexión de Mercado Libre se caía, los
 * pedidos de ese seller dejaban de entrar, y nadie se enteraba hasta que alguien
 * abría el panel.
 *
 * Ahora se envía de verdad, por la plantilla común (`envolverEmail`) y por el
 * mismo puerto que el resto del producto. La deduplicación no cambia: una por
 * `(seller, día)`, registrada antes del envío.
 *
 * ⚠️ **Va al COURIER, no al seller.** El seller ve el aviso en su portal —y
 * puede reconectar desde ahí—, pero quien pierde plata mientras la conexión está
 * caída es el courier: son entregas que no va a hacer. Es él quien tiene que
 * llamar.
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
import { envolverEmail } from "@/lib/email/plantilla-email";
import { enviarNotificacionEmail } from "@/modules/plataforma/notificaciones";
import { resolverUrlBaseApp } from "@/modules/identidad/enlace-invitacion";

/**
 * El correo de conexión caída.
 *
 * Dice **la consecuencia antes que el hecho**: «conexión desvinculada» es
 * vocabulario de OAuth y no le dice a nadie que dejó de entrar trabajo.
 *
 * Y **no promete un diagnóstico que el sistema no tiene**: token vencido,
 * revocado y fallo de descifrado terminan los tres en el mismo estado y no se
 * pueden distinguir desde acá. Reconectar arregla los tres, así que el correo
 * dice eso en vez de aventurar cuál fue.
 */
export function construirEmailConexionCaida(args: {
  nombreSeller: string;
  urlPanel: string | null;
}): { asunto: string; html: string; texto: string } {
  return {
    // «Dejamos de recibir», no «dejaron de entrar»: el sujeto somos nosotros.
    // La forma impersonal suena a que algo pasó solo; ésta dice quién se quedó
    // sin los pedidos, que es lo que el courier necesita entender de un vistazo
    // en la bandeja.
    asunto: `Dejamos de recibir los pedidos de «${args.nombreSeller}»`,
    html: envolverEmail({
      marca: "Rutax",
      titular: `Se cayó la conexión de ${args.nombreSeller} con Mercado Libre`,
      preencabezado: "Sus pedidos nuevos no están entrando",
      cuerpoHtml:
        "<p style=\"margin:0\"><strong>Sus pedidos nuevos dejaron de entrar a Rutax.</strong> " +
        "Los que ya estaban siguen en el sistema y se despachan normal; lo que se detuvo es " +
        "la llegada de los nuevos.</p>" +
        "<p style=\"margin:12px 0 0\">Mercado Libre dejó de aceptar el permiso. Puede ser que " +
        "caducara solo, que el seller lo revocara o que algo fallara de nuestro lado: no se " +
        "puede distinguir cuál de los tres, y reconectar arregla los tres igual.</p>" +
        "<p style=\"margin:12px 0 0\">El seller también lo ve en su portal y puede reconectar " +
        "desde ahí. Si no lo hace hoy, conviene llamarlo.</p>" +
        // ⚠️ Que se arregla en menos de un minuto **va en el correo**, y no es
        // relleno: sin ese dato, «se cayó la conexión con Mercado Libre» se lee
        // como un problema técnico que hay que escalar, y se pospone. Con él, se
        // resuelve en el momento.
        "<p style=\"margin:12px 0 0\">Reconectar toma menos de un minuto: son dos clics y " +
        "entrar con la cuenta de Mercado Libre del seller.</p>",
      datos: [{ etiqueta: "Seller", valor: args.nombreSeller, destacada: true }],
      // «Volver a conectar», no «Ver sus conexiones»: la acción del correo es la
      // que resuelve el problema, no la que lleva a mirarlo.
      ...(args.urlPanel ? { accion: { etiqueta: "Volver a conectar", url: args.urlPanel } } : {}),
      motivoRecepcion:
        "Recibes este correo porque administras la operación de tu courier en Rutax. " +
        "El estado de las conexiones está en Clientes → el seller.",
    }),
    texto:
      `Se cayó la conexión de ${args.nombreSeller} con Mercado Libre y sus pedidos nuevos ` +
      `dejaron de entrar. Los que ya estaban se despachan normal.

` +
      `Reconectar toma menos de un minuto y lo arregla; el seller también puede hacerlo desde ` +
      `su portal.`,
  };
}

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

      logger.info(
        `[NOTIFICACION] Conexión ML caída para seller '${nombreSeller}' ` +
          `(tenant: ${nombreTenant}). ` +
          `Email destino: ${emailDestino ?? "no configurado"}. ` +
          "Acción requerida: reconectar la cuenta ML del seller.",
      );

      // El envío, que hasta hoy era un TODO comentado.
      // ---------------------------------------------------------------------
      // ⚠️ Envuelto: un correo que no sale no puede tumbar el job que registra
      // la caída. La bitácora ya quedó escrita más arriba, así que la
      // deduplicación se sostiene aunque el envío falle — y el siguiente sondeo
      // NO va a reintentar el correo, porque la caída ya está marcada como
      // avisada hoy. Es el precio de deduplicar por hecho y no por envío, y se
      // acepta: la alternativa es que un proveedor de correo intermitente
      // mande el mismo aviso cinco veces.
      let notificado = false;
      if (emailDestino) {
        try {
          const base = resolverUrlBaseApp();
          const contenido = construirEmailConexionCaida({
            nombreSeller,
            urlPanel: base ? `${base}/sellers/${sellerId}` : null,
          });
          const envio = await enviarNotificacionEmail({
            para: emailDestino,
            asunto: contenido.asunto,
            html: contenido.html,
            texto: contenido.texto,
          });
          notificado = envio.enviado;
          if (!envio.enviado) {
            logger.warn(
              `Seller ${sellerId}: conexión caída registrada pero NO avisada por correo ` +
                `(modo=${envio.modo}).`,
            );
          }
        } catch (err) {
          logger.warn(
            `Seller ${sellerId}: falló el correo de conexión caída — ` +
              `${err instanceof Error ? err.message : "error desconocido"}.`,
          );
        }
      }

      return { emailDestino, notificado };
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
