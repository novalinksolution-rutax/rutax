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
import {
  ErrorRuteo,
  obtenerPuertoOptimizacion,
  type ParadaAOptimizar,
  type TramoRuta,
} from "@/modules/integraciones/ruteo";

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
  /**
   * Posición fijada por el conductor, o `null` si el motor puede moverla.
   *
   * ⚠️ **Sobrevive también al «Calcular ruta» del coordinador**, y eso es una
   * decisión, no un descuido: si el recálculo del coordinador borrara las
   * fijaciones, desharía en silencio la corrección que el conductor hizo en la
   * calle — que es exactamente lo que el diseño prohíbe. Se limpian solo
   * cuando alguien manda una secuencia sin ellas.
   */
  ordenFijo: number | null;
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
  /**
   * Quién resolvió la secuencia. `local` = motor propio sobre haversine (línea
   * recta); `google` = Route Optimization, por calle y con tráfico.
   *
   * Sale hacia la pantalla a propósito: la diferencia entre las dos es
   * exactamente la advertencia que el producto le debe al conductor —«esto es
   * una propuesta en línea recta»— y esa advertencia **no se puede escribir
   * fija** si la ruta a veces viene por calle.
   */
  proveedor: ProveedorRuta;
  /**
   * Segundos estimados de conducción, con tráfico. `null` con motor local, que
   * no tiene noción de tiempo.
   *
   * Como `distanciaTotalM`, se acumula solo hasta la última parada: nunca
   * incluye el trayecto al punto de término (canal 5 del §4.3).
   */
  duracionTotalS: number | null;
  /**
   * Geometría por calle de cada tramo (origen→1, 1→2, …). `null` con motor
   * local.
   *
   * ⚠️ **Esto es el canal 3 del §4.3 y por eso vale la pena decir por qué puede
   * salir de aquí.** El adaptador ya descartó el tramo final hacia el ancla, así
   * que este arreglo tiene siempre tantos tramos como paradas en secuencia,
   * exista o no punto de término — la salida es idéntica en los dos casos, que
   * es la condición dura del documento. Un `fitBounds` sobre estas polilíneas
   * tampoco puede delatar el ancla, porque no hay un solo vértice suyo aquí.
   */
  tramos: readonly TramoRuta[] | null;
}

/** Quién resolvió la secuencia. */
export type ProveedorRuta = "local" | "google";

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
  const ruta = await resolverRuta({
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
    // Las fijadas se REESCRIBEN tal como venían: el recálculo respeta lo que el
    // conductor movió a mano. Ver la nota de `ParadaDelManifiesto.ordenFijo`.
    fijados: fijadosDeLaSecuencia(ruta.secuencia, paradas),
    // `undefined` con motor local — mide en línea recta y no tiene geometría
    // que guardar. El RPC lo traduce a «sin tramos».
    //
    // Un tramo SIN polilínea es «sin geometría», no un tramo a medias: sus
    // métricas se descartan con él. Es la misma regla que impone el CHECK
    // `asignaciones_pedido_tramo_completo`, dicha antes de llegar a la base.
    tramos: ruta.tramos?.map((t) =>
      t.polilinea === null
        ? null
        : { polilinea: t.polilinea, distanciaM: t.distanciaM, duracionS: t.duracionS },
    ),
  });

  return {
    totalParadas: resultado.totalParadas,
    totalSinSecuencia: resultado.totalSinSecuencia,
    distanciaTotalM: ruta.distanciaTotalM,
    nombreOrigen: origen.nombre,
    proveedor: ruta.proveedor,
    duracionTotalS: ruta.duracionTotalS,
    tramos: ruta.tramos,
  };
}

// =============================================================================
// Quién resuelve la ruta: el proveedor externo si está encendido, si no el motor
// =============================================================================

/** Lo que las dos vías tienen que producir para que el resto no se entere. */
interface RutaResuelta {
  secuencia: readonly { pedidoId: string; orden: number }[];
  distanciaTotalM: number;
  duracionTotalS: number | null;
  tramos: readonly TramoRuta[] | null;
  proveedor: ProveedorRuta;
}

/** Qué paradas de `secuencia` quedan fijadas, alineado POR POSICIÓN. */
function fijadosDeLaSecuencia(
  secuencia: readonly { pedidoId: string }[],
  paradas: readonly ParadaDelManifiesto[],
): boolean[] {
  const fijos = new Set(
    paradas.filter((p) => p.ordenFijo !== null).map((p) => p.pedidoId),
  );
  return secuencia.map((s) => fijos.has(s.pedidoId));
}

/**
 * Resuelve la secuencia con el proveedor externo si hay uno configurado, y si
 * no —o si falla— con el motor local.
 *
 * =============================================================================
 * EL FALLBACK NO ES PEREZA: ES LA HORA
 * =============================================================================
 * Esto se ejecuta con el coordinador mirando la pantalla y la flota esperando
 * para salir a las 16:00 en punto. Si Google no contesta, una secuencia en
 * línea recta es peor que una por calle y muchísimo mejor que un mensaje de
 * error y cero paradas ordenadas. Por eso `ErrorRuteoProveedor` **no se
 * propaga**: se degrada.
 *
 * ⚠️ Lo que SÍ se propaga es `ErrorRuteoConfig`: que alguien haya escrito mal
 * el nombre del proveedor no se arregla sirviendo líneas rectas en silencio
 * durante un mes. Falla ruidoso, como pide el puerto.
 *
 * =============================================================================
 * LAS PARADAS SIN COORDENADA NO LLEGAN AL PROVEEDOR, Y NO SE PIERDEN
 * =============================================================================
 * El puerto externo exige coordenada; el motor local acepta nulos y los
 * devuelve en `sinUbicar`. Acá se filtran antes de salir a la red, y las que
 * quedan fuera simplemente no entran en la secuencia — lo que el RPC traduce a
 * `orden_ruta` nulo, o sea el estado «sin secuencia» que la pantalla ya
 * muestra. Es el mismo destino que tienen con el motor local.
 */
async function resolverRuta(entrada: {
  origen: Punto;
  destino: Punto | null;
  paradas: readonly ParadaDelManifiesto[];
}): Promise<RutaResuelta> {
  const puerto = obtenerPuertoOptimizacion();

  // ⚠️ **Con paradas fijadas NO se llama al proveedor externo, y es a propósito.**
  //
  // Google decide un orden y devuelve la geometría DE ESE orden. Al insertar
  // después una parada fijada en el medio, esa geometría deja de unir los pines
  // que se ven en pantalla: la línea iría por un lado y los números por otro.
  // Dibujar eso es peor que no dibujarlo, y sus totales quedan igual de
  // inválidos — devolver «0 km» o los kilómetros del orden que no se usó serían
  // las dos formas de mentir.
  //
  // El motor local, en cambio, maneja las fijadas de forma nativa y devuelve un
  // kilometraje que corresponde a la ruta real. Se pierde el trazado por calle
  // mientras haya una parada fijada; se gana que todo lo que se muestra sea
  // cierto.
  //
  // El estado deseable es otro y queda anotado: pedirle la geometría del orden
  // YA DECIDIDO a `Compute Routes` de Google, que se cobra POR PETICIÓN (una
  // por ruta) y no por parada. Ese es el siguiente paso del ruteo.
  const hayFijadas = entrada.paradas.some((p) => p.ordenFijo !== null);

  if (puerto !== null && !hayFijadas) {
    // Solo las ubicables salen a la red.
    const ubicables: ParadaAOptimizar[] = [];
    for (const parada of entrada.paradas) {
      const punto = puntoUsable(parada.lat, parada.long);
      if (punto) {
        ubicables.push({ pedidoId: parada.pedidoId, lat: punto.lat, long: punto.long });
      }
    }

    try {
      const optimizada = await puerto.optimizarRuta({
        origen: entrada.origen,
        destino: entrada.destino,
        paradas: ubicables,
      });
      return {
        secuencia: optimizada.secuencia,
        distanciaTotalM: optimizada.distanciaTotalM,
        duracionTotalS: optimizada.duracionTotalS,
        tramos: optimizada.tramos,
        proveedor: "google",
      };
    } catch (causa) {
      // Se degrada ante CUALQUIER fallo del módulo de ruteo, no solo los de
      // red: credenciales ilegibles incluidas. El único que sigue propagando es
      // el nombre de proveedor no reconocido, porque `obtenerPuertoOptimizacion`
      // se llama FUERA de este try.
      //
      // ⚠️ Antes esto solo atajaba `ErrorRuteoProveedor`, así que una clave
      // privada mal pegada **bloqueaba el cálculo de la ruta entera** con un
      // error de OpenSSL en pantalla. Pasó en producción el 2026-08-27.
      if (!(causa instanceof ErrorRuteo)) throw causa;

      // `console.error`, no `warn`: cuando esto falla, el primer sitio donde se
      // mira es el filtro de errores de Vercel. Con un warning, ahí no aparece
      // nada y el diagnóstico se hace a ciegas — costó una hora ese día.
      //
      // Se registra SIN la entrada del solver: lleva el ancla (canal 12 del
      // §4.3). Solo el mensaje, que ya viene depurado de coordenadas.
      console.error(
        "[ruta-manifiesto] el proveedor de ruteo falló, se usa el motor local:",
        causa.message,
      );
    }
  }

  const local = await calcularRuta({
    origen: entrada.origen,
    destino: entrada.destino,
    paradas: entrada.paradas,
  });

  return {
    secuencia: local.secuencia,
    distanciaTotalM: local.distanciaTotalM,
    duracionTotalS: null,
    tramos: null,
    proveedor: "local",
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
    .select("pedido_id, orden_ruta, orden_fijado, pedidos(id, lat, long)")
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
      // La fijación solo significa algo junto a su posición: `orden_fijado`
      // sin `orden_ruta` no puede ocurrir (lo impide el CHECK
      // `asignaciones_pedido_fijado_exige_orden`), pero se comprueba igual
      // porque leer de la base no es lo mismo que confiar en ella.
      const fijado = fila.orden_fijado === true;
      const ordenRuta = (fila.orden_ruta as number | null) ?? null;
      return {
        pedidoId: fila.pedido_id as string,
        lat: (pedido.lat as number | null) ?? null,
        long: (pedido.long as number | null) ?? null,
        ordenFijo: fijado && ordenRuta !== null ? ordenRuta : null,
      } satisfies ParadaDelManifiesto;
    })
    .filter((p): p is ParadaDelManifiesto => p !== null);
}
