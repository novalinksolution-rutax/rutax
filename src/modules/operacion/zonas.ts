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
 * - Reasignación de comunas: borrar las existentes + insertar las nuevas
 *   (operación atómica — la BD tiene unique (tenant_id, comuna) en zona_comunas).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import { puedeGestionarTarifas } from '@/modules/identidad/capacidades';
import { ErrorValidacion } from '@/modules/identidad/errores';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { resolverComunaCanonica } from '@/modules/integraciones/geocoding/normalizacion';
import type { Zona, ZonaComuna, CrearZonaEntrada, AsignarComunasZonaEntrada } from './tipos';

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
// crearZona
// =============================================================================

/**
 * Crea una nueva zona para el tenant. Requiere capacidad `gestionar_tarifas`.
 * Lanza `ErrorValidacion` si el nombre ya existe en el tenant.
 */
export async function crearZona(
  cliente: SupabaseClient,
  entrada: CrearZonaEntrada,
  actor: UsuarioActual,
): Promise<Zona> {
  if (!puedeGestionarTarifas(actor)) {
    throw new ErrorValidacion('El usuario no tiene capacidad para gestionar zonas');
  }

  // Bitácora ANTES de la escritura (CLAUDE.md invariante).
  await registrarEnBitacora(cliente, {
    tenantId: entrada.tenantId,
    actorUsuarioId: entrada.actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'zona.creada',
    entidadTipo: 'zona',
    entidadId: null,
    detalle: { nombre: entrada.nombre },
  });

  const { data, error } = await cliente
    .schema('identidad')
    .from('zonas')
    .insert({
      tenant_id: entrada.tenantId,
      nombre: entrada.nombre,
      activa: true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new ErrorValidacion(`Ya existe una zona llamada "${entrada.nombre}" en este tenant`);
    }
    throw new Error(`Error al crear zona: ${error.message}`);
  }

  return filaAZona(data);
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
// asignarComunasAZona
// =============================================================================

/**
 * Reemplaza las comunas de una zona por la lista proporcionada.
 * Operación: DELETE las existentes + INSERT las nuevas, en transacción implícita
 * (dos llamadas al cliente — la BD garantiza la unicidad).
 *
 * Valida cada comuna contra COMUNAS_RM usando `resolverComunaCanonica`.
 * La commune se almacena en su forma canónica del catálogo.
 */
export async function asignarComunasAZona(
  cliente: SupabaseClient,
  entrada: AsignarComunasZonaEntrada,
  actor: UsuarioActual,
): Promise<ZonaComuna[]> {
  if (!puedeGestionarTarifas(actor)) {
    throw new ErrorValidacion('El usuario no tiene capacidad para gestionar zonas');
  }

  // Validar y normalizar comunas.
  const comunasCanoninicas: string[] = [];
  const comunasInvalidas: string[] = [];

  for (const c of entrada.comunas) {
    const canonica = resolverComunaCanonica(c);
    if (!canonica) {
      comunasInvalidas.push(c);
    } else {
      comunasCanoninicas.push(canonica);
    }
  }

  if (comunasInvalidas.length > 0) {
    throw new ErrorValidacion(
      `Las siguientes comunas no están en la Región Metropolitana: ${comunasInvalidas.join(', ')}`,
    );
  }

  // Bitácora ANTES del efecto.
  await registrarEnBitacora(cliente, {
    tenantId: entrada.tenantId,
    actorUsuarioId: entrada.actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'zona.comunas_reasignadas',
    entidadTipo: 'zona',
    entidadId: entrada.zonaId,
    detalle: { comunas: comunasCanoninicas, cantidad: comunasCanoninicas.length },
  });

  // Borrar comunas existentes de esta zona en el tenant.
  const { error: errorDelete } = await cliente
    .schema('identidad')
    .from('zona_comunas')
    .delete()
    .eq('tenant_id', entrada.tenantId)
    .eq('zona_id', entrada.zonaId);

  if (errorDelete) {
    throw new Error(`Error al limpiar comunas de la zona: ${errorDelete.message}`);
  }

  if (comunasCanoninicas.length === 0) {
    return [];
  }

  // Insertar las nuevas.
  const filas = comunasCanoninicas.map((comuna) => ({
    tenant_id: entrada.tenantId,
    zona_id: entrada.zonaId,
    comuna,
  }));

  const { data, error: errorInsert } = await cliente
    .schema('identidad')
    .from('zona_comunas')
    .insert(filas)
    .select();

  if (errorInsert) {
    if (errorInsert.code === '23505') {
      throw new ErrorValidacion(
        'Una o más comunas ya están asignadas a otra zona del tenant. ' +
          'Una comuna solo puede pertenecer a una zona por tenant.',
      );
    }
    throw new Error(`Error al asignar comunas a la zona: ${errorInsert.message}`);
  }

  return (data ?? []).map(filaAZonaComuna);
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

// =============================================================================
// renombrarZona
// =============================================================================

/**
 * Cambia el nombre de una zona.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ FALTABA Y POR QUÉ IMPORTA
 * -----------------------------------------------------------------------------
 * Una zona se podía crear y desactivar, pero **no renombrar**. El courier que
 * escribía «Nororiente» y después quería «Zona 1 · Nororiente» no tenía salida:
 * o vivía con el nombre, o desactivaba la zona —perdiendo sus comunas de la
 * vista, porque las secciones filtran las inactivas— y creaba otra a mano.
 *
 * No se toca `activa` acá: renombrar y desactivar son dos cosas distintas y
 * mezclarlas en una función haría que un rename accidental apagara una zona.
 */
export async function renombrarZona(
  cliente: SupabaseClient,
  tenantId: string,
  zonaId: string,
  nombre: string,
  actorUsuarioId: string,
  actor: UsuarioActual,
): Promise<Zona> {
  if (!puedeGestionarTarifas(actor)) {
    throw new ErrorValidacion('El usuario no tiene capacidad para gestionar zonas');
  }

  const limpio = nombre.trim();
  if (limpio.length < 2) {
    throw new ErrorValidacion('El nombre de la zona debe tener al menos 2 caracteres');
  }

  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'zona.renombrada',
    entidadTipo: 'zona',
    entidadId: zonaId,
    detalle: { nombre: limpio },
  });

  const { data, error } = await cliente
    .schema('identidad')
    .from('zonas')
    .update({ nombre: limpio })
    .eq('id', zonaId)
    .eq('tenant_id', tenantId)
    .select()
    .single();

  if (error) {
    throw new Error(`Error al renombrar zona: ${error.message}`);
  }
  if (!data) {
    throw new ErrorValidacion(`Zona ${zonaId} no encontrada en el tenant`);
  }

  return filaAZona(data);
}
