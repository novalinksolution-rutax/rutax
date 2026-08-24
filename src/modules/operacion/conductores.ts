/**
 * Funciones de escritura para conductores — disponibilidad, capacidad y zonas
 * preferentes (F6, ítem 1.3).
 *
 * La lectura de conductores (para la vista del conductor) vive en identidad.
 * Este módulo solo añade las tres operaciones de escritura que necesita el
 * coordinador/supervisor para configurar el pool antes del auto-assign:
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
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { ErrorValidacion } from '@/modules/identidad/errores';
import { normalizarYValidarRut } from '@/modules/identidad/rut';
import { verificarLimite } from '@/modules/plataforma/enforcement';
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
// actualizarDisponibilidadConductor — RETIRADA el 24-08-2026
// =============================================================================
//
// Cambiaba `conductores.disponible` con la capacidad del coordinador. Ese campo
// pasa a ser **solo del conductor**: lo marca desde su app, y la única
// superficie es `marcarmeDisponible` en `disponibilidad-conductor.ts`, que NO
// acepta un `conductorId` de fuera — sale de la sesión.
//
// Se retira entera y no se deja «por si acaso»: mientras exista una función que
// cambia la disponibilidad de un tercero, alguien la va a volver a llamar.

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

// =============================================================================
// crearConductor — alta de conductor (F2 "Ola 1", ítem G2)
// =============================================================================

const TIPOS_RELACION_VALIDOS = ['dependiente', 'independiente'] as const;
type TipoRelacionValido = (typeof TIPOS_RELACION_VALIDOS)[number];

export interface DatosAltaConductor {
  nombreCompleto: string;
  rut: string;
  tipoRelacion: TipoRelacionValido;
}

/**
 * Resultado tipado del gate de límite del plan — NO se lanza como excepción.
 * "Enforcement blando" (CLAUDE.md) significa que el bloqueo llega como un
 * resultado accionable para la UI ("actualiza tu plan"), no como un error
 * genérico/500; el bloqueo en sí (no dejar crear MÁS conductores por sobre el
 * cap del plan) es real y deliberado — distinto de `pedidos_mes`, que jamás
 * bloquea nada (ver `enforcement.ts`).
 */
export interface ResultadoAltaConductorLimiteAlcanzado {
  ok: false;
  motivo: 'limite_alcanzado';
  mensaje: string;
  usoActual: number;
  limite: number;
}

export type ResultadoAltaConductor =
  | { ok: true; conductor: Conductor }
  | ResultadoAltaConductorLimiteAlcanzado;

/**
 * Iniciales del nombre completo — lo único del nombre que llega a
 * `bitacora_auditoria` (minimización de PII, Ley 21.431). El nombre completo
 * SÍ se persiste en `conductores` (dato de negocio); esto solo acota el
 * rastro de auditoría, visible al super-admin de Rutax cross-tenant.
 * `"Juan Pérez Soto"` → `"J.P.S."`.
 */
function obtenerInicialesNombre(nombreCompleto: string): string {
  return nombreCompleto
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra) => `${palabra[0]?.toUpperCase() ?? ''}.`)
    .join('');
}

/**
 * Enmascara un RUT normalizado (`NNNNNNNN-DV`) para la bitácora: conserva
 * solo los últimos 4 dígitos antes del DV y el propio DV, oculta el resto
 * con `****`. Mismo criterio que `numero_cuenta_mascara` en
 * `actualizarDatosBancariosConductor`. `"12345678-5"` → `"****5678-5"`.
 */
function enmascararRutBitacora(rutNormalizado: string): string {
  const [cuerpo, dv] = rutNormalizado.split('-');
  return `****${cuerpo.slice(-4)}-${dv}`;
}

/**
 * Alta de un conductor nuevo — chokepoint del gate `conductores_max` del plan.
 * Distinto del resto de este archivo (que EDITA conductores existentes): aquí
 * se CREA la fila.
 *
 * RBAC — decisión: se reutiliza `asignar_y_reasignar_pedidos`, la MISMA
 * capacidad que gatea el resto de este módulo (disponibilidad/capacidad/
 * zonas en `actions.ts`, del coordinador/supervisor que arma el pool). El
 * levantamiento (`docs/levantamiento.md` §4) no define una capacidad
 * específica de "alta de conductor" distinta de "configurar el pool" — dar de
 * alta es la primera preparación de ese mismo pool, así que se prefiere
 * reusar el gate operativo ya existente en vez de inventar una capacidad sin
 * respaldo textual.
 *
 * Gate de límite (BLANDO, CLAUDE.md: "avisa, no corta la operación en
 * marcha"): `verificarLimite(tenantId, 'conductores')`. Si el plan ya está en
 * su tope, esta función NO lanza — devuelve `{ ok:false,
 * motivo:'limite_alcanzado', ... }` para que el frontend lo muestre como
 * aviso accionable. No interrumpe NADA que ya esté en marcha (el pool
 * existente sigue operando igual); solo topa el alta de un conductor NUEVO
 * por sobre el cap contratado.
 *
 * Bitácora ANTES del INSERT (RNF-04, actor usuario) — el `id` del conductor
 * se genera acá mismo (client-side, `crypto.randomUUID()`) y se pasa explícito
 * en el INSERT, así el `entidadId` de la bitácora es el id real de la fila sin
 * tener que esperar a que la BD lo devuelva (evita usar el RUT como
 * identificador de entidad — minimización de PII, Ley 21.431: la bitácora es
 * visible al super-admin de Rutax cross-tenant en `/admin/bitacora`, y ni el
 * RUT completo ni el nombre completo del conductor pertenecen ahí; ambos SÍ
 * se persisten en `conductores`, que es la tabla de negocio). El `detalle`
 * solo lleva un RUT enmascarado e iniciales del nombre — ver
 * `enmascararRutBitacora`/`obtenerInicialesNombre` más abajo, mismo criterio
 * que `numero_cuenta_mascara` en `actualizarDatosBancariosConductor`.
 *
 * Usa el cliente RLS recibido (NO service_role) para el INSERT del conductor:
 * la policy `conductores_insert_interno` (migración 0002) ya exige
 * `tenant_id = claim_tenant_id() AND tipo_usuario = 'interno'` — el
 * aislamiento de tenant lo impone la base de datos, no esta función.
 *
 * PERO la bitácora NO se escribe con ese cliente: `bitacora_auditoria` es
 * append-only y ningún rol de cliente (`authenticated`/`anon`) tiene privilegio
 * de INSERT, ni sobre la tabla base ni sobre la vista espejo de `public`
 * (migración 0004 §5 + prueba pgTAP `rls_aislamiento.test.sql`). Escribir la
 * bitácora con la sesión del usuario fallaba SIEMPRE con
 * "permission denied for view bitacora_auditoria" y bloqueaba el alta entera.
 * El único rol que puede insertar ahí es `service_role`, así que la bitácora va
 * por su propio cliente — mismo patrón que `dinero/acciones.ts`. Los dos
 * clientes conviven a propósito: la auditoría no debe ampliar la superficie de
 * escritura del usuario final, y el aislamiento del INSERT no debe delegarse a
 * la aplicación.
 */
export async function crearConductor(
  cliente: SupabaseClient,
  tenantId: string,
  datos: DatosAltaConductor,
  actorUsuarioId: string,
  actor: UsuarioActual,
): Promise<ResultadoAltaConductor> {
  if (!puedeAsignarYReasignarPedidos(actor)) {
    throw new ErrorValidacion('El usuario no tiene capacidad para dar de alta conductores');
  }

  const nombreCompleto = datos.nombreCompleto.trim();
  if (nombreCompleto.length < 2) {
    throw new ErrorValidacion('El nombre completo debe tener al menos 2 caracteres');
  }

  const rutNormalizado = normalizarYValidarRut(datos.rut);
  if (!rutNormalizado) {
    throw new ErrorValidacion(
      'El RUT ingresado no es válido (formato o dígito verificador incorrectos)',
    );
  }

  if (!TIPOS_RELACION_VALIDOS.includes(datos.tipoRelacion)) {
    throw new ErrorValidacion('El tipo de relación debe ser "dependiente" o "independiente"');
  }

  // Gate de límite — chokepoint del cap `conductores_max` del plan.
  const limite = await verificarLimite(tenantId, 'conductores');
  if (!limite.permitido && limite.motivo === 'limite_alcanzado') {
    return {
      ok: false,
      motivo: 'limite_alcanzado',
      mensaje: `Alcanzaste el máximo de conductores de tu plan (${limite.limite}). Actualiza tu plan para agregar más.`,
      usoActual: limite.usoActual,
      limite: limite.limite as number,
    };
  }

  // Id generado acá (no lo asigna la BD) para poder loguear la bitácora ANTES
  // del INSERT (CLAUDE.md invariante — RNF-04) con el id real como entidadId,
  // en vez del RUT completo (minimización de PII, Ley 21.431).
  const conductorId = crypto.randomUUID();

  // Bitácora ANTES del INSERT. `detalle` minimizado: sin RUT completo ni
  // nombre completo — ver `enmascararRutBitacora`/`obtenerInicialesNombre`.
  // Cliente service_role: `bitacora_auditoria` no admite INSERT de ningún rol
  // de cliente (append-only, migración 0004 §5). NO se reusa `cliente` (sesión
  // del usuario) — ver el bloque de documentación de esta función.
  await registrarEnBitacora(crearClienteServiceRole(), {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'conductor.alta',
    entidadTipo: 'conductor',
    entidadId: conductorId,
    detalle: {
      conductor_id: conductorId,
      tipo_relacion: datos.tipoRelacion,
      nombre_iniciales: obtenerInicialesNombre(nombreCompleto),
      rut_mascara: enmascararRutBitacora(rutNormalizado),
    },
  });

  const { data, error } = await cliente
    .schema('identidad')
    .from('conductores')
    .insert({
      id: conductorId,
      tenant_id: tenantId,
      nombre_completo: nombreCompleto,
      rut: rutNormalizado,
      tipo_relacion: datos.tipoRelacion,
    })
    .select(
      'id, tenant_id, estado, disponible, capacidad_paradas, nombre_completo, banco, tipo_cuenta, numero_cuenta',
    )
    .maybeSingle();

  if (error) {
    // Unique (tenant_id, rut) — migración 0002 (`conductores_tenant_rut_uk`).
    if ((error as { code?: string }).code === '23505') {
      throw new ErrorValidacion('Ya existe un conductor con ese RUT en tu equipo.');
    }
    throw new Error(`Error al crear el conductor: ${error.message}`);
  }
  if (!data) {
    throw new Error('El INSERT del conductor no devolvió datos.');
  }

  return { ok: true, conductor: filaAConductor(data) };
}
