/**
 * Servicio de envío de notificaciones por WhatsApp.
 * =============================================================================
 * Recibe «pasó tal cosa en tal courier», resuelve a quién hay que escribirle,
 * arma la plantilla, la manda por el puerto y deja constancia en
 * `integraciones.whatsapp_mensajes`.
 *
 * -----------------------------------------------------------------------------
 * LA IDEMPOTENCIA VA PRIMERO, Y NO ES OPCIONAL
 * -----------------------------------------------------------------------------
 * La Cloud API de Meta NO acepta idempotency key, y los jobs de este proyecto
 * reintentan por diseño. Un timeout sobre una llamada que SÍ llegó mandaría el
 * mensaje dos veces y **cobraría dos veces**.
 *
 * El orden es: **primero se reserva la fila, después se llama a Meta.** La
 * reserva es un INSERT contra el índice único
 * `(tenant_id, contacto_id, clave_idempotencia)`; si choca, alguien ya mandó
 * este aviso a este contacto y no se vuelve a enviar. Al revés —llamar y
 * después registrar— el duplicado ya se cobró cuando nos damos cuenta.
 *
 * Queda una ventana estrecha e inevitable: si el proceso muere entre el "Meta
 * aceptó" y el UPDATE, el reintento ve la fila en `encolado` y vuelve a enviar.
 * Sin idempotency key del lado del proveedor no hay forma de cerrarla; se acota
 * a esa grieta en vez de dejarla abierta de par en par.
 *
 * -----------------------------------------------------------------------------
 * NUNCA LANZA POR UN FALLO DE ENVÍO
 * -----------------------------------------------------------------------------
 * Un aviso que no salió no puede deshacer el retiro que ya se cerró. Los fallos
 * vuelven contados en el resultado; el job que llama decide si el fallo es
 * reintentable y, solo en ese caso, lanza dentro de su `step.run` para que
 * Inngest reintente con su propio backoff. Sí lanza ante un fallo de BASE: eso
 * no es "el aviso no salió", es "no sé qué pasó", y ahí el reintento sirve.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { capturarMensaje } from "@/lib/observabilidad";
import { obtenerPuertoWhatsApp } from "./fabrica-whatsapp";
import { obtenerPlantilla, clavesEventoConocidas } from "./catalogo-plantillas";
import type { PuertoWhatsApp } from "./puerto-whatsapp";

/** Estados desde los que NO se vuelve a intentar: el mensaje ya tuvo su turno. */
const ESTADOS_YA_RESUELTOS = new Set(["enviado", "entregado", "leido", "fallido"]);

export interface DestinoNotificacion {
  /** SIEMPRE obligatorio: todo aviso va a los contactos de un seller. */
  sellerId?: string | null;
}

export interface SolicitudNotificacion {
  tenantId: string;
  /** Clave del catálogo (`retiro_completado`, `prueba_conexion`…). */
  claveEvento: string;
  /**
   * Qué hecho concreto originó el aviso: el id de la sesión de retiro, del
   * manifiesto, del pedido. Es la mitad variable de la llave de idempotencia —
   * **sin esto, dos retiros distintos del mismo día se considerarían el mismo
   * aviso y el segundo no saldría nunca.**
   */
  referencia: string;
  destino?: DestinoNotificacion;
  /** Variables del cuerpo EN ORDEN. Debe calzar con el catálogo. */
  variables: string[];
}

export type MotivoRechazo =
  | "evento_desconocido"
  | "variables_no_calzan"
  | "destino_incompleto"
  | "sin_destinatarios";

export interface DetalleEnvio {
  contactoId: string;
  resultado: "enviado" | "duplicado" | "fallido";
  metaMessageId?: string;
  error?: string;
  /** Solo en `fallido`: ¿vale la pena que el job reintente? */
  reintentable?: boolean;
}

export interface ResultadoNotificacion {
  ok: boolean;
  /** Presente solo si `ok === false` por una razón previa al envío. */
  rechazo?: MotivoRechazo;
  /** Explicación en castellano, apta para devolver por HTTP. Nunca lleva el teléfono. */
  mensaje?: string;
  enviados: number;
  duplicados: number;
  fallidos: number;
  detalles: DetalleEnvio[];
}

interface FilaContacto {
  id: string;
  telefono_e164: string;
  idioma: string;
}

function rechazo(motivo: MotivoRechazo, mensaje: string): ResultadoNotificacion {
  return { ok: false, rechazo: motivo, mensaje, enviados: 0, duplicados: 0, fallidos: 0, detalles: [] };
}

/**
 * Manda el aviso a todos los contactos que corresponden.
 *
 * @param puerto Inyectable para pruebas. En producción se omite y lo resuelve
 *   la fábrica, que aplica el gate sandbox/real.
 */
export async function enviarNotificacionWhatsApp(
  solicitud: SolicitudNotificacion,
  puerto: PuertoWhatsApp = obtenerPuertoWhatsApp(solicitud.tenantId),
): Promise<ResultadoNotificacion> {
  const { tenantId, claveEvento, referencia, variables } = solicitud;

  // ---- 1. La plantilla ------------------------------------------------------
  const plantilla = obtenerPlantilla(claveEvento);
  if (!plantilla) {
    return rechazo(
      "evento_desconocido",
      `El evento "${claveEvento}" no existe. Los conocidos son: ${clavesEventoConocidas().join(", ")}.`,
    );
  }

  // Se compara ANTES de llamar a Meta. Mandar 4 variables a una plantilla de 5
  // es un 400 del proveedor; acá se atrapa gratis y con un mensaje que dice qué
  // falta, en vez de "param mismatch".
  if (variables.length !== plantilla.variables.length) {
    return rechazo(
      "variables_no_calzan",
      `La plantilla "${plantilla.nombre}" espera ${plantilla.variables.length} ` +
        `variable(s) (${plantilla.variables.join(", ")}) y llegaron ${variables.length}.`,
    );
  }

  // ---- 2. Los destinatarios -------------------------------------------------
  const cliente = crearClienteServiceRole();

  // TODO aviso va a los contactos de UN seller — no hay otro tipo de
  // destinatario (decisión del usuario, 2026-08-25). El seller es siempre
  // obligatorio y por eso se comprueba antes de tocar la base.
  const sellerId = solicitud.destino?.sellerId;
  if (!sellerId) {
    return rechazo(
      "destino_incompleto",
      `Falta "sellerId": todo aviso de WhatsApp va dirigido a los contactos de un seller.`,
    );
  }

  const { data: contactos, error: errorContactos } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .select("id, telefono_e164, idioma")
    .eq("tenant_id", tenantId)
    .eq("seller_id", sellerId)
    // ⚠️ La barrera de consentimiento. Es la única condición que impide que
    // Rutax le escriba a alguien que no dijo que sí, y va en la consulta —no en
    // un `if` posterior— para que no haya forma de saltársela por descuido.
    //
    // Nota: acá caen TODOS los contactos del seller, tanto el suyo propio como
    // los que Rutax agregó (la pareja, el jefe de bodega). Es deliberado: son
    // destinatarios del mismo aviso, y cada uno tiene su propio consentimiento.
    .eq("opt_in_estado", "otorgado");

  if (errorContactos) {
    // Fallo de BASE: sí se lanza. No es "el aviso no salió", es "no sé si
    // había a quién mandárselo", y ahí el reintento del job sirve.
    throw new Error(`No se pudieron resolver los destinatarios de WhatsApp: ${errorContactos.message}`);
  }

  const destinatarios = (contactos ?? []) as FilaContacto[];
  if (destinatarios.length === 0) {
    // No es un error: es un courier que todavía no cargó contactos, o cuyos
    // contactos se dieron de baja. Se devuelve `ok:false` con motivo propio
    // para que el llamador lo distinga de un fallo y NO reintente.
    return rechazo(
      "sin_destinatarios",
      "Este seller no tiene ningún contacto de WhatsApp con consentimiento otorgado.",
    );
  }

  // ---- 3. Enviar, uno por uno ----------------------------------------------
  const claveIdempotencia = `${claveEvento}:${referencia}`;
  const detalles: DetalleEnvio[] = [];

  for (const contacto of destinatarios) {
    detalles.push(
      await enviarAUnContacto({
        cliente,
        puerto,
        tenantId,
        contacto,
        claveEvento,
        claveIdempotencia,
        nombrePlantilla: plantilla.nombre,
        idioma: plantilla.idioma,
        variables,
      }),
    );
  }

  const enviados = detalles.filter((d) => d.resultado === "enviado").length;
  const duplicados = detalles.filter((d) => d.resultado === "duplicado").length;
  const fallidos = detalles.filter((d) => d.resultado === "fallido").length;

  return { ok: fallidos === 0, enviados, duplicados, fallidos, detalles };
}

interface ArgsEnvioUnitario {
  cliente: ReturnType<typeof crearClienteServiceRole>;
  puerto: PuertoWhatsApp;
  tenantId: string;
  contacto: FilaContacto;
  claveEvento: string;
  claveIdempotencia: string;
  nombrePlantilla: string;
  idioma: string;
  variables: string[];
}

async function enviarAUnContacto(args: ArgsEnvioUnitario): Promise<DetalleEnvio> {
  const { cliente, puerto, tenantId, contacto, claveIdempotencia } = args;

  // ---- 3a. Reservar la fila ANTES de llamar a Meta --------------------------
  const { data: insertada, error: errorInsert } = await cliente
    .schema("integraciones")
    .from("whatsapp_mensajes")
    .insert({
      tenant_id: tenantId,
      contacto_id: contacto.id,
      clave_evento: args.claveEvento,
      nombre_plantilla: args.nombrePlantilla,
      clave_idempotencia: claveIdempotencia,
      variables: args.variables,
      estado: "encolado",
    })
    .select("id, estado")
    .maybeSingle();

  let mensajeId: string;

  if (errorInsert) {
    // 23505 = violación de índice único. Es el camino ESPERADO cuando este
    // aviso ya se mandó: no es un error, es la idempotencia funcionando.
    if (errorInsert.code !== "23505") {
      throw new Error(`No se pudo registrar el mensaje de WhatsApp: ${errorInsert.message}`);
    }

    const { data: existente, error: errorLectura } = await cliente
      .schema("integraciones")
      .from("whatsapp_mensajes")
      .select("id, estado")
      .eq("tenant_id", tenantId)
      .eq("contacto_id", contacto.id)
      .eq("clave_idempotencia", claveIdempotencia)
      .maybeSingle();

    if (errorLectura || !existente) {
      throw new Error("El mensaje de WhatsApp ya existía pero no se pudo leer su estado.");
    }

    if (ESTADOS_YA_RESUELTOS.has(existente.estado as string)) {
      return { contactoId: contacto.id, resultado: "duplicado" };
    }

    // Quedó en `encolado`: un intento anterior murió antes de llamar a Meta o
    // antes de anotar el resultado. Se retoma esa misma fila.
    mensajeId = existente.id as string;
  } else {
    if (!insertada) {
      throw new Error("El INSERT del mensaje de WhatsApp no devolvió la fila.");
    }
    mensajeId = insertada.id as string;
  }

  // ---- 3b. Llamar a Meta ----------------------------------------------------
  const resultado = await puerto.enviarPlantilla({
    telefonoE164: contacto.telefono_e164,
    nombrePlantilla: args.nombrePlantilla,
    idioma: args.idioma,
    variables: args.variables,
  });

  // ---- 3c. Anotar lo que pasó ----------------------------------------------
  if (resultado.enviado && resultado.metaMessageId) {
    const { error } = await cliente
      .schema("integraciones")
      .from("whatsapp_mensajes")
      .update({ estado: "enviado", meta_message_id: resultado.metaMessageId, error_motivo: null })
      .eq("id", mensajeId);

    if (error) {
      // El mensaje SÍ salió. Perder el `wamid` significa que los acuses no van a
      // encontrar su fila, pero no justifica reintentar el envío — eso lo
      // duplicaría. Se registra para que quede visible y se sigue.
      await capturarMensaje("Se envió un WhatsApp pero no se pudo guardar su identificador.", "error", {
        origen: "whatsapp:envio",
      });
    }

    return { contactoId: contacto.id, resultado: "enviado", metaMessageId: resultado.metaMessageId };
  }

  // Fallo. Si es reintentable se deja en `encolado` para que el reintento del
  // job retome esta misma fila; si es permanente se cierra en `fallido` y no se
  // vuelve a tocar.
  await cliente
    .schema("integraciones")
    .from("whatsapp_mensajes")
    .update({
      estado: resultado.reintentable ? "encolado" : "fallido",
      error_motivo: resultado.errorDescripcion ?? "Fallo sin descripción.",
    })
    .eq("id", mensajeId);

  return {
    contactoId: contacto.id,
    resultado: "fallido",
    error: resultado.errorDescripcion,
    reintentable: resultado.reintentable,
  };
}
