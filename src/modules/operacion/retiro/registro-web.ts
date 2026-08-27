/**
 * Registrar un retiro desde la WEB — la vía del coordinador.
 * =============================================================================
 *
 * Hasta ahora un retiro solo podía nacer en la app del conductor, escaneando
 * QR en la bodega. Eso dejaba un agujero operativo que bloquea el día entero:
 * si el conductor se queda sin batería, sin señal o sin teléfono, **nadie en la
 * oficina puede desatascarlo**, y sin retiro no hay asignación, sin asignación
 * no hay manifiesto y sin manifiesto no hay ruta.
 *
 * =============================================================================
 * NO INVENTA NINGÚN CAMINO NUEVO. USA EL MISMO CICLO, ENTERO
 * =============================================================================
 * Decisión del usuario (2026-08-26): registrar desde la web tiene que ser
 * **idéntico** a haber ido — mismo conductor, misma bodega, mismos bultos, y
 * los mismos efectos. Por eso este módulo no escribe una sola columna por su
 * cuenta: llama a las tres funciones que ya existen, en el mismo orden que la
 * app.
 *
 *   abrirVisitaBodega → registrarLoteEscaneos → cerrarSesionRetiro
 *
 * ⚠️ `operacion.pedidos.situacion_retiro` sigue teniendo **exactamente dos
 * escritores SQL** (`cerrar_sesion_retiro` y `resolver_bulto_retiro`). Esta vía
 * no agrega un tercero, y no debe: esa disciplina es lo que impide que el eje
 * de retiro se desincronice entre pantallas vecinas.
 *
 * =============================================================================
 * LO QUE ESTO CUESTA, DICHO AQUÍ PARA QUE NADIE LO DESCUBRA EN LA FACTURA
 * =============================================================================
 * Cerrar una visita **no es un acto administrativo**. Dispara dos efectos
 * reales, y los dos son deliberados:
 *
 *   1. **Le paga al conductor.** Publica `dinero/retiro.visita-cerrada`, que
 *      consume `dinero/jobs/generar-linea-retiro.ts` y genera su línea de
 *      liquidación por esa visita.
 *   2. **Le avisa al seller por WhatsApp** que le retiraron los pedidos.
 *
 * Se planteó ofrecer un modo "solo marcar, sin plata ni aviso" y **el usuario
 * lo descartó a propósito**: quiere el ciclo idéntico. La consecuencia asumida
 * es que registrar aquí una visita que nadie hizo paga una visita que nadie
 * hizo. La defensa no es técnica, es el gate RBAC y la bitácora con autor.
 *
 * =============================================================================
 * POR QUÉ NO HACE FALTA UN FORMATO DE CÓDIGO NUEVO
 * =============================================================================
 * `parser-codigo.ts` ya trae **`flex_manual`** — "número de envío de Flex
 * tecleado a mano, la vía de excepción cuando la etiqueta no se puede
 * escanear". Acepta el `ml_shipment_id` pelado, y `rutax_interno` acepta el
 * `codigo_interno` (`RX-XXXX-XXXX`) de same-day. O sea que alimentar el
 * pipeline con el identificador del pedido seleccionado **es una vía ya
 * prevista y probada**, no un atajo.
 *
 * Y tiene una virtud que un formato propio no tendría: el bulto queda grabado
 * como `flex_manual`, no como `flex_qr`. **El acta dice la verdad** —que no
 * hubo QR capturado— sin que haya que mantener un mecanismo aparte.
 */

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { limitesDelDiaSantiago } from "@/lib/fecha-santiago";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";

import { abrirVisitaBodega } from "./bodegas";
import { registrarLoteEscaneos, type ResultadoEscaneo } from "./escaneos";
import { cerrarSesionRetiro } from "./sesiones";

/**
 * Tope de pedidos por registro.
 *
 * No es una regla de negocio: es la reja contra el `URI too long` de PostgREST,
 * que ya mordió una vez en este repo con un `.in()` de mil UUID. Un retiro real
 * grande son ~130 bultos (el caso del courier: 30 + 30 + 70 entre tres
 * bodegas), así que 300 deja holgura de sobra sin acercarse al límite.
 *
 * Se DENUNCIA en la respuesta de la Server Action en vez de recortar en
 * silencio — mismo criterio que `TOPE_LOTE` en la conciliación.
 *
 * ⚠️ **Vive acá y NO en `actions.ts`, y no es una preferencia de orden.** Un
 * módulo `"use server"` solo puede exportar funciones async; una constante
 * exportada desde ahí hace que Next descarte **todos** los exports del módulo,
 * y el build de producción falla con «The module has no exports at all».
 * Typecheck, lint y las 4.244 pruebas pasan igual: solo lo caza `npm run build`.
 * Ya ocurrió una vez (2026-08-27) — no devolverla a `actions.ts`.
 */
export const TOPE_PEDIDOS_RETIRO = 300;

export interface RegistrarRetiroWebEntrada {
  tenantId: string;
  /** Quién retiró. Lo elige el coordinador: es el que va a cobrar la visita. */
  conductorId: string;
  /** En qué bodega del seller. */
  bodegaId: string;
  /** Los pedidos que se retiraron, elegidos de una lista. */
  pedidoIds: readonly string[];
  /** UUID del usuario que registra. RNF-04: toda acción financiera lleva su autor. */
  actorUsuarioId: string;
}

/** Un pedido que no se pudo alimentar al pipeline, con su motivo. */
export interface PedidoNoRegistrado {
  pedidoId: string;
  motivo: "sin_codigo_identificable" | "no_encontrado";
}

export interface ResultadoRegistroWeb {
  sesionId: string;
  /** Resultado por bulto, tal cual lo devuelve el pipeline de escaneos. */
  resultados: readonly ResultadoEscaneo[];
  /** Los que ni siquiera llegaron al pipeline. **Nunca se descartan en silencio.** */
  noRegistrados: readonly PedidoNoRegistrado[];
  /**
   * Cuántos bultos quedaron REALMENTE guardados (`registrado` o
   * `duplicado_fusionado`).
   *
   * ⚠️ **Existe porque contar `resultados.length` es mentir.** El pipeline no
   * lanza ante un ítem malo: devuelve `rechazado` y sigue. La primera versión
   * de la pantalla reportaba «Retiro registrado: 2 bultos» con los DOS
   * rechazados, la sesión borrada por quedar vacía y nada en la base. Mordió en
   * producción el 2026-08-27 y fue invisible: sin este número, un fallo total y
   * un éxito total se ven exactamente igual.
   */
  totalGuardados: number;
  /** Los rechazados con su motivo, para poder decirlo y para poder loguearlo. */
  rechazados: readonly { escaneoId: string; motivo: string }[];
}

/**
 * UUID determinista a partir de una clave.
 *
 * `operacion.bultos_retiro.escaneo_id` es `uuid`: cualquier otra cosa hace
 * fallar el insert con 22P02, y el pipeline traduce eso a `rechazado` sin
 * lanzar — o sea, en silencio. No es un UUID v5 canónico (no hay namespace
 * RFC), pero cumple lo único que importa acá: **es un uuid válido y el mismo
 * para la misma clave**, así que reintentar el registro choca contra
 * `bultos_retiro_escaneo_uk` en vez de duplicar bultos.
 */
export function uuidDeterminista(clave: string): string {
  const h = createHash("sha256").update(clave, "utf8").digest("hex");
  // Versión 4 y variante RFC 4122 en los nibbles que las fijan.
  const v = `4${h.slice(13, 16)}`;
  const var_ = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${v}-${var_}-${h.slice(20, 32)}`;
}

/** Lo mínimo que hace falta de un pedido para poder alimentarlo al pipeline. */
interface PedidoParaRetiro {
  id: string;
  mlShipmentId: string | null;
  codigoInterno: string | null;
}

/**
 * Registra un retiro completo desde la web y lo cierra.
 *
 * El `cliente` debe ser `service_role`. El aislamiento lo impone `tenantId`,
 * que el llamador ya resolvió contra la sesión — nunca un claim del navegador.
 *
 * ⚠️ **El gate RBAC va en la Server Action, no aquí.** Este módulo es dominio y
 * no conoce la sesión; quien lo llame tiene que haber comprobado la capacidad
 * antes. Mismo reparto que el resto de `operacion`.
 */
export async function registrarRetiroDesdeWeb(
  cliente: SupabaseClient,
  entrada: RegistrarRetiroWebEntrada,
): Promise<ResultadoRegistroWeb> {
  const { tenantId, conductorId, bodegaId, pedidoIds, actorUsuarioId } = entrada;

  if (pedidoIds.length === 0) {
    throw new Error("No se seleccionó ningún pedido para registrar el retiro.");
  }

  // --- 1. Bitácora ANTES de cualquier efecto -------------------------------
  // Invariante de CLAUDE.md: la auditoría queda completa aunque el paso
  // siguiente falle. Y este asiento es el que distingue para siempre un retiro
  // registrado en la oficina de uno escaneado en terreno — el eje `formato` del
  // bulto lo dice por bulto, esto lo dice por acto y con su autor.
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "retiro.registrado_desde_web",
    entidadTipo: "bodega_seller",
    entidadId: bodegaId,
    detalle: {
      conductor_id: conductorId,
      total_pedidos: pedidoIds.length,
    },
  });

  // --- 2. Los pedidos y su código identificable ----------------------------
  const pedidos = await leerPedidosParaRetiro(cliente, tenantId, pedidoIds);
  const porId = new Map(pedidos.map((p) => [p.id, p] as const));

  const noRegistrados: PedidoNoRegistrado[] = [];
  /** (pedido, código) de los que SÍ se pueden alimentar. Sin id todavía. */
  const alimentables: { pedidoId: string; codigo: string }[] = [];
  const ahora = new Date().toISOString();

  for (const pedidoId of pedidoIds) {
    const pedido = porId.get(pedidoId);
    if (!pedido) {
      noRegistrados.push({ pedidoId, motivo: "no_encontrado" });
      continue;
    }
    // Flex primero: `ml_shipment_id` cae en `flex_manual`. Same-day y Shopify
    // usan `codigo_interno`, que cae en `rutax_interno`.
    const codigo = pedido.mlShipmentId ?? pedido.codigoInterno;
    if (!codigo) {
      // Sin identificador no hay nada que alimentar, y **no se inventa uno**:
      // un código fabricado entraría como `desconocido` y ensuciaría la bandeja
      // de excepciones con un bulto que sí sabemos a qué pedido pertenece.
      noRegistrados.push({ pedidoId, motivo: "sin_codigo_identificable" });
      continue;
    }
    alimentables.push({ pedidoId, codigo });
  }

  if (alimentables.length === 0) {
    throw new Error(
      "Ninguno de los pedidos seleccionados tiene un código con el que registrar el retiro.",
    );
  }

  // --- 3. El ciclo, igual que en la app ------------------------------------
  const visita = await abrirVisitaBodega(cliente, { tenantId, conductorId, bodegaId });

  // El id se deriva DESPUÉS de tener la sesión, por eso el ciclo va acá y no
  // dentro del bucle de arriba. Ver `uuidDeterminista`.
  const escaneos = alimentables.map((a) => ({
    escaneoId: uuidDeterminista(`${visita.sesion.id}:${a.pedidoId}`),
    codigo: a.codigo,
    escaneadoEn: ahora,
  }));

  const { resultados } = await registrarLoteEscaneos(cliente, {
    tenantId,
    sesionId: visita.sesion.id,
    conductorId,
    sellerIdBodega: visita.bodega.sellerId,
    // Se abre y se cierra en el mismo acto, así que la sesión está viva cuando
    // llegan los bultos. Nunca es un lote posterior al cierre.
    sesionCerrada: false,
    escaneos,
  });

  const guardados = resultados.filter(
    (r) => r.estado === "registrado" || r.estado === "duplicado_fusionado",
  );
  const rechazados = resultados
    .filter((r) => r.estado === "rechazado")
    .map((r) => ({ escaneoId: r.escaneoId, motivo: r.motivo ?? "sin_motivo" }));

  // ⚠️ Se registra el rechazo con nombre y motivo. Sin esto, el fallo del
  // 2026-08-27 (todo el lote rechazado por un `escaneo_id` que no era uuid) no
  // dejó UNA SOLA línea en los logs de Vercel: el POST devolvía 200, la
  // pantalla decía «registrado» y la sesión se borraba sola por quedar vacía.
  // Los motivos son constantes del pipeline, no derivan del código escaneado.
  if (rechazados.length > 0) {
    console.error("[operacion/retiro] bultos rechazados al registrar desde la web", {
      sesionId: visita.sesion.id,
      total: resultados.length,
      rechazados: rechazados.length,
      motivos: [...new Set(rechazados.map((r) => r.motivo))],
    });
  }

  await cerrarSesionRetiro(cliente, {
    tenantId,
    sesionId: visita.sesion.id,
    conductorId,
    actorUsuarioId,
  });

  return {
    sesionId: visita.sesion.id,
    resultados,
    noRegistrados,
    totalGuardados: guardados.length,
    rechazados,
  };
}

/**
 * Lee los pedidos seleccionados. Filtra por `tenant_id` **además** del id: el
 * cliente es `service_role` y salta RLS, así que el aislamiento es este filtro.
 */
async function leerPedidosParaRetiro(
  cliente: SupabaseClient,
  tenantId: string,
  pedidoIds: readonly string[],
): Promise<PedidoParaRetiro[]> {
  const { data, error } = await cliente
    .schema("operacion")
    .from("pedidos")
    .select("id, ml_shipment_id, codigo_interno")
    .eq("tenant_id", tenantId)
    .in("id", pedidoIds as string[]);

  if (error) {
    throw new Error(`Error al leer los pedidos del retiro: ${error.message}`);
  }

  return (data ?? []).map((fila: Record<string, unknown>) => ({
    id: fila.id as string,
    mlShipmentId: (fila.ml_shipment_id as string | null) ?? null,
    codigoInterno: (fila.codigo_interno as string | null) ?? null,
  }));
}

// =============================================================================
// Lectura para la pantalla — qué hay pendiente de retirar hoy
// =============================================================================

export interface PedidoPendienteDeRetiro {
  id: string;
  /** El que se le muestra al coordinador. Shipment id en Flex, interno si no. */
  codigoVisible: string;
  destinatarioComuna: string | null;
  sellerId: string;
  /** `false` si no tiene ningún código: se muestra, pero no se puede registrar. */
  registrable: boolean;
}

/**
 * Los pedidos del día que **todavía no están en poder del courier**.
 *
 * Es el espejo exacto de la reja de la bandeja de asignación
 * (`asignacion.ts`, `situacion_retiro = 'retirado'`): lo que aquí aparece es
 * justamente lo que allá todavía no.
 *
 * ⚠️ Se filtra por `fecha_compromiso` y no por `retirado_en`, que es NULL en
 * todas estas filas por definición. Mismo criterio de fecha que `/operaciones`.
 *
 * Los pedidos sin código identificable **se listan igual**, marcados como no
 * registrables: esconderlos dejaría al coordinador contando bultos que no le
 * cuadran con la pantalla y sin ninguna pista de por qué.
 */
export async function listarPedidosPendientesDeRetiro(
  cliente: SupabaseClient,
  entrada: { tenantId: string; fecha: string },
): Promise<PedidoPendienteDeRetiro[]> {
  const { desde, hasta } = limitesDelDiaSantiago(entrada.fecha);

  const { data, error } = await cliente
    .schema("operacion")
    .from("pedidos")
    .select("id, ml_shipment_id, codigo_interno, destinatario_comuna, seller_id")
    .eq("tenant_id", entrada.tenantId)
    .eq("situacion_retiro", "pendiente")
    .eq("estado", "pendiente_asignacion")
    .gte("fecha_compromiso", desde.toISOString())
    .lt("fecha_compromiso", hasta.toISOString())
    .order("destinatario_comuna", { ascending: true })
    .limit(500);

  if (error) {
    throw new Error(`Error al listar los pedidos por retirar: ${error.message}`);
  }

  return (data ?? []).map((fila: Record<string, unknown>) => {
    const mlShipmentId = (fila.ml_shipment_id as string | null) ?? null;
    const codigoInterno = (fila.codigo_interno as string | null) ?? null;
    const codigo = mlShipmentId ?? codigoInterno;
    return {
      id: fila.id as string,
      codigoVisible: codigo ?? "(sin código)",
      destinatarioComuna: (fila.destinatario_comuna as string | null) ?? null,
      sellerId: fila.seller_id as string,
      registrable: codigo !== null,
    };
  });
}
