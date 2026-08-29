/**
 * Panel de couriers/tenants del backstage (gap 1 — solo datos, ver
 * `docs/plataforma/informe-gaps-administracion-plataforma.md`).
 * =============================================================================
 * Función de solo lectura que combina, por courier: su suscripción (reusa
 * `obtenerTodasSuscripciones` de `consultas.ts` — NO se reimplementa) + la
 * salud TÉCNICA del sistema (reusa `obtenerSaludJobs`/`obtenerBacklogSistema`
 * de `salud.ts` — NO se duplica esa lógica de clasificación) + morosidad
 * derivada barata (períodos `vencido` de la propia suscripción, que ya marca
 * el job `plataforma/marcarMorosidad`; aquí solo se CUENTAN, no se detectan).
 *
 * ALCANCE (Ola 0, deliberadamente acotado):
 * - `salud.ts` hoy es system-wide (crons + backlog del motor entrega→dinero
 *   agregados) — no tiene desglose por tenant. Esta función NO fabrica un
 *   desglose per-tenant nuevo (evitaría "componer lo existente" y terminaría
 *   reimplementando la lógica de conciliación/backlog por tenant). El
 *   drill-down de salud POR courier es el gap #9 del informe ("Observabilidad
 *   por-tenant", F2/F3) — trabajo aparte, no de este Ola 0.
 * - El semáforo `salud` por courier es un derivado LIVIANO de datos que sí son
 *   inherentemente por-tenant: el estado de la suscripción y su morosidad.
 * - OFFBOARD: esta función NO implementa borrado ni retención — es de solo
 *   lectura. La "acción de offboard" en F2 son las acciones YA existentes
 *   `suspenderSuscripcion`/`cancelarSuscripcion` (`acciones.ts`). Cualquier
 *   necesidad de purgar/retener datos financieros al dar de baja un courier
 *   queda ANOTADA aquí, sin implementar: requiere decisión de negocio +
 *   revisión de `seguridad-cumplimiento` (retención de bitácora/DTE es legal,
 *   nunca se borra un rastro financiero).
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { obtenerTodasSuscripciones } from './consultas';
import { obtenerSaludJobs, obtenerBacklogSistema, type SaludJob, type BacklogSistema } from './salud';
import { areasApagadasPorTenant } from './areas-courier';
import type { AreaProducto } from '@/modules/identidad/areas-producto';
import type { EstadoSuscripcion, Periodicidad } from './tipos';

/** Semáforo de salud del courier — derivado de estado de suscripción + morosidad. */
export type NivelSaludCourier = 'verde' | 'amarillo' | 'rojo';

export interface CourierPanelItem {
  tenantId: string;
  /** Id de la suscripción — enlaza la fila a `/admin/suscripciones/[suscripcionId]` (frontend). */
  suscripcionId: string;
  nombreFantasia: string | null;
  estadoSuscripcion: EstadoSuscripcion;
  planNombre: string;
  periodicidad: Periodicidad;
  /** Cantidad de períodos de suscripción en estado `vencido` (impagos tras su
   *  fecha de vencimiento) — derivado barato, NO recalcula la regla de
   *  morosidad (esa vive en el job `plataforma/marcarMorosidad`). */
  periodosVencidos: number;
  /** Semáforo del courier: `rojo` si la suscripción está suspendida/cancelada
   *  o tiene morosidad; `amarillo` si está en trial; `verde` en cualquier
   *  otro caso. NO incluye salud operativa/técnica (eso es system-wide, ver
   *  `saludSistema`). */
  salud: NivelSaludCourier;
  /**
   * Las áreas de producto que Rutax le tiene APAGADAS. Vacío = las cinco
   * encendidas, que es lo normal.
   *
   * ⚠️ NO entra en `salud`. Un área apagada es una decisión deliberada de
   * Rutax, no un problema del courier: pintarla de rojo junto a la morosidad
   * haría que el semáforo dejara de significar «hay que llamar a este».
   */
  areasApagadas: AreaProducto[];
}

export interface PanelCouriers {
  couriers: CourierPanelItem[];
  /**
   * Salud TÉCNICA del sistema — system-wide, no desglosada por tenant (ver
   * nota de alcance arriba). Compuesta de `salud.ts` sin reimplementar su
   * lógica: `jobs` = último estado de los crons con telemetría; `backlog` =
   * contadores de integridad del motor entrega→dinero.
   */
  saludSistema: {
    jobs: SaludJob[];
    backlog: BacklogSistema;
  };
}

/**
 * Deriva el semáforo de un courier a partir del estado de su suscripción y su
 * morosidad. Función pura — extraída para poder testearla sin BD.
 */
export function derivarSaludCourier(
  estadoSuscripcion: EstadoSuscripcion,
  periodosVencidos: number,
): NivelSaludCourier {
  if (estadoSuscripcion === 'suspendida' || estadoSuscripcion === 'cancelada') return 'rojo';
  if (periodosVencidos > 0) return 'rojo';
  if (estadoSuscripcion === 'trial') return 'amarillo';
  return 'verde';
}

/**
 * Panel de couriers del backstage: uno por courier con suscripción, más un
 * resumen de salud técnica del sistema. Solo lectura, `service_role`.
 */
export async function obtenerPanelCouriers(): Promise<PanelCouriers> {
  const [suscripciones, saludJobs, backlog] = await Promise.all([
    obtenerTodasSuscripciones(),
    obtenerSaludJobs(),
    obtenerBacklogSistema(),
  ]);

  const saludSistema = { jobs: saludJobs, backlog };

  if (suscripciones.length === 0) {
    return { couriers: [], saludSistema };
  }

  // Morosidad barata: contar períodos 'vencido' por tenant en una sola query
  // (el estado 'vencido' ya lo asigna el job `plataforma/marcarMorosidad` —
  // aquí solo se cuenta, no se re-detecta).
  const supabase = crearClienteServiceRole();
  const tenantIds = suscripciones.map((s) => s.tenantId);
  const { data: periodosVencidosData, error } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('tenant_id')
    .in('tenant_id', tenantIds)
    .eq('estado', 'vencido');

  if (error) throw new Error(`Error al derivar morosidad del panel de couriers: ${error.message}`);

  const periodosVencidosPorTenant = new Map<string, number>();
  for (const fila of periodosVencidosData ?? []) {
    const tid = fila.tenant_id as string;
    periodosVencidosPorTenant.set(tid, (periodosVencidosPorTenant.get(tid) ?? 0) + 1);
  }

  // Las áreas apagadas van en la misma pasada: sin esto, saber a quién le falta
  // algo encendido obligaba a abrir courier por courier, y con eso un área que
  // se apagó «hasta que esté listo» se queda apagada sin que nadie se entere.
  const apagadasPorTenant = await areasApagadasPorTenant(tenantIds);

  const couriers: CourierPanelItem[] = suscripciones.map((s) => {
    const periodosVencidos = periodosVencidosPorTenant.get(s.tenantId) ?? 0;
    return {
      tenantId: s.tenantId,
      suscripcionId: s.id,
      nombreFantasia: s.nombreFantasiaTenant,
      estadoSuscripcion: s.estado,
      planNombre: s.plan.nombre,
      periodicidad: s.periodicidad,
      periodosVencidos,
      salud: derivarSaludCourier(s.estado, periodosVencidos),
      areasApagadas: apagadasPorTenant.get(s.tenantId) ?? [],
    };
  });

  return { couriers, saludSistema };
}
