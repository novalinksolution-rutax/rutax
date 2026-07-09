/**
 * Funciones de escritura para conductores — disponibilidad, capacidad y zonas
 * preferentes (F6, ítem 1.3).
 *
 * La lectura de conductores (para la vista del conductor) vive en identidad.
 * Este módulo solo añade las tres operaciones de escritura que necesita el
 * coordinador/supervisor para configurar el pool antes del auto-assign:
 *   - `actualizarDisponibilidadConductor`  — toggle disponible/no-disponible
 *   - `actualizarCapacidadConductor`       — cupo máximo de paradas
 *   - `actualizarZonasConductor`           — reemplaza zonas preferentes
 *
 * RBAC: capacidad `asignar_y_reasignar_pedidos` (misma que el auto-assign,
 * ya que configurar el pool es parte del mismo flujo operativo).
 *
 * Convenciones:
 * - service_role (bypass RLS) — los datos de conductor no están disponibles al
 *   cliente autenticado interno por las políticas P1/P2 de identidad.
 * - Bitácora ANTES del efecto (CLAUDE.md invariante).
 * - `actorUsuarioId` UUID de auth siempre explícito (RNF-04).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import {
  puedeAsignarYReasignarPedidos,
  puedeGestionarLiquidacionesConductores,
} from '@/modules/identidad/capacidades';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { ErrorValidacion } from '@/modules/identidad/errores';
import type { Conductor, ConductorZona } from './tipos';

// =============================================================================
// Mappers fila BD → interfaz
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAConductor(fila: Record<string, any>): Conductor {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    estado: fila.estado as 'activo' | 'inactivo',
    disponible: Boolean(fila.disponible),
    capacidadParadas: Number(fila.capacidad_paradas),
    nombre: fila.nombre_completo ?? '',
    banco: fila.banco ?? null,
    tipoCuenta: (fila.tipo_cuenta as 'corriente' | 'vista' | 'ahorro' | null) ?? null,
    numeroCuenta: fila.numero_cuenta ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAConductorZona(fila: Record<string, any>): ConductorZona {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    conductorId: fila.conductor_id,
    zonaId: fila.zona_id,
    creadoEn: fila.creado_en,
  };
}

// =============================================================================
// listarConductores
// =============================================================================

/**
 * Lista todos los conductores activos del tenant con sus datos operativos.
 * Sin RBAC de escritura — es lectura usada por el coordinador para ver el pool.
 */
export async function listarConductores(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<Conductor[]> {
  const { data, error } = await cliente
    .schema('identidad')
    .from('conductores')
    .select(
      'id, tenant_id, estado, disponible, capacidad_paradas, nombre_completo, banco, tipo_cuenta, numero_cuenta',
    )
    .eq('tenant_id', tenantId)
    .order('nombre_completo');

  if (error) {
    throw new Error(`Error al listar conductores: ${error.message}`);
  }

  return (data ?? []).map(filaAConductor);
}

// =============================================================================
// listarZonasConductor
// =============================================================================

/** Devuelve las zonas preferentes actuales de un conductor. */
export async function listarZonasConductor(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
): Promise<ConductorZona[]> {
  const { data, error } = await cliente
    .schema('identidad')
    .from('conductor_zonas')
    .select('id, tenant_id, conductor_id, zona_id, creado_en')
    .eq('tenant_id', tenantId)
    .eq('conductor_id', conductorId);

  if (error) {
    throw new Error(`Error al listar zonas del conductor: ${error.message}`);
  }

  return (data ?? []).map(filaAConductorZona);
}

// =============================================================================
// actualizarDisponibilidadConductor
// =============================================================================

/**
 * Cambia el campo `disponible` de un conductor.
 * DISTINTO de `estado` ('activo'/'inactivo'): un conductor activo puede estar
 * no disponible por día libre o licencia sin darse de baja de la nómina.
 *
 * Requiere `asignar_y_reasignar_pedidos`.
 */
export async function actualizarDisponibilidadConductor(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
  disponible: boolean,
  actorUsuarioId: string,
  actor: UsuarioActual,
): Promise<Conductor> {
  if (!puedeAsignarYReasignarPedidos(actor)) {
    throw new ErrorValidacion(
      'El usuario no tiene capacidad para modificar la disponibilidad de conductores',
    );
  }

  // Bitácora ANTES del efecto (CLAUDE.md invariante).
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: disponible ? 'conductor.disponible_activado' : 'conductor.disponible_desactivado',
    entidadTipo: 'conductor',
    entidadId: conductorId,
    detalle: { conductor_id: conductorId, disponible },
  });

  const { data, error } = await cliente
    .schema('identidad')
    .from('conductores')
    .update({ disponible })
    .eq('id', conductorId)
    .eq('tenant_id', tenantId)
    .select(
      'id, tenant_id, estado, disponible, capacidad_paradas, nombre_completo, banco, tipo_cuenta, numero_cuenta',
    )
    .maybeSingle();

  if (error) {
    throw new Error(`Error al actualizar disponibilidad del conductor: ${error.message}`);
  }

  if (!data) {
    throw new ErrorValidacion(`Conductor ${conductorId} no encontrado en el tenant`);
  }

  return filaAConductor(data);
}

// =============================================================================
// actualizarCapacidadConductor
// =============================================================================

/**
 * Actualiza el cupo máximo de paradas del conductor.
 * Mínimo 1, máximo razonable definido en BD (constraint > 0).
 * Requiere `asignar_y_reasignar_pedidos`.
 */
export async function actualizarCapacidadConductor(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
  capacidadParadas: number,
  actorUsuarioId: string,
  actor: UsuarioActual,
): Promise<Conductor> {
  if (!puedeAsignarYReasignarPedidos(actor)) {
    throw new ErrorValidacion(
      'El usuario no tiene capacidad para modificar la capacidad de conductores',
    );
  }

  if (!Number.isInteger(capacidadParadas) || capacidadParadas < 1) {
    throw new ErrorValidacion('La capacidad de paradas debe ser un número entero mayor a 0');
  }

  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'conductor.capacidad_actualizada',
    entidadTipo: 'conductor',
    entidadId: conductorId,
    detalle: { conductor_id: conductorId, capacidad_paradas: capacidadParadas },
  });

  const { data, error } = await cliente
    .schema('identidad')
    .from('conductores')
    .update({ capacidad_paradas: capacidadParadas })
    .eq('id', conductorId)
    .eq('tenant_id', tenantId)
    .select(
      'id, tenant_id, estado, disponible, capacidad_paradas, nombre_completo, banco, tipo_cuenta, numero_cuenta',
    )
    .maybeSingle();

  if (error) {
    throw new Error(`Error al actualizar capacidad del conductor: ${error.message}`);
  }

  if (!data) {
    throw new ErrorValidacion(`Conductor ${conductorId} no encontrado en el tenant`);
  }

  return filaAConductor(data);
}

// =============================================================================
// actualizarZonasConductor
// =============================================================================

/**
 * Reemplaza las zonas preferentes de un conductor por la lista dada.
 * Operación: DELETE las existentes + INSERT las nuevas.
 * Lista vacía = conductor sin preferencia de zona (acepta cualquier pedido).
 * Requiere `asignar_y_reasignar_pedidos`.
 */
export async function actualizarZonasConductor(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
  zonaIds: string[],
  actorUsuarioId: string,
  actor: UsuarioActual,
): Promise<ConductorZona[]> {
  if (!puedeAsignarYReasignarPedidos(actor)) {
    throw new ErrorValidacion(
      'El usuario no tiene capacidad para modificar las zonas de conductores',
    );
  }

  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'conductor.zonas_actualizadas',
    entidadTipo: 'conductor',
    entidadId: conductorId,
    detalle: { conductor_id: conductorId, zona_ids: zonaIds, cantidad: zonaIds.length },
  });

  // Borrar zonas actuales del conductor en el tenant.
  const { error: errorDelete } = await cliente
    .schema('identidad')
    .from('conductor_zonas')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('conductor_id', conductorId);

  if (errorDelete) {
    throw new Error(`Error al limpiar zonas del conductor: ${errorDelete.message}`);
  }

  if (zonaIds.length === 0) {
    return [];
  }

  // Insertar nuevas.
  const filas = zonaIds.map((zonaId) => ({
    tenant_id: tenantId,
    conductor_id: conductorId,
    zona_id: zonaId,
  }));

  const { data, error: errorInsert } = await cliente
    .schema('identidad')
    .from('conductor_zonas')
    .insert(filas)
    .select('id, tenant_id, conductor_id, zona_id, creado_en');

  if (errorInsert) {
    throw new Error(`Error al asignar zonas al conductor: ${errorInsert.message}`);
  }

  return (data ?? []).map(filaAConductorZona);
}

// =============================================================================
// actualizarDatosBancariosConductor
// =============================================================================

/**
 * Actualiza los datos bancarios del conductor (banco, tipo_cuenta, numero_cuenta).
 * Requeridos para el flujo de pago F19 — sin ellos el job lanza NonRetriableError.
 *
 * Requiere `gestionar_liquidaciones_conductores` (capacidad financiera, DISTINTA
 * de `asignar_y_reasignar_pedidos` que gobierna las acciones operativas).
 */
export async function actualizarDatosBancariosConductor(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
  datos: {
    banco: string;
    tipo_cuenta: 'corriente' | 'vista' | 'ahorro';
    numero_cuenta: string;
  },
  actorUsuarioId: string,
  actor: UsuarioActual,
): Promise<Conductor> {
  if (!puedeGestionarLiquidacionesConductores(actor)) {
    throw new ErrorValidacion(
      'El usuario no tiene capacidad para gestionar datos bancarios de conductores',
    );
  }

  // Bitácora ANTES del efecto (CLAUDE.md invariante).
  // No loguear el número de cuenta completo — solo banco y tipo.
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'conductor.datos_bancarios_actualizados',
    entidadTipo: 'conductor',
    entidadId: conductorId,
    detalle: {
      conductor_id: conductorId,
      banco: datos.banco,
      tipo_cuenta: datos.tipo_cuenta,
      // Número enmascarado: solo últimos 4 dígitos en bitácora.
      numero_cuenta_mascara: `****${datos.numero_cuenta.slice(-4)}`,
    },
  });

  const { data, error } = await cliente
    .schema('identidad')
    .from('conductores')
    .update({
      banco: datos.banco,
      tipo_cuenta: datos.tipo_cuenta,
      numero_cuenta: datos.numero_cuenta,
    })
    .eq('id', conductorId)
    .eq('tenant_id', tenantId)
    .select(
      'id, tenant_id, estado, disponible, capacidad_paradas, nombre_completo, banco, tipo_cuenta, numero_cuenta',
    )
    .maybeSingle();

  if (error) {
    throw new Error(`Error al actualizar datos bancarios del conductor: ${error.message}`);
  }

  if (!data) {
    throw new ErrorValidacion(`Conductor ${conductorId} no encontrado en el tenant`);
  }

  return filaAConductor(data);
}
