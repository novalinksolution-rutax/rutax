/**
 * Trazabilidad de un objeto: quién le hizo qué, cuándo y por qué.
 *
 * POR QUÉ ES UNA LECTURA APARTE Y NO UNA COLUMNA
 * ---------------------------------------------------------------------------
 * El tablero muestra «Aplicó M. Soto el 19-08» junto a un ajuste manual, y la
 * fila no lo sabe: `dinero.liquidaciones` guarda `nota_ajuste` —el motivo— pero
 * **no quién lo aplicó**. El autor vive en `bitacora_auditoria`, que es donde
 * corresponde: la bitácora es el registro, la tabla de negocio es el estado.
 *
 * Duplicar el autor en cada tabla de negocio sería agregar una columna que se
 * puede desincronizar del registro que la auditoría considera verdad. Esto lee
 * del registro.
 *
 * QUÉ ES UN «MOTIVO» ACÁ
 * ---------------------------------------------------------------------------
 * Las acciones del producto no guardan el motivo con una sola llave: unas
 * escriben `motivo`, el ajuste de liquidación escribe `nota_ajuste`, el bloqueo
 * de conciliación escribe `motivo_bloqueo`. Son la misma idea —el texto que
 * alguien escribió para justificar el acto— y acá se normalizan a una. Si
 * aparece una llave nueva, va en `LLAVES_DE_MOTIVO` y no en cada pantalla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { mapaNombresUsuarios } from './consultas';

/**
 * Las llaves con que las distintas acciones guardan su motivo.
 *
 * El orden importa: se toma la primera que exista. `motivo` va primero por ser
 * la canónica; las otras son históricas y no se renombran en base porque son
 * filas de auditoría — reescribir una bitácora para que quede prolija es
 * exactamente lo que una bitácora no debe permitir.
 */
const LLAVES_DE_MOTIVO = ['motivo', 'nota_ajuste', 'motivo_bloqueo', 'motivo_anulacion'] as const;

export interface HechoTrazable {
  /** La acción tal como la escribió el dominio, p. ej. `dinero.periodo_reabierto`. */
  accion: string;
  /** ISO 8601. La pantalla la formatea con `formato-cl`, nunca a mano. */
  cuando: string;
  /**
   * Nombre de quien lo hizo. `null` cuando lo hizo el sistema (un job, una
   * sincronización) o cuando el usuario ya no existe en el tenant — y esas dos
   * cosas se distinguen por `actorTipo`, no por el nombre.
   */
  autorNombre: string | null;
  actorTipo: string | null;
  /** El texto que se escribió para justificar el acto, si lo hubo. */
  motivo: string | null;
}

function extraerMotivo(detalle: unknown): string | null {
  if (!detalle || typeof detalle !== 'object') return null;
  const obj = detalle as Record<string, unknown>;
  for (const llave of LLAVES_DE_MOTIVO) {
    const valor = obj[llave];
    if (typeof valor === 'string' && valor.trim().length > 0) return valor.trim();
  }
  return null;
}

/**
 * Los hechos registrados sobre un objeto, del más reciente al más antiguo.
 *
 * `acciones` acota a las que la pantalla quiere mostrar; sin ella vienen todas
 * las del objeto. `limite` existe porque una liquidación con muchos ajustes
 * puede tener decenas de filas y la tarjeta muestra unas pocas.
 */
export async function obtenerTrazabilidad(
  cliente: SupabaseClient,
  tenantId: string,
  entidadTipo: string,
  entidadId: string,
  opciones?: { acciones?: readonly string[]; limite?: number },
): Promise<HechoTrazable[]> {
  let consulta = cliente
    .from('bitacora_auditoria')
    .select('accion, creado_en, actor_usuario_id, actor_tipo, detalle')
    .eq('tenant_id', tenantId)
    .eq('entidad_tipo', entidadTipo)
    .eq('entidad_id', entidadId)
    .order('creado_en', { ascending: false })
    .limit(opciones?.limite ?? 20);

  if (opciones?.acciones?.length) {
    consulta = consulta.in('accion', [...opciones.acciones]);
  }

  const { data, error } = await consulta;
  if (error) {
    throw new Error(`Error al leer la trazabilidad del objeto: ${error.message}`);
  }

  const filas = (data ?? []) as Record<string, unknown>[];

  // Una sola consulta de nombres para todas las filas: `mapaNombresUsuarios`
  // acota por tenant, así que un id de otro courier simplemente no resuelve.
  const ids = [
    ...new Set(
      filas
        .map((f) => f.actor_usuario_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  const nombres = ids.length > 0 ? await mapaNombresUsuarios(cliente, tenantId, ids) : {};

  return filas.map((f) => ({
    accion: f.accion as string,
    cuando: f.creado_en as string,
    autorNombre:
      typeof f.actor_usuario_id === 'string'
        ? (nombres[f.actor_usuario_id]?.nombreCompleto ?? null)
        : null,
    actorTipo: (f.actor_tipo as string | null) ?? null,
    motivo: extraerMotivo(f.detalle),
  }));
}
