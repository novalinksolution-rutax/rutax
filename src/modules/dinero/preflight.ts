/**
 * PREFLIGHT de las 3 acciones financieras irreversibles del motor
 * entrega→dinero (`emitirFacturaPeriodo`, `emitirNotaCreditoPeriodo`,
 * `emitirPagoLiquidacion` en `./acciones.ts`).
 * =============================================================================
 *
 * Hallazgo P0 de la auditoría externa (jul 2026): antes de disparar cualquiera
 * de esas 3 acciones, el usuario debe ver un resumen verificado del servidor
 * (montos, líneas incluidas/excluidas) y cualquier inconsistencia evidente
 * (folios agotados, RUT incompleto, datos bancarios faltantes, etc.) — en vez
 * de enterarse recién cuando el job C3/C-NC/F19 falla después de haber
 * publicado el evento Inngest.
 *
 * Contrato NO-NEGOCIABLE (CLAUDE.md): este módulo es 100% de LECTURA.
 * Ninguna función de aquí hace INSERT/UPDATE — solo PREPARA (arma el resumen
 * que la acción real facturará/pagará) y VERIFICA (bloqueos/advertencias).
 * El registro de auditoría del escenario "el preflight mismo falló y el
 * usuario decide continuar bajo su responsabilidad" lo hace la Server Action
 * (`accionRegistrarPreflightOmitido`), NUNCA una función de este archivo.
 *
 * Cada función exige la MISMA capacidad RBAC que la acción de escritura
 * equivalente — un usuario que no puede emitir la factura tampoco puede ver
 * su preflight (evita filtrar montos/RUT a quien no tiene el permiso).
 *
 * Categorías de `ItemPreflight`:
 * - `bloquea`: la acción real fallaría o el estado es inválido — `ok=false`.
 * - `advierte`: la acción PUEDE ejecutarse, pero el usuario debería revisar
 *   antes (discrepancias de conciliación, incidencias abiertas, folios bajos).
 * - `informativo`: contexto que no impide ni exige revisión (líneas anuladas
 *   ya excluidas del total, por ejemplo).
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import {
  puedeEmitirFacturas,
  puedeGestionarLiquidacionesConductores,
} from '@/modules/identidad/capacidades';
import { ErrorValidacion } from '@/modules/identidad/errores';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import { formatearCLP } from '@/lib/ui/formato-moneda';
import { montosDesdeNeto } from './montos';
import { modoDtePlataforma, resolverModoDteTenant, type ModoDte } from './modo-dte';
import { UMBRAL_FOLIOS } from './folios';
import { calcularMontoPayout, type TipoRelacionConductor } from './jobs/calculo-payout';
import { bloqueaFacturacion, bloqueaPago } from './excepciones';

// =============================================================================
// Tipos del contrato (fijados por `arquitecto` — no renombrar/reordenar)
// =============================================================================

export type TipoAccionDinero = 'emitir_factura' | 'emitir_nota_credito' | 'emitir_pago';
export type CategoriaItem = 'bloquea' | 'advierte' | 'informativo';

export type CodigoItemPreflight =
  | 'estado_invalido'
  | 'documento_ya_existe'
  | 'opt_in_real_no_habilitado'
  | 'folios_agotados'
  | 'rut_seller_incompleto'
  | 'dte_rechazado_no_anulable'
  | 'cuenta_bancaria_incompleta'
  | 'monto_no_positivo'
  | 'monto_bajo_minimo_retiro'
  | 'folios_bajos'
  | 'discrepancias_conciliacion'
  | 'incidencias_abiertas'
  | 'bandeja_excepciones'
  | 'lineas_anuladas_excluidas';

export interface ItemPreflight {
  codigo: CodigoItemPreflight;
  categoria: CategoriaItem;
  titulo: string;
  detalle?: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface ResumenCobro {
  tipoAccion: 'emitir_factura' | 'emitir_nota_credito';
  sellerNombre: string;
  lineasIncluidas: number;
  lineasAnuladas: number;
  netoClp: number;
  ivaClp: number;
  totalClp: number;
  modoDte: ModoDte;
}

export interface ResumenPago {
  tipoAccion: 'emitir_pago';
  conductorNombre: string;
  lineasIncluidas: number;
  lineasAnuladas: number;
  montoBrutoClp: number;
  montoRetencionClp: number;
  montoLiquidoClp: number;
}

export type ResumenPreflight = ResumenCobro | ResumenPago;

export interface ResultadoPreflight {
  tipoAccion: TipoAccionDinero;
  /** `true` solo si `bloqueos.length === 0`. */
  ok: boolean;
  bloqueos: ItemPreflight[];
  advertencias: ItemPreflight[];
  informativos: ItemPreflight[];
  resumen: ResumenPreflight;
  generadoEn: string;
}

// =============================================================================
// Helpers internos — compartidos entre las 3 funciones públicas
// =============================================================================

/** Espejo del CHECK SQL `sellers_rut_formato` / `conductores_rut_formato`. */
const RUT_REGEX = /^[0-9]{1,8}-[0-9kK]$/;

/** Nunca exponer el número de cuenta completo — solo los últimos 4 dígitos. */
function enmascararCuenta(numero: string): string {
  if (numero.length <= 4) return '*'.repeat(numero.length);
  return `****${numero.slice(-4)}`;
}

/**
 * Lee el CAF vigente del tenant para el tipo de documento indicado y produce
 * el `ItemPreflight` correspondiente (bloquea si agotado/inexistente, advierte
 * si bajo el umbral). Misma discriminación por `tipo_documento` que el fix ya
 * aplicado en `reservarFolio` (`./folios.ts`) — un courier con CAF 61 cargado
 * pero sin CAF 33 no debe ver "folios OK" al intentar facturar.
 */
async function evaluarFolios(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
  tipoDocumento: 33 | 61,
): Promise<{ bloqueos: ItemPreflight[]; advertencias: ItemPreflight[] }> {
  const { data: caf, error } = await supabase
    .schema('identidad')
    .from('folios_caf')
    .select('folio_actual, folio_hasta')
    .eq('tenant_id', tenantId)
    .eq('tipo_documento', tipoDocumento)
    .eq('estado', 'vigente')
    .order('folio_actual', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Error al leer folios CAF: ${error.message}`);

  if (!caf) {
    return {
      bloqueos: [
        {
          codigo: 'folios_agotados',
          categoria: 'bloquea',
          titulo: 'Sin folios CAF disponibles',
          detalle: `No hay un CAF vigente cargado para documentos tipo ${tipoDocumento}.`,
          meta: { tipo_documento: tipoDocumento },
        },
      ],
      advertencias: [],
    };
  }

  // INCLUSIVO: `folio_actual` es el PRÓXIMO folio a consumir (aún no gastado),
  // así que cuando folio_actual === folio_hasta todavía queda exactamente 1
  // folio utilizable — el mismo que `reservarFolio` (`./folios.ts`) SÍ
  // reservaría (su guarda es `folioActual > folioHasta`, no `>=`). Un cálculo
  // exclusivo aquí (`folio_hasta - folio_actual`) bloquearía un folio ANTES de
  // que estuviera realmente agotado: un falso bloqueo — el preflight le diría
  // al usuario "sin folios, sube un CAF nuevo" mientras la emisión real (job
  // C3/C-NC vía `reservarFolio`) todavía la habría dejado pasar (fix QA jul 2026).
  const restantes = Number(caf.folio_hasta) - Number(caf.folio_actual) + 1;

  if (restantes <= 0) {
    return {
      bloqueos: [
        {
          codigo: 'folios_agotados',
          categoria: 'bloquea',
          titulo: 'Sin folios CAF disponibles',
          detalle: 'El CAF vigente no tiene folios restantes — carga un nuevo CAF antes de emitir.',
          meta: { restantes, tipo_documento: tipoDocumento },
        },
      ],
      advertencias: [],
    };
  }

  if (restantes < UMBRAL_FOLIOS) {
    return {
      bloqueos: [],
      advertencias: [
        {
          codigo: 'folios_bajos',
          categoria: 'advierte',
          titulo: `Quedan ${restantes} folio${restantes !== 1 ? 's' : ''} CAF`,
          detalle: 'Sube un nuevo CAF pronto para no interrumpir la emisión.',
          meta: { restantes, tipo_documento: tipoDocumento },
        },
      ],
    };
  }

  return { bloqueos: [], advertencias: [] };
}

/**
 * Discrepancias de conciliación pendientes acotadas a la entidad específica
 * (período o liquidación) — mismo patrón que `avisosDiscrepanciasConciliacion`
 * de `lib/avisos/obtener-avisos.ts`, pero sin agregar todo el tenant.
 */
async function evaluarDiscrepanciasConciliacion(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
  filtro: { periodoCobroId?: string; liquidacionId?: string },
): Promise<ItemPreflight[]> {
  let consulta = supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .select('id, monto_diferencia_clp')
    .eq('tenant_id', tenantId)
    .eq('estado', 'pendiente');

  if (filtro.periodoCobroId) consulta = consulta.eq('periodo_cobro_id', filtro.periodoCobroId);
  if (filtro.liquidacionId) consulta = consulta.eq('liquidacion_id', filtro.liquidacionId);

  const { data, error } = await consulta;
  if (error) throw new Error(`Error al leer discrepancias de conciliación: ${error.message}`);

  const eventos = data ?? [];
  if (eventos.length === 0) return [];

  const montoEnJuego = eventos.reduce(
    (acc, e) => acc + Math.abs(Number(e.monto_diferencia_clp ?? 0)),
    0,
  );

  return [
    {
      codigo: 'discrepancias_conciliacion',
      categoria: 'advierte',
      titulo:
        eventos.length === 1
          ? '1 discrepancia de conciliación sin revisar'
          : `${eventos.length} discrepancias de conciliación sin revisar`,
      detalle:
        montoEnJuego > 0
          ? `Diferencias por ${formatearCLP(montoEnJuego)} detectadas por el cruce automático.`
          : undefined,
      meta: { cantidad: eventos.length, monto_diferencia_clp: montoEnJuego },
    },
  ];
}

/** Incidencias abiertas de los pedidos cuyas líneas se incluyen en la acción. */
async function evaluarIncidenciasAbiertas(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
  pedidoIds: string[],
): Promise<ItemPreflight[]> {
  if (pedidoIds.length === 0) return [];

  const { data, error } = await supabase
    .schema('operacion')
    .from('incidencias')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('estado', 'abierta')
    .in('pedido_id', pedidoIds);

  if (error) throw new Error(`Error al leer incidencias abiertas: ${error.message}`);

  const incidencias = data ?? [];
  if (incidencias.length === 0) return [];

  return [
    {
      codigo: 'incidencias_abiertas',
      categoria: 'advierte',
      titulo:
        incidencias.length === 1
          ? '1 incidencia abierta en los pedidos incluidos'
          : `${incidencias.length} incidencias abiertas en los pedidos incluidos`,
      detalle: 'Revisa si corresponde ajustar el cobro o la liquidación antes de emitir.',
      meta: { cantidad: incidencias.length },
    },
  ];
}

/** Construye el ítem informativo de líneas anuladas excluidas del total (o `null` si no hay). */
function itemLineasAnuladas(anuladas: Array<{ motivo_anulacion: string | null }>): ItemPreflight | null {
  if (anuladas.length === 0) return null;

  const motivosUnicos = Array.from(
    new Set(anuladas.map((a) => a.motivo_anulacion).filter((m): m is string => Boolean(m))),
  ).slice(0, 5);

  return {
    codigo: 'lineas_anuladas_excluidas',
    categoria: 'informativo',
    titulo:
      anuladas.length === 1
        ? '1 línea anulada excluida del total'
        : `${anuladas.length} líneas anuladas excluidas del total`,
    detalle: motivosUnicos.length > 0 ? `Motivos: ${motivosUnicos.join(', ')}.` : undefined,
    meta: { cantidad: anuladas.length },
  };
}

interface LineasCobroPeriodo {
  vigentes: Array<{ pedido_id: string; monto_final_clp: number }>;
  anuladas: Array<{ motivo_anulacion: string | null }>;
}

/** Lee las líneas de cobro vigentes (para el resumen) y anuladas (para el informativo) del período. */
async function leerLineasCobroPeriodo(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
  periodoId: string,
): Promise<LineasCobroPeriodo> {
  const { data: vigentes, error: errorVigentes } = await supabase
    .schema('dinero')
    .from('lineas_cobro')
    .select('pedido_id, monto_final_clp')
    .eq('tenant_id', tenantId)
    .eq('periodo_cobro_id', periodoId)
    .eq('anulada', false);
  if (errorVigentes) throw new Error(`Error al leer líneas de cobro: ${errorVigentes.message}`);

  const { data: anuladas, error: errorAnuladas } = await supabase
    .schema('dinero')
    .from('lineas_cobro')
    .select('motivo_anulacion')
    .eq('tenant_id', tenantId)
    .eq('periodo_cobro_id', periodoId)
    .eq('anulada', true);
  if (errorAnuladas) throw new Error(`Error al leer líneas de cobro anuladas: ${errorAnuladas.message}`);

  return {
    vigentes: (vigentes ?? []) as LineasCobroPeriodo['vigentes'],
    anuladas: (anuladas ?? []) as LineasCobroPeriodo['anuladas'],
  };
}

/** Verifica el opt-in de emisión real (`courier_config_dte.emision_dte_real_habilitada`) — solo si la plataforma está en modo real. */
async function evaluarOptInReal(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
): Promise<ItemPreflight | null> {
  if (modoDtePlataforma() !== 'real') return null;

  const { data: config } = await supabase
    .schema('identidad')
    .from('courier_config_dte')
    .select('emision_dte_real_habilitada')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (config?.emision_dte_real_habilitada) return null;

  return {
    codigo: 'opt_in_real_no_habilitado',
    categoria: 'bloquea',
    titulo: 'La emisión real de DTE no está habilitada',
    detalle: 'Habilita la emisión real en las opciones de DTE de este courier antes de emitir.',
  };
}

interface SellerResuelto {
  sellerNombre: string;
  itemRutInvalido: ItemPreflight | null;
}

/** Lee el seller del período y valida su RUT — defensivo aunque el `CHECK` de BD lo exige. */
async function resolverSeller(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
  sellerId: string,
): Promise<SellerResuelto> {
  const { data: seller, error } = await supabase
    .schema('identidad')
    .from('sellers')
    .select('id, razon_social, rut')
    .eq('id', sellerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`Error al leer seller: ${error.message}`);

  const rut = seller?.rut as string | null | undefined;
  const itemRutInvalido: ItemPreflight | null =
    !rut || !RUT_REGEX.test(rut)
      ? {
          codigo: 'rut_seller_incompleto',
          categoria: 'bloquea',
          titulo: 'El seller no tiene un RUT válido',
          detalle: 'El DTE exige un RUT de receptor válido — completa el dato antes de emitir.',
        }
      : null;

  return {
    sellerNombre: (seller?.razon_social as string | undefined) ?? 'Seller',
    itemRutInvalido,
  };
}

// =============================================================================
// preflightEmitirFactura
// =============================================================================

/**
 * PREFLIGHT de `emitirFacturaPeriodo`. Espejo exacto de sus validaciones de
 * estado + verificaciones adicionales de folios, RUT, opt-in y advertencias
 * de conciliación/incidencias — sin escribir nada.
 */
export async function preflightEmitirFactura(
  tenantId: string,
  periodoId: string,
  usuario: UsuarioActual,
): Promise<ResultadoPreflight> {
  if (!puedeEmitirFacturas(usuario)) {
    throw new ErrorValidacion('Solo el dueño o administración puede emitir facturas (DTE).');
  }

  const supabase = crearClienteServiceRole();

  const { data: periodo, error: errorPeriodo } = await supabase
    .schema('dinero')
    .from('periodos_cobro')
    .select('id, tenant_id, seller_id, estado, documento_dte_id')
    .eq('id', periodoId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (errorPeriodo) throw new Error(`Error al leer período: ${errorPeriodo.message}`);
  if (!periodo) throw new ErrorValidacion(`Período ${periodoId} no encontrado en el tenant.`);

  const bloqueos: ItemPreflight[] = [];
  const advertencias: ItemPreflight[] = [];
  const informativos: ItemPreflight[] = [];

  // Espejo exacto del if/else de `emitirFacturaPeriodo`: "ya facturado" tiene
  // prioridad sobre "estado inválido" (un período facturado también falla el
  // chequeo `!== 'cerrado'`, pero el mensaje correcto es el de "ya existe").
  if (periodo.estado === 'facturado' || periodo.documento_dte_id) {
    bloqueos.push({
      codigo: 'documento_ya_existe',
      categoria: 'bloquea',
      titulo: 'El período ya fue facturado',
      detalle: 'Ya existe un DTE emitido para este período — no se puede volver a facturar.',
    });
  } else if (periodo.estado !== 'cerrado') {
    bloqueos.push({
      codigo: 'estado_invalido',
      categoria: 'bloquea',
      titulo: 'El período no está cerrado',
      detalle: `Solo se puede facturar un período en estado 'cerrado'. Estado actual: '${periodo.estado}'.`,
      meta: { estado_actual: periodo.estado as string },
    });
  }

  const { sellerNombre, itemRutInvalido } = await resolverSeller(
    supabase,
    tenantId,
    periodo.seller_id as string,
  );
  if (itemRutInvalido) bloqueos.push(itemRutInvalido);

  const modoDte = await resolverModoDteTenant(tenantId);
  const itemOptIn = await evaluarOptInReal(supabase, tenantId);
  if (itemOptIn) bloqueos.push(itemOptIn);

  const resultadoFolios = await evaluarFolios(supabase, tenantId, 33);
  bloqueos.push(...resultadoFolios.bloqueos);
  advertencias.push(...resultadoFolios.advertencias);

  const { vigentes, anuladas } = await leerLineasCobroPeriodo(supabase, tenantId, periodoId);
  const netoTotal = vigentes.reduce((acc, l) => acc + Math.round(Number(l.monto_final_clp ?? 0)), 0);
  const montos = montosDesdeNeto(netoTotal);

  const itemAnuladas = itemLineasAnuladas(anuladas);
  if (itemAnuladas) informativos.push(itemAnuladas);

  advertencias.push(
    ...(await evaluarDiscrepanciasConciliacion(supabase, tenantId, { periodoCobroId: periodoId })),
  );

  const pedidoIds = vigentes.map((l) => l.pedido_id).filter(Boolean);
  advertencias.push(...(await evaluarIncidenciasAbiertas(supabase, tenantId, pedidoIds)));

  const resultadoBloqueo = await bloqueaFacturacion({
    tenantId,
    periodoCobroId: periodoId,
    sellerId: periodo.seller_id as string,
  });
  if (resultadoBloqueo.bloquea) bloqueos.push(...resultadoBloqueo.motivos);

  const resumen: ResumenCobro = {
    tipoAccion: 'emitir_factura',
    sellerNombre,
    lineasIncluidas: vigentes.length,
    lineasAnuladas: anuladas.length,
    netoClp: montos.netoClp,
    ivaClp: montos.ivaClp,
    totalClp: montos.totalClp,
    modoDte,
  };

  return {
    tipoAccion: 'emitir_factura',
    ok: bloqueos.length === 0,
    bloqueos,
    advertencias,
    informativos,
    resumen,
    generadoEn: new Date().toISOString(),
  };
}

// =============================================================================
// preflightEmitirNotaCredito
// =============================================================================

/**
 * PREFLIGHT de `emitirNotaCreditoPeriodo`. Espejo de sus validaciones
 * (estado facturado + DTE 33 existente, no rechazado, sin NC previa) más las
 * verificaciones compartidas con la factura (folios tipo 61, RUT, opt-in).
 */
export async function preflightEmitirNotaCredito(
  tenantId: string,
  periodoId: string,
  usuario: UsuarioActual,
): Promise<ResultadoPreflight> {
  if (!puedeEmitirFacturas(usuario)) {
    throw new ErrorValidacion('Solo el dueño o administración puede emitir notas de crédito.');
  }

  const supabase = crearClienteServiceRole();

  const { data: periodo, error: errorPeriodo } = await supabase
    .schema('dinero')
    .from('periodos_cobro')
    .select('id, tenant_id, seller_id, estado, documento_dte_id')
    .eq('id', periodoId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (errorPeriodo) throw new Error(`Error al leer período: ${errorPeriodo.message}`);
  if (!periodo) throw new ErrorValidacion(`Período ${periodoId} no encontrado en el tenant.`);

  const bloqueos: ItemPreflight[] = [];
  const advertencias: ItemPreflight[] = [];
  const informativos: ItemPreflight[] = [];

  let dte: { id: string; estado_sii: string } | null = null;

  if (periodo.estado !== 'facturado' || !periodo.documento_dte_id) {
    bloqueos.push({
      codigo: 'estado_invalido',
      categoria: 'bloquea',
      titulo: 'El período no está facturado',
      detalle: `Solo se puede emitir una nota de crédito para un período 'facturado'. Estado actual: '${periodo.estado}'.`,
      meta: { estado_actual: periodo.estado as string },
    });
  } else {
    // Solo se lee el DTE 33 si el estado del período es consistente — evita
    // consultas innecesarias y espeja el early-return de `emitirNotaCreditoPeriodo`.
    const { data: dteData, error: errorDte } = await supabase
      .schema('dinero')
      .from('documentos_dte')
      .select('id, tipo_documento, estado_sii')
      .eq('id', periodo.documento_dte_id as string)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (errorDte) throw new Error(`Error al leer DTE: ${errorDte.message}`);

    if (!dteData || dteData.tipo_documento !== 33) {
      // Caso defensivo (no debería ocurrir: FK + tipo fijo al facturar) — se
      // reporta como estado inválido, el código más cercano del catálogo cerrado.
      bloqueos.push({
        codigo: 'estado_invalido',
        categoria: 'bloquea',
        titulo: 'No se encontró la factura',
        detalle: 'El documento referenciado no existe o no es una factura.',
      });
    } else {
      dte = { id: dteData.id as string, estado_sii: dteData.estado_sii as string };

      if (dte.estado_sii === 'rechazado') {
        bloqueos.push({
          codigo: 'dte_rechazado_no_anulable',
          categoria: 'bloquea',
          titulo: 'La factura fue rechazada por el SII',
          detalle: 'Un documento rechazado nunca entró al SII — no requiere nota de crédito.',
        });
      }

      const { data: ncExistente } = await supabase
        .schema('dinero')
        .from('documentos_dte')
        .select('id, folio')
        .eq('tenant_id', tenantId)
        .eq('tipo_documento', 61)
        .eq('dte_referencia_id', dte.id)
        .maybeSingle();
      if (ncExistente) {
        bloqueos.push({
          codigo: 'documento_ya_existe',
          categoria: 'bloquea',
          titulo: 'Ya existe una nota de crédito para esta factura',
          detalle: `Folio ${ncExistente.folio}.`,
          meta: { folio: ncExistente.folio as number },
        });
      }
    }
  }

  const { sellerNombre, itemRutInvalido } = await resolverSeller(
    supabase,
    tenantId,
    periodo.seller_id as string,
  );
  if (itemRutInvalido) bloqueos.push(itemRutInvalido);

  const modoDte = await resolverModoDteTenant(tenantId);
  const itemOptIn = await evaluarOptInReal(supabase, tenantId);
  if (itemOptIn) bloqueos.push(itemOptIn);

  // Folios de nota de crédito — CAF tipo 61, discriminado del 33 de la factura.
  const resultadoFolios = await evaluarFolios(supabase, tenantId, 61);
  bloqueos.push(...resultadoFolios.bloqueos);
  advertencias.push(...resultadoFolios.advertencias);

  // Resumen: mismo criterio que la factura (suma de lineas_cobro vigentes del
  // período). En el estado normal (período facturado, sin anulaciones desde el
  // cierre) coincide con los montos copiados del DTE 33 que la NC replicará.
  const { vigentes, anuladas } = await leerLineasCobroPeriodo(supabase, tenantId, periodoId);
  const netoTotal = vigentes.reduce((acc, l) => acc + Math.round(Number(l.monto_final_clp ?? 0)), 0);
  const montos = montosDesdeNeto(netoTotal);

  const itemAnuladas = itemLineasAnuladas(anuladas);
  if (itemAnuladas) informativos.push(itemAnuladas);

  advertencias.push(
    ...(await evaluarDiscrepanciasConciliacion(supabase, tenantId, { periodoCobroId: periodoId })),
  );

  const pedidoIds = vigentes.map((l) => l.pedido_id).filter(Boolean);
  advertencias.push(...(await evaluarIncidenciasAbiertas(supabase, tenantId, pedidoIds)));

  const resultadoBloqueo = await bloqueaFacturacion({
    tenantId,
    periodoCobroId: periodoId,
    sellerId: periodo.seller_id as string,
  });
  if (resultadoBloqueo.bloquea) bloqueos.push(...resultadoBloqueo.motivos);

  const resumen: ResumenCobro = {
    tipoAccion: 'emitir_nota_credito',
    sellerNombre,
    lineasIncluidas: vigentes.length,
    lineasAnuladas: anuladas.length,
    netoClp: montos.netoClp,
    ivaClp: montos.ivaClp,
    totalClp: montos.totalClp,
    modoDte,
  };

  return {
    tipoAccion: 'emitir_nota_credito',
    ok: bloqueos.length === 0,
    bloqueos,
    advertencias,
    informativos,
    resumen,
    generadoEn: new Date().toISOString(),
  };
}

// =============================================================================
// preflightEmitirPago
// =============================================================================

/**
 * PREFLIGHT de `emitirPagoLiquidacion`. Espejo de sus validaciones de estado
 * más las que hoy solo viven en el job `jobEjecutarPayout` (datos bancarios,
 * monto positivo, mínimo de retiro) — el usuario las ve ANTES de aprobar el
 * pago, no después de que el job las descubra y falle.
 */
export async function preflightEmitirPago(
  tenantId: string,
  liquidacionId: string,
  usuario: UsuarioActual,
): Promise<ResultadoPreflight> {
  if (!puedeGestionarLiquidacionesConductores(usuario)) {
    throw new ErrorValidacion(
      'Solo el dueño o administración puede solicitar el pago de liquidaciones a conductores.',
    );
  }

  const supabase = crearClienteServiceRole();

  const { data: liq, error: errorLiq } = await supabase
    .schema('dinero')
    .from('liquidaciones')
    .select('id, tenant_id, driver_id, estado, monto_total_clp, bono_clp, penalizacion_clp, tipo_relacion_conductor')
    .eq('id', liquidacionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (errorLiq) throw new Error(`Error al leer liquidación: ${errorLiq.message}`);
  if (!liq) throw new ErrorValidacion(`Liquidación ${liquidacionId} no encontrada en el tenant.`);

  const bloqueos: ItemPreflight[] = [];
  const advertencias: ItemPreflight[] = [];
  const informativos: ItemPreflight[] = [];

  if (liq.estado !== 'emitida') {
    bloqueos.push({
      codigo: 'estado_invalido',
      categoria: 'bloquea',
      titulo: 'La liquidación no está en estado emitida',
      detalle: `Solo se pueden pagar liquidaciones en estado 'emitida'. Estado actual: '${liq.estado}'.`,
      meta: { estado_actual: liq.estado as string },
    });
  }

  // Datos bancarios — misma lectura que `ejecutar-payout.ts` (Step 2).
  const { data: conductor, error: errorConductor } = await supabase
    .schema('identidad')
    .from('conductores')
    .select('id, nombre_completo, rut, banco, tipo_cuenta, numero_cuenta, tipo_relacion')
    .eq('id', liq.driver_id as string)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (errorConductor) throw new Error(`Error al leer conductor: ${errorConductor.message}`);

  const banco = conductor?.banco as string | null | undefined;
  const tipoCuenta = conductor?.tipo_cuenta as string | null | undefined;
  const numeroCuenta = conductor?.numero_cuenta as string | null | undefined;

  if (!banco || !tipoCuenta || !numeroCuenta) {
    bloqueos.push({
      codigo: 'cuenta_bancaria_incompleta',
      categoria: 'bloquea',
      titulo: 'El conductor no tiene datos bancarios completos',
      detalle: 'Completa banco, tipo de cuenta y número de cuenta antes de pagar.',
      // Nunca el número completo — solo una máscara con los últimos 4 dígitos.
      meta: { numero_cuenta_mascara: numeroCuenta ? enmascararCuenta(numeroCuenta) : null },
    });
  }

  const conductorNombre = (conductor?.nombre_completo as string | undefined) ?? 'Conductor';
  const tipoRelacion: TipoRelacionConductor =
    (conductor?.tipo_relacion as TipoRelacionConductor | undefined) ??
    (liq.tipo_relacion_conductor as TipoRelacionConductor);

  // Config de payout — misma lectura que `ejecutar-payout.ts` (Step 3). A
  // diferencia de otras lecturas defensivas de este archivo, SÍ propagamos el
  // error aquí (como hace el job): si la consulta falla, un default silencioso
  // de 0% de retención mostraría un monto líquido mayor al real — mejor que el
  // preflight falle ruidosamente a que muestre una cifra optimista.
  const { data: config, error: errorConfig } = await supabase
    .schema('identidad')
    .from('courier_config_payout')
    .select('porcentaje_retencion, minimo_retiro_clp')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (errorConfig) throw new Error(`Error al leer configuración de payout: ${errorConfig.message}`);

  const porcentajeRetencion =
    typeof config?.porcentaje_retencion === 'number' ? config.porcentaje_retencion : 0;
  const minimoRetiroClp = typeof config?.minimo_retiro_clp === 'number' ? config.minimo_retiro_clp : 0;

  // Misma fórmula que el job (`../jobs/calculo-payout.ts`) — no puede divergir.
  const calculo = calcularMontoPayout({
    montoTotalClp: Math.round(Number(liq.monto_total_clp ?? 0)),
    bonoClp: Math.round(Number(liq.bono_clp ?? 0)),
    penalizacionClp: Math.round(Number(liq.penalizacion_clp ?? 0)),
    tipoRelacion,
    porcentajeRetencion,
  });

  if (calculo.montoLiquidoClp <= 0) {
    bloqueos.push({
      codigo: 'monto_no_positivo',
      categoria: 'bloquea',
      titulo: 'No hay monto para pagar',
      detalle: `El monto líquido es ${calculo.montoLiquidoClp} CLP. Verifica la configuración de retención y bonos/penalizaciones.`,
      meta: { monto_liquido_clp: calculo.montoLiquidoClp },
    });
  } else if (minimoRetiroClp > 0 && calculo.montoLiquidoClp < minimoRetiroClp) {
    bloqueos.push({
      codigo: 'monto_bajo_minimo_retiro',
      categoria: 'bloquea',
      titulo: 'El monto es menor al mínimo de retiro',
      detalle: `El monto líquido es ${calculo.montoLiquidoClp} CLP, pero el mínimo configurado es ${minimoRetiroClp} CLP.`,
      meta: { monto_liquido_clp: calculo.montoLiquidoClp, minimo_retiro_clp: minimoRetiroClp },
    });
  }

  const { data: lineasVigentes, error: errorVigentes } = await supabase
    .schema('dinero')
    .from('lineas_liquidacion')
    .select('pedido_id')
    .eq('tenant_id', tenantId)
    .eq('liquidacion_id', liquidacionId)
    .eq('anulada', false);
  if (errorVigentes) throw new Error(`Error al leer líneas de liquidación: ${errorVigentes.message}`);

  const { data: lineasAnuladasData, error: errorAnuladas } = await supabase
    .schema('dinero')
    .from('lineas_liquidacion')
    .select('motivo_anulacion')
    .eq('tenant_id', tenantId)
    .eq('liquidacion_id', liquidacionId)
    .eq('anulada', true);
  if (errorAnuladas) {
    throw new Error(`Error al leer líneas de liquidación anuladas: ${errorAnuladas.message}`);
  }

  const vigentes = (lineasVigentes ?? []) as Array<{ pedido_id: string }>;
  const lineasAnuladas = (lineasAnuladasData ?? []) as Array<{ motivo_anulacion: string | null }>;

  const itemAnuladas = itemLineasAnuladas(lineasAnuladas);
  if (itemAnuladas) informativos.push(itemAnuladas);

  advertencias.push(
    ...(await evaluarDiscrepanciasConciliacion(supabase, tenantId, { liquidacionId })),
  );

  const pedidoIds = vigentes.map((l) => l.pedido_id).filter(Boolean);
  advertencias.push(...(await evaluarIncidenciasAbiertas(supabase, tenantId, pedidoIds)));

  const resultadoBloqueo = await bloqueaPago({
    tenantId,
    liquidacionId,
    driverId: liq.driver_id as string,
  });
  if (resultadoBloqueo.bloquea) bloqueos.push(...resultadoBloqueo.motivos);

  const resumen: ResumenPago = {
    tipoAccion: 'emitir_pago',
    conductorNombre,
    lineasIncluidas: vigentes.length,
    lineasAnuladas: lineasAnuladas.length,
    montoBrutoClp: calculo.montoBrutoClp,
    montoRetencionClp: calculo.montoRetencionClp,
    montoLiquidoClp: calculo.montoLiquidoClp,
  };

  return {
    tipoAccion: 'emitir_pago',
    ok: bloqueos.length === 0,
    bloqueos,
    advertencias,
    informativos,
    resumen,
    generadoEn: new Date().toISOString(),
  };
}
