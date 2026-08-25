/**
 * CRUD de zonas y mapeo comuna→zona (F7, ítem 1.2).
 *
 * Las zonas son configuración INTERNA del courier — el seller y el conductor
 * no las ven (RLS solo-interno P1 en BD).
 *
 * Reglas:
 * - RBAC: capacidad `gestionar_tarifas` (la misma que usa tarifas, por ser
 *   configuración operativa-tarifaria del courier).
 * - Escritura via service_role (bypass RLS).
 * - Bitácora ANTES del efecto externo.
 * - Validación de comunas contra COMUNAS_RM.
 * - Guardar una zona (crear/renombrar + sus comunas) va por
 *   `guardarZonaConComunas`, o sea por UNA transacción en Postgres.
 *
 * 🔴 **Acá vivía `asignarComunasAZona`, y su comentario decía «operación
 * atómica» sin serlo**: borraba las comunas de la zona y después insertaba las
 * nuevas, en dos viajes distintos. Si el insert fallaba —bastaba una comuna que
 * ya fuera de otra zona, el `unique (tenant_id, comuna)`— la zona **se quedaba
 * sin ninguna comuna**, y eso no hace ruido en ninguna parte: las comunas
 * huérfanas caen en la tarifa por defecto del courier y se cobran igual, en
 * silencio, hasta el cierre del período. Se retiró junto con `crearZona` y
 * `renombrarZona` para que no quede un segundo camino de escritura.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import { puedeGestionarTarifas } from '@/modules/identidad/capacidades';
import { ErrorValidacion } from '@/modules/identidad/errores';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { resolverComunaCanonica } from '@/modules/integraciones/geocoding/normalizacion';
import type { Zona, ZonaComuna } from './tipos';

// =============================================================================
// Mappers fila BD → interfaz
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAZona(fila: Record<string, any>): Zona {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    nombre: fila.nombre,
    activa: fila.activa,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAZonaComuna(fila: Record<string, any>): ZonaComuna {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    zonaId: fila.zona_id,
    comuna: fila.comuna,
    creadoEn: fila.creado_en,
  };
}


// =============================================================================
// listarZonas
// =============================================================================

/** Lista todas las zonas del tenant (activas e inactivas), ordenadas por nombre. */
export async function listarZonas(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<Zona[]> {
  const { data, error } = await cliente
    .schema('identidad')
    .from('zonas')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('nombre');

  if (error) {
    throw new Error(`Error al listar zonas: ${error.message}`);
  }

  return (data ?? []).map(filaAZona);
}

// =============================================================================
// activarDesactivarZona
// =============================================================================

/**
 * Activa o desactiva una zona. Requiere capacidad `gestionar_tarifas`.
 * Lanza `ErrorValidacion` si la zona no pertenece al tenant.
 */
export async function activarDesactivarZona(
  cliente: SupabaseClient,
  tenantId: string,
  zonaId: string,
  activa: boolean,
  actorUsuarioId: string,
  actor: UsuarioActual,
): Promise<Zona> {
  if (!puedeGestionarTarifas(actor)) {
    throw new ErrorValidacion('El usuario no tiene capacidad para gestionar zonas');
  }

  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: activa ? 'zona.activada' : 'zona.desactivada',
    entidadTipo: 'zona',
    entidadId: zonaId,
    detalle: { activa },
  });

  const { data, error } = await cliente
    .schema('identidad')
    .from('zonas')
    .update({ activa })
    .eq('id', zonaId)
    .eq('tenant_id', tenantId)
    .select()
    .single();

  if (error) {
    throw new Error(`Error al actualizar zona: ${error.message}`);
  }

  if (!data) {
    throw new ErrorValidacion(`Zona ${zonaId} no encontrada en el tenant`);
  }

  return filaAZona(data);
}


// =============================================================================
// listarComunasDeZona
// =============================================================================

/** Lista las comunas asignadas a una zona específica. */
export async function listarComunasDeZona(
  cliente: SupabaseClient,
  tenantId: string,
  zonaId: string,
): Promise<ZonaComuna[]> {
  const { data, error } = await cliente
    .schema('identidad')
    .from('zona_comunas')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('zona_id', zonaId)
    .order('comuna');

  if (error) {
    throw new Error(`Error al listar comunas de la zona: ${error.message}`);
  }

  return (data ?? []).map(filaAZonaComuna);
}

// =============================================================================
// guardarZonaConComunas — crear/renombrar + comunas, en UNA transacción
// =============================================================================

export interface GuardarZonaEntrada {
  tenantId: string;
  /** `null` = crear una zona nueva. */
  zonaId: string | null;
  nombre: string;
  comunas: string[];
  actorUsuarioId: string;
}

/**
 * 🔴 **Reemplaza a `crearZona` + `asignarComunasAZona`, y la razón es que ese
 * par dejaba estados a medias en dos sitios distintos.**
 *
 * · **Crear + asignar:** si la asignación fallaba, la zona quedaba creada y
 *   vacía. Al reintentar se creaba una segunda zona con el mismo nombre.
 * · **Reasignar:** `asignarComunasAZona` borra las comunas actuales y después
 *   inserta las nuevas, en dos viajes. Si el insert fallaba —bastaba una comuna
 *   que ya fuera de otra zona, o sea el `unique (tenant_id, comuna)`— **la zona
 *   se quedaba sin ninguna comuna**. Y eso no falla en ninguna parte: las
 *   comunas huérfanas caen en la tarifa por defecto del courier y se cobran
 *   igual, en silencio, hasta el cierre del período. El comentario de la
 *   cabecera de este archivo decía «operación atómica» y no lo era.
 *
 * Ahora las tres escrituras viven en `identidad.guardar_zona_con_comunas`, o
 * sea en una sola transacción.
 *
 * ⚠️ **La normalización de comunas se queda acá, no baja al SQL.** La función
 * confía en lo que recibe: `resolverComunaCanonica` resuelve «ñuñoa» y «NUNOA»
 * a la forma del catálogo, y hacerlo en plpgsql sería duplicar una tabla de
 * alias que ya vive en TypeScript.
 *
 * ⚠️ **La bitácora sigue yendo ANTES**, fuera de la transacción. Es el
 * invariante del proyecto: la auditoría queda completa aunque el paso siguiente
 * falle. La contrapartida —una línea de un guardado que no ocurrió— es
 * preferible a un guardado sin línea.
 */
export async function guardarZonaConComunas(
  cliente: SupabaseClient,
  entrada: GuardarZonaEntrada,
  actor: UsuarioActual,
): Promise<Zona> {
  if (!puedeGestionarTarifas(actor)) {
    throw new ErrorValidacion('El usuario no tiene capacidad para gestionar zonas');
  }

  const nombre = entrada.nombre.trim();
  if (!nombre) {
    throw new ErrorValidacion('El nombre de la zona no puede ir vacío');
  }

  const canonicas: string[] = [];
  const invalidas: string[] = [];
  for (const c of entrada.comunas) {
    const canonica = resolverComunaCanonica(c);
    if (canonica) canonicas.push(canonica);
    else invalidas.push(c);
  }
  if (invalidas.length > 0) {
    throw new ErrorValidacion(
      `Las siguientes comunas no están en la Región Metropolitana: ${invalidas.join(', ')}`,
    );
  }

  await registrarEnBitacora(cliente, {
    tenantId: entrada.tenantId,
    actorUsuarioId: entrada.actorUsuarioId,
    actorTipo: 'usuario',
    accion: entrada.zonaId ? 'zona.comunas_reasignadas' : 'zona.creada',
    entidadTipo: 'zona',
    entidadId: entrada.zonaId,
    detalle: { nombre, comunas: canonicas, cantidad: canonicas.length },
  });

  const { data, error } = await cliente
    .schema('identidad')
    .rpc('guardar_zona_con_comunas', {
      p_tenant_id: entrada.tenantId,
      p_zona_id: entrada.zonaId,
      p_nombre: nombre,
      p_comunas: canonicas,
    });

  if (error) {
    // El choque de unicidad es el caso frecuente y tiene una salida concreta:
    // quitar de la selección la comuna que ya es de otra zona.
    if (error.code === '23505') {
      throw new ErrorValidacion(
        'Una o más comunas ya están asignadas a otra zona. Una comuna solo puede estar en una zona.',
      );
    }
    if (error.code === 'P0002') {
      throw new ErrorValidacion('La zona no existe en este courier.');
    }
    throw new Error(`Error al guardar la zona: ${error.message}`);
  }

  // La función devuelve la fila, que PostgREST entrega como objeto.
  return filaAZona(data as Record<string, unknown>);
}

// =============================================================================
// listarComunasDelTenant
// =============================================================================

/**
 * Todas las comunas asignadas del tenant, con su zona.
 *
 * 🔴 **Hace falta para poder decir la verdad en el alta de zona.** Con solo las
 * comunas de LA zona que se edita, la pantalla no sabe cuáles ya tienen dueño:
 * las dibuja libres, alguien las marca, y o se mueven de zona sin que nadie lo
 * pidiera o el servidor rechaza el guardado entero por el `unique (tenant_id,
 * comuna)`. B3b lo resuelve al revés — «las que ya tienen dueño se ven con su
 * zona y no se pueden marcar desde acá»— y para eso hay que leerlas todas.
 *
 * ⚠️ Trae también las de zonas INACTIVAS: la restricción de unicidad no mira si
 * la zona está activa, así que una comuna atrapada en una zona apagada sigue
 * ocupada. Mostrarla libre sería prometer un guardado que va a fallar.
 */
export async function listarComunasDelTenant(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<ZonaComuna[]> {
  const { data, error } = await cliente
    .schema('identidad')
    .from('zona_comunas')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('comuna');

  if (error) {
    throw new Error(`Error al listar las comunas del tenant: ${error.message}`);
  }

  return (data ?? []).map(filaAZonaComuna);
}

// =============================================================================
// resolverZona — helper para el backend (llama a la función SQL)
// =============================================================================

/**
 * Resuelve la zona_id de una comuna normalizada para un tenant.
 * Llama a `identidad.resolver_zona(p_tenant_id, p_comuna)` — SECURITY DEFINER.
 * La `comunaNormalizada` debe venir YA resuelta vía `resolverComunaCanonica`
 * antes de llamar aquí.
 *
 * Devuelve null si la comuna no está mapeada o la zona está inactiva.
 */
export async function resolverZona(
  cliente: SupabaseClient,
  tenantId: string,
  comunaNormalizada: string,
): Promise<string | null> {
  // La función vive en el esquema `identidad` (no hay wrapper en `public`), por
  // lo que hay que apuntar el RPC a ese esquema explícitamente. Sin el
  // `.schema('identidad')`, PostgREST busca `public.resolver_zona`, no la
  // encuentra (404) y la resolución de zona fallaba SIEMPRE en silencio (el
  // catch de abajo devolvía null), dejando inertes las ventanas de corte por
  // zona y la preferencia de zona en la auto-asignación.
  const { data, error } = await cliente.schema('identidad').rpc('resolver_zona', {
    p_tenant_id: tenantId,
    p_comuna: comunaNormalizada,
  });

  if (error) {
    // No lanzamos: si falla la resolución de zona, el pedido igual se crea
    // (sin zona asignada). La función es informativa — no bloquea.
    return null;
  }

  return (data as string | null) ?? null;
}

