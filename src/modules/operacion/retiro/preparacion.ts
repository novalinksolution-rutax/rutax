/**
 * Preparación del día — lectura del lado COURIER (coordinador), etapa 5 del
 * alcance "retiro en bodega + ruteo" (docs/arquitectura/retiro-y-ruteo.md §7).
 *
 * Hasta este archivo, `operacion/retiro/` era 100% del lado CONDUCTOR: toda
 * lectura filtraba por `conductorId` (`bodegas.ts`, `sesiones.ts`,
 * `escaneos.ts`). Éste es el primero A NIVEL DE TENANT — el que consume la
 * pantalla del coordinador: qué conductor está retirando dónde ahora mismo, y
 * de lo que ya entró hoy, cuánto va a cada comuna.
 *
 * =============================================================================
 * LAS DOS FUNCIONES SQL — NO REPETIR SU LÓGICA AQUÍ
 * =============================================================================
 * Toda la agregación vive en la BASE: `operacion.preparacion_visitas_del_dia`
 * y `operacion.preparacion_carga_por_comuna`
 * (`supabase/migrations/20260813000006_operacion_preparacion_dia_agregados.sql`
 * — léela antes de tocar este archivo, ahí está el PORQUÉ de cada columna, en
 * particular por qué NO se cuenta en memoria: PostgREST trunca en 1.000 filas
 * en silencio, CLAUDE.md §gotchas). Este módulo SOLO llama, convierte tipos
 * (`bigint` → `Number`, con el mismo criterio que
 * `src/modules/plataforma/salud.ts:57-75`) y — la única lógica de negocio real
 * que vive en TypeScript — funde comunas que solo difieren en el acento. Nunca
 * trae una fila de pedido ni una dirección: la base entrega cifras.
 *
 * =============================================================================
 * SECURITY DEFINER, `service_role` únicamente — el `cliente` YA debe serlo
 * =============================================================================
 * Las dos funciones SQL son `security definer` + `stable`, con `EXECUTE`
 * revocado a `public`/`anon`/`authenticated` y concedido SOLO a `service_role`
 * — un pgTAP (`supabase/tests/database/rls_aislamiento_preparacion_dia.test.sql`)
 * demuestra que un `.rpc()` de sesión de usuario recibe 42501. El aislamiento
 * lo impone el parámetro `p_tenant_id`, no RLS (bajo SECURITY DEFINER no hay
 * RLS debajo). Por eso este módulo, igual que el resto de `operacion/retiro/`
 * (ver `rpc.ts`, `sesiones.ts`), NO crea su propio cliente: recibe `cliente` ya
 * construido con `crearClienteServiceRole()` por el llamador (route handler /
 * server action), que es quien ya validó la sesión y resolvió `tenantId` —
 * nunca lo tomes de un claim ni de un parámetro sin validar contra la sesión.
 *
 * =============================================================================
 * `acta: null` NO ES `{ total: 0, resueltos: 0, sinResolver: 0 }`
 * =============================================================================
 * La base devuelve `acta_total`/`acta_resueltos`/`acta_sin_resolver` en NULL
 * mientras la sesión sigue `abierta` (a propósito, migración 20260813000004
 * §2): "todavía no hay acta" no es lo mismo que "el acta dice cero".
 * Colapsarlo a un objeto de ceros le mentiría a la pantalla justo en el número
 * que respalda el pago del retiro al conductor (etapa 8) — por eso `acta` es
 * `{ total; resueltos; sinResolver } | null`, nunca un objeto con ceros de
 * relleno. Ver el contrato en `VisitaRetiroResumenCourier.acta`.
 *
 * =============================================================================
 * LA FUSIÓN DE COMUNAS — la única lógica de verdad de este archivo
 * =============================================================================
 * `operacion.preparacion_carga_por_comuna` ya agrupa por
 * `lower(btrim(destinatario_comuna))`, así que resuelve mayúsculas y espacios,
 * PERO NO ACENTOS (`unaccent` no está instalada en el proyecto — instalarla
 * por ~30 filas/día sería desproporcionado, ver el comentario de la
 * migración). El camino Flex (98% del volumen) guarda la comuna TAL CUAL la
 * manda Mercado Libre, sin canonizar
 * (`src/modules/integraciones/ml/ingesta-pedidos.ts:737`), así que "Ñuñoa" y
 * "Nunoa" pueden llegar como DOS filas distintas desde la base. Este archivo
 * las funde con `resolverComunaCanonica` contra el catálogo `COMUNAS_RM`: son
 * ~30 filas por día, la fusión es exacta y sin costo medible.
 *
 * La fila de `comuna_clave` NULL ("sin comuna conocida": bultos sin pedido o
 * comuna en blanco) NUNCA se funde con nada y siempre queda al final del
 * resultado, aunque tenga más bultos que cualquier comuna real — es una
 * excepción a resolver, no una zona a la que mandar conductores.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverComunaCanonica } from "@/modules/integraciones/geocoding/normalizacion";

/**
 * `RETURNS TABLE`/`SETOF` en Postgres siempre llega como array desde
 * PostgREST (posiblemente vacío `[]`, nunca un escalar suelto) — a diferencia
 * de los RPC de una sola fila de `rpc.ts`. Se normaliza igual el caso escalar
 * por defensa (mismo criterio que `cerrarSesionRetiroRpc`/`resolverBultoRetiroRpc`
 * en `./rpc.ts`), y `null`/`undefined` como lista vacía.
 */
function normalizarFilasRpc<T>(data: unknown): T[] {
  if (data === null || data === undefined) return [];
  return Array.isArray(data) ? (data as T[]) : [data as T];
}

// =============================================================================
// operacion.preparacion_visitas_del_dia — "¿quién está retirando ahora mismo?"
// =============================================================================

export interface VisitaRetiroResumenCourier {
  sesionId: string;
  estado: "abierta" | "cerrada";
  abiertaEn: string;
  cerradaEn: string | null;
  bodega: { id: string; nombre: string | null; comuna: string | null };
  seller: { id: string; nombre: string | null };
  conductor: { id: string; nombre: string | null };
  /** Conteo actual sobre bultos_retiro. Incluye los posteriores al cierre. */
  vivos: { total: number; resueltos: number; sinResolver: number };
  bultosDeOtroSeller: number;
  ultimoEscaneoEn: string | null;
  /** El acta congelada. `null` mientras la visita está abierta — no es cero. */
  acta: { total: number; resueltos: number; sinResolver: number } | null;
}

/** Fila cruda de `operacion.preparacion_visitas_del_dia` — nombres de columna SQL. */
interface FilaVisitaRetiroCourier {
  sesion_id: string;
  estado: "abierta" | "cerrada";
  abierta_en: string;
  cerrada_en: string | null;
  bodega_id: string;
  bodega_nombre: string | null;
  bodega_comuna: string | null;
  seller_id: string;
  seller_nombre: string | null;
  conductor_id: string;
  conductor_nombre: string | null;
  /** bigint: llega como string o number según el valor — normalizar con Number(). */
  bultos_vivos: number | string;
  bultos_resueltos_vivos: number | string;
  bultos_sin_resolver_vivos: number | string;
  bultos_de_otro_seller: number | string;
  ultimo_escaneo_en: string | null;
  /** integer, NULL mientras la sesión está `abierta` — NO es lo mismo que 0. */
  acta_total: number | null;
  acta_resueltos: number | null;
  acta_sin_resolver: number | null;
}

function filaAVisitaResumen(fila: FilaVisitaRetiroCourier): VisitaRetiroResumenCourier {
  return {
    sesionId: fila.sesion_id,
    estado: fila.estado,
    abiertaEn: fila.abierta_en,
    cerradaEn: fila.cerrada_en,
    bodega: { id: fila.bodega_id, nombre: fila.bodega_nombre, comuna: fila.bodega_comuna },
    seller: { id: fila.seller_id, nombre: fila.seller_nombre },
    conductor: { id: fila.conductor_id, nombre: fila.conductor_nombre },
    vivos: {
      total: Number(fila.bultos_vivos),
      resueltos: Number(fila.bultos_resueltos_vivos),
      sinResolver: Number(fila.bultos_sin_resolver_vivos),
    },
    bultosDeOtroSeller: Number(fila.bultos_de_otro_seller),
    ultimoEscaneoEn: fila.ultimo_escaneo_en,
    // `acta_total` es NULL mientras la visita sigue `abierta`: "todavía no hay
    // acta" no es "el acta dice cero" (ver cabecera del archivo). Gatilla
    // SOLO en `acta_total` porque las tres columnas las escribe, atómicas,
    // el mismo UPDATE de `cerrar_sesion_retiro` — nunca quedan a medias.
    acta:
      fila.acta_total === null
        ? null
        : {
            total: Number(fila.acta_total),
            resueltos: Number(fila.acta_resueltos ?? 0),
            sinResolver: Number(fila.acta_sin_resolver ?? 0),
          },
  };
}

/**
 * Una fila por visita a bodega del día operativo del tenant: qué conductor,
 * en qué bodega, de qué seller, cuántos lleva (vivos) y cuánto dice el acta
 * congelada. Orden ya resuelto por la base: abiertas primero, luego por
 * `abierta_en` descendente — este módulo NO reordena.
 */
export async function listarVisitasDelDia(
  cliente: SupabaseClient,
  entrada: { tenantId: string; fecha: string },
): Promise<VisitaRetiroResumenCourier[]> {
  const { data, error } = await cliente.schema("operacion").rpc("preparacion_visitas_del_dia", {
    p_tenant_id: entrada.tenantId,
    p_fecha: entrada.fecha,
  });

  if (error) {
    throw new Error(`Error al listar las visitas de la Preparación del día: ${error.message}`);
  }

  return normalizarFilasRpc<FilaVisitaRetiroCourier>(data).map(filaAVisitaResumen);
}

// =============================================================================
// operacion.preparacion_carga_por_comuna — "de lo que entró, ¿cuánto va a dónde?"
// =============================================================================

export interface CargaComunaRetiro {
  /** Etiqueta canónica para mostrar. `null` = sin comuna conocida. */
  comuna: string | null;
  bultosTotal: number;
  bultosAsignados: number;
  bultosSinResolver: number;
}

/** Fila cruda de `operacion.preparacion_carga_por_comuna` — nombres de columna SQL. */
interface FilaCargaComunaCruda {
  comuna_clave: string | null;
  comuna_etiqueta: string | null;
  /** bigint, igual que en `FilaVisitaRetiroCourier`. */
  bultos_total: number | string;
  bultos_asignados: number | string;
  bultos_sin_resolver: number | string;
}

/**
 * Acumulado del día por comuna, fusionando en TypeScript lo que la base no
 * fusiona por acento (ver cabecera del archivo). Reglas, en orden:
 *
 *   1. La fila de `comuna_clave` NULL (sin comuna conocida) se aparta de
 *      inmediato: nunca se funde, nunca se pierde.
 *   2. Cada fila restante se resuelve contra `COMUNAS_RM` con
 *      `resolverComunaCanonica`. Si resuelve, la clave de fusión es el nombre
 *      CANÓNICO del catálogo (así "Maipú" y "Maipu" caen en el mismo grupo).
 *   3. Si NO resuelve (comuna fuera de la RM), se conserva la etiqueta cruda
 *      tal cual llegó — nunca se descarta ni se manda al grupo "sin comuna".
 *   4. Los grupos fusionados se ordenan por `bultosTotal` descendente.
 *   5. La fila de "sin comuna" (si existe) se agrega SIEMPRE al final, aunque
 *      su total sea el más grande de todos.
 */
export async function obtenerCargaPorComuna(
  cliente: SupabaseClient,
  entrada: { tenantId: string; fecha: string },
): Promise<CargaComunaRetiro[]> {
  const { data, error } = await cliente.schema("operacion").rpc("preparacion_carga_por_comuna", {
    p_tenant_id: entrada.tenantId,
    p_fecha: entrada.fecha,
  });

  if (error) {
    throw new Error(`Error al obtener la carga por comuna de la Preparación del día: ${error.message}`);
  }

  const filas = normalizarFilasRpc<FilaCargaComunaCruda>(data);

  const fusionadas = new Map<string, CargaComunaRetiro>();
  // Hoy la base solo puede devolver UNA fila con comuna_clave NULL (agrupa por
  // esa columna, y NULL es un único grupo). Se ACUMULA igual, en vez de asignar:
  // asignar hace que la última gane y las anteriores desaparezcan sin ruido, y
  // basta que alguien agregue mañana un discriminador al `group by` para que
  // esta lectura empiece a perder bultos en silencio. Acumular no cuesta nada y
  // deja de depender de un detalle de la consulta que vive en otro archivo.
  let filaSinComuna: CargaComunaRetiro | null = null;

  for (const fila of filas) {
    const total = Number(fila.bultos_total);
    const asignados = Number(fila.bultos_asignados);
    const sinResolver = Number(fila.bultos_sin_resolver);

    if (fila.comuna_clave === null) {
      if (filaSinComuna) {
        filaSinComuna.bultosTotal += total;
        filaSinComuna.bultosAsignados += asignados;
        filaSinComuna.bultosSinResolver += sinResolver;
      } else {
        filaSinComuna = {
          comuna: null,
          bultosTotal: total,
          bultosAsignados: asignados,
          bultosSinResolver: sinResolver,
        };
      }
      continue;
    }

    const etiquetaCruda = fila.comuna_etiqueta ?? fila.comuna_clave;
    const canonica = resolverComunaCanonica(etiquetaCruda);
    // Si no resuelve (fuera de la RM), la propia etiqueta cruda hace de clave
    // de fusión: no colisiona con nada más (la base ya deduplicó exactos por
    // mayúsculas/espacios) y queda como su propia fila, con su texto tal cual.
    const claveFusion = canonica ?? etiquetaCruda;

    const existente = fusionadas.get(claveFusion);
    if (existente) {
      existente.bultosTotal += total;
      existente.bultosAsignados += asignados;
      existente.bultosSinResolver += sinResolver;
    } else {
      fusionadas.set(claveFusion, {
        comuna: canonica ?? etiquetaCruda,
        bultosTotal: total,
        bultosAsignados: asignados,
        bultosSinResolver: sinResolver,
      });
    }
  }

  const resultado = [...fusionadas.values()].sort((a, b) => b.bultosTotal - a.bultosTotal);
  if (filaSinComuna) resultado.push(filaSinComuna);
  return resultado;
}
