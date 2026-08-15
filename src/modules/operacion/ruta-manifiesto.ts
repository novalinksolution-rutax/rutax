/**
 * Ruteo de un manifiesto — la orquestación que faltaba entre el motor y la BD.
 * =============================================================================
 * Etapa 7 de "retiro en bodega + ruteo" (`docs/arquitectura/retiro-y-ruteo.md`
 * §4, `docs/arquitectura/retiro-y-ruteo-plan.md` §Etapa 7).
 *
 * Hasta ahora la etapa 7 tenía las dos puntas construidas y nada en el medio:
 * el motor (`./ruteo/`) calculaba una secuencia y no sabía de dónde salían las
 * paradas; el RPC (`./secuencia-paradas-rpc.ts`) sabía escribirla y **no tenía
 * un solo llamador**. Este módulo es el tramo que las une, y vive en `operacion`
 * —no en `app/**`— por una razón que no es de estilo:
 *
 * =============================================================================
 * ESTE ARCHIVO ES LA FRONTERA DE PRIVACIDAD DEL PUNTO DE TÉRMINO
 * =============================================================================
 * `docs/seguridad/punto-de-termino-conductor.md` §6.2 lo pide con estas
 * palabras: el ancla la lee UNA función (`obtenerAnclaFinRuta`), el solver la
 * recibe como parámetro y **devuelve el orden de las paradas, no los nodos**, y
 * el tipo que sale hacia `app/**` no tiene un campo donde quepa una coordenada
 * de término.
 *
 * Aquí eso se traduce en una regla mecánica: **`ancla` es una variable local de
 * `calcularYAplicarRutaManifiesto` y no aparece en ningún tipo exportado.** Si
 * al editar este archivo te encuentras devolviéndola, aunque sea "solo para
 * depurar", ese es el canal 2 del §4.3 — el que ese documento señala como el que
 * más se rompe en la práctica.
 *
 * Y no es cortesía: bajo subordinación laboral el consentimiento del conductor
 * solo es libre si negarse no queda a la vista del jefe. Por eso la salida tiene
 * que ser IDÉNTICA exista o no ancla — mismas claves, mismos totales — y no
 * basta con que la interfaz no la pinte.
 *
 * =============================================================================
 * LA SALIDA NO PUEDE DELATAR AL CONDUCTOR NI SIQUIERA FALLANDO
 * =============================================================================
 * Un detalle que no está en el documento y que se decide aquí: si el ancla
 * tuviera una coordenada corrupta, `calcularRuta` lanzaría — y el coordinador
 * vería un error **solo para los conductores que definieron su punto**. Eso es
 * un canal de fuga por la puerta de atrás. Por eso el ancla se valida ANTES de
 * pasarla y, si no sirve, se ruteA sin ella: mejor una ruta que no termina cerca
 * de casa que un mensaje que delata quién dijo que sí.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Punto } from "@/lib/geo/distancia";

import { puntoUsable } from "./distancias-tramo";
import { obtenerAnclaFinRuta } from "./punto-termino-conductor";
import { calcularRuta } from "./ruteo";
import {
  aplicarSecuenciaParadasRpc,
  pedidoIdsDesdeSecuencia,
} from "./secuencia-paradas-rpc";

// =============================================================================
// Errores de dominio
// =============================================================================

/**
 * No hay bodega del courier usable como punto de partida.
 *
 * Es un error de CONFIGURACIÓN, no de datos del día, y por eso tiene tipo
 * propio: el coordinador no puede hacer nada útil con "falló el ruteo", pero sí
 * con "anda a configurar tu bodega". La bodega es el origen de TODA ruta
 * (`identidad.courier_bodegas`, migración 20260813000002 §2).
 */
export class ErrorSinBodegaOrigen extends Error {
  constructor() {
    super(
      "Todavía no hay una bodega del courier con ubicación resuelta. Configúrala en Configuración → Bodegas antes de calcular una ruta.",
    );
    this.name = "ErrorSinBodegaOrigen";
  }
}

/** El manifiesto no existe, o es de otro courier. Indistinguibles a propósito. */
export class ErrorManifiestoNoEncontrado extends Error {
  constructor() {
    super("El manifiesto no existe o no pertenece a tu operación.");
    this.name = "ErrorManifiestoNoEncontrado";
  }
}

// =============================================================================
// Origen de la ruta — la bodega del courier
// =============================================================================

/**
 * De dónde sale la flota. Es lo MÍNIMO que necesita el solver más el nombre,
 * que sí se muestra (la bodega del courier no es un dato personal de nadie:
 * es el galpón desde el que opera la empresa, y el coordinador tiene que saber
 * desde cuál se calculó la ruta).
 */
export interface OrigenRuta {
  id: string;
  nombre: string;
  lat: number;
  long: number;
}

/**
 * La bodega desde la que arranca la ruta: la principal si está resuelta, y si
 * no, la más antigua de las activas con coordenada.
 *
 * El respaldo NO es un capricho. `es_principal` puede estar en una bodega cuyo
 * geocoding falló (la Server Action de bodegas guarda igual y marca
 * `no_resuelto` — es deliberado, para no bloquear el alta), y en ese caso negarle
 * la ruta al coordinador cuando tiene otra bodega perfectamente geocodificada
 * sería obedecer a la letra en contra del propósito. Se ordena por `creado_en`
 * para que el respaldo sea ESTABLE: dos corridas seguidas tienen que elegir la
 * misma, o la ruta cambiaría sola entre recargas.
 *
 * Devuelve `null` si no hay ninguna usable — el llamador lo traduce a
 * `ErrorSinBodegaOrigen`.
 */
export async function obtenerOrigenRutaDelCourier(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<OrigenRuta | null> {
  const { data, error } = await cliente
    .schema("identidad")
    .from("courier_bodegas")
    .select("id, nombre, lat, long, es_principal, creado_en")
    .eq("tenant_id", tenantId)
    .eq("activa", true)
    .eq("geo_estado", "resuelto")
    .not("lat", "is", null)
    .not("long", "is", null)
    // `es_principal` primero (descendente: true antes que false), y el empate lo
    // rompe la antigüedad para que la elección sea reproducible.
    .order("es_principal", { ascending: false })
    .order("creado_en", { ascending: true });

  if (error) {
    throw new Error(`Error al leer la bodega de origen: ${error.message}`);
  }

  const fila = data?.[0];
  if (!fila) return null;

  const punto = puntoUsable(fila.lat as number | null, fila.long as number | null);
  if (!punto) return null;

  return {
    id: fila.id as string,
    nombre: fila.nombre as string,
    lat: punto.lat,
    long: punto.long,
  };
}

// =============================================================================
// Cálculo + persistencia
// =============================================================================

/** Una parada tal como la lee este módulo de `asignaciones_pedido` + `pedidos`. */
export interface ParadaDelManifiesto {
  pedidoId: string;
  lat: number | null;
  long: number | null;
}

export interface ResultadoRuteoManifiesto {
  /** Paradas que quedaron con número de orden. */
  totalParadas: number;
  /**
   * Paradas ACTIVAS que quedaron sin secuencia. Son las que el motor no pudo
   * ubicar por falta de coordenada usable: **no desaparecen**, siguen siendo
   * paquetes que hay que entregar y la pantalla tiene que mostrarlas.
   */
  totalSinSecuencia: number;
  /** Metros de bodega a la ÚLTIMA parada. Nunca incluye tramo hacia el ancla. */
  distanciaTotalM: number;
  /** Nombre de la bodega desde la que se calculó. Para decirlo en pantalla. */
  nombreOrigen: string;
}

/**
 * Calcula la ruta del manifiesto y la persiste, en ese orden.
 *
 * El `cliente` debe ser `service_role`: el RPC es `security definer` con EXECUTE
 * solo para ese rol, y `courier_bodegas` no es legible por el conductor. El
 * aislamiento lo impone `tenantId`, que el llamador ya resolvió contra la
 * sesión — nunca un claim del navegador.
 *
 * Devuelve un resumen SIN una sola coordenada del punto de término. Ver la
 * cabecera del archivo.
 */
export async function calcularYAplicarRutaManifiesto(
  cliente: SupabaseClient,
  input: {
    tenantId: string;
    manifiestoId: string;
    /** UUID del usuario auth que dispara el cálculo. RNF-04. */
    actorUsuarioId: string;
  },
): Promise<ResultadoRuteoManifiesto> {
  const { tenantId, manifiestoId, actorUsuarioId } = input;

  // --- 1. El manifiesto, para saber de qué conductor es --------------------
  const { data: manifiesto, error: errorManifiesto } = await cliente
    .from("manifiestos")
    .select("id, driver_id")
    .eq("id", manifiestoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (errorManifiesto) {
    throw new Error(`Error al leer el manifiesto: ${errorManifiesto.message}`);
  }
  if (!manifiesto) throw new ErrorManifiestoNoEncontrado();

  // --- 2. Origen y paradas, en paralelo ------------------------------------
  const [origen, paradas] = await Promise.all([
    obtenerOrigenRutaDelCourier(cliente, tenantId),
    listarParadasDelManifiesto(cliente, tenantId, manifiestoId),
  ]);

  if (!origen) throw new ErrorSinBodegaOrigen();

  // --- 3. El ancla. Variable local, y hasta aquí llega ----------------------
  // Se lee DESPUÉS del origen para que un fallo de configuración de bodega
  // (visible para el coordinador) nunca dependa de si este conductor definió su
  // punto: el error de bodega se lanza antes de que el ancla exista siquiera.
  const anclaLeida = await obtenerAnclaFinRuta(cliente, tenantId, manifiesto.driver_id as string);

  // Ver la cabecera: un ancla corrupta se descarta en silencio en vez de dejar
  // que el motor lance. Un error que solo aparece para los conductores con punto
  // definido delata exactamente lo que el diseño protege.
  const ancla: Punto | null =
    anclaLeida === null ? null : puntoUsable(anclaLeida.lat, anclaLeida.long);

  // --- 4. Motor -------------------------------------------------------------
  const ruta = await calcularRuta({
    origen: { lat: origen.lat, long: origen.long },
    destino: ancla,
    paradas,
  });

  // --- 5. Persistir la secuencia COMPLETA ----------------------------------
  // `sinUbicar` no viaja: su sitio es quedarse sin secuencia (NULL), que es
  // exactamente lo que hace el RPC con todo lo que no venga en la lista.
  const resultado = await aplicarSecuenciaParadasRpc(cliente, {
    tenantId,
    manifiestoId,
    pedidoIdsEnOrden: pedidoIdsDesdeSecuencia(ruta.secuencia),
    origen: "motor",
    actorUsuarioId,
  });

  return {
    totalParadas: resultado.totalParadas,
    totalSinSecuencia: resultado.totalSinSecuencia,
    distanciaTotalM: ruta.distanciaTotalM,
    nombreOrigen: origen.nombre,
  };
}

/**
 * Las paradas activas del manifiesto, con su coordenada.
 *
 * Trae TODAS las asignaciones activas, sin filtrar por estado del pedido: un
 * pedido ya entregado sigue ocupando su lugar en la secuencia del día, y
 * excluirlo aquí haría que la lista enviada al RPC no coincidiera con sus
 * paradas activas — que es exactamente el `P0001` que el RPC levanta.
 */
async function listarParadasDelManifiesto(
  cliente: SupabaseClient,
  tenantId: string,
  manifiestoId: string,
): Promise<ParadaDelManifiesto[]> {
  const { data, error } = await cliente
    .from("asignaciones_pedido")
    .select("pedido_id, pedidos(id, lat, long)")
    .eq("tenant_id", tenantId)
    .eq("manifiesto_id", manifiestoId)
    .eq("activa", true);

  if (error) {
    throw new Error(`Error al leer las paradas del manifiesto: ${error.message}`);
  }

  return (data ?? [])
    .map((fila: Record<string, unknown>) => {
      const pedido = fila.pedidos as Record<string, unknown> | null;
      if (!pedido) return null;
      return {
        pedidoId: fila.pedido_id as string,
        lat: (pedido.lat as number | null) ?? null,
        long: (pedido.long as number | null) ?? null,
      } satisfies ParadaDelManifiesto;
    })
    .filter((p): p is ParadaDelManifiesto => p !== null);
}
