/**
 * Motor de auto-asignación heurístico (F6, ítem 1.3).
 *
 * FRONTERA DURA — este módulo NO es ruteo:
 *   - Asigna pedidos → conductores por reglas discretas (zona, carga, disponibilidad).
 *   - NUNCA ordena ni optimiza secuencia de paradas.
 *   - NUNCA calcula distancias entre paradas.
 *   - NUNCA realiza clustering geográfico.
 *   - El "costo" de asignación = ocupación (cargaActual / capacidadParadas), NO distancia.
 *   - `src/modules/operacion/orden-paradas.ts` NO se toca desde aquí.
 *
 * Estructura:
 *   - Sección A: función pura `elegirConductor` — heurística sin I/O.
 *   - Sección B: acciones de servidor `autoAsignarPendientesDelDia` y
 *                `marcarConductorNoDisponibleYRedistribuir`.
 *
 * Regla de aislamiento: toda consulta filtra por `tenant_id` explícito.
 * El conductor NO se auto-asigna nada — siempre es acción del coordinador/supervisor.
 * No se emiten eventos Inngest (operación acotada al lote; no encadena proceso pesado).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import { puedeAsignarYReasignarPedidos } from '@/modules/identidad/capacidades';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { ErrorValidacion } from '@/modules/identidad/errores';
import {
  crearManifiesto,
  asignarPedidosAManifiesto,
} from './manifiestos';
import { resolverZona } from './zonas';
import { obtenerImpactoSlaDeReasignacion } from './metricas';
import type {
  Conductor,
  MotivoSinAsignar,
  PedidoSinAsignar,
  ResultadoAutoAsignacion,
  ResultadoRedistribucion,
  ImpactoSla,
} from './tipos';

// =============================================================================
// A. Heurística pura — sin I/O
// =============================================================================

/**
 * Pedido enriquecido con su zona resuelta, para pasárselo a `elegirConductor`.
 * `zonaPedido = null` si la comuna no está mapeada a ninguna zona del tenant.
 */
export interface PedidoConZona {
  pedidoId: string;
  sellerId: string;
  comunaDestino: string;
  /** ID de la zona resuelta para este pedido, o null si no hay mapeo. */
  zonaPedido: string | null;
}

/**
 * Conductor candidato tal como lo necesita la heurística.
 * `cargaActual` se mantiene EN MEMORIA durante la ejecución del lote
 * para no sobrecargar a un mismo conductor (se incrementa tras cada asignación).
 */
export interface ConductorCandidato extends Conductor {
  /** Paradas ya asignadas (activas) en el día, antes de esta ejecución. */
  cargaActual: number;
  /** Zonas preferentes configuradas por el coordinador. */
  zonasConductor: Set<string>;
}

/** Resultado de `elegirConductor` cuando se encuentra un candidato válido. */
export interface ElegirConductorOk {
  ok: true;
  conductor: ConductorCandidato;
}

/** Resultado de `elegirConductor` cuando no hay candidato válido. */
export interface ElegirConductorFail {
  ok: false;
  motivo: MotivoSinAsignar;
}

export type ResultadoElegirConductor = ElegirConductorOk | ElegirConductorFail;

/**
 * Elige el mejor conductor para un pedido dado un pool de candidatos.
 *
 * Función PURA — no toca BD, no muta los candidatos.
 * El llamador (acción de servidor) es responsable de actualizar `cargaActual`
 * en memoria tras cada asignación para evitar sobrecargar a un conductor.
 *
 * Reglas de elegibilidad (cumple TODAS o es descartado):
 *   1. `conductor.estado === 'activo'`
 *   2. `conductor.disponible === true`
 *   3. `conductor.cargaActual < conductor.capacidadParadas`
 *
 * Preferencia en cascada (primer criterio que discrimina gana):
 *   3. Afinidad de zona: candidatos cuya `zonasConductor ∋ zonaPedido` van
 *      primero. Si `zonaPedido === null`, no se discrimina por zona.
 *   4. Desempate por menor ocupación: `cargaActual / capacidadParadas` (menor = mejor).
 *   5. Desempate estable final: `conductor.id` lexicográfico ascendente.
 *
 * Sin candidato elegible → {ok: false, motivo} estructurado.
 */
export function elegirConductor(
  pedido: PedidoConZona,
  candidatos: readonly ConductorCandidato[],
): ResultadoElegirConductor {
  // Paso 1: filtrar elegibles (estado activo + disponible + con cupo).
  const elegibles = candidatos.filter(
    (c) =>
      c.estado === 'activo' &&
      c.disponible === true &&
      c.cargaActual < c.capacidadParadas,
  );

  if (elegibles.length === 0) {
    // Distinguir entre "no hay nadie disponible" y "hay pero sin cupo".
    const hayDisponibles = candidatos.some(
      (c) => c.estado === 'activo' && c.disponible === true,
    );
    if (!hayDisponibles) {
      return { ok: false, motivo: 'sin_conductor_disponible' };
    }
    return { ok: false, motivo: 'sin_cupo' };
  }

  // Paso 2: separar con/sin afinidad de zona (solo si el pedido tiene zona mapeada).
  let conZona: ConductorCandidato[];
  let sinZona: ConductorCandidato[];

  if (pedido.zonaPedido !== null) {
    conZona = elegibles.filter((c) => c.zonasConductor.has(pedido.zonaPedido!));
    sinZona = elegibles.filter((c) => !c.zonasConductor.has(pedido.zonaPedido!));
  } else {
    // Sin zona mapeada: todos los elegibles son equivalentes a nivel de zona.
    conZona = [];
    sinZona = elegibles;
  }

  // Ordenar cada grupo por ocupación ascendente y luego por id estable.
  function ordenar(lista: ConductorCandidato[]): ConductorCandidato[] {
    return [...lista].sort((a, b) => {
      const ocA = a.cargaActual / a.capacidadParadas;
      const ocB = b.cargaActual / b.capacidadParadas;
      if (ocA !== ocB) return ocA - ocB;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  // Elegir primero de los que tienen afinidad; si no hay, de los restantes.
  const pool = conZona.length > 0 ? ordenar(conZona) : ordenar(sinZona);
  const elegido = pool[0];

  return { ok: true, conductor: elegido };
}

// =============================================================================
// B. Acciones de servidor
// =============================================================================

// -----------------------------------------------------------------------------
// Tipos auxiliares internos
// -----------------------------------------------------------------------------

/** Fila de pedido pendiente de asignación leída desde BD. */
interface FilaPedidoPendiente {
  id: string;
  seller_id: string;
  destinatario_comuna: string;
}

/** Fila de conductor del pool leída desde BD. */
interface FilaConductor {
  id: string;
  tenant_id: string;
  estado: string;
  disponible: boolean;
  capacidad_paradas: number;
  nombre: string;
}

/** Fila de zona preferente de conductor. */
interface FilaConductorZona {
  conductor_id: string;
  zona_id: string;
}

/** Manifiesto borrador del día para un conductor. */
interface FilaManifiestoResumen {
  id: string;
  driver_id: string;
  estado: string;
}

// -----------------------------------------------------------------------------
// autoAsignarPendientesDelDia
// -----------------------------------------------------------------------------

/**
 * Auto-asigna los pedidos en estado `pendiente_asignacion` sin asignación
 * activa del día a los conductores disponibles usando la heurística de
 * `elegirConductor`.
 *
 * Idempotente: re-ejecutar sin pedidos pendientes = no-op (devuelve vacío).
 *
 * Flujo:
 *   1. RBAC `puedeAsignarYReasignarPedidos`.
 *   2. Lee pedidos del día en `pendiente_asignacion` sin asignación activa.
 *   3. Lee pool: conductores `activo + disponible`, zonas preferentes,
 *      capacidad y carga actual (asignaciones activas del día).
 *   4. Resuelve zona por pedido (RPC `resolver_zona`).
 *   5. Corre la heurística pedido a pedido, actualizando carga EN MEMORIA.
 *   6. Agrupa asignados por conductor → obtiene o CREA su manifiesto borrador
 *      → `asignarPedidosAManifiesto`. Solo manifiestos `borrador`; si el
 *      conductor ya tiene `confirmado`/`en_ruta` del día, es INELEGIBLE.
 *   7. Bitácora ANTES de devolver el resultado (acción de usuario con actor).
 *   8. Devuelve `ResultadoAutoAsignacion`.
 *
 * @param cliente         Cliente Supabase con service_role.
 * @param tenantId        Tenant del courier.
 * @param fecha           Fecha de operación ('YYYY-MM-DD').
 * @param actor           Usuario que dispara la acción (para RBAC).
 * @param actorUsuarioId  UUID de auth del usuario (`sesion.usuarioId`) — RNF-04.
 */
export async function autoAsignarPendientesDelDia(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: string,
  actor: UsuarioActual,
  actorUsuarioId: string,
): Promise<ResultadoAutoAsignacion> {
  // 1. RBAC
  if (!puedeAsignarYReasignarPedidos(actor)) {
    throw new ErrorValidacion(
      'El usuario no tiene capacidad para asignar y reasignar pedidos',
    );
  }

  // 2. Pedidos del día en pendiente_asignacion sin asignación activa.
  //    Usamos subconsulta: pedidos cuyo id NO aparece en asignaciones activas.
  const { data: filasAsignacionesActivas, error: errAsigActivas } = await cliente
    .schema('operacion')
    .from('asignaciones_pedido')
    .select('pedido_id')
    .eq('tenant_id', tenantId)
    .eq('activa', true);

  if (errAsigActivas) {
    throw new Error(`Error al leer asignaciones activas: ${errAsigActivas.message}`);
  }

  const idsYaAsignados = new Set(
    (filasAsignacionesActivas ?? []).map((a: { pedido_id: string }) => a.pedido_id),
  );

  const { data: filasPedidos, error: errPedidos } = await cliente
    .schema('operacion')
    .from('pedidos')
    .select('id, seller_id, destinatario_comuna')
    .eq('tenant_id', tenantId)
    .eq('estado', 'pendiente_asignacion')
    .eq('fecha_compromiso', fecha);

  if (errPedidos) {
    throw new Error(`Error al leer pedidos pendientes del día: ${errPedidos.message}`);
  }

  const pedidosPendientes: FilaPedidoPendiente[] = (filasPedidos ?? []).filter(
    (p: FilaPedidoPendiente) => !idsYaAsignados.has(p.id),
  );

  // No-op si no hay pedidos pendientes.
  if (pedidosPendientes.length === 0) {
    await _registrarAutoAsignacion(cliente, tenantId, actorUsuarioId, {
      fecha,
      pedidosProcesados: 0,
      asignados: 0,
      sinAsignar: 0,
    });
    return { asignados: [], sinAsignar: [], conductoresAfectados: [] };
  }

  // 3. Pool de conductores activos + disponibles.
  const { data: filasConductores, error: errConductores } = await cliente
    .schema('identidad')
    .from('conductores')
    .select('id, tenant_id, estado, disponible, capacidad_paradas, nombre')
    .eq('tenant_id', tenantId)
    .eq('estado', 'activo')
    .eq('disponible', true);

  if (errConductores) {
    throw new Error(`Error al leer conductores disponibles: ${errConductores.message}`);
  }

  const conductoresRaw: FilaConductor[] = filasConductores ?? [];

  // Zonas preferentes de todos los conductores del pool.
  const idsConductores = conductoresRaw.map((c) => c.id);
  const mapaZonas = new Map<string, Set<string>>();

  if (idsConductores.length > 0) {
    const { data: filasZonas, error: errZonas } = await cliente
      .schema('identidad')
      .from('conductor_zonas')
      .select('conductor_id, zona_id')
      .eq('tenant_id', tenantId)
      .in('conductor_id', idsConductores);

    if (errZonas) {
      throw new Error(`Error al leer zonas de conductores: ${errZonas.message}`);
    }

    for (const fz of (filasZonas ?? []) as FilaConductorZona[]) {
      if (!mapaZonas.has(fz.conductor_id)) {
        mapaZonas.set(fz.conductor_id, new Set());
      }
      mapaZonas.get(fz.conductor_id)!.add(fz.zona_id);
    }
  }

  // Manifiestos del día por conductor (para detectar confirmado/en_ruta = inelegible).
  const { data: filasManifiestos, error: errManifiestos } = await cliente
    .schema('operacion')
    .from('manifiestos')
    .select('id, driver_id, estado')
    .eq('tenant_id', tenantId)
    .eq('fecha_operacion', fecha)
    .in('estado', ['borrador', 'confirmado', 'en_ruta']);

  if (errManifiestos) {
    throw new Error(`Error al leer manifiestos del día: ${errManifiestos.message}`);
  }

  const mapaManifiestosBorrador = new Map<string, string>(); // conductorId → manifiestoId
  const conductoresConManifiestoActivo = new Set<string>(); // confirmado/en_ruta

  for (const m of (filasManifiestos ?? []) as FilaManifiestoResumen[]) {
    if (m.estado === 'confirmado' || m.estado === 'en_ruta') {
      conductoresConManifiestoActivo.add(m.driver_id);
    } else if (m.estado === 'borrador') {
      // Guardar el manifiesto borrador más reciente del conductor (en caso de varios).
      if (!mapaManifiestosBorrador.has(m.driver_id)) {
        mapaManifiestosBorrador.set(m.driver_id, m.id);
      }
    }
  }

  // Carga actual de cada conductor (asignaciones activas de pedidos del día).
  // Pedidos del día = los de este tenant con fecha_compromiso = fecha.
  const { data: filasAsigActDia, error: errCargaDia } = await cliente
    .schema('operacion')
    .from('asignaciones_pedido')
    .select('driver_id, pedido_id')
    .eq('tenant_id', tenantId)
    .eq('activa', true)
    .in('driver_id', idsConductores.length > 0 ? idsConductores : ['__vacio__']);

  if (errCargaDia) {
    throw new Error(`Error al leer carga de conductores: ${errCargaDia.message}`);
  }

  // Cruzamos las asignaciones activas con los pedidos del día del tenant
  // para obtener carga por conductor (solo paradas del día, no históricas).
  const { data: filasPedidosDia, error: errPedDia } = await cliente
    .schema('operacion')
    .from('pedidos')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('fecha_compromiso', fecha);

  if (errPedDia) {
    throw new Error(`Error al leer pedidos del día para carga: ${errPedDia.message}`);
  }

  const idsPedidosDia = new Set((filasPedidosDia ?? []).map((p: { id: string }) => p.id));
  const mapaCarga = new Map<string, number>();

  for (const a of (filasAsigActDia ?? []) as { driver_id: string; pedido_id: string }[]) {
    if (idsPedidosDia.has(a.pedido_id)) {
      mapaCarga.set(a.driver_id, (mapaCarga.get(a.driver_id) ?? 0) + 1);
    }
  }

  // Construir el array de candidatos mutable (cargaActual se actualiza en memoria).
  const candidatos: ConductorCandidato[] = conductoresRaw
    .filter((c) => !conductoresConManifiestoActivo.has(c.id)) // excluir confirmado/en_ruta
    .map((c) => ({
      id: c.id,
      tenantId: c.tenant_id,
      estado: c.estado as 'activo' | 'inactivo',
      disponible: c.disponible,
      capacidadParadas: c.capacidad_paradas,
      nombre: c.nombre,
      cargaActual: mapaCarga.get(c.id) ?? 0,
      zonasConductor: mapaZonas.get(c.id) ?? new Set(),
    }));

  // 4 + 5. Resolver zona por pedido y correr heurística.
  const asignacionesPorConductor = new Map<string, string[]>(); // conductorId → [pedidoId]
  const sinAsignar: PedidoSinAsignar[] = [];

  for (const pedido of pedidosPendientes) {
    // Resolver zona (RPC — puede devolver null si la comuna no está mapeada).
    const zonaPedido = await resolverZona(cliente, tenantId, pedido.destinatario_comuna);

    const pedidoConZona: PedidoConZona = {
      pedidoId: pedido.id,
      sellerId: pedido.seller_id,
      comunaDestino: pedido.destinatario_comuna,
      zonaPedido,
    };

    const resultado = elegirConductor(pedidoConZona, candidatos);

    if (!resultado.ok) {
      sinAsignar.push({
        pedidoId: pedido.id,
        sellerId: pedido.seller_id,
        comunaDestino: pedido.destinatario_comuna,
        motivo: resultado.motivo,
      });
      continue;
    }

    // Actualizar carga en memoria para el próximo pedido.
    const candidato = candidatos.find((c) => c.id === resultado.conductor.id)!;
    candidato.cargaActual += 1;

    if (!asignacionesPorConductor.has(candidato.id)) {
      asignacionesPorConductor.set(candidato.id, []);
    }
    asignacionesPorConductor.get(candidato.id)!.push(pedido.id);
  }

  // 6. Por conductor: obtener o crear manifiesto borrador → asignar pedidos.
  const asignadosResultado = [];
  const conductoresAfectados: string[] = [];

  for (const [conductorId, pedidoIds] of asignacionesPorConductor.entries()) {
    if (pedidoIds.length === 0) continue;

    // Obtener manifiesto borrador existente o crear uno nuevo.
    let manifiestoId = mapaManifiestosBorrador.get(conductorId);

    if (!manifiestoId) {
      const conductorInfo = conductoresRaw.find((c) => c.id === conductorId)!;
      const nuevoManifiesto = await crearManifiesto(cliente, {
        tenantId,
        driverId: conductorId,
        nombre: `Auto-asignación ${fecha} — ${conductorInfo.nombre}`,
        fechaOperacion: fecha,
        creadoPorUsuarioId: actorUsuarioId ?? undefined,
      });
      manifiestoId = nuevoManifiesto.id;
      mapaManifiestosBorrador.set(conductorId, manifiestoId);
    }

    // Asignar pedidos al manifiesto (actor con usuarioId real — RNF-04).
    await asignarPedidosAManifiesto(cliente, manifiestoId, pedidoIds, actor, actorUsuarioId);

    asignadosResultado.push({
      conductorId,
      manifiestoId,
      pedidosAsignados: pedidoIds,
    });
    conductoresAfectados.push(conductorId);
  }

  // 7. Bitácora ANTES de devolver (invariante CLAUDE.md: bitácora antes del efecto de retorno).
  await _registrarAutoAsignacion(cliente, tenantId, actorUsuarioId, {
    fecha,
    pedidosProcesados: pedidosPendientes.length,
    asignados: asignadosResultado.reduce((acc, a) => acc + a.pedidosAsignados.length, 0),
    sinAsignar: sinAsignar.length,
    conductoresAfectados: conductoresAfectados.length,
  });

  return {
    asignados: asignadosResultado,
    sinAsignar,
    conductoresAfectados,
  };
}

// -----------------------------------------------------------------------------
// marcarConductorNoDisponibleYRedistribuir
// -----------------------------------------------------------------------------

/**
 * Marca un conductor como no disponible y redistribuye sus paradas ABIERTAS
 * (estado `pendiente_asignacion` o `asignado`, NO `en_ruta` ni terminales)
 * entre los conductores restantes del pool.
 *
 * Idempotente: si el conductor ya estaba `disponible=false` y no tiene paradas
 * abiertas, devuelve resumen vacío con `idempotente: true`.
 *
 * Flujo:
 *   1. RBAC `puedeAsignarYReasignarPedidos`.
 *   2. Bitácora `operacion.conductor_caido` ANTES de cualquier escritura.
 *   3. `UPDATE conductores SET disponible=false`.
 *   4. Selecciona paradas ABIERTAS del conductor:
 *      asignación activa cuyo pedido.estado ∈ {pendiente_asignacion, asignado}.
 *      Los pedidos `en_ruta` y terminales se OMITEN (invariante de máquina de estados).
 *   5. Corre heurística sobre conductores restantes (el caído ya está disponible=false).
 *   6. Mueve con `asignarPedidosAManifiesto` (que desactiva asignación anterior).
 *   7. Sin receptor → queda pendiente con motivo en `paradasSinConductor`.
 *   8. Bitácora del resultado.
 *   9. Devuelve `ResultadoRedistribucion` con impacto SLA.
 */
export async function marcarConductorNoDisponibleYRedistribuir(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
  fecha: string,
  actor: UsuarioActual,
  actorUsuarioId: string,
): Promise<ResultadoRedistribucion> {
  // 1. RBAC
  if (!puedeAsignarYReasignarPedidos(actor)) {
    throw new ErrorValidacion(
      'El usuario no tiene capacidad para asignar y reasignar pedidos',
    );
  }

  // 2. Bitácora ANTES de cualquier escritura.
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'operacion.conductor_caido',
    entidadTipo: 'conductor',
    entidadId: conductorId,
    detalle: { conductor_id: conductorId, fecha },
  });

  // Verificar estado actual del conductor para idempotencia.
  const { data: filaConductor, error: errConductor } = await cliente
    .schema('identidad')
    .from('conductores')
    .select('id, disponible, estado')
    .eq('id', conductorId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (errConductor) {
    throw new Error(`Error al leer conductor: ${errConductor.message}`);
  }
  if (!filaConductor) {
    throw new ErrorValidacion(`Conductor '${conductorId}' no encontrado en el tenant`);
  }

  // 3. Marcar como no disponible (idempotente si ya lo estaba).
  const yaNoDisponible = filaConductor.disponible === false;

  if (!yaNoDisponible) {
    const { error: errUpdate } = await cliente
      .schema('identidad')
      .from('conductores')
      .update({ disponible: false })
      .eq('id', conductorId)
      .eq('tenant_id', tenantId);

    if (errUpdate) {
      throw new Error(`Error al marcar conductor no disponible: ${errUpdate.message}`);
    }
  }

  // 4. Paradas ABIERTAS del conductor: asignaciones activas cuyos pedidos
  //    están en {pendiente_asignacion, asignado}. Los en_ruta y terminales se omiten.
  const ESTADOS_ABIERTOS = ['pendiente_asignacion', 'asignado'] as const;

  const { data: filasAsignacionesCaido, error: errAsig } = await cliente
    .schema('operacion')
    .from('asignaciones_pedido')
    .select('pedido_id, manifiesto_id')
    .eq('tenant_id', tenantId)
    .eq('driver_id', conductorId)
    .eq('activa', true);

  if (errAsig) {
    throw new Error(`Error al leer asignaciones del conductor: ${errAsig.message}`);
  }

  const asignacionesCaido = filasAsignacionesCaido ?? [];

  if (asignacionesCaido.length === 0) {
    // No-op: conductor ya marcado como no disponible sin paradas que redistribuir.
    await registrarEnBitacora(cliente, {
      tenantId,
      actorUsuarioId,
      actorTipo: 'usuario',
      accion: 'operacion.redistribucion_completada',
      entidadTipo: 'conductor',
      entidadId: conductorId,
      detalle: {
        conductor_id: conductorId,
        fecha,
        pedidos_redistribuidos: 0,
        pedidos_sin_conductor: 0,
        idempotente: true,
      },
    });

    return {
      conductorId,
      paradasReasignadas: [],
      paradasSinConductor: [],
      impactoSla: [],
      idempotente: yaNoDisponible,
    };
  }

  // Obtener ids de pedidos de la asignación del conductor caído.
  const idsPedidosCaido = asignacionesCaido.map(
    (a: { pedido_id: string }) => a.pedido_id,
  );

  // Filtrar solo los que están en estado abierto.
  const { data: filasPedidosCaido, error: errPedidos } = await cliente
    .schema('operacion')
    .from('pedidos')
    .select('id, seller_id, destinatario_comuna, estado')
    .eq('tenant_id', tenantId)
    .in('id', idsPedidosCaido)
    .in('estado', [...ESTADOS_ABIERTOS]);

  if (errPedidos) {
    throw new Error(`Error al leer pedidos del conductor caído: ${errPedidos.message}`);
  }

  const pedidosAbiertos: FilaPedidoPendiente[] = filasPedidosCaido ?? [];

  if (pedidosAbiertos.length === 0) {
    // Todos los pedidos del conductor están en_ruta o terminales — no hay nada que redistribuir.
    await registrarEnBitacora(cliente, {
      tenantId,
      actorUsuarioId,
      actorTipo: 'usuario',
      accion: 'operacion.redistribucion_completada',
      entidadTipo: 'conductor',
      entidadId: conductorId,
      detalle: {
        conductor_id: conductorId,
        fecha,
        pedidos_redistribuidos: 0,
        pedidos_sin_conductor: 0,
        idempotente: false,
      },
    });

    return {
      conductorId,
      paradasReasignadas: [],
      paradasSinConductor: [],
      impactoSla: [],
      idempotente: false,
    };
  }

  // 5. Pool de conductores restantes (sin el caído, que ya está disponible=false).
  const { data: filasConductores, error: errPool } = await cliente
    .schema('identidad')
    .from('conductores')
    .select('id, tenant_id, estado, disponible, capacidad_paradas, nombre')
    .eq('tenant_id', tenantId)
    .eq('estado', 'activo')
    .eq('disponible', true)
    .neq('id', conductorId); // el caído ya no está disponible, pero por claridad lo excluimos

  if (errPool) {
    throw new Error(`Error al leer pool de conductores: ${errPool.message}`);
  }

  const conductoresRaw: FilaConductor[] = filasConductores ?? [];
  const idsConductores = conductoresRaw.map((c) => c.id);

  // Zonas preferentes del pool restante.
  const mapaZonas = new Map<string, Set<string>>();
  if (idsConductores.length > 0) {
    const { data: filasZonas, error: errZonas } = await cliente
      .schema('identidad')
      .from('conductor_zonas')
      .select('conductor_id, zona_id')
      .eq('tenant_id', tenantId)
      .in('conductor_id', idsConductores);

    if (errZonas) {
      throw new Error(`Error al leer zonas de conductores del pool: ${errZonas.message}`);
    }

    for (const fz of (filasZonas ?? []) as FilaConductorZona[]) {
      if (!mapaZonas.has(fz.conductor_id)) {
        mapaZonas.set(fz.conductor_id, new Set());
      }
      mapaZonas.get(fz.conductor_id)!.add(fz.zona_id);
    }
  }

  // Manifiestos del día del pool (para detectar confirmado/en_ruta = inelegible).
  const { data: filasManifiestos, error: errMan } = await cliente
    .schema('operacion')
    .from('manifiestos')
    .select('id, driver_id, estado')
    .eq('tenant_id', tenantId)
    .eq('fecha_operacion', fecha)
    .in('estado', ['borrador', 'confirmado', 'en_ruta']);

  if (errMan) {
    throw new Error(`Error al leer manifiestos del día: ${errMan.message}`);
  }

  const mapaManifiestosBorrador = new Map<string, string>();
  const conductoresConManifiestoActivo = new Set<string>();

  for (const m of (filasManifiestos ?? []) as FilaManifiestoResumen[]) {
    if (m.estado === 'confirmado' || m.estado === 'en_ruta') {
      conductoresConManifiestoActivo.add(m.driver_id);
    } else if (m.estado === 'borrador') {
      if (!mapaManifiestosBorrador.has(m.driver_id)) {
        mapaManifiestosBorrador.set(m.driver_id, m.id);
      }
    }
  }

  // Carga actual del pool (asignaciones activas, todos los pedidos).
  const mapaCarga = new Map<string, number>();
  if (idsConductores.length > 0) {
    const { data: filasAsig, error: errCarga } = await cliente
      .schema('operacion')
      .from('asignaciones_pedido')
      .select('driver_id')
      .eq('tenant_id', tenantId)
      .eq('activa', true)
      .in('driver_id', idsConductores);

    if (errCarga) {
      throw new Error(`Error al leer carga del pool: ${errCarga.message}`);
    }

    for (const a of (filasAsig ?? []) as { driver_id: string }[]) {
      mapaCarga.set(a.driver_id, (mapaCarga.get(a.driver_id) ?? 0) + 1);
    }
  }

  // Construir candidatos (excluir los con manifiesto confirmado/en_ruta).
  const candidatos: ConductorCandidato[] = conductoresRaw
    .filter((c) => !conductoresConManifiestoActivo.has(c.id))
    .map((c) => ({
      id: c.id,
      tenantId: c.tenant_id,
      estado: c.estado as 'activo' | 'inactivo',
      disponible: c.disponible,
      capacidadParadas: c.capacidad_paradas,
      nombre: c.nombre,
      cargaActual: mapaCarga.get(c.id) ?? 0,
      zonasConductor: mapaZonas.get(c.id) ?? new Set(),
    }));

  // 5 + 6. Correr heurística y redistribuir.
  const paradasReasignadas: string[] = [];
  const paradasSinConductor: PedidoSinAsignar[] = [];
  const asignacionesPorConductor = new Map<string, string[]>();
  const manifestosPorConductor = new Map<string, string>();

  // Copiar mapaManifiestosBorrador para no mutar el original.
  for (const [k, v] of mapaManifiestosBorrador.entries()) {
    manifestosPorConductor.set(k, v);
  }

  for (const pedido of pedidosAbiertos) {
    const zonaPedido = await resolverZona(cliente, tenantId, pedido.destinatario_comuna);

    const resultado = elegirConductor(
      {
        pedidoId: pedido.id,
        sellerId: pedido.seller_id,
        comunaDestino: pedido.destinatario_comuna,
        zonaPedido,
      },
      candidatos,
    );

    if (!resultado.ok) {
      paradasSinConductor.push({
        pedidoId: pedido.id,
        sellerId: pedido.seller_id,
        comunaDestino: pedido.destinatario_comuna,
        motivo: resultado.motivo,
      });
      continue;
    }

    const candidato = candidatos.find((c) => c.id === resultado.conductor.id)!;
    candidato.cargaActual += 1;

    if (!asignacionesPorConductor.has(candidato.id)) {
      asignacionesPorConductor.set(candidato.id, []);
    }
    asignacionesPorConductor.get(candidato.id)!.push(pedido.id);
    paradasReasignadas.push(pedido.id);
  }

  // Ejecutar asignaciones por conductor (crea o reutiliza manifiesto borrador).
  for (const [cId, pedidoIds] of asignacionesPorConductor.entries()) {
    if (pedidoIds.length === 0) continue;

    let manifiestoId = manifestosPorConductor.get(cId);
    if (!manifiestoId) {
      const conductorInfo = conductoresRaw.find((c) => c.id === cId)!;
      const nuevoManifiesto = await crearManifiesto(cliente, {
        tenantId,
        driverId: cId,
        nombre: `Redistribución ${fecha} — ${conductorInfo.nombre}`,
        fechaOperacion: fecha,
        creadoPorUsuarioId: actorUsuarioId ?? undefined,
      });
      manifiestoId = nuevoManifiesto.id;
      manifestosPorConductor.set(cId, manifiestoId);
    }

    await asignarPedidosAManifiesto(cliente, manifiestoId, pedidoIds, actor, actorUsuarioId);
  }

  // 8. Calcular impacto SLA de sellers afectados.
  const sellersSinConductor = [
    ...new Set(paradasSinConductor.map((p) => p.sellerId)),
  ];

  const impactoSla: ImpactoSla[] = await obtenerImpactoSlaDeReasignacion(
    cliente,
    tenantId,
    fecha,
    sellersSinConductor,
    paradasSinConductor,
  );

  // 8b. Bitácora del resultado.
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'operacion.redistribucion_completada',
    entidadTipo: 'conductor',
    entidadId: conductorId,
    detalle: {
      conductor_id: conductorId,
      fecha,
      pedidos_redistribuidos: paradasReasignadas.length,
      pedidos_sin_conductor: paradasSinConductor.length,
      sellers_afectados: sellersSinConductor.length,
      idempotente: false,
    },
  });

  return {
    conductorId,
    paradasReasignadas,
    paradasSinConductor,
    impactoSla,
    idempotente: false,
  };
}

// =============================================================================
// C. Utilidad privada — registro de bitácora de auto-asignación
// =============================================================================

async function _registrarAutoAsignacion(
  cliente: SupabaseClient,
  tenantId: string,
  actorUsuarioId: string | null,
  detalle: Record<string, unknown>,
): Promise<void> {
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'operacion.auto_asignacion_ejecutada',
    entidadTipo: 'tenant',
    entidadId: tenantId,
    detalle,
  });
}
