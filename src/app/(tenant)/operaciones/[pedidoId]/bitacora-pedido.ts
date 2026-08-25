/**
 * La bitácora de UN pedido, en lenguaje humano.
 * =============================================================================
 * Tablero `P3 · Detalle del pedido`, decisión n.º 4: «la auditoría es contexto,
 * no consecuencia». El bloque va a la vista, sin abrir nada, para que quien está
 * por hacer algo grave ya sepa que queda registrado — y no se entere después.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NO ES EL MISMO LISTADO QUE «SEGUIMIENTO»
 * -----------------------------------------------------------------------------
 * `historial-estados.ts` filtra la bitácora a las acciones que MUEVEN EL ESTADO,
 * porque el seguimiento narra el viaje del paquete. Esto es lo contrario: todo
 * lo que se hizo sobre el pedido, incluido lo que no lo movió —una etiqueta
 * descargada, una incidencia reclasificada, una línea de dinero anulada—. Los
 * dos leen la misma tabla y responden preguntas distintas.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ NO SE INVENTA UNA FRASE PARA UNA ACCIÓN DESCONOCIDA
 * -----------------------------------------------------------------------------
 * Una acción que no esté en esta tabla se muestra con su nombre técnico tal
 * cual, no con un texto genérico tipo «acción del sistema». En una bitácora, un
 * rótulo bonito que no dice qué pasó es peor que un identificador feo: el feo se
 * puede buscar en el código, el bonito no se puede deshacer.
 */

/** Qué se hizo, en tercera persona y sin sujeto — el sujeto es el autor. */
const FRASES: Record<string, string> = {
  "pedido.cancelado": "canceló el pedido",
  "pedido.cancelado_por_ml": "canceló el pedido en Mercado Libre",
  "pedido.estado_corregido_manual": "corrigió el estado a mano",
  "pedido.estado_actualizado_conductor": "actualizó el estado desde la app",
  "pedido.cierre_operativo": "cerró la parada",
  "pedido.reagendado_desde_incidencia": "reagendó el pedido desde una incidencia",
  "pedido.creado_fuera_corte": "creó el pedido fuera de la hora de corte",
  "pedido.cumplimiento_notificado_shopify": "avisó el cumplimiento a Shopify",
  "pod.capturado": "registró la prueba de entrega",
  "incidencia.abierta_manual": "abrió una incidencia",
  "incidencia.reclasificada": "reclasificó la incidencia",
  "incidencia.resuelta_por_cancelacion": "cerró la incidencia al cancelarse el pedido",
  "incidencia.resuelta_por_devolucion": "cerró la incidencia con la devolución",
  "operacion.etiqueta_descargada": "descargó la etiqueta",
  "operacion.etiqueta_same_day_descargada": "descargó la etiqueta same-day",
  "operacion.conductor_caido": "marcó al conductor como caído",
  "operacion.redistribucion_completada": "redistribuyó los pedidos del conductor",
  "operacion.pedidos_exportados": "exportó los datos del pedido",
  "operacion.evidencias_purgadas_por_retencion": "purgó las evidencias por retención",
  "operacion.punto_termino_purgado_por_retencion": "purgó el punto de término por retención",
  "dinero.linea_cobro_anulada_manual": "anuló el cobro al seller",
  "dinero.linea_liquidacion_anulada_manual": "anuló la liquidación al conductor",
  "geocoding.pedido_reubicado": "reubicó la dirección",
};

export interface EntradaBitacora {
  id: string;
  creadoEn: string;
  /** Nombre del autor ya resuelto, o `null` si lo hizo el sistema. */
  autor: string | null;
  /** Qué se hizo. Nunca vacío. */
  frase: string;
  /** El motivo escrito, cuando la acción lo exigía. */
  motivo: string | null;
}

/**
 * Convierte filas crudas de `bitacora_auditoria` en líneas legibles.
 *
 * ⚠️ **`actorTipo` decide el sujeto, no la ausencia de `actor_usuario_id`.** Una
 * acción del sistema y una acción de un usuario cuyo nombre no se pudo resolver
 * son dos cosas distintas: la primera dice «Rutax» con propiedad, y la segunda
 * es un fallo de lectura que no hay que disfrazar de proceso automático.
 */
export function armarBitacoraPedido(
  filas: readonly Record<string, unknown>[],
  nombresPorUsuario: Record<string, { nombreCompleto: string }>,
): EntradaBitacora[] {
  return filas.map((f) => {
    const accion = String(f.accion ?? "");
    const actorId = (f.actor_usuario_id as string | null) ?? null;
    const actorTipo = String(f.actor_tipo ?? "");
    const detalle = (f.detalle ?? {}) as Record<string, unknown>;

    let autor: string | null;
    if (actorTipo === "sistema" || !actorId) {
      autor = null;
    } else {
      autor = nombresPorUsuario[actorId]?.nombreCompleto ?? "Usuario no encontrado";
    }

    const motivo =
      typeof detalle.motivo === "string" && detalle.motivo.trim() ? detalle.motivo.trim() : null;

    return {
      id: String(f.id),
      creadoEn: String(f.creado_en),
      autor,
      frase: FRASES[accion] ?? accion,
      motivo,
    };
  });
}
