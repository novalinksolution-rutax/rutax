/**
 * Sesiones de retiro — "las visitas de hoy de este conductor" (`GET /hoy`),
 * el detalle de una visita con sus bultos (`GET /{sesionId}`), y el cierre
 * (`POST /{sesionId}/cerrar`).
 *
 * Todas las consultas filtran EXPLÍCITAMENTE por `tenant_id` y por
 * `conductor_id`: como estas rutas corren con `service_role` (salta RLS), ese
 * filtro ES el aislamiento (docs/arquitectura/retiro-y-ruteo.md §13bis-1.7).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import {
  buscarPedidosPorIds,
  construirDtoPedidoRetiro,
  resolverNombresSellers,
  type PedidoRetiroDto,
} from "./dto-pedido";
import { codigoVisibleDeBulto, derivarResolucionBulto, type FormatoCodigoBulto, type ResolucionEscaneo } from "./parser-codigo";
import { cerrarSesionRetiroRpc, type ResultadoCerrarSesionRetiro } from "./rpc";
import { inngest } from "@/lib/inngest/cliente";
import type { EventoVisitaRetiroCerrada } from "@/lib/inngest/eventos";
import type { SesionRetiroResumen } from "./bodegas";
import { listarEsperadosDeSeller, type BultoEsperado } from "./expectativa";

interface FilaSesionRetiro {
  id: string;
  estado: "abierta" | "cerrada";
  bodega_id: string;
  seller_id: string;
  fecha_operacion: string;
  abierta_en: string;
  cerrada_en: string | null;
  bultos_total: number | null;
  bultos_resueltos: number | null;
  bultos_sin_resolver: number | null;
}

function filaASesion(fila: FilaSesionRetiro): SesionRetiroResumen {
  return {
    id: fila.id,
    estado: fila.estado,
    bodegaId: fila.bodega_id,
    sellerId: fila.seller_id,
    fechaOperacion: fila.fecha_operacion,
    abiertaEn: fila.abierta_en,
    cerradaEn: fila.cerrada_en,
    bultosTotal: fila.bultos_total,
    bultosResueltos: fila.bultos_resueltos,
    bultosSinResolver: fila.bultos_sin_resolver,
  };
}

// =============================================================================
// GET /hoy — las visitas de HOY de este conductor
// =============================================================================

export async function listarSesionesDeHoyDelConductor(
  cliente: SupabaseClient,
  entrada: { tenantId: string; conductorId: string },
): Promise<SesionRetiroResumen[]> {
  const hoy = fechaLocalEnSantiago(new Date());

  const { data, error } = await cliente
    .from("sesiones_retiro")
    .select("*")
    .eq("tenant_id", entrada.tenantId)
    .eq("conductor_id", entrada.conductorId)
    .eq("fecha_operacion", hoy)
    .order("abierta_en", { ascending: false });

  if (error) {
    throw new Error(`Error al listar las visitas de hoy: ${error.message}`);
  }

  return ((data ?? []) as FilaSesionRetiro[]).map(filaASesion);
}

// =============================================================================
// GET /{sesionId} — detalle de una visita, con sus bultos
// =============================================================================

export interface BultoRetiroResumen {
  id: string;
  escaneoId: string;
  codigoFormato: FormatoCodigoBulto;
  codigoVisible: string;
  resolucion: ResolucionEscaneo;
  /** Info VIVA del pedido resuelto (puede haber cambiado desde el escaneo) — null si no_procesado/ilegible. */
  pedido: PedidoRetiroDto | null;
  posteriorAlCierre: boolean;
  escaneadoEn: string;
}

export interface SesionRetiroDetalle extends SesionRetiroResumen {
  bodega: { id: string; nombre: string; comuna: string };
  bultos: BultoRetiroResumen[];
  /**
   * Los bultos que la plataforma ya tiene esperando retiro para este seller hoy.
   *
   * Es el **denominador** de la visita: sin él la app solo sabe contar lo que
   * escaneó, y «38» no dice si faltan cuatro o si ya está. Incluye lo que YA se
   * escaneó — es una conciliación, no una cola de trabajo.
   *
   * Va como LISTA y no como número porque al cerrar con faltantes hay que
   * nombrarlos: decir «4 sin escanear» sin decir cuáles manda al conductor a
   * recorrer la bodega de nuevo.
   *
   * `null` = no se pudo leer. Es distinto de una lista vacía, que significa
   * «este seller no tiene nada hoy»: con la lista vacía el conductor se va, con
   * `null` la app le dice que escanee igual y se cuadra después.
   */
  esperados: BultoEsperado[] | null;
}

interface FilaBultoDetalle {
  id: string;
  escaneo_id: string;
  codigo_formato: FormatoCodigoBulto;
  codigo_normalizado: string;
  muestra_codigo: string | null;
  ml_shipment_id: string | null;
  pedido_id: string | null;
  posterior_al_cierre: boolean;
  escaneado_en: string;
}

/**
 * Detalle de una visita, con sus bultos. Devuelve `null` si la sesión no
 * existe para este (tenant, conductor) — el llamador (route handler) traduce
 * eso a 404.
 */
export async function obtenerSesionRetiro(
  cliente: SupabaseClient,
  entrada: { tenantId: string; conductorId: string; sesionId: string },
): Promise<SesionRetiroDetalle | null> {
  const { data: sesionFila, error: errorSesion } = await cliente
    .from("sesiones_retiro")
    .select("*")
    .eq("id", entrada.sesionId)
    .eq("tenant_id", entrada.tenantId)
    .eq("conductor_id", entrada.conductorId)
    .maybeSingle();

  if (errorSesion) {
    throw new Error(`Error al obtener la visita de retiro: ${errorSesion.message}`);
  }
  if (!sesionFila) return null;

  const sesion = sesionFila as FilaSesionRetiro;

  const [bodega, bultosFilas] = await Promise.all([
    obtenerNombreYComunaBodega(cliente, entrada.tenantId, sesion.bodega_id),
    listarFilasDeBultos(cliente, entrada.tenantId, sesion.id),
  ]);

  const pedidoIds = [...new Set(bultosFilas.map((b) => b.pedido_id).filter((v): v is string => !!v))];
  const pedidosPorId = await buscarPedidosPorIds(cliente, entrada.tenantId, pedidoIds);
  const sellerIds = [...new Set([...pedidosPorId.values()].map((c) => c.sellerId))];
  const nombresSellers = await resolverNombresSellers(cliente, entrada.tenantId, sellerIds);

  const bultos: BultoRetiroResumen[] = bultosFilas.map((b) => {
    const candidato = b.pedido_id ? pedidosPorId.get(b.pedido_id) : undefined;
    return {
      id: b.id,
      escaneoId: b.escaneo_id,
      codigoFormato: b.codigo_formato,
      codigoVisible: codigoVisibleDeBulto({
        mlShipmentId: b.ml_shipment_id,
        muestraCodigo: b.muestra_codigo,
        codigoNormalizado: b.codigo_normalizado,
      }),
      resolucion: derivarResolucionBulto(b.codigo_formato, b.pedido_id),
      pedido: candidato
        ? construirDtoPedidoRetiro(candidato, nombresSellers.get(candidato.sellerId) ?? "", sesion.seller_id)
        : null,
      posteriorAlCierre: b.posterior_al_cierre,
      escaneadoEn: b.escaneado_en,
    };
  });

  // El denominador NO tumba la pantalla si falla: el retiro es lo que respalda
  // el pago por visita y no se bloquea por una lectura de contexto.
  const esperados = await listarEsperadosDeSeller(cliente, {
    tenantId: entrada.tenantId,
    sellerId: sesion.seller_id,
    fecha: sesion.fecha_operacion,
  }).catch(() => null);

  return { ...filaASesion(sesion), bodega, bultos, esperados };
}

async function obtenerNombreYComunaBodega(
  cliente: SupabaseClient,
  tenantId: string,
  bodegaId: string,
): Promise<{ id: string; nombre: string; comuna: string }> {
  const { data, error } = await cliente
    .from("seller_bodegas")
    .select("id, nombre, comuna")
    .eq("tenant_id", tenantId)
    .eq("id", bodegaId)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al leer la bodega de la visita: ${error.message}`);
  }
  // Defensivo: la FK compuesta de sesiones_retiro garantiza que la bodega
  // existe y es del tenant, pero si por algo no aparece no se rompe el
  // detalle entero por eso.
  return data
    ? { id: data.id as string, nombre: data.nombre as string, comuna: data.comuna as string }
    : { id: bodegaId, nombre: "", comuna: "" };
}

async function listarFilasDeBultos(
  cliente: SupabaseClient,
  tenantId: string,
  sesionId: string,
): Promise<FilaBultoDetalle[]> {
  const { data, error } = await cliente
    .from("bultos_retiro")
    .select("id, escaneo_id, codigo_formato, codigo_normalizado, muestra_codigo, ml_shipment_id, pedido_id, posterior_al_cierre, escaneado_en")
    .eq("tenant_id", tenantId)
    .eq("sesion_retiro_id", sesionId)
    .order("escaneado_en", { ascending: false });

  if (error) {
    throw new Error(`Error al listar los bultos de la visita: ${error.message}`);
  }
  return (data ?? []) as FilaBultoDetalle[];
}

// =============================================================================
// POST /{sesionId}/cerrar
// =============================================================================

/**
 * Cierra la visita a una bodega. Bitácora ANTES del efecto (patrón del
 * proyecto, CLAUDE.md): si `cerrarSesionRetiroRpc` falla después, la
 * auditoría ya quedó completa. `actorUsuarioId` es el id de AUTH
 * (`usuario.usuarioId` de `autenticarBearer`) — NUNCA `driverId`: son
 * espacios de UUID distintos y `bitacora_auditoria.actor_usuario_id` tiene FK
 * a `auth.users(id)` (bug ya cometido dos veces en este repo con
 * `cierre-conductor.ts` y `evidencias-entrega.ts`).
 *
 * El llamador (route handler) debe haber verificado YA que la sesión
 * pertenece a (tenantId, conductorId) antes de invocar esto — es lo que hace
 * seguro escribir la bitácora sin haber tocado el RPC todavía.
 */
export async function cerrarSesionRetiro(
  cliente: SupabaseClient,
  entrada: { tenantId: string; sesionId: string; conductorId: string; actorUsuarioId: string },
): Promise<ResultadoCerrarSesionRetiro> {
  // --- Visita SIN UN SOLO BULTO: se descarta, no se cierra ------------------
  // Decisión del usuario (2026-08-15). Cerrarla dejaba un acta de ceros en la
  // Preparación del coordinador para siempre: ruido puro, sin nada que
  // respaldar. El invariante "nunca se pierde un escaneo" no se toca — aquí NO
  // HAY escaneos que perder, y por eso este es el único caso en que una sesión
  // se puede borrar.
  //
  // Se cuenta sobre `bultos_retiro`, la fuente real, no sobre los contadores
  // denormalizados de la sesión (que están NULL mientras está abierta).
  const { count, error: errorConteo } = await cliente
    .from("bultos_retiro")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", entrada.tenantId)
    .eq("sesion_retiro_id", entrada.sesionId);

  if (errorConteo) {
    throw new Error(`Error al contar los bultos de la visita: ${errorConteo.message}`);
  }

  if (count === 0) {
    // Bitácora ANTES del efecto (invariante de CLAUDE.md). Queda el rastro de
    // que el conductor abrió la visita y no cargó nada — que es información
    // del día aunque la fila operativa no valga la pena conservarla.
    await registrarEnBitacora(cliente, {
      tenantId: entrada.tenantId,
      actorUsuarioId: entrada.actorUsuarioId,
      actorTipo: "usuario",
      accion: "retiro.sesion_descartada_sin_bultos",
      entidadTipo: "sesion_retiro",
      entidadId: entrada.sesionId,
      detalle: { conductor_id: entrada.conductorId },
    });

    // `eq("estado", "abierta")` es la guarda contra la carrera: si entre el
    // conteo y este DELETE alguien alcanzó a escanear y cerrar, no casa ninguna
    // fila y la visita sobrevive con sus bultos. Nunca se borra una visita que
    // ya tiene respaldo.
    const { error: errorBorrado } = await cliente
      .from("sesiones_retiro")
      .delete()
      .eq("tenant_id", entrada.tenantId)
      .eq("id", entrada.sesionId)
      .eq("conductor_id", entrada.conductorId)
      .eq("estado", "abierta");

    if (errorBorrado) {
      throw new Error(`Error al descartar la visita vacía: ${errorBorrado.message}`);
    }

    return {
      sesionId: entrada.sesionId,
      estado: "cerrada",
      bultosTotal: 0,
      bultosResueltos: 0,
      bultosSinResolver: 0,
      cerradaEn: new Date().toISOString(),
      yaEstabaCerrada: false,
      pedidosMarcados: 0,
      descartada: true,
    };
  }

  await registrarEnBitacora(cliente, {
    tenantId: entrada.tenantId,
    actorUsuarioId: entrada.actorUsuarioId,
    actorTipo: "usuario",
    accion: "retiro.sesion_cerrada",
    entidadTipo: "sesion_retiro",
    entidadId: entrada.sesionId,
    detalle: { conductor_id: entrada.conductorId },
  });

  const resultado = await cerrarSesionRetiroRpc(cliente, {
    tenantId: entrada.tenantId,
    sesionId: entrada.sesionId,
    conductorId: entrada.conductorId,
  });

  // --- El hecho económico: la visita se cerró, hay que pagarla (etapa 8) -----
  // Solo si el cierre lo hizo ESTE llamado. Si `yaEstabaCerrada`, el evento ya
  // se publicó en su momento y volver a emitirlo sería ruido — aunque el job es
  // idempotente y lo absorbería igual.
  if (!resultado.yaEstabaCerrada) {
    await publicarVisitaCerrada(cliente, entrada, resultado);
  }

  return resultado;
}

/**
 * Publica `dinero/retiro.visita-cerrada` para que el job C8 genere la línea de
 * liquidación del conductor.
 *
 * BEST-EFFORT POST-COMMIT, y la asimetría es deliberada: la visita YA está
 * cerrada y respaldada cuando esto corre. Si la publicación falla, lo que se
 * pierde es la generación automática del pago — no el registro del trabajo.
 * Hacerlo al revés (fallar el cierre porque no se pudo avisar a la cola)
 * dejaría al conductor sin poder cerrar su visita, de pie en la bodega, por un
 * problema de la trastienda financiera. El acta queda, y la línea se puede
 * regenerar; una visita que no se pudo cerrar no se recupera.
 *
 * ⚠️ Que sea best-effort NO significa que se pierda en silencio: el conteo de
 * visitas cerradas sin línea es exactamente lo que la conciliación tiene que
 * poder detectar. Ver el detector de la etapa 8 en `dinero`.
 */
async function publicarVisitaCerrada(
  cliente: SupabaseClient,
  entrada: { tenantId: string; sesionId: string; conductorId: string },
  resultado: ResultadoCerrarSesionRetiro,
): Promise<void> {
  try {
    // La bodega, el seller y la fecha viven en la fila de la sesión y el RPC no
    // los devuelve. Se leen acá y no antes, para no pagar el SELECT en el
    // camino de la visita descartada.
    const { data: sesion } = await cliente
      .from("sesiones_retiro")
      .select("bodega_id, seller_id, fecha_operacion")
      .eq("tenant_id", entrada.tenantId)
      .eq("id", entrada.sesionId)
      .maybeSingle();

    if (!sesion) return;

    const data: EventoVisitaRetiroCerrada["data"] = {
      sesionRetiroId: entrada.sesionId,
      tenantId: entrada.tenantId,
      conductorId: entrada.conductorId,
      bodegaId: sesion.bodega_id as string,
      sellerId: sesion.seller_id as string,
      fechaOperacion: sesion.fecha_operacion as string,
      bultosTotal: resultado.bultosTotal,
    };

    await inngest.send({
      name: "dinero/retiro.visita-cerrada",
      // Determinístico por visita: dos reintentos del cierre no generan dos
      // pagos. Es la primera de las tres capas de idempotencia (las otras dos
      // están en el job y en el índice único de la tabla).
      id: `linea-retiro-${entrada.sesionId}`,
      data,
    });
  } catch {
    // Ver la cabecera: el cierre ya ocurrió y no se revierte por esto.
  }
}
