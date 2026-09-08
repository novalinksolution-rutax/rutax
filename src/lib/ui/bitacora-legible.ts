/**
 * La bitácora de plataforma, en lenguaje humano.
 * =============================================================================
 * El visor de `/admin/bitacora` mostraba el `accion` como slug técnico
 * (`plataforma.plan_cambiado`) y el `detalle` como pares clave/valor crudos
 * (`estado_anterior: pendiente_asignacion`, valores JSON largos). Este módulo lo
 * traduce: cada acción tiene su frase, cada clave conocida su etiqueta, y los
 * valores se formatean por tipo (fechas, montos, estados, booleanos).
 *
 * ⚠️ **Nunca se inventa una frase para una acción o clave desconocida.** Si no
 * está en el diccionario, se muestra una versión "des-snake-case" del slug
 * (`plan_cambiado` → «Plan cambiado») en vez de un genérico tipo «acción del
 * sistema»: en una auditoría, un identificador legible-pero-fiel vale más que un
 * rótulo bonito que oculta qué pasó. El slug técnico sigue disponible en el
 * `title` para poder buscarlo en el código.
 */

import { formatearFechaHora, formatearClp } from "@/lib/formato-cl";
import { traducirEstadoPedido } from "@/lib/ui/traduccion-estados";
import type { EstadoPedido } from "@/modules/operacion/tipos";

// ─── Acciones → frase en tercera persona (el autor va aparte) ────────────────

const FRASES_ACCION: Record<string, string> = {
  // Pedidos
  "pedido.cancelado": "Canceló el pedido",
  "pedido.cancelado_por_ml": "Canceló el pedido en Mercado Libre",
  "pedido.estado_corregido_manual": "Corrigió el estado a mano",
  "pedido.estado_actualizado_conductor": "Actualizó el estado desde la app",
  "pedido.cierre_operativo": "Cerró la parada",
  "pedido.reagendado_desde_incidencia": "Reagendó el pedido desde una incidencia",
  "pedido.creado_fuera_corte": "Creó el pedido fuera de la hora de corte",
  "pedido.cumplimiento_notificado_shopify": "Avisó el cumplimiento a Shopify",
  // POD / evidencias
  "pod.capturado": "Registró la prueba de entrega",
  "evidencia.capturada": "Registró una evidencia",
  // Incidencias
  "incidencia.abierta_manual": "Abrió una incidencia",
  "incidencia.reclasificada": "Reclasificó la incidencia",
  "incidencia.resuelta_por_cancelacion": "Cerró la incidencia al cancelarse el pedido",
  "incidencia.resuelta_por_devolucion": "Cerró la incidencia con la devolución",
  "operacion.notificacion_incidencia_sin_gestion": "Avisó por incidencias sin gestionar",
  // Operación varias
  "operacion.etiqueta_descargada": "Descargó la etiqueta",
  "operacion.etiqueta_same_day_descargada": "Descargó la etiqueta same-day",
  "operacion.conductor_caido": "Marcó al conductor como caído",
  "operacion.redistribucion_completada": "Redistribuyó los pedidos del conductor",
  "operacion.pedidos_exportados": "Exportó datos de pedidos",
  "operacion.evidencias_purgadas_por_retencion": "Purgó evidencias por retención",
  "operacion.punto_termino_purgado_por_retencion": "Purgó el punto de término por retención",
  "geocoding.pedido_reubicado": "Reubicó la dirección",
  // Manifiestos
  "manifiesto.pedidos_asignados": "Asignó pedidos a un manifiesto",
  "manifiesto.confirmado": "Confirmó el manifiesto",
  "manifiesto.completado": "Completó el manifiesto",
  "manifiesto.cancelado": "Canceló el manifiesto",
  "manifiesto.parada_quitada": "Quitó una parada del manifiesto",
  // Retiro
  "retiro.sesion_cerrada": "Cerró una sesión de retiro",
  "retiro.sesion_descartada_sin_bultos": "Descartó una sesión de retiro sin bultos",
  "retiro.registrado_desde_web": "Registró un retiro desde la web",
  // Ventanas de corte
  "ventana_corte.guardada": "Guardó una ventana de corte",
  // Conductores
  "conductor.alta": "Dio de alta un conductor",
  "conductor.capacidad_actualizada": "Actualizó la capacidad del conductor",
  "conductor.zonas_actualizadas": "Actualizó las zonas del conductor",
  "conductor.datos_bancarios_actualizados": "Actualizó los datos bancarios del conductor",
  "conductor.vehiculo_declarado": "Declaró el vehículo del conductor",
  "conductor.vehiculo_actualizado": "Actualizó el vehículo del conductor",
  "conductor.vehiculo_borrado": "Borró el vehículo del conductor",
  "conductor.baja_nomina": "Dio de baja al conductor de la nómina",
  "conductor.reincorporado_nomina": "Reincorporó al conductor a la nómina",
  "conductor.ubicacion.consentimiento_revocado": "Revocó el consentimiento de ubicación",
  "conductor.punto_termino.definido": "Definió el punto de término del conductor",
  "conductor.punto_termino.revocado": "Revocó el punto de término del conductor",
  "conductor.punto_termino.borrado_por_desvinculacion": "Borró el punto de término al desvincular",
  // Dinero
  "dinero.linea_cobro_anulada_manual": "Anuló el cobro al seller",
  "dinero.linea_liquidacion_anulada_manual": "Anuló la liquidación al conductor",
  "dinero.pago_recibido": "Recibió un pago",
  "dinero.payout_webhook_recibido": "Recibió un aviso de pago (webhook)",
  "dinero.periodo_cerrado_manual": "Cerró un período a mano",
  "dinero.periodo_reabierto": "Reabrió un período",
  "dinero.periodicidad_facturacion_actualizada": "Actualizó la periodicidad de facturación",
  "dinero.alerta_morosidad": "Emitió una alerta de morosidad",
  "dinero.alerta_folios_proximos": "Emitió una alerta de folios próximos a agotarse",
  // Identidad / configuración del courier
  "identidad.tarifa_creada": "Creó una tarifa",
  "identidad.tarifa_editada": "Editó una tarifa",
  "identidad.tarifa_inactivada": "Inactivó una tarifa",
  "identidad.tarifa_reactivada": "Reactivó una tarifa",
  "identidad.bodega_seller_creada": "Creó una bodega de seller",
  "identidad.bodega_seller_editada": "Editó una bodega de seller",
  "identidad.bodega_courier_creada": "Creó una bodega propia",
  "identidad.bodega_courier_editada": "Editó una bodega propia",
  "identidad.bodega_seller_creada_por_seller": "El seller creó su bodega",
  "identidad.bodega_seller_editada_por_seller": "El seller editó su bodega",
  "identidad.bodega_seller_principal_cambiada_por_seller": "El seller cambió su bodega principal",
  "identidad.config_retiro_actualizada": "Actualizó la configuración de retiro",
  "identidad.datos_emisor_actualizados": "Actualizó los datos del emisor",
  "identidad.datos_cobro_actualizados": "Actualizó los datos de cobro",
  "identidad.retencion_conductores_actualizada": "Actualizó la retención de conductores",
  "identidad.contacto_publico_actualizado": "Actualizó el contacto público",
  "identidad.datos_courier_exportados": "Exportó los datos del courier",
  "identidad.alerta_certificado_por_vencer": "Emitió una alerta de certificado por vencer",
  // Cobranza / folios
  "cobranza.banco_conectado": "Conectó el banco",
  "folios_caf.rango_cargado": "Cargó un rango de folios (CAF)",
  // Integraciones / API
  "integraciones.api_key_creada": "Creó una clave de API",
  "integraciones.api_key_revocada": "Revocó una clave de API",
  "integraciones.webhook_endpoint_creado": "Creó un webhook",
  "integraciones.webhook_endpoint_eliminado": "Eliminó un webhook",
  // Conexión ML / Shopify
  "conexion_ml.sincronizacion_solicitada": "Solicitó sincronizar Mercado Libre",
  "conexion_ml.desconectada": "Desconectó una cuenta de Mercado Libre",
  "conexion_ml.colision_detectada": "Detectó una cuenta de ML ya conectada",
  "conexion_ml.error_callback": "Falló el enlace con Mercado Libre",
  "seller.conexion_shopify_solicitada": "Solicitó conectar Shopify",
  "seller.conexion_shopify_reconectada": "Reconectó Shopify",
  "seller.conexion_shopify_desconectada": "Desconectó Shopify",
  "seller.creado": "Creó un seller",
  // Notificaciones
  "notificacion.conexion_caida": "Avisó por una conexión caída",
  // WhatsApp
  "whatsapp.consentimiento_otorgado": "Otorgó el consentimiento de WhatsApp",
  "whatsapp.consentimiento_revocado": "Revocó el consentimiento de WhatsApp",
  "whatsapp.destinatario_agregado_por_rutax": "Agregó un destinatario de WhatsApp",
  "whatsapp.destinatario_eliminado_por_rutax": "Eliminó un destinatario de WhatsApp",
  // Usuarios / invitaciones / tenant
  "usuario.activado": "Activó su cuenta",
  "usuario.contrasena_restablecida": "Restableció su contraseña",
  "usuario.rol_cambiado": "Cambió el rol de un usuario",
  "invitacion.creada": "Creó una invitación",
  "invitacion.aceptada": "Aceptó una invitación",
  "invitacion.revocada": "Revocó una invitación",
  "invitacion.enlace_entregado": "Entregó un enlace de invitación",
  "tenant.alta": "Dio de alta un courier",
  "tenant.usuario_invitado": "Invitó a un usuario del courier",
  // Plataforma (backstage Rutax → courier)
  "plataforma.suscripcion_autocreada": "Creó la suscripción automáticamente",
  "plataforma.suscripcion_activada": "Activó la suscripción",
  "plataforma.suscripcion_suspendida": "Suspendió la suscripción",
  "plataforma.suscripcion_cancelada": "Canceló la suscripción",
  "plataforma.plan_asignado": "Asignó un plan",
  "plataforma.plan_cambiado": "Cambió el plan",
  "plataforma.plan_creado": "Creó un plan",
  "plataforma.plan_actualizado": "Actualizó un plan",
  "plataforma.plan_desactivado": "Desactivó un plan",
  "plataforma.plan_reactivado": "Reactivó un plan",
  "plataforma.cambio_diferido_aplicado": "Aplicó un cambio de plan diferido",
  "plataforma.override_caracteristicas_actualizado": "Ajustó las características del plan",
  "plataforma.auto_cobro_enrolamiento_iniciado": "Inició el enrolamiento del cobro automático",
  "plataforma.auto_cobro_desactivado": "Desactivó el cobro automático",
  "plataforma.cobro_auto_intentado": "Intentó un cobro automático",
  "plataforma.mandato_activado": "Activó el mandato de cobro",
  "plataforma.mandato_fallido": "Falló la activación del mandato",
  "plataforma.pago_suscripcion_confirmado": "Confirmó el pago de la suscripción",
  "plataforma.pago_suscripcion_monto_discrepante": "Detectó un monto de pago discrepante",
  "plataforma.pago_manual_registrado": "Registró un pago manual",
  "plataforma.trial_activado_por_pago": "Activó la prueba por un pago",
  "plataforma.link_cobro_generado": "Generó un enlace de cobro",
  "plataforma.periodo_generado_manual": "Generó un período a mano",
  "plataforma.notificacion_pago_confirmado": "Avisó del pago confirmado",
  "plataforma.notificacion_comunicacion": "Envió una comunicación",
  "plataforma.comunicacion_creada": "Creó una comunicación",
  "plataforma.comunicacion_activada": "Activó una comunicación",
  "plataforma.comunicacion_desactivada": "Desactivó una comunicación",
  "plataforma.soporte_iniciado": "Inició una sesión de soporte",
  "plataforma.soporte_terminado": "Terminó la sesión de soporte",
  "plataforma.soporte_expirado": "Expiró la sesión de soporte",
  "plataforma.dte_real_opt_in": "Activó la emisión real de DTE",
  "plataforma.dte_real_opt_out": "Desactivó la emisión real de DTE",
};

/** Pasa un slug `a.b_c` a algo legible: «B c» del último segmento. */
function humanizarSlug(slug: string): string {
  const ultimo = slug.split(".").pop() ?? slug;
  const texto = ultimo.replace(/_/g, " ").trim();
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : slug;
}

/** La frase legible de una acción, o una versión humanizada del slug si no está mapeada. */
export function fraseAccion(accion: string): string {
  return FRASES_ACCION[accion] ?? humanizarSlug(accion);
}

// ─── Claves del detalle → etiqueta legible ───────────────────────────────────

const ETIQUETAS_CLAVE: Record<string, string> = {
  motivo: "Motivo",
  estado_anterior: "Estado anterior",
  estado_nuevo: "Estado nuevo",
  ejecutor: "Ejecutor",
  seller_id: "Seller",
  zona_id: "Zona",
  hora_corte: "Hora de corte",
  hora_actual: "Hora actual",
  hora_evaluada: "Hora evaluada",
  tipo_incidencia: "Tipo de incidencia",
  incidencia_id: "Incidencia",
  plan_id: "Plan",
  plan_anterior: "Plan anterior",
  plan_nuevo: "Plan nuevo",
  monto: "Monto",
  monto_clp: "Monto",
  periodo_id: "Período",
  conductor_id: "Conductor",
  manifiesto_id: "Manifiesto",
  pedido_id: "Pedido",
  tarifa_id: "Tarifa",
  bodega_id: "Bodega",
  ml_user_id: "Cuenta ML",
  cantidad: "Cantidad",
  nombre: "Nombre",
  correo: "Correo",
  rol_anterior: "Rol anterior",
  rol_nuevo: "Rol nuevo",
  telefono: "Teléfono",
};

const ESTADOS_PEDIDO_VALIDOS = new Set<string>([
  "pendiente_asignacion",
  "asignado",
  "en_ruta",
  "entregado",
  "entregado_manual",
  "fallido",
  "fallido_manual",
  "devuelto",
  "cancelado",
]);

/** La etiqueta legible de una clave del detalle, o una versión humanizada. */
export function etiquetaClaveDetalle(clave: string): string {
  return ETIQUETAS_CLAVE[clave] ?? humanizarSlug(clave);
}

const ISO_FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Formatea un valor del detalle según su clave y su tipo:
 * - estados de pedido → texto legible del estado
 * - booleanos → «Sí»/«No»
 * - fechas ISO → fecha y hora local
 * - montos → CLP
 * - objetos/arreglos → pares o lista compactos, no un JSON crudo de una línea
 */
export function formatearValorDetalle(clave: string, valor: unknown): string {
  if (valor === null || valor === undefined) return "—";

  if (typeof valor === "boolean") return valor ? "Sí" : "No";

  if (typeof valor === "number") {
    if (clave === "monto" || clave === "monto_clp" || clave.endsWith("_clp")) {
      return formatearClp(valor);
    }
    return String(valor);
  }

  if (typeof valor === "string") {
    if ((clave === "estado_anterior" || clave === "estado_nuevo") && ESTADOS_PEDIDO_VALIDOS.has(valor)) {
      return traducirEstadoPedido(valor as EstadoPedido);
    }
    if (ISO_FECHA.test(valor)) {
      try {
        return formatearFechaHora(valor);
      } catch {
        return valor;
      }
    }
    return valor;
  }

  if (Array.isArray(valor)) {
    return valor.map((v) => formatearValorDetalle(clave, v)).join(", ");
  }

  if (typeof valor === "object") {
    return Object.entries(valor as Record<string, unknown>)
      .map(([k, v]) => `${etiquetaClaveDetalle(k)}: ${formatearValorDetalle(k, v)}`)
      .join(" · ");
  }

  return String(valor);
}
