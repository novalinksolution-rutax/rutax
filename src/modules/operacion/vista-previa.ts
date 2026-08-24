/**
 * La vista previa de un pedido: lo que se contesta de una mirada.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ ES Y QUÉ NO ES
 * -----------------------------------------------------------------------------
 * Es **previsualización, no detalle**. Resuelve el gesto más repetido del día —el
 * coordinador necesita mirar un pedido sin perder su filtro ni su lugar en la
 * lista— y por eso lleva solo cuatro preguntas: **dónde va, quién lo lleva, en
 * qué anda y cuánto se cobra**.
 *
 * El detalle completo sigue existiendo y es un segundo paso explícito. Lo que no
 * entra acá, y no es olvido: **ninguna acción de consecuencia**. Anular el
 * cobro, anular la liquidación y cancelar el pedido viven en el detalle, con su
 * zona de consecuencia y su tarjeta de trazabilidad. Un panel que se abre con un
 * toque no es sitio para algo que no se deshace.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ CADA BLOQUE SE PIDE APARTE Y PUEDE FALTAR
 * -----------------------------------------------------------------------------
 * Las cinco consultas van en paralelo y **cada una con su propio `catch`**. Un
 * pedido recién ingresado no tiene asignación, uno que nunca se retiró no tiene
 * bultos, y uno de un período aún sin cerrar puede no tener línea de cobro. Nada
 * de eso es un error: es el estado normal de un pedido a las 10 de la mañana.
 *
 * La regla que se sigue en todo el archivo: **lo que no se pudo leer se devuelve
 * `null` y el panel no dibuja ese bloque**. Nunca un cero ni un «—» que se lea
 * como un hecho comprobado.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { obtenerPedido } from "./pedidos";
import { mapaNombresConductores } from "@/modules/identidad/consultas";
import type { EstadoPedido, FuentePedido } from "./tipos";

export interface HitoSeguimiento {
  texto: string;
  /** ISO. Se formatea en la interfaz, con la zona de Santiago. */
  en: string;
}

export interface VistaPreviaPedido {
  id: string;
  /** `RX-XXXX-XXXX` en same-day, el id de envío en Flex. Nunca el token público. */
  codigo: string | null;
  destinatario: string;
  estado: EstadoPedido;
  fuente: FuentePedido;
  fechaCompromiso: string | null;
  /** Instante prometido, cuando el seller tiene ventana de corte configurada. */
  fechaCompromisoHora: string | null;

  donde: {
    direccion: string;
    comuna: string;
    /** Bultos efectivamente escaneados en el retiro. `null` si no hubo retiro. */
    bultos: number | null;
  };

  /** `null` mientras nadie lo lleve. */
  quien: {
    conductorId: string;
    conductorNombre: string | null;
    /** «parada 8 de 24». `null` si la ruta no está secuenciada. */
    parada: { numero: number; de: number } | null;
    asignadoEn: string | null;
  } | null;

  seguimiento: HitoSeguimiento[];

  /** `null` cuando todavía no hay línea de cobro para este pedido. */
  dinero: {
    montoCobroClp: number | null;
    sellerNombre: string | null;
    periodoId: string | null;
    periodoEtiqueta: string | null;
  } | null;

  /** Solo same-day. Es el enlace que se comparte con el destinatario. */
  trackingToken: string | null;
}

export async function armarVistaPreviaPedido(
  cliente: SupabaseClient,
  tenantId: string,
  pedidoId: string,
): Promise<VistaPreviaPedido | null> {
  // ⚠️ `obtenerPedido` filtra por tenant. Es la barrera de aislamiento de esta
  // función: si el pedido no es de este courier, acá se acaba.
  const pedido = await obtenerPedido(cliente, pedidoId, tenantId).catch(() => null);
  if (!pedido) return null;

  const [asignacion, bultos, cierre, cobro] = await Promise.all([
    leerAsignacion(cliente, tenantId, pedidoId),
    contarBultosRetirados(cliente, tenantId, pedidoId),
    leerCierreDelConductor(cliente, tenantId, pedidoId),
    leerCobro(cliente, tenantId, pedidoId),
  ]);

  const conductorId = asignacion?.driverId ?? pedido.driverIdAsignado ?? null;
  const nombres: Record<string, string> = conductorId
    ? await mapaNombresConductores(cliente, tenantId, [conductorId]).catch(
        () => ({}) as Record<string, string>,
      )
    : {};

  return {
    id: pedido.id,
    // El código de envío, nunca `trackingToken`: ése es público y viaja en la
    // URL que se le manda al destinatario.
    codigo: pedido.codigoInterno ?? pedido.mlShipmentId ?? null,
    destinatario: pedido.destinatarioNombre,
    estado: pedido.estado,
    fuente: pedido.fuente,
    fechaCompromiso: pedido.fechaCompromiso,
    fechaCompromisoHora: pedido.fechaCompromisoHora ?? null,

    donde: {
      direccion: pedido.destinatarioDireccion,
      comuna: pedido.destinatarioComuna,
      bultos,
    },

    quien: conductorId
      ? {
          conductorId,
          conductorNombre: nombres[conductorId] ?? null,
          parada: asignacion?.parada ?? null,
          asignadoEn: asignacion?.asignadoEn ?? null,
        }
      : null,

    seguimiento: armarHitos({
      asignadoEn: asignacion?.asignadoEn ?? null,
      conductorNombre: conductorId ? (nombres[conductorId] ?? null) : null,
      cerradoEn: cierre?.en ?? null,
      cerradoResultado: cierre?.resultado ?? null,
      canceladoEn: pedido.canceladoEn ?? null,
    }),

    dinero: cobro,
    trackingToken: pedido.trackingToken ?? null,
  };
}

/**
 * Los hitos, **construidos solo con instantes que existen**.
 *
 * ⚠️ No se inventa un «Retirado a las 11:40» porque el pedido esté en ruta: si no
 * hay una marca de tiempo real detrás, el hito no se dibuja. Un seguimiento con
 * un hito plausible pero falso es peor que un seguimiento corto — el coordinador
 * lo usa para decidir si llamar al conductor.
 */
function armarHitos(datos: {
  asignadoEn: string | null;
  conductorNombre: string | null;
  cerradoEn: string | null;
  cerradoResultado: string | null;
  canceladoEn: string | null;
}): HitoSeguimiento[] {
  const hitos: HitoSeguimiento[] = [];

  if (datos.asignadoEn) {
    hitos.push({
      texto: datos.conductorNombre ? `Asignado a ${datos.conductorNombre}` : "Asignado",
      en: datos.asignadoEn,
    });
  }
  if (datos.cerradoEn) {
    hitos.push({
      texto:
        datos.cerradoResultado === "entregado"
          ? "Entregado por el conductor"
          : "El conductor no pudo entregarlo",
      en: datos.cerradoEn,
    });
  }
  if (datos.canceladoEn) {
    hitos.push({ texto: "Cancelado", en: datos.canceladoEn });
  }

  // Del más reciente al más antiguo: lo que pasó recién es lo que se mira.
  return hitos.sort((a, b) => b.en.localeCompare(a.en));
}

async function leerAsignacion(cliente: SupabaseClient, tenantId: string, pedidoId: string) {
  try {
    const { data } = await cliente
      .schema("operacion")
      .from("asignaciones_pedido")
      .select("driver_id, manifiesto_id, asignado_en, orden_ruta")
      .eq("tenant_id", tenantId)
      .eq("pedido_id", pedidoId)
      .eq("activa", true)
      .maybeSingle();
    if (!data) return null;

    const fila = data as {
      driver_id: string | null;
      manifiesto_id: string | null;
      asignado_en: string | null;
      orden_ruta: number | null;
    };

    // «parada 8 de 24»: el 24 son las paradas activas del mismo manifiesto.
    // Sin secuencia (`orden_ruta` nulo) no hay número de parada que dar — el
    // manifiesto existe pero nadie lo ruteó todavía.
    let parada: { numero: number; de: number } | null = null;
    if (fila.orden_ruta !== null && fila.manifiesto_id) {
      const { count } = await cliente
        .schema("operacion")
        .from("asignaciones_pedido")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("manifiesto_id", fila.manifiesto_id)
        .eq("activa", true);
      if (count) parada = { numero: fila.orden_ruta, de: count };
    }

    return { driverId: fila.driver_id, asignadoEn: fila.asignado_en, parada };
  } catch {
    return null;
  }
}

async function contarBultosRetirados(
  cliente: SupabaseClient,
  tenantId: string,
  pedidoId: string,
): Promise<number | null> {
  try {
    const { count } = await cliente
      .schema("operacion")
      .from("bultos_retiro")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("pedido_id", pedidoId);
    // Cero bultos y «no hubo retiro» son lo mismo acá: en los dos casos no hay
    // nada que afirmar, así que no se dibuja la cifra.
    return count && count > 0 ? count : null;
  } catch {
    return null;
  }
}

async function leerCierreDelConductor(
  cliente: SupabaseClient,
  tenantId: string,
  pedidoId: string,
): Promise<{ en: string; resultado: string } | null> {
  try {
    const { data } = await cliente
      .schema("operacion")
      .from("cierres_conductor")
      .select("resultado, creado_en")
      .eq("tenant_id", tenantId)
      .eq("pedido_id", pedidoId)
      .maybeSingle();
    if (!data) return null;
    const fila = data as { resultado: string; creado_en: string };
    return { en: fila.creado_en, resultado: fila.resultado };
  } catch {
    return null;
  }
}

async function leerCobro(cliente: SupabaseClient, tenantId: string, pedidoId: string) {
  try {
    const { data } = await cliente
      .schema("dinero")
      .from("lineas_cobro")
      // ⚠️ `anulada = false`: una línea anulada existe en la tabla y **no se
      // cobra**. Mostrar su monto en el panel diría que el seller debe una plata
      // que ya nadie le va a pedir.
      .select(
        "monto_final_clp, periodo_cobro_id, sellers(razon_social), periodos_cobro(fecha_inicio, fecha_fin)",
      )
      .eq("tenant_id", tenantId)
      .eq("pedido_id", pedidoId)
      .eq("anulada", false)
      .maybeSingle();
    if (!data) return null;
    const fila = data as unknown as {
      monto_final_clp: number | null;
      periodo_cobro_id: string | null;
      sellers?: { razon_social?: string } | null;
      periodos_cobro?: { fecha_inicio?: string; fecha_fin?: string } | null;
    };
    return {
      montoCobroClp: fila.monto_final_clp,
      sellerNombre: fila.sellers?.razon_social ?? null,
      periodoId: fila.periodo_cobro_id,
      periodoEtiqueta: etiquetaDePeriodo(fila.periodos_cobro?.fecha_inicio),
    };
  } catch {
    return null;
  }
}

/**
 * `2026-08-01` → `08-2026`.
 *
 * Los períodos **no tienen columna de etiqueta**: se identifican por sus fechas.
 * Se arma desde la fecha de inicio y sin pasar por `Date`, que con un
 * `YYYY-MM-DD` retrocede un día al formatear en Santiago — el mismo defecto que
 * `formatearFechaCivilCorta` documenta.
 */
function etiquetaDePeriodo(fechaInicio: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(fechaInicio?.trim() ?? "");
  return m ? `${m[2]}-${m[1]}` : null;
}
