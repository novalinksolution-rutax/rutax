/**
 * El listado de manifiestos con lo que la tabla de manifiestos no sabe.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * UN MANIFIESTO NO SABE CUÁNTAS PARADAS TIENE
 * -----------------------------------------------------------------------------
 * `operacion.manifiestos` guarda quién, cuándo y en qué estado. **Las paradas
 * viven en `asignaciones_pedido`**, y hasta hoy el listado no las consultaba: la
 * pantalla mostraba el nombre del manifiesto y su fecha, que es lo único que la
 * tabla tenía a mano.
 *
 * Por eso el listado no podía responder la pregunta con la que se entra a él —
 * «¿quién va atrasado?»—: sin paradas no hay avance, y sin avance el listado es
 * un índice de documentos.
 *
 * -----------------------------------------------------------------------------
 * EL MANIFIESTO CANCELADO: DÓNDE QUEDARON SUS PARADAS
 * -----------------------------------------------------------------------------
 * Al cancelar, las asignaciones del manifiesto se desactivan y los pedidos se
 * redistribuyen. La pregunta que uno se hace al ver una fila cancelada es si
 * esas paradas quedaron huérfanas, y eso **se responde con las asignaciones, no
 * con la bitácora**: se miran las que quedaron inactivas y dónde está cada
 * pedido AHORA.
 *
 * La bitácora también lo registra, pero está indexada por CONDUCTOR y por fecha
 * —no por manifiesto—, no dice a cuántos conductores fueron, y sobre todo es un
 * registro de auditoría: usarlo como fuente de datos lo convierte en un contrato
 * que nadie sabe que está firmando, y se rompe callado el día que alguien cambie
 * qué guarda ese `detalle`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";
import type { EstadoManifiesto } from "./tipos";

/** Estados terminales del pedido: una parada así ya no cuenta como pendiente. */
const CERRADOS = new Set([
  "entregado",
  "entregado_manual",
  "fallido",
  "fallido_manual",
  "devuelto",
  "cancelado",
]);

export interface AvanceManifiesto {
  paradas: number;
  cerradas: number;
  /**
   * De las cerradas, cuántas lo están **solo** porque el conductor lo declaró en
   * la app: el estado oficial del pedido todavía no llegó. En Flex es lo normal
   * durante horas, y es lo que la celda usa para no mentir en ninguna dirección.
   */
  cerradasSoloEnApp: number;
  /** 0–100. `null` cuando no hay paradas: no es 0 %, es «nada que medir». */
  porcentaje: number | null;
}

export interface RedistribucionManifiesto {
  /** Paradas que tenía cuando se canceló. */
  paradas: number;
  /** A cuántos conductores distintos fueron a parar. */
  conductores: number;
  /** Las que no quedaron con nadie. Es lo que de verdad hay que mirar. */
  huerfanas: number;
}

export interface ContextoManifiestos {
  avance: Record<string, AvanceManifiesto>;
  redistribucion: Record<string, RedistribucionManifiesto>;
}

/**
 * Paradas y avance de cada manifiesto, y el destino de las de los cancelados.
 *
 * Se resuelve en dos lecturas para TODOS los manifiestos de la página, no una
 * por fila: cincuenta manifiestos son cincuenta viajes, y esta pantalla se abre
 * varias veces al día.
 */
export async function cargarContextoManifiestos(
  cliente: SupabaseClient,
  tenantId: string,
  manifiestos: readonly { id: string; estado: EstadoManifiesto }[],
): Promise<ContextoManifiestos> {
  const ids = manifiestos.map((m) => m.id);
  if (ids.length === 0) return { avance: {}, redistribucion: {} };

  // TODAS las asignaciones de esos manifiestos, activas e inactivas: las
  // inactivas son las que cuentan la historia de un manifiesto cancelado.
  const asignaciones = await leerTodasLasFilas<{
    manifiesto_id: string;
    pedido_id: string;
    activa: boolean;
    pedidos: { estado: string }[];
  }>("asignaciones de los manifiestos", (desde, hasta) =>
    cliente
      .schema("operacion")
      .from("asignaciones_pedido")
      .select("manifiesto_id, pedido_id, activa, pedidos!inner(estado)")
      .eq("tenant_id", tenantId)
      .in("manifiesto_id", ids)
      .range(desde, hasta),
  );

  // Lo que el conductor declaró cerrado desde SU app, que es lo que va por
  // delante del estado oficial. Ver `cerradasPorElConductor`.
  const declaradas = await cerradasPorElConductor(
    cliente,
    tenantId,
    asignaciones.filter((a) => a.activa).map((a) => a.pedido_id),
  );

  const avance: Record<string, AvanceManifiesto> = {};
  for (const a of asignaciones) {
    if (!a.activa) continue;
    const actual = (avance[a.manifiesto_id] ??= {
      paradas: 0,
      cerradas: 0,
      cerradasSoloEnApp: 0,
      porcentaje: null,
    });
    actual.paradas += 1;

    const estado = Array.isArray(a.pedidos) ? a.pedidos[0]?.estado : undefined;
    const oficialCerrado = Boolean(estado && CERRADOS.has(estado));
    const declaradoCerrado = declaradas.has(a.pedido_id);

    if (oficialCerrado || declaradoCerrado) actual.cerradas += 1;
    if (declaradoCerrado && !oficialCerrado) actual.cerradasSoloEnApp += 1;
  }
  for (const v of Object.values(avance)) {
    v.porcentaje = v.paradas > 0 ? Math.round((v.cerradas / v.paradas) * 100) : null;
  }

  const redistribucion = await resolverRedistribuciones(
    cliente,
    tenantId,
    manifiestos.filter((m) => m.estado === "cancelado").map((m) => m.id),
    asignaciones,
  );

  return { avance, redistribucion };
}

/**
 * Las paradas que el CONDUCTOR declaró cerradas desde su app.
 * =============================================================================
 *
 * 🔴 **Ésta es la mitad que faltaba, y por eso una ruta completada salía en 0 %.**
 *
 * El avance se medía solo contra `pedidos.estado`, y en Flex ese estado **no lo
 * escribe Rutax**: lo escribe Mercado Libre y llega con la sincronización.
 * `completarManifiesto` tampoco mueve un solo pedido. Resultado: el conductor
 * cerraba sus 26 paradas en la app, el coordinador cerraba la ruta, y la tabla
 * seguía diciendo «0 % (0/26)» — en rojo, además, si ya eran más de las 18:00.
 *
 * Es exactamente el desfase que la Torre de control ya resuelve, y se resuelve
 * igual: mirando las dos tablas donde el conductor deja su declaración.
 *
 *   · **`cierres_conductor`** — Flex. Registro PARALELO del courier: no mueve el
 *     estado, porque el POD oficial lo gobierna la app de Mercado Envíos.
 *   · **`pruebas_entrega`** — same-day. Es el POD autoritativo y sí mueve el
 *     estado, así que acá suele ser redundante. Se consulta igual: si la
 *     escritura del estado falló, el POD sigue siendo la verdad.
 *
 * **Cuenta el cierre, no la entrega.** Un `no_entregado` cierra la parada igual
 * que un entregado: la pregunta de esta columna es «¿cuánto le queda por
 * hacer?», no «¿cuánto entregó?». Lo que no se pudo entregar lo levanta
 * incidencias, que es su pantalla.
 *
 * ⚠️ **Une, no reemplaza.** Un pedido cancelado en ML nunca va a tener cierre
 * del conductor y está cerradísimo; uno entregado y ya sincronizado tampoco lo
 * necesita. Los dos lados suman, y por eso esto no puede empeorar ninguna fila.
 *
 * ⚠️ **En tandas de 100.** Un `.in()` con mil UUID responde `URI too long` — ya
 * pasó en este repo. Acá el largo lo decide cuántas paradas tengan los
 * manifiestos de la página: cincuenta rutas de treinta paradas son 1.500 ids, o
 * sea que el fallo llega con el volumen real y no con los datos de demo.
 *
 * ⚠️ **Es `export` porque la nómina de conductores cuenta lo mismo** (su columna
 * «Ruta de hoy»). Cuando cada una tenía su copia de la regla, la tabla de
 * conductores decía «0 de 3» de la misma ruta que Manifiestos daba por completa
 * — dos pantallas contradiciéndose sobre el mismo conductor. Si esta regla
 * cambia, tiene que cambiar en un solo sitio.
 */
export async function cerradasPorElConductor(
  cliente: SupabaseClient,
  tenantId: string,
  pedidoIds: readonly string[],
): Promise<Set<string>> {
  const cerradas = new Set<string>();
  if (pedidoIds.length === 0) return cerradas;

  const unicos = [...new Set(pedidoIds)];
  const TANDA = 100;

  for (const tabla of ['cierres_conductor', 'pruebas_entrega'] as const) {
    for (let i = 0; i < unicos.length; i += TANDA) {
      const tanda = unicos.slice(i, i + TANDA);
      const filas = await leerTodasLasFilas<{ pedido_id: string }>(
        `${tabla} de los manifiestos`,
        (desde, hasta) =>
          cliente
            .schema("operacion")
            .from(tabla)
            .select("pedido_id")
            .eq("tenant_id", tenantId)
            .in("pedido_id", tanda)
            .range(desde, hasta),
      );
      for (const f of filas) cerradas.add(f.pedido_id);
    }
  }

  return cerradas;
}

/**
 * A dónde fueron a parar las paradas de cada manifiesto cancelado.
 *
 * Se pregunta por la asignación ACTIVA de cada uno de esos pedidos: si tiene
 * otra, se redistribuyó y se sabe a qué conductor; si no tiene ninguna, quedó
 * huérfana — y ése es el caso que importa, porque es un bulto que nadie va a
 * llevar y que no aparece en la ruta de nadie.
 */
async function resolverRedistribuciones(
  cliente: SupabaseClient,
  tenantId: string,
  idsCancelados: readonly string[],
  asignaciones: readonly { manifiesto_id: string; pedido_id: string; activa: boolean }[],
): Promise<Record<string, RedistribucionManifiesto>> {
  if (idsCancelados.length === 0) return {};

  const cancelados = new Set(idsCancelados);
  const pedidosPorManifiesto = new Map<string, string[]>();
  for (const a of asignaciones) {
    if (!cancelados.has(a.manifiesto_id) || a.activa) continue;
    const lista = pedidosPorManifiesto.get(a.manifiesto_id) ?? [];
    lista.push(a.pedido_id);
    pedidosPorManifiesto.set(a.manifiesto_id, lista);
  }

  const todosLosPedidos = [...new Set([...pedidosPorManifiesto.values()].flat())];
  if (todosLosPedidos.length === 0) return {};

  const activas = await leerTodasLasFilas<{ pedido_id: string; manifiestos: { driver_id: string }[] }>(
    "destino de las paradas redistribuidas",
    (desde, hasta) =>
      cliente
        .schema("operacion")
        .from("asignaciones_pedido")
        .select("pedido_id, manifiestos!inner(driver_id)")
        .eq("tenant_id", tenantId)
        .eq("activa", true)
        .in("pedido_id", todosLosPedidos)
        .range(desde, hasta),
  );

  const conductorDePedido = new Map<string, string>();
  for (const a of activas) {
    const driver = Array.isArray(a.manifiestos) ? a.manifiestos[0]?.driver_id : undefined;
    if (driver) conductorDePedido.set(a.pedido_id, driver);
  }

  const salida: Record<string, RedistribucionManifiesto> = {};
  for (const [manifiestoId, pedidos] of pedidosPorManifiesto) {
    const conductores = new Set<string>();
    let huerfanas = 0;
    for (const pedidoId of pedidos) {
      const driver = conductorDePedido.get(pedidoId);
      if (driver) conductores.add(driver);
      else huerfanas += 1;
    }
    salida[manifiestoId] = {
      paradas: pedidos.length,
      conductores: conductores.size,
      huerfanas,
    };
  }
  return salida;
}

// =============================================================================
// Los cajones
// =============================================================================

export type ConteosManifiesto = Record<EstadoManifiesto, number>;

/**
 * Cuántos manifiestos hay en cada estado, con los filtros aplicados **menos el
 * de estado** — que es justo lo que el cajón elige.
 *
 * Los contadores cuentan sobre el conjunto filtrado y nunca sobre la página: un
 * contador que cuenta la página es un contador que miente, y acá es la razón de
 * existir de la barra.
 */
export async function contarManifiestosPorEstado(
  cliente: SupabaseClient,
  tenantId: string,
  filtros: { fechaExacta?: string; desde?: string; hasta?: string; conductorId?: string },
): Promise<ConteosManifiesto> {
  const filas = await leerTodasLasFilas<{ estado: EstadoManifiesto }>(
    "manifiestos por estado",
    (desde, hasta) => {
      let q = cliente
        .from("manifiestos")
        .select("estado")
        .eq("tenant_id", tenantId);
      if (filtros.conductorId) q = q.eq("driver_id", filtros.conductorId);
      if (filtros.fechaExacta) {
        q = q.eq("fecha_operacion", filtros.fechaExacta);
      } else {
        if (filtros.desde) q = q.gte("fecha_operacion", filtros.desde);
        if (filtros.hasta) q = q.lte("fecha_operacion", filtros.hasta);
      }
      return q.range(desde, hasta);
    },
  );

  const conteos: ConteosManifiesto = {
    borrador: 0,
    confirmado: 0,
    en_ruta: 0,
    completado: 0,
    cancelado: 0,
  };
  for (const f of filas) {
    if (f.estado in conteos) conteos[f.estado] += 1;
  }
  return conteos;
}

// =============================================================================
// El umbral de avance
// =============================================================================

/**
 * A partir de qué hora un avance bajo deja de ser normal.
 *
 * Antes de las 18:00 un 30 % es lo esperable: el despacho salió a las 16:00 y la
 * ruta recién arranca. Después, con tres horas corridas y el corte a las 21:00,
 * el mismo 30 % es un conductor que no va a llegar.
 *
 * Es lo que impide que la tabla se pinte de rojo a las 16:15 —cuando todos van
 * en 5 %— y deje de significar nada a las 20:00.
 */
export const HORA_UMBRAL_AVANCE = 18;
export const AVANCE_MINIMO_ESPERADO = 40;

/**
 * ⚠️ **El estado del manifiesto es parte de la regla, no un adorno.**
 *
 * «Va atrasado» solo tiene sentido mientras la ruta puede avanzar. Una ruta ya
 * `completado` no está atrasada: está cerrada, y pintarla de rojo a las 20:00
 * dice «este conductor no va a llegar» de alguien que terminó hace dos horas.
 * Si quedaron paradas sin cerrar, eso se cuenta aparte y en tono de atención —
 * es otra cosa, y la celda la dice con otras palabras.
 *
 * `borrador` y `cancelado` no llegan hasta acá (la celda los resuelve antes),
 * pero se excluyen igual: la regla tiene que ser cierta leída sola.
 */
export function avanceEnFalla(
  porcentaje: number | null,
  horaActual: number,
  estado?: EstadoManifiesto,
): boolean {
  if (porcentaje === null) return false;
  if (estado === 'completado' || estado === 'cancelado' || estado === 'borrador') return false;
  return horaActual >= HORA_UMBRAL_AVANCE && porcentaje < AVANCE_MINIMO_ESPERADO;
}

// =============================================================================
// El subtítulo de la cabecera
// =============================================================================

export interface CoberturaDelDia {
  /** Conductores con manifiesto hoy (sin contar los cancelados). */
  conRuta: number;
  /** Conductores que se declararon disponibles hoy. */
  disponibles: number;
}

/**
 * «7 de 9 conductores con ruta» — lo primero que dice la pantalla.
 *
 * El denominador son los DISPONIBLES y no los activos: alguien de licencia sigue
 * en la nómina y no debería hacer parecer que falta gente por asignar. Es el
 * mismo criterio que usa la Torre, y el mismo que hace accionable la fracción:
 * los que faltan son a quienes todavía se les puede dar una ruta.
 */
export async function obtenerCoberturaDelDia(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: string,
): Promise<CoberturaDelDia> {
  const [manifiestos, conductores] = await Promise.all([
    leerTodasLasFilas<{ driver_id: string }>("manifiestos de hoy", (desde, hasta) =>
      cliente
        .from("manifiestos")
        .select("driver_id")
        .eq("tenant_id", tenantId)
        .eq("fecha_operacion", fecha)
        .neq("estado", "cancelado")
        .range(desde, hasta),
    ),
    leerTodasLasFilas<{ id: string }>("conductores disponibles", (desde, hasta) =>
      cliente
        .schema("identidad")
        .from("conductores")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("estado", "activo")
        .eq("disponible", true)
        .range(desde, hasta),
    ),
  ]);

  return {
    conRuta: new Set(manifiestos.map((m) => m.driver_id)).size,
    disponibles: conductores.length,
  };
}
