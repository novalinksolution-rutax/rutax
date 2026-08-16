/**
 * Envía por correo el aviso de una incidencia sin gestionar.
 *
 * Une las tres piezas que ya existían por separado y nunca se habían conectado:
 * quién recibe (`identidad/destinatarios-internos`), qué dice
 * (`./aviso-incidencia-email`) y por dónde sale (el puerto de email, que hoy
 * resuelve a Resend en producción y a un stub en sandbox).
 *
 * =============================================================================
 * NUNCA LANZA, Y ESO ES LA DECISIÓN, NO UN DESCUIDO
 * =============================================================================
 * Este envío corre DENTRO del barrido que recorre las incidencias de todos los
 * tenants. Si una dirección rebota, si el proveedor está caído o si un courier
 * no tiene ni un usuario activo, el resto de las incidencias tiene que seguir
 * detectándose igual. Un problema de bandeja de entrada no puede apagar la
 * vigilancia operativa de toda la plataforma.
 *
 * El aviso ya quedó en bitácora antes de llegar acá, así que lo peor que puede
 * pasar es volver al estado anterior a esta feature: la alerta existe, solo que
 * nadie recibe el correo.
 *
 * =============================================================================
 * LEE EL PEDIDO PARA EL CÓDIGO Y LA COMUNA — Y SOLO ESO
 * =============================================================================
 * El `select` es explícito y corto a propósito. Un `select('*')` traería el
 * nombre, la dirección y el teléfono del destinatario a un módulo cuyo trabajo
 * es mandar texto fuera del sistema; que esos campos ni siquiera estén en
 * memoria es la forma más barata de garantizar que no se cuelen en el correo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverDestinatariosInternos } from "@/modules/identidad/destinatarios-internos";
import { obtenerPuertoEmail } from "@/modules/integraciones/notificaciones/email";
import { TEXTO_TIPO_INCIDENCIA } from "@/lib/ui/traduccion-estados";
import type { TipoIncidencia } from "./tipos";
import { construirAvisoIncidencia } from "./aviso-incidencia-email";

export async function enviarAvisoIncidencia(
  cliente: SupabaseClient,
  args: {
    tenantId: string;
    pedidoId: string;
    tipoIncidencia: string;
    horasAbierta: number;
  },
): Promise<void> {
  try {
    const destinatarios = await resolverDestinatariosInternos(cliente, args.tenantId);
    if (destinatarios.length === 0) return;

    const [{ data: pedido }, { data: tenant }] = await Promise.all([
      cliente
        .from("pedidos")
        .select("codigo_interno, ml_shipment_id, destinatario_comuna")
        .eq("id", args.pedidoId)
        .eq("tenant_id", args.tenantId)
        .maybeSingle(),
      cliente
        .from("tenants")
        .select("nombre_fantasia")
        .eq("id", args.tenantId)
        .maybeSingle(),
    ]);

    // Sin pedido no hay nada que decir: un aviso que no identifica el envío
    // obliga a buscarlo, que es justo lo que el correo viene a evitar.
    if (!pedido) return;

    const contenido = construirAvisoIncidencia({
      // Misma regla de código visible que la Torre: shipment de ML en Flex,
      // código interno en same-day. Nunca el `tracking_token`, que es público.
      codigoEnvio:
        (pedido.ml_shipment_id as string | null) ??
        (pedido.codigo_interno as string | null) ??
        "Sin código",
      comuna: (pedido.destinatario_comuna as string | null) ?? "Sin comuna",
      tipoIncidencia:
        // Se reusa el catálogo que ya ve el humano en pantalla en vez de
        // escribir uno paralelo: dos traducciones del mismo enum terminan
        // diciendo cosas distintas del mismo problema.
        TEXTO_TIPO_INCIDENCIA[args.tipoIncidencia as TipoIncidencia] ?? args.tipoIncidencia,
      horasAbierta: args.horasAbierta,
      pedidoId: args.pedidoId,
      nombreCourier: (tenant?.nombre_fantasia as string | null) ?? "tu courier",
    });

    const puerto = obtenerPuertoEmail();
    // Secuencial y no en paralelo: son como mucho 5 correos y el proveedor
    // agradece no recibir una ráfaga por cada incidencia de cada tenant.
    for (const destinatario of destinatarios) {
      try {
        await puerto.enviarEmail({
          para: destinatario.email,
          asunto: contenido.asunto,
          html: contenido.html,
          texto: contenido.texto,
        });
      } catch {
        // El fallo de UNO no deja sin aviso a los demás.
      }
    }
  } catch {
    // Ver la cabecera: el aviso ya está en bitácora.
  }
}
