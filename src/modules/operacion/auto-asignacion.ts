/**
 * Motor heurístico de asignación de pedidos a conductores (F6, ítem 1.3).
 *
 * Qué vive acá:
 *   - La heurística pura `elegirConductor` (Sección A).
 *   - La acción de servidor `marcarConductorNoDisponibleYRedistribuir`
 *     (Sección B): redistribuye las paradas ABIERTAS de un conductor puntual
 *     que cae (se marca no disponible) entre el resto del pool. NUNCA barre
 *     pedidos sueltos del día sin dueño.
 *
 * Histórico: también vivió acá `autoAsignarPendientesDelDia`, que sí barría
 * TODOS los pedidos `pendiente_asignacion` del día. Se desactivó el
 * 2026-08-12 (Etapa 0 de `docs/arquitectura/retiro-y-ruteo-plan.md`) porque
 * no sabía nada de retiros físicos: con la ingesta diaria de ML habilitada,
 * habría movido a `asignado` pedidos que el seller despacha con OTROS
 * couriers, habilitando `asignado → en_ruta → entregado` (ML publica esos
 * eventos igual) y generando cobro al seller por entregas de la competencia.
 * Se ELIMINÓ por completo el 2026-08-14: ya era inalcanzable (guarda en la
 * Server Action, botón sin importar en ninguna pantalla) y su reemplazo
 * — selección masiva por filtros, Etapa 6 — es la vía que sigue.
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
 *   - Sección B: acción de servidor `marcarConductorNoDisponibleYRedistribuir`
 *                y su helper `obtenerCargaPoolDelDia`.
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
import { leerTodasLasFilas } from '@/lib/supabase/leer-paginado';
import { resolverZona } from './zonas';
import { obtenerImpactoSlaDeReasignacion, ESTADOS_TERMINALES_PEDIDO } from './metricas';
import type {
  Conductor,
  MotivoSinAsignar,
  PedidoSinAsignar,
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
  /** Informativo. Viaja porque el tipo lo pide, no porque la heurística lo mire. */
  vehiculo: 'moto' | 'auto' | null;
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
// obtenerCargaPoolDelDia
// -----------------------------------------------------------------------------

/**
 * Carga actual de cada conductor: SOLO paradas de HOY (`fecha_compromiso`
 * = `fecha`) que siguen realmente pendientes (pedido fuera de
 * `ESTADOS_TERMINALES_PEDIDO` — el mismo conjunto que usa el resto del
 * módulo para "pendientes/en curso", ver `metricas.ts`).
 *
 * `asignaciones_pedido.activa` NO significa "en curso": significa "esta es
 * la asignación VIGENTE de este pedido" (lo impone el índice único parcial
 * `(pedido_id) where activa = true`) y a propósito no se apaga al entregar
 * — ver `docs/arquitectura/retiro-y-ruteo-plan.md`. Sin el filtro de fecha
 * + estado, este conteo suma TODO el histórico de asignaciones activas del
 * conductor, incluidas las de pedidos entregados hace días, y hace creer
 * que el pool está saturado cuando no lo está.
 *
 * `pedidos!inner(...)` es obligatorio: sin él, el filtro sobre la tabla
 * embebida NO poda las filas (PostgREST hace LEFT JOIN por defecto y solo
 * anularía el campo embebido) — ver `manifiestos-same-day.ts:44-51`.
 */
export async function obtenerCargaPoolDelDia(
  cliente: SupabaseClient,
  tenantId: string,
  driverIds: readonly string[],
  fecha: string,
): Promise<Map<string, number>> {
  const mapaCarga = new Map<string, number>();
  if (driverIds.length === 0) return mapaCarga;

  // Paginado, y no una consulta suelta: PostgREST corta en 1.000 filas SIN
  // avisar, y esto es exactamente el patrón que ese tope arruina — una carga
  // truncada subestima al conductor saturado y la redistribución le encaja
  // todavía más. Es el mismo defecto que esta función acaba de arreglar, solo
  // que apareciendo a mayor volumen: hoy son ~400 pedidos/día, el alcance
  // apunta a 1.000+.
  const filas = await leerTodasLasFilas<{ driver_id: string }>(
    'carga del pool del día',
    (desde, hasta) =>
      cliente
        .schema('operacion')
        .from('asignaciones_pedido')
        .select('driver_id, pedidos!inner(estado, fecha_compromiso)')
        .eq('tenant_id', tenantId)
        .eq('activa', true)
        .in('driver_id', driverIds)
        .eq('pedidos.fecha_compromiso', fecha)
        .not('pedidos.estado', 'in', `(${ESTADOS_TERMINALES_PEDIDO.join(',')})`)
        .range(desde, hasta),
  );

  for (const fila of filas) {
    mapaCarga.set(fila.driver_id, (mapaCarga.get(fila.driver_id) ?? 0) + 1);
  }

  return mapaCarga;
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
  /**
   * Por qué se cae el conductor. Va a la bitácora junto al hecho.
   *
   * Sin esto la línea decía «alguien marcó a Muñoz no disponible el 21-08» y
   * nada más: mañana, cuando se revise por qué esas paradas cambiaron de manos,
   * no hay forma de distinguir un accidente de un error de dedo.
   */
  motivo: string,
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
    detalle: { conductor_id: conductorId, fecha, motivo },
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
    // ⚠️ `nombre` NO EXISTE en `identidad.conductores`: la columna es
    // `nombre_completo`. Pedía `nombre` a secas y PostgREST devolvía
    // «column conductores.nombre does not exist», que acá se convierte en un
    // throw — o sea que **redistribuir fallaba siempre**, en el primer paso, y
    // el conductor quedaba marcado no disponible con sus paradas sin mover.
    // Se alias-ea para no tocar el resto del archivo, que lee `c.nombre`.
    .select('id, tenant_id, estado, disponible, capacidad_paradas, vehiculo, nombre:nombre_completo')
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

  // Carga actual del pool: SOLO paradas de hoy y realmente pendientes
  // (ver `obtenerCargaPoolDelDia` — antes este conteo sumaba el histórico
  // completo de asignaciones activas, incluidas las ya entregadas).
  const mapaCarga = await obtenerCargaPoolDelDia(cliente, tenantId, idsConductores, fecha);

  // Construir candidatos (excluir los con manifiesto confirmado/en_ruta).
  const candidatos: ConductorCandidato[] = conductoresRaw
    .filter((c) => !conductoresConManifiestoActivo.has(c.id))
    .map((c) => ({
      // ⚠️ `vehiculo` viaja pero NO pesa en la heurística: el costo sigue
      // siendo la ocupación `cargaActual / capacidadParadas`. Está acá porque
      // `ConductorCandidato` extiende `Conductor`, no porque decida nada
      // (decisión del usuario, 26-08-2026: el vehículo es informativo).
      vehiculo: c.vehiculo ?? null,
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
