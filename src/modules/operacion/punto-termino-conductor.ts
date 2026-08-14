/**
 * Punto de término de ruta del conductor — capa de acceso.
 * =============================================================================
 * FUENTE DE VERDAD: `docs/seguridad/punto-de-termino-conductor.md`. Ese
 * documento manda sobre todo lo que toque este dato; si el plan de ejecución
 * dice otra cosa, gana el documento.
 *
 * QUÉ ES: dónde el conductor pide TERMINAR su ruta — su casa, o cerca de ella.
 * Opcional, revocable, y **no pasa nada si no lo define**: la ruta simplemente
 * termina en la última parada.
 *
 * ## Lo único que hay que entender antes de tocar este archivo
 *
 * **La RLS de la tabla NO es la protección principal.** El motor de ruteo corre
 * con `service_role`, que bypasea RLS por diseño: nada a nivel de base impide
 * que el servidor serialice esta coordenada en las props que viajan al
 * navegador del coordinador. La barrera real es de MÓDULO y es esta:
 *
 *   · `obtenerAnclaFinRuta` es el ÚNICO lector del ancla para el cálculo.
 *   · El solver la recibe como PARÁMETRO y devuelve **el orden de las paradas**,
 *     no los nodos.
 *   · El tipo de la ruta que sale hacia `app/**` **no debe tener un campo donde
 *     quepa una coordenada de término**. Si lo tiene, la fuga es cuestión de
 *     tiempo.
 *
 * Y no es cortesía. Bajo la Ley 21.431 el domicilio particular no está en el
 * contexto del servicio que el conductor presta: la base de licitud es su
 * consentimiento, y un consentimiento prestado bajo subordinación laboral solo
 * se sostiene si negarse **no queda a la vista del jefe**. Por eso "nada delata
 * quién no lo definió" es la condición que hace VÁLIDO el consentimiento de
 * todos los demás, no una preferencia de producto. Y no se cumple escondiendo un
 * campo: se cumple haciendo que la salida sea **idéntica** en los dos casos —
 * mismas claves, mismos totales de km, mismo ETA, mismo encuadre de mapa.
 *
 * Los 15 canales de fuga están enumerados en §4.3 del documento. Los que más se
 * rompen en la práctica: el DTO, el `fitBounds` del mapa (un encuadre que
 * incluya el ancla delata el sector aunque el punto no se pinte) y los totales
 * de distancia (comparar dos conductores con las mismas paradas revela quién
 * tiene ancla y a qué distancia — fuga silenciosa y aritmética).
 *
 * ## Lo prohibido, en corto (§8 del documento)
 *
 *   1. Sin histórico. Una fila por conductor; redefinir PISA el dato.
 *   2. Sin el texto de la dirección, en ninguna columna de ninguna tabla.
 *   3. **Nunca `resolverCoordenadaConCache`.** `integraciones.geocoding_cache`
 *      es global, sin `tenant_id`, guarda `direccion_norm` en claro y no tiene
 *      purga: meter ahí el domicilio de un conductor haría FALSA la promesa de
 *      borrado. El atajo natural —"reuso lo de bodegas"— es exactamente lo que
 *      no se puede hacer.
 *   4. No es columna de `identidad.conductores` (esa fila la lee cualquier
 *      interno del tenant).
 *   5. No se infiere del rastreo, ni de `pruebas_entrega.geo_*`, ni de nada
 *      capturado. Lo define el conductor a mano, o no existe.
 *   6. No entra en `TABLAS_A_EXPORTAR` (la exportación RNF-13 se la lleva el
 *      DUEÑO del courier), ni en Realtime, ni en Sentry, ni en la bitácora como
 *      valor, ni en una URL.
 *   7. No se hace obligatorio: ni bloqueando pantallas, ni con recordatorios,
 *      ni condicionando la asignación. Un consentimiento con costo no es
 *      consentimiento.
 *
 * ## Escritura
 * Todo pasa por `service_role`: la tabla no tiene un solo `grant` para
 * `authenticated` y su política SELECT (solo el propio conductor) está inerte
 * a propósito. La app Expo entra por rutas Bearer y la PWA por Server Actions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { CENTROIDES_RM } from "@/lib/geo/centroides-rm";
import { distanciaEnMetros } from "@/lib/geo/distancia";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";

import {
  revocarConsentimientoUbicacion,
  tieneConsentimientoVigente,
} from "./consentimiento-ubicacion";

// =============================================================================
// Constantes
// =============================================================================

/** La finalidad de consentimiento que autoriza guardar este dato. */
export const FINALIDAD_PUNTO_TERMINO = "punto_termino_ruta" as const;

/**
 * Distancia máxima a un centroide comunal para atribuir la comuna. Más allá de
 * esto se deja `null` en vez de mentir: el catálogo cubre la Región
 * Metropolitana y un punto en Rancagua no es "Melipilla porque es el centroide
 * menos lejano".
 */
const RADIO_MAX_COMUNA_M = 20_000;

/** Nombre de la tabla; vive en `operacion` y NO tiene espejo en `public`. */
const TABLA = "punto_termino_conductor";

// =============================================================================
// Tipos
// =============================================================================

/**
 * Lo MÍNIMO que necesita el solver: dos números.
 *
 * Deliberadamente no incluye `comuna`, ni `conductorId`, ni fechas. Un tipo
 * pequeño es difícil de esparcir por accidente: si esto tuviera forma de "fila
 * de la tabla", el camino natural sería pasarlo entero hacia arriba.
 */
export interface AnclaFinRuta {
  lat: number;
  long: number;
}

/** Lo que ve el conductor de SU propio punto, en SU app. En ningún otro lado. */
export interface PuntoTerminoConductor {
  lat: number;
  long: number;
  /** Solo para que él reconozca su punto. No es el texto de una dirección. */
  comuna: string | null;
  definidoEn: string;
  actualizadoEn: string;
}

export interface DefinirPuntoTerminoInput {
  tenantId: string;
  conductorId: string;
  /** UUID del usuario auth que ejecuta (el propio conductor). RNF-04. */
  actorUsuarioId: string;
  /** Coordenada del pin que marcó en el mapa. Se redondea EN LA BASE. */
  lat: number;
  long: number;
}

export interface RevocarPuntoTerminoInput {
  tenantId: string;
  conductorId: string;
  actorUsuarioId: string;
}

/** Se lanza cuando falta el consentimiento de ESTA finalidad. */
export class ErrorSinConsentimientoPuntoTermino extends Error {
  constructor() {
    super(
      "El conductor no tiene consentimiento vigente para guardar su punto de término.",
    );
    this.name = "ErrorSinConsentimientoPuntoTermino";
  }
}

/** Se lanza cuando la coordenada no es un punto válido de la esfera. */
export class ErrorCoordenadaPuntoTerminoInvalida extends Error {
  constructor() {
    super("La coordenada del punto de término no es válida.");
    this.name = "ErrorCoordenadaPuntoTerminoInvalida";
  }
}

// =============================================================================
// Derivación de comuna
// =============================================================================

/**
 * Comuna aproximada de una coordenada, por centroide más cercano.
 *
 * Es una ETIQUETA para que el conductor reconozca su propio punto, no una
 * atribución territorial: cerca de un límite comunal puede equivocarse, y da
 * igual — nadie toma ninguna decisión con este valor y nadie más que él lo ve.
 * Se prefiere el centroide al polígono a propósito: el repo no tiene PostGIS
 * ni geometría comunal en el servidor, y traerla para rotular un pin sería
 * pagar una dependencia por un adorno.
 *
 * Devuelve `null` si el punto queda fuera del radio de cobertura: es mejor no
 * decir nada que decir una comuna que no es.
 */
export function comunaDeCoordenada(lat: number, long: number): string | null {
  let mejorNombre: string | null = null;
  let mejorDistancia = Number.POSITIVE_INFINITY;

  for (const [nombre, centro] of Object.entries(CENTROIDES_RM)) {
    const d = distanciaEnMetros({ lat, long }, centro);
    if (d < mejorDistancia) {
      mejorDistancia = d;
      mejorNombre = nombre;
    }
  }

  return mejorDistancia <= RADIO_MAX_COMUNA_M ? mejorNombre : null;
}

/** ¿Es un par lat/long representable? Ataja NaN, Infinity y el swap evidente. */
function coordenadaValida(lat: number, long: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(long) &&
    lat >= -90 &&
    lat <= 90 &&
    long >= -180 &&
    long <= 180
  );
}

// =============================================================================
// Lectura
// =============================================================================

/**
 * **EL ÚNICO LECTOR DEL ANCLA PARA EL CÁLCULO DE RUTA.**
 *
 * Devuelve solo `{ lat, long }`, o `null` si el conductor no definió punto.
 * El solver la recibe como PARÁMETRO y devuelve **el orden de las paradas**;
 * el valor que sale de aquí **no puede sobrevivir a la función que calcula la
 * ruta**: no se guarda en la ruta persistida, no se serializa en el DTO, no
 * entra en el `fitBounds`, no suma a los totales de distancia ni al ETA, y no
 * viaja en un traspaso de ruta entre conductores (si se recalcula, se usa la
 * del receptor; si no, no hay tramo final de nadie).
 *
 * Si te encuentras queriendo devolver esto hacia `app/**`, para: eso es el
 * canal 2 del §4.3, el que más se rompe en la práctica.
 */
export async function obtenerAnclaFinRuta(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
): Promise<AnclaFinRuta | null> {
  const { data, error } = await cliente
    .schema("operacion")
    .from(TABLA)
    .select("lat, long")
    .eq("tenant_id", tenantId)
    .eq("conductor_id", conductorId)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al leer el punto de término: ${error.message}`);
  }
  if (!data) return null;

  return { lat: data.lat as number, long: data.long as number };
}

/**
 * El punto propio del conductor, para SU app. Es el único lugar donde este dato
 * se muestra a un humano.
 *
 * No existe una variante "de un conductor cualquiera" a propósito: cualquier
 * llamador que quiera ver el punto de otro está pidiendo justo lo que el diseño
 * prohíbe. `tenantId` va en el filtro aunque `conductor_id` sea la PK — misma
 * razón que en el resto del repo: un id que viene de fuera nunca se usa solo.
 */
export async function obtenerPuntoTerminoPropio(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
): Promise<PuntoTerminoConductor | null> {
  const { data, error } = await cliente
    .schema("operacion")
    .from(TABLA)
    .select("lat, long, comuna, definido_en, actualizado_en")
    .eq("tenant_id", tenantId)
    .eq("conductor_id", conductorId)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al leer el punto de término: ${error.message}`);
  }
  if (!data) return null;

  return {
    lat: data.lat as number,
    long: data.long as number,
    comuna: (data.comuna as string | null) ?? null,
    definidoEn: data.definido_en as string,
    actualizadoEn: data.actualizado_en as string,
  };
}

// =============================================================================
// Escritura
// =============================================================================

/**
 * Define (o REdefine) el punto de término del conductor.
 *
 * Orden, y ninguno de los pasos es opcional:
 *   1. Coordenada válida.
 *   2. **Consentimiento vigente de `punto_termino_ruta`.** Sin él no se guarda
 *      nada: la base de licitud de este dato es el consentimiento, no el
 *      contrato de trabajo. Fallamos cerrado.
 *   3. **Bitácora ANTES del efecto** (invariante de `CLAUDE.md`), con el HECHO
 *      y sin la coordenada — ni lat, ni long, ni comuna. El asiento dice que
 *      definió un punto, jamás cuál.
 *   4. SELECT → INSERT o UPDATE acotado. **No es un `upsert` de PostgREST** por
 *      la lección del 2026-08-13: en un upsert, toda columna del payload es
 *      también una escritura en el UPDATE, y aquí eso pisaría `definido_en`
 *      —la fecha desde la que existe el dato— en cada redefinición.
 *
 * Devuelve lo que quedó GUARDADO, no lo que se pidió guardar: la coordenada
 * vuelve leída de la base, ya redondeada por el trigger. Devolver el input
 * mentiría al conductor sobre la precisión con la que se le guardó.
 */
export async function definirPuntoTermino(
  cliente: SupabaseClient,
  input: DefinirPuntoTerminoInput,
): Promise<PuntoTerminoConductor> {
  const { tenantId, conductorId, actorUsuarioId, lat, long } = input;

  // --- 1. Coordenada -----------------------------------------------------------
  if (!coordenadaValida(lat, long)) {
    throw new ErrorCoordenadaPuntoTerminoInvalida();
  }

  // --- 2. Consentimiento de ESTA finalidad -------------------------------------
  const consiente = await tieneConsentimientoVigente(
    cliente,
    tenantId,
    conductorId,
    FINALIDAD_PUNTO_TERMINO,
  );
  if (!consiente) throw new ErrorSinConsentimientoPuntoTermino();

  const comuna = comunaDeCoordenada(lat, long);

  // ¿Ya existía? Se resuelve antes para no usar upsert (ver docstring) y para
  // que la bitácora sepa distinguir "definió" de "redefinió".
  const { data: existente, error: errorLectura } = await cliente
    .schema("operacion")
    .from(TABLA)
    .select("conductor_id")
    .eq("tenant_id", tenantId)
    .eq("conductor_id", conductorId)
    .maybeSingle();

  if (errorLectura) {
    throw new Error(
      `Error al comprobar el punto de término existente: ${errorLectura.message}`,
    );
  }

  // --- 3. Bitácora ANTES del efecto, SIN la coordenada -------------------------
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "conductor.punto_termino.definido",
    entidadTipo: "conductor",
    entidadId: conductorId,
    detalle: {
      // El HECHO, nunca el valor. Ni lat, ni long, ni comuna: la comuna es un
      // sector, y un sector en la bitácora del courier es exactamente lo que el
      // §4 evita (el dueño puede leer su propia bitácora).
      redefinicion: existente !== null,
      finalidad: FINALIDAD_PUNTO_TERMINO,
    },
  });

  // --- 4. INSERT o UPDATE ------------------------------------------------------
  const columnas = "lat, long, comuna, definido_en, actualizado_en";

  const { data, error } = existente
    ? await cliente
        .schema("operacion")
        .from(TABLA)
        // `definido_en` NO viaja: es la fecha desde la que existe el dato.
        // `actualizado_en` lo sella el trigger.
        .update({ lat, long, comuna })
        .eq("tenant_id", tenantId)
        .eq("conductor_id", conductorId)
        .select(columnas)
        .single()
    : await cliente
        .schema("operacion")
        .from(TABLA)
        .insert({ tenant_id: tenantId, conductor_id: conductorId, lat, long, comuna })
        .select(columnas)
        .single();

  if (error || !data) {
    throw new Error(
      `Error al guardar el punto de término: ${error?.message ?? "sin fila devuelta"}`,
    );
  }

  return {
    lat: data.lat as number,
    long: data.long as number,
    comuna: (data.comuna as string | null) ?? null,
    definidoEn: data.definido_en as string,
    actualizadoEn: data.actualizado_en as string,
  };
}

/**
 * El conductor retira su punto de término.
 *
 * Orden fijado por §5.3 del documento:
 *   1. Bitácora (invariante: antes de cualquier efecto).
 *   2. `revocado_en` en el consentimiento **de esta finalidad**.
 *   3. **DELETE de la fila. No `activa = false`.** Aquí no cuelga plata, ni
 *      prueba, ni respaldo contable: conservar la fila sería conservar el
 *      domicilio de un trabajador sin un solo motivo. Es la diferencia con las
 *      bodegas, donde la baja SÍ es lógica porque detrás hay actas que
 *      respaldan pagos.
 *
 * Idempotente: revocar dos veces no falla. Y tiene que serlo — el control en la
 * app es de UN TOQUE, sin confirmación en cadena.
 */
export async function revocarPuntoTermino(
  cliente: SupabaseClient,
  input: RevocarPuntoTerminoInput,
): Promise<void> {
  const { tenantId, conductorId, actorUsuarioId } = input;

  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "conductor.punto_termino.revocado",
    entidadTipo: "conductor",
    entidadId: conductorId,
    detalle: { finalidad: FINALIDAD_PUNTO_TERMINO },
  });

  await revocarConsentimientoUbicacion(cliente, {
    tenantId,
    conductorId,
    actorUsuarioId,
    finalidad: FINALIDAD_PUNTO_TERMINO,
  });

  await borrarFila(cliente, tenantId, conductorId, "revocación");
}

/**
 * Borra el punto de término porque el conductor se desvincula del courier.
 *
 * §5.4: el vínculo laboral era la ÚNICA razón por la que ese dato existía, así
 * que se borra sin esperar a ningún job. La FK lleva `on delete cascade` para el
 * borrado físico del conductor, pero en este proyecto la baja es LÓGICA
 * (`identidad.conductores.estado = 'inactivo'`) y una baja lógica no dispara
 * ninguna cascada: hay que llamar a esto explícitamente desde la acción que da
 * de baja al conductor.
 *
 * ⚠️ Al 2026-08-14 **esa acción no existe todavía en el repo** (no hay ningún
 * camino que ponga `estado = 'inactivo'`). Cuando se construya, tiene que
 * llamar aquí. Mientras tanto, la red es el job `operacion/purgarPuntoTermino`,
 * que borra las filas de conductores no activos en su corrida diaria.
 *
 * También revoca el consentimiento: si el conductor volviera meses después, un
 * consentimiento "vigente" del vínculo anterior autorizaría guardar su casa sin
 * volver a preguntarle.
 */
export async function borrarPuntoTerminoPorDesvinculacion(
  cliente: SupabaseClient,
  input: RevocarPuntoTerminoInput,
): Promise<void> {
  const { tenantId, conductorId, actorUsuarioId } = input;

  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "conductor.punto_termino.borrado_por_desvinculacion",
    entidadTipo: "conductor",
    entidadId: conductorId,
    detalle: { finalidad: FINALIDAD_PUNTO_TERMINO, motivo: "desvinculacion" },
  });

  await revocarConsentimientoUbicacion(cliente, {
    tenantId,
    conductorId,
    actorUsuarioId,
    finalidad: FINALIDAD_PUNTO_TERMINO,
  });

  await borrarFila(cliente, tenantId, conductorId, "desvinculación");
}

/** DELETE acotado a (tenant, conductor). Idempotente. */
async function borrarFila(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
  motivo: string,
): Promise<void> {
  const { error } = await cliente
    .schema("operacion")
    .from(TABLA)
    .delete()
    .eq("tenant_id", tenantId)
    .eq("conductor_id", conductorId);

  if (error) {
    throw new Error(
      `Error al borrar el punto de término por ${motivo}: ${error.message}`,
    );
  }
}
