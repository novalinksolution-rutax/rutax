/**
 * CRUD de ventanas de corte y helper de resolución (F7, ítem 1.2).
 *
 * Las ventanas de corte definen, por seller (y opcionalmente por zona):
 *   - hora_corte: hora límite local Santiago para comprometer entrega same-day/flex.
 *   - minutos_preparacion + minutos_ruta_estimado: buffers para calcular
 *     fecha_compromiso_hora (timestamptz).
 *   - sla_objetivo_pct: objetivo de nivel de servicio (default 97%).
 *
 * Son configuración INTERNA del courier (RLS solo-interno P1). El seller
 * NO ve sus propias ventanas de corte ni su SLA pactado.
 *
 * Reglas:
 * - RBAC: capacidad `gestionar_tarifas`.
 * - Escritura via service_role.
 * - Bitácora ANTES del efecto.
 * - hora_corte almacenada como 'HH:MM' (time LOCAL Santiago sin TZ).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import { puedeGestionarTarifas } from '@/modules/identidad/capacidades';
import { ErrorValidacion } from '@/modules/identidad/errores';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { ahoraEnSantiago, combinarFechaHoraSantiago, horaAMinutos } from '@/lib/fecha-santiago';
import type { VentanaCorte, GuardarVentanaCorteEntrada, TipoPedido } from './tipos';

// =============================================================================
// Mapper fila BD → interfaz
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAVentanaCorte(fila: Record<string, any>): VentanaCorte {
  // hora_corte viene de Postgres como 'HH:MM:SS' — tomar solo 'HH:MM'.
  const horaCorteRaw: string = fila.hora_corte ?? '00:00:00';
  const horaCorte = horaCorteRaw.slice(0, 5); // 'HH:MM'

  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    sellerId: fila.seller_id,
    zonaId: fila.zona_id ?? null,
    tipoEntrega: fila.tipo_entrega as TipoPedido,
    horaCorte,
    minutosPreparacion: Number(fila.minutos_preparacion ?? 0),
    minutosRutaEstimado: Number(fila.minutos_ruta_estimado ?? 0),
    slaObjetivoPct: Number(fila.sla_objetivo_pct ?? 97),
    activa: fila.activa,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

// =============================================================================
// guardarVentanaCorte (upsert)
// =============================================================================

/**
 * Crea o reemplaza la ventana de corte de un seller (por zona o por defecto).
 * Unicidad garantizada por `ventanas_corte_fallback_uk` en BD:
 * (tenant_id, seller_id, zona_id, tipo_entrega) NULLS NOT DISTINCT.
 */
export async function guardarVentanaCorte(
  cliente: SupabaseClient,
  entrada: GuardarVentanaCorteEntrada,
  actor: UsuarioActual,
): Promise<VentanaCorte> {
  if (!puedeGestionarTarifas(actor)) {
    throw new ErrorValidacion('El usuario no tiene capacidad para gestionar ventanas de corte');
  }

  // Validar formato hora_corte 'HH:MM'.
  if (!/^\d{2}:\d{2}$/.test(entrada.horaCorte)) {
    throw new ErrorValidacion(
      `hora_corte inválida: "${entrada.horaCorte}". Formato esperado: HH:MM (hora local Santiago)`,
    );
  }

  const [hh, mm] = entrada.horaCorte.split(':').map(Number);
  if (hh > 23 || mm > 59) {
    throw new ErrorValidacion(`hora_corte fuera de rango: "${entrada.horaCorte}"`);
  }

  if (entrada.minutosPreparacion < 0 || entrada.minutosRutaEstimado < 0) {
    throw new ErrorValidacion('minutos_preparacion y minutos_ruta_estimado deben ser >= 0');
  }

  const slaObjetivoPct = entrada.slaObjetivoPct ?? 97;
  if (slaObjetivoPct < 0 || slaObjetivoPct > 100) {
    throw new ErrorValidacion('sla_objetivo_pct debe estar entre 0 y 100');
  }

  // Bitácora ANTES del upsert.
  await registrarEnBitacora(cliente, {
    tenantId: entrada.tenantId,
    actorUsuarioId: entrada.actorUsuarioId,
    actorTipo: 'usuario',
    accion: 'ventana_corte.guardada',
    entidadTipo: 'ventana_corte',
    entidadId: null,
    detalle: {
      seller_id: entrada.sellerId,
      zona_id: entrada.zonaId,
      tipo_entrega: entrada.tipoEntrega,
      hora_corte: entrada.horaCorte,
      minutos_preparacion: entrada.minutosPreparacion,
      minutos_ruta_estimado: entrada.minutosRutaEstimado,
      sla_objetivo_pct: slaObjetivoPct,
    },
  });

  const { data, error } = await cliente
    .schema('identidad')
    .from('ventanas_corte')
    .upsert(
      {
        tenant_id: entrada.tenantId,
        seller_id: entrada.sellerId,
        zona_id: entrada.zonaId ?? null,
        tipo_entrega: entrada.tipoEntrega,
        hora_corte: entrada.horaCorte,
        minutos_preparacion: entrada.minutosPreparacion,
        minutos_ruta_estimado: entrada.minutosRutaEstimado,
        sla_objetivo_pct: slaObjetivoPct,
        activa: true,
      },
      {
        onConflict: 'tenant_id,seller_id,zona_id,tipo_entrega',
        ignoreDuplicates: false,
      },
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Error al guardar ventana de corte: ${error.message}`);
  }

  return filaAVentanaCorte(data);
}

// =============================================================================
// listarVentanasPorSeller
// =============================================================================

/**
 * Lista todas las ventanas de corte de un seller (activas e inactivas),
 * incluyendo los overrides por zona. Ordenadas por zona_id NULLS FIRST
 * (la ventana por defecto aparece primero).
 */
export async function listarVentanasPorSeller(
  cliente: SupabaseClient,
  tenantId: string,
  sellerId: string,
): Promise<VentanaCorte[]> {
  const { data, error } = await cliente
    .schema('identidad')
    .from('ventanas_corte')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('seller_id', sellerId)
    .order('zona_id', { nullsFirst: true })
    .order('tipo_entrega');

  if (error) {
    throw new Error(`Error al listar ventanas de corte: ${error.message}`);
  }

  return (data ?? []).map(filaAVentanaCorte);
}

// =============================================================================
// resolverVentanaCorte — helper de resolución (prioridad: zona > default)
// =============================================================================

/**
 * Busca la ventana de corte aplicable para un seller/zona/tipoEntrega:
 *   1. Si hay override por zona (zona_id = zonaId): lo usa.
 *   2. Si no, usa la ventana por defecto del seller (zona_id IS NULL).
 *   3. Si no hay ninguna configurada: devuelve null (sin regla → sin corte).
 *
 * Solo devuelve ventanas activas.
 */
export async function resolverVentanaCorte(
  cliente: SupabaseClient,
  tenantId: string,
  sellerId: string,
  zonaId: string | null,
  tipoEntrega: TipoPedido,
): Promise<VentanaCorte | null> {
  // Traer todas las ventanas activas del seller para el tipo de entrega
  // (máximo 2 filas: la por defecto y un override por zona).
  const { data, error } = await cliente
    .schema('identidad')
    .from('ventanas_corte')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('seller_id', sellerId)
    .eq('tipo_entrega', tipoEntrega)
    .eq('activa', true)
    .order('zona_id', { nullsFirst: false }); // zona_id NOT NULL primero

  if (error) {
    // No bloquear: si falla la resolución, el pedido se crea sin regla de corte.
    return null;
  }

  const ventanas = (data ?? []).map(filaAVentanaCorte);

  // 1. Buscar override por zona (si zonaId está definido).
  if (zonaId) {
    const override = ventanas.find((v) => v.zonaId === zonaId);
    if (override) return override;
  }

  // 2. Fallback: ventana por defecto del seller (zona_id IS NULL).
  const porDefecto = ventanas.find((v) => v.zonaId === null);
  return porDefecto ?? null;
}

// =============================================================================
// evaluarVentanaCorte — resolución + evaluación horaria, en un solo lugar
// =============================================================================

/** Lo que un pedido nuevo necesita saber del corte al momento de nacer. */
export interface EvaluacionCorte {
  /** La ventana aplicable, o `null` si el seller no tiene ninguna configurada. */
  ventana: VentanaCorte | null;
  /**
   * Instante de compromiso (`operacion.pedidos.fecha_compromiso_hora`), o `null`
   * cuando no hay ventana o cuando ya pasó el corte (ahí no se promete hora: se
   * marca riesgo).
   */
  fechaCompromisoHora: string | null;
  /** Marca INFORMATIVA de riesgo (F7). Nunca rechaza nada. */
  corteRiesgo: boolean;
  /** Hora local de Santiago con la que se evaluó ('HH:MM'), para el aviso al usuario. */
  horaEvaluada: string;
}

/**
 * Resuelve la ventana de corte del seller/zona y la evalúa contra el reloj de
 * Santiago, devolviendo las DOS columnas que un pedido nuevo necesita:
 * `fecha_compromiso_hora` y `corte_riesgo`.
 *
 * POR QUÉ EXISTE (y por qué está aquí y no en cada llamador). Este cálculo lo
 * necesitan hoy dos caminos de alta que no comparten nada más: el alta manual
 * same-day (`operacion/pedidos.ts`, `crearPedidoSameDay`) y la ingesta de
 * Shopify (`integraciones/shopify/ingesta-pedidos.ts`). Vivía incrustado en el
 * primero; copiarlo al segundo habría dejado dos relojes que se pueden
 * desincronizar en silencio — y el modo de falla no es un error, es un pedido
 * que promete una hora que el courier no va a cumplir.
 *
 * Lo que este helper NO hace, a propósito: no escribe bitácora ni compone el
 * aviso al usuario. Eso es del llamador, porque solo el alta manual tiene un
 * humano al que avisarle (`avisoCorte`) y un actor que registrar. Un job de
 * ingesta no tiene ninguno de los dos.
 *
 * ⚠️ `corte_riesgo` describe el momento en que el pedido ENTRÓ y por eso se
 * calcula SOLO al insertar. Recalcularlo en cada re-sincronización lo pondría en
 * `true` para todo el padrón a partir de la hora de corte, que es falso.
 *
 * `ahora` se puede inyectar para pruebas; por defecto es el reloj de Santiago.
 * Nunca `new Date()` crudo: Vercel corre en UTC y `hora_corte` es hora LOCAL.
 */
export async function evaluarVentanaCorte(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    sellerId: string;
    zonaId: string | null;
    tipoEntrega: TipoPedido;
    /** Reloj inyectable — `{ fecha: 'YYYY-MM-DD', hora: 'HH:MM' }` en Santiago. */
    ahora?: { fecha: string; hora: string };
  },
): Promise<EvaluacionCorte> {
  const ahora = entrada.ahora ?? ahoraEnSantiago();

  const ventana = await resolverVentanaCorte(
    cliente,
    entrada.tenantId,
    entrada.sellerId,
    entrada.zonaId,
    entrada.tipoEntrega,
  );

  if (!ventana) {
    // Sin regla configurada no hay corte que evaluar: el pedido nace sin
    // compromiso horario y sin marca de riesgo. No es un error.
    return { ventana: null, fechaCompromisoHora: null, corteRiesgo: false, horaEvaluada: ahora.hora };
  }

  const minutosAhora = horaAMinutos(ahora.hora);
  const minutosCorte = horaAMinutos(ventana.horaCorte);

  if (minutosAhora > minutosCorte) {
    // Fuera de corte: se marca el riesgo y NO se promete hora. Nunca se rechaza
    // el pedido — la decisión de producto es avisar, no bloquear.
    return { ventana, fechaCompromisoHora: null, corteRiesgo: true, horaEvaluada: ahora.hora };
  }

  const minutosCompromiso =
    minutosCorte + ventana.minutosPreparacion + ventana.minutosRutaEstimado;
  const horasCompromiso = Math.floor(minutosCompromiso / 60) % 24;
  const minsCompromiso = minutosCompromiso % 60;
  const horaCompromiso = `${String(horasCompromiso).padStart(2, '0')}:${String(minsCompromiso).padStart(2, '0')}`;

  // El instante de compromiso se refiere al DÍA de hoy en Santiago.
  const instante = combinarFechaHoraSantiago(ahora.fecha, horaCompromiso);

  return {
    ventana,
    fechaCompromisoHora: instante.toISOString(),
    corteRiesgo: false,
    horaEvaluada: ahora.hora,
  };
}
