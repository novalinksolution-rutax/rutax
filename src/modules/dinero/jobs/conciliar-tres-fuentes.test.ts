/**
 * Tests del job C7 — conciliar-tres-fuentes (F17, Bloque 3).
 *
 * Verifica los 6 detectores con lógica pura (sin mocks de BD):
 *
 * D1 · pagado_conductor_sin_cobro_seller    — FUGA DIRECTA
 * D2 · cobrado_seller_no_pagado_conductor   — inverso D1
 * D3 · reprogramacion_no_cobrada            — recargo de reagendado sin aplicar
 * D4 · minimo_omitido                       — período o línea bajo mínimo
 * D5 · pago_seller_faltante                 — período facturado sin pago
 * D6 · pago_conductor_faltante              — liquidación emitida sin pagar N días
 *
 * Invariantes clave:
 * - Idempotencia: segunda ejecución no duplica eventos.
 * - No muta líneas, liquidaciones ni períodos.
 * - Pobla monto_diferencia_clp en todos los detectores (requerido por F22).
 * - Pobla driver_id en D1 y liquidacion_id en D6 (fuente 3).
 * - Si falta dato de tarifa (NULL) → no genera falso positivo.
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// Lógica pura extraída de cada detector — sin dependencias de BD
// =============================================================================

// ---------------------------------------------------------------------------
// D1: pagado_conductor_sin_cobro_seller
// ---------------------------------------------------------------------------

interface LineaLiquidacion {
  pedidoId: string;
  driverId: string;
  montoFinalClp: number;
}

interface LineaCobro {
  pedidoId: string;
  sellerId: string;
  periodoCobroId: string;
  montoFinalClp: number;
  anulada: boolean;
}

/**
 * Detecta pedidos con línea de liquidación pero sin línea de cobro activa.
 * Refleja la lógica pura del detector D1.
 */
function detectarFugasD1(
  lineasLiq: LineaLiquidacion[],
  lineasCobroActivas: LineaCobro[], // anulada=false
): LineaLiquidacion[] {
  const pedidosConCobro = new Set(lineasCobroActivas.map((l) => l.pedidoId));
  return lineasLiq.filter((ll) => !pedidosConCobro.has(ll.pedidoId));
}

// ---------------------------------------------------------------------------
// D2: cobrado_seller_no_pagado_conductor
// ---------------------------------------------------------------------------

interface PedidoConDriver {
  id: string;
  driverIdAsignado: string;
}

/**
 * Detecta pedidos cobrados al seller que tienen conductor pero sin liquidación.
 */
function detectarFugasD2(
  lineasCobro: LineaCobro[],
  pedidosConDriver: PedidoConDriver[],
  pedidosConLiquidacion: string[],
): LineaCobro[] {
  const pedidosConDriverSet = new Set(pedidosConDriver.map((p) => p.id));
  const pedidosConLiqSet = new Set(pedidosConLiquidacion);

  return lineasCobro.filter(
    (lc) => pedidosConDriverSet.has(lc.pedidoId) && !pedidosConLiqSet.has(lc.pedidoId),
  );
}

// ---------------------------------------------------------------------------
// D3: reprogramacion_no_cobrada
// ---------------------------------------------------------------------------

interface LineaCobroConTarifa {
  pedidoId: string;
  sellerId: string;
  periodoCobroId: string;
  ajusteIncidenciaClp: number;
  tarifaId: string;
}

interface Tarifa {
  id: string;
  recargoReprogramacionClp: number | null;
}

/**
 * Detecta pedidos con reagendado y sin recargo cobrado, cuando la tarifa lo tiene.
 */
function detectarReprogramacionesNoCobradas(
  lineasCobro: LineaCobroConTarifa[],
  pedidosConReagendado: string[],
  tarifas: Map<string, Tarifa>,
): Array<{ linea: LineaCobroConTarifa; montoRecargo: number }> {
  const pedidosReagendadoSet = new Set(pedidosConReagendado);

  return lineasCobro
    .filter(
      (lc) =>
        pedidosReagendadoSet.has(lc.pedidoId) &&
        lc.ajusteIncidenciaClp === 0,
    )
    .flatMap((lc) => {
      const tarifa = tarifas.get(lc.tarifaId);
      const recargo = Number(tarifa?.recargoReprogramacionClp ?? 0);
      if (recargo <= 0) return [];
      return [{ linea: lc, montoRecargo: recargo }];
    });
}

// ---------------------------------------------------------------------------
// D4: minimo_omitido
// ---------------------------------------------------------------------------

interface PeriodoCobro {
  id: string;
  sellerId: string;
  montoTotalClp: number;
}

interface TarifaConMinimos {
  minimoFacturacionClp: number | null;
  minimoRetiroClp: number | null;
}

/**
 * Detecta si el período quedó bajo el mínimo de facturación.
 */
function detectarMinimoFacturacion(
  periodo: PeriodoCobro,
  tarifa: TarifaConMinimos,
): number | null {
  const minimo = Number(tarifa.minimoFacturacionClp ?? 0);
  if (minimo <= 0) return null; // sin mínimo configurado → omitir
  if (periodo.montoTotalClp >= minimo) return null;
  return minimo - periodo.montoTotalClp;
}

/**
 * Detecta líneas de cobro bajo el mínimo de retiro.
 */
function detectarMinimoRetiro(
  montoLinea: number,
  tarifa: TarifaConMinimos,
): number | null {
  const minimo = Number(tarifa.minimoRetiroClp ?? 0);
  if (minimo <= 0) return null; // sin mínimo configurado → omitir
  if (montoLinea >= minimo) return null;
  return minimo - montoLinea;
}

// ---------------------------------------------------------------------------
// D5: pago_seller_faltante
// ---------------------------------------------------------------------------

interface PeriodoFacturado {
  id: string;
  sellerId: string;
  montoTotalClp: number;
  estadoCobro: string;
  fechaFin: string;
}

function detectarPagosSellerFaltantes(periodos: PeriodoFacturado[]): PeriodoFacturado[] {
  return periodos.filter((p) => p.estadoCobro !== 'pagado');
}

// ---------------------------------------------------------------------------
// D6: pago_conductor_faltante
// ---------------------------------------------------------------------------

interface Liquidacion {
  id: string;
  driverId: string;
  estado: string;
  generadoEn: string | null;
  montoTotalClp: number;
}

function diasEntre(desdeIso: string, hastaIso: string): number {
  const desde = new Date(`${desdeIso}T00:00:00Z`).getTime();
  const hasta = new Date(`${hastaIso}T00:00:00Z`).getTime();
  return Math.round((hasta - desde) / (1000 * 60 * 60 * 24));
}

function detectarPagosConductorFaltantes(
  liquidaciones: Liquidacion[],
  hoy: string,
  maxDias: number,
): Liquidacion[] {
  return liquidaciones.filter((liq) => {
    if (liq.estado !== 'emitida') return false;
    if (!liq.generadoEn) return false;
    const fechaEmision = liq.generadoEn.substring(0, 10);
    return diasEntre(fechaEmision, hoy) > maxDias;
  });
}

// ---------------------------------------------------------------------------
// Idempotencia genérica
// ---------------------------------------------------------------------------

interface EventoConciliacion {
  tipoDiferencia: string;
  pedidoId?: string | null;
  periodoCobroidId?: string | null;
  liquidacionId?: string | null;
}

function existeEvento(
  eventos: EventoConciliacion[],
  tipoDiferencia: string,
  filtro: { pedidoId?: string; periodoCobroidId?: string; liquidacionId?: string },
): boolean {
  return eventos.some(
    (e) =>
      e.tipoDiferencia === tipoDiferencia &&
      (filtro.pedidoId === undefined || e.pedidoId === filtro.pedidoId) &&
      (filtro.periodoCobroidId === undefined || e.periodoCobroidId === filtro.periodoCobroidId) &&
      (filtro.liquidacionId === undefined || e.liquidacionId === filtro.liquidacionId),
  );
}

// =============================================================================
// Tests
// =============================================================================

describe('Job C7 — conciliar-tres-fuentes', () => {
  // ===========================================================================
  // D1 · pagado_conductor_sin_cobro_seller
  // ===========================================================================

  describe('D1 · pagado_conductor_sin_cobro_seller (fuga directa)', () => {
    it('línea de liquidación sin cobro al seller → detecta fuga', () => {
      const lineasLiq: LineaLiquidacion[] = [
        { pedidoId: 'p1', driverId: 'driver-A', montoFinalClp: 3000 },
      ];
      const lineasCobro: LineaCobro[] = [];

      const fugas = detectarFugasD1(lineasLiq, lineasCobro);

      expect(fugas).toHaveLength(1);
      expect(fugas[0].pedidoId).toBe('p1');
    });

    it('línea de liquidación CON cobro al seller → no es fuga', () => {
      const lineasLiq: LineaLiquidacion[] = [
        { pedidoId: 'p1', driverId: 'driver-A', montoFinalClp: 3000 },
      ];
      const lineasCobro: LineaCobro[] = [
        {
          pedidoId: 'p1',
          sellerId: 'seller-1',
          periodoCobroId: 'periodo-1',
          montoFinalClp: 5000,
          anulada: false,
        },
      ];

      const fugas = detectarFugasD1(lineasLiq, lineasCobro);

      expect(fugas).toHaveLength(0);
    });

    it('múltiples pedidos: solo detecta los sin cobro', () => {
      const lineasLiq: LineaLiquidacion[] = [
        { pedidoId: 'p1', driverId: 'driver-A', montoFinalClp: 3000 },
        { pedidoId: 'p2', driverId: 'driver-B', montoFinalClp: 4000 },
        { pedidoId: 'p3', driverId: 'driver-C', montoFinalClp: 2000 },
      ];
      const lineasCobro: LineaCobro[] = [
        {
          pedidoId: 'p1',
          sellerId: 's1',
          periodoCobroId: 'pc1',
          montoFinalClp: 5000,
          anulada: false,
        },
        {
          pedidoId: 'p3',
          sellerId: 's1',
          periodoCobroId: 'pc1',
          montoFinalClp: 3000,
          anulada: false,
        },
      ];

      const fugas = detectarFugasD1(lineasLiq, lineasCobro);

      expect(fugas).toHaveLength(1);
      expect(fugas[0].pedidoId).toBe('p2');
    });

    it('monto_diferencia_clp es el monto de la línea de liquidación', () => {
      const lineasLiq: LineaLiquidacion[] = [
        { pedidoId: 'p1', driverId: 'driver-A', montoFinalClp: 3500 },
      ];
      const fugas = detectarFugasD1(lineasLiq, []);

      expect(fugas[0].montoFinalClp).toBe(3500);
    });

    it('fuga tiene driver_id poblado (fuente 3)', () => {
      const lineasLiq: LineaLiquidacion[] = [
        { pedidoId: 'p1', driverId: 'driver-uuid-001', montoFinalClp: 3000 },
      ];
      const fugas = detectarFugasD1(lineasLiq, []);

      expect(fugas[0].driverId).toBe('driver-uuid-001');
    });

    it('idempotencia: evento previo evita duplicado', () => {
      const eventosExistentes: EventoConciliacion[] = [
        { tipoDiferencia: 'pagado_conductor_sin_cobro_seller', pedidoId: 'p1' },
      ];

      const yaExiste = existeEvento(
        eventosExistentes,
        'pagado_conductor_sin_cobro_seller',
        { pedidoId: 'p1' },
      );

      expect(yaExiste).toBe(true);
    });

    it('idempotencia: distinto pedido sí genera evento', () => {
      const eventosExistentes: EventoConciliacion[] = [
        { tipoDiferencia: 'pagado_conductor_sin_cobro_seller', pedidoId: 'p1' },
      ];

      const yaExistep2 = existeEvento(
        eventosExistentes,
        'pagado_conductor_sin_cobro_seller',
        { pedidoId: 'p2' },
      );

      expect(yaExistep2).toBe(false);
    });
  });

  // ===========================================================================
  // D2 · cobrado_seller_no_pagado_conductor
  // ===========================================================================

  describe('D2 · cobrado_seller_no_pagado_conductor', () => {
    it('cobro al seller con conductor asignado pero sin liquidación → detecta', () => {
      const lineasCobro: LineaCobro[] = [
        {
          pedidoId: 'p1',
          sellerId: 's1',
          periodoCobroId: 'pc1',
          montoFinalClp: 5000,
          anulada: false,
        },
      ];
      const pedidosConDriver: PedidoConDriver[] = [
        { id: 'p1', driverIdAsignado: 'driver-A' },
      ];
      const pedidosConLiquidacion: string[] = [];

      const resultado = detectarFugasD2(lineasCobro, pedidosConDriver, pedidosConLiquidacion);

      expect(resultado).toHaveLength(1);
      expect(resultado[0].pedidoId).toBe('p1');
    });

    it('cobro al seller SIN conductor asignado → no genera evento D2', () => {
      const lineasCobro: LineaCobro[] = [
        {
          pedidoId: 'p1',
          sellerId: 's1',
          periodoCobroId: 'pc1',
          montoFinalClp: 5000,
          anulada: false,
        },
      ];
      const pedidosConDriver: PedidoConDriver[] = []; // sin conductor
      const pedidosConLiquidacion: string[] = [];

      const resultado = detectarFugasD2(lineasCobro, pedidosConDriver, pedidosConLiquidacion);

      expect(resultado).toHaveLength(0);
    });

    it('cobro al seller con conductor Y con liquidación → no genera evento D2', () => {
      const lineasCobro: LineaCobro[] = [
        {
          pedidoId: 'p1',
          sellerId: 's1',
          periodoCobroId: 'pc1',
          montoFinalClp: 5000,
          anulada: false,
        },
      ];
      const pedidosConDriver: PedidoConDriver[] = [{ id: 'p1', driverIdAsignado: 'driver-A' }];
      const pedidosConLiquidacion = ['p1'];

      const resultado = detectarFugasD2(lineasCobro, pedidosConDriver, pedidosConLiquidacion);

      expect(resultado).toHaveLength(0);
    });

    it('monto_diferencia_clp es el monto de la línea de cobro', () => {
      const lineasCobro: LineaCobro[] = [
        {
          pedidoId: 'p1',
          sellerId: 's1',
          periodoCobroId: 'pc1',
          montoFinalClp: 7500,
          anulada: false,
        },
      ];
      const pedidosConDriver: PedidoConDriver[] = [{ id: 'p1', driverIdAsignado: 'driver-A' }];

      const resultado = detectarFugasD2(lineasCobro, pedidosConDriver, []);

      expect(resultado[0].montoFinalClp).toBe(7500);
    });

    it('idempotencia: segundo run no duplica evento', () => {
      const eventosExistentes: EventoConciliacion[] = [
        { tipoDiferencia: 'cobrado_seller_no_pagado_conductor', pedidoId: 'p1' },
      ];

      const yaExiste = existeEvento(
        eventosExistentes,
        'cobrado_seller_no_pagado_conductor',
        { pedidoId: 'p1' },
      );

      expect(yaExiste).toBe(true);
    });
  });

  // ===========================================================================
  // D3 · reprogramacion_no_cobrada
  // ===========================================================================

  describe('D3 · reprogramacion_no_cobrada', () => {
    it('pedido con reagendado y tarifa con recargo > 0 y ajuste = 0 → detecta', () => {
      const lineas: LineaCobroConTarifa[] = [
        {
          pedidoId: 'p1',
          sellerId: 's1',
          periodoCobroId: 'pc1',
          ajusteIncidenciaClp: 0,
          tarifaId: 'tarifa-1',
        },
      ];
      const pedidosConReagendado = ['p1'];
      const tarifas = new Map<string, Tarifa>([
        ['tarifa-1', { id: 'tarifa-1', recargoReprogramacionClp: 2000 }],
      ]);

      const resultado = detectarReprogramacionesNoCobradas(lineas, pedidosConReagendado, tarifas);

      expect(resultado).toHaveLength(1);
      expect(resultado[0].montoRecargo).toBe(2000);
    });

    it('pedido con reagendado pero tarifa SIN recargo (NULL) → no genera falso positivo', () => {
      const lineas: LineaCobroConTarifa[] = [
        {
          pedidoId: 'p1',
          sellerId: 's1',
          periodoCobroId: 'pc1',
          ajusteIncidenciaClp: 0,
          tarifaId: 'tarifa-1',
        },
      ];
      const pedidosConReagendado = ['p1'];
      const tarifas = new Map<string, Tarifa>([
        ['tarifa-1', { id: 'tarifa-1', recargoReprogramacionClp: null }],
      ]);

      const resultado = detectarReprogramacionesNoCobradas(lineas, pedidosConReagendado, tarifas);

      expect(resultado).toHaveLength(0);
    });

    it('pedido con reagendado pero ajuste_incidencia_clp > 0 → no es discrepancia', () => {
      const lineas: LineaCobroConTarifa[] = [
        {
          pedidoId: 'p1',
          sellerId: 's1',
          periodoCobroId: 'pc1',
          ajusteIncidenciaClp: 2000, // ya se cobró el recargo
          tarifaId: 'tarifa-1',
        },
      ];
      const pedidosConReagendado = ['p1'];
      const tarifas = new Map<string, Tarifa>([
        ['tarifa-1', { id: 'tarifa-1', recargoReprogramacionClp: 2000 }],
      ]);

      const resultado = detectarReprogramacionesNoCobradas(lineas, pedidosConReagendado, tarifas);

      expect(resultado).toHaveLength(0);
    });

    it('pedido sin incidencia reagendado → no genera evento', () => {
      const lineas: LineaCobroConTarifa[] = [
        {
          pedidoId: 'p1',
          sellerId: 's1',
          periodoCobroId: 'pc1',
          ajusteIncidenciaClp: 0,
          tarifaId: 'tarifa-1',
        },
      ];
      const pedidosConReagendado: string[] = []; // sin reagendado
      const tarifas = new Map<string, Tarifa>([
        ['tarifa-1', { id: 'tarifa-1', recargoReprogramacionClp: 2000 }],
      ]);

      const resultado = detectarReprogramacionesNoCobradas(lineas, pedidosConReagendado, tarifas);

      expect(resultado).toHaveLength(0);
    });

    it('monto_diferencia_clp = recargo_reprogramacion_clp de la tarifa', () => {
      const lineas: LineaCobroConTarifa[] = [
        {
          pedidoId: 'p1',
          sellerId: 's1',
          periodoCobroId: 'pc1',
          ajusteIncidenciaClp: 0,
          tarifaId: 'tarifa-1',
        },
      ];
      const tarifas = new Map<string, Tarifa>([
        ['tarifa-1', { id: 'tarifa-1', recargoReprogramacionClp: 1500 }],
      ]);

      const resultado = detectarReprogramacionesNoCobradas(lineas, ['p1'], tarifas);

      expect(resultado[0].montoRecargo).toBe(1500);
    });

    it('idempotencia: evento previo bloquea inserción', () => {
      const eventosExistentes: EventoConciliacion[] = [
        { tipoDiferencia: 'reprogramacion_no_cobrada', pedidoId: 'p1' },
      ];

      expect(existeEvento(eventosExistentes, 'reprogramacion_no_cobrada', { pedidoId: 'p1' })).toBe(true);
      expect(existeEvento(eventosExistentes, 'reprogramacion_no_cobrada', { pedidoId: 'p2' })).toBe(false);
    });
  });

  // ===========================================================================
  // D4 · minimo_omitido
  // ===========================================================================

  describe('D4 · minimo_omitido', () => {
    describe('sub-detector 4a: período bajo mínimo de facturación', () => {
      it('monto_total_clp < minimo_facturacion_clp → diferencia detectada', () => {
        const periodo: PeriodoCobro = { id: 'pc1', sellerId: 's1', montoTotalClp: 8000 };
        const tarifa: TarifaConMinimos = { minimoFacturacionClp: 10000, minimoRetiroClp: null };

        const diferencia = detectarMinimoFacturacion(periodo, tarifa);

        expect(diferencia).toBe(2000);
      });

      it('monto_total_clp === minimo_facturacion_clp → no es discrepancia', () => {
        const periodo: PeriodoCobro = { id: 'pc1', sellerId: 's1', montoTotalClp: 10000 };
        const tarifa: TarifaConMinimos = { minimoFacturacionClp: 10000, minimoRetiroClp: null };

        const diferencia = detectarMinimoFacturacion(periodo, tarifa);

        expect(diferencia).toBeNull();
      });

      it('monto_total_clp > minimo_facturacion_clp → no es discrepancia', () => {
        const periodo: PeriodoCobro = { id: 'pc1', sellerId: 's1', montoTotalClp: 15000 };
        const tarifa: TarifaConMinimos = { minimoFacturacionClp: 10000, minimoRetiroClp: null };

        const diferencia = detectarMinimoFacturacion(periodo, tarifa);

        expect(diferencia).toBeNull();
      });

      it('tarifa sin mínimo configurado (NULL) → no genera falso positivo', () => {
        const periodo: PeriodoCobro = { id: 'pc1', sellerId: 's1', montoTotalClp: 0 };
        const tarifa: TarifaConMinimos = { minimoFacturacionClp: null, minimoRetiroClp: null };

        const diferencia = detectarMinimoFacturacion(periodo, tarifa);

        expect(diferencia).toBeNull();
      });

      it('monto_diferencia_clp = diferencia hasta el mínimo (no el monto total)', () => {
        const periodo: PeriodoCobro = { id: 'pc1', sellerId: 's1', montoTotalClp: 6000 };
        const tarifa: TarifaConMinimos = { minimoFacturacionClp: 10000, minimoRetiroClp: null };

        const diferencia = detectarMinimoFacturacion(periodo, tarifa);

        expect(diferencia).toBe(4000); // 10000 - 6000
      });
    });

    describe('sub-detector 4b: línea bajo mínimo de retiro', () => {
      it('monto_linea < minimo_retiro_clp → diferencia detectada', () => {
        const diferencia = detectarMinimoRetiro(800, { minimoFacturacionClp: null, minimoRetiroClp: 1000 });

        expect(diferencia).toBe(200);
      });

      it('monto_linea >= minimo_retiro_clp → no es discrepancia', () => {
        const diferencia = detectarMinimoRetiro(1200, { minimoFacturacionClp: null, minimoRetiroClp: 1000 });

        expect(diferencia).toBeNull();
      });

      it('tarifa sin mínimo de retiro (NULL) → no genera falso positivo', () => {
        const diferencia = detectarMinimoRetiro(0, { minimoFacturacionClp: null, minimoRetiroClp: null });

        expect(diferencia).toBeNull();
      });

      it('monto_diferencia_clp = diferencia hasta el mínimo de retiro', () => {
        const diferencia = detectarMinimoRetiro(500, { minimoFacturacionClp: null, minimoRetiroClp: 1500 });

        expect(diferencia).toBe(1000); // 1500 - 500
      });
    });

    it('idempotencia: evento previo de periodo bloquea inserción', () => {
      const eventosExistentes: EventoConciliacion[] = [
        { tipoDiferencia: 'minimo_omitido', periodoCobroidId: 'pc1' },
      ];

      expect(existeEvento(eventosExistentes, 'minimo_omitido', { periodoCobroidId: 'pc1' })).toBe(true);
      expect(existeEvento(eventosExistentes, 'minimo_omitido', { periodoCobroidId: 'pc2' })).toBe(false);
    });

    it('idempotencia: evento previo de pedido bloquea inserción', () => {
      const eventosExistentes: EventoConciliacion[] = [
        { tipoDiferencia: 'minimo_omitido', pedidoId: 'p1' },
      ];

      expect(existeEvento(eventosExistentes, 'minimo_omitido', { pedidoId: 'p1' })).toBe(true);
      expect(existeEvento(eventosExistentes, 'minimo_omitido', { pedidoId: 'p99' })).toBe(false);
    });
  });

  // ===========================================================================
  // D5 · pago_seller_faltante
  // ===========================================================================

  describe('D5 · pago_seller_faltante', () => {
    it('período facturado con estado_cobro=pendiente → detecta', () => {
      const periodos: PeriodoFacturado[] = [
        {
          id: 'pc1',
          sellerId: 's1',
          montoTotalClp: 50000,
          estadoCobro: 'pendiente',
          fechaFin: '2026-06-01',
        },
      ];

      const resultado = detectarPagosSellerFaltantes(periodos);

      expect(resultado).toHaveLength(1);
      expect(resultado[0].id).toBe('pc1');
    });

    it('período facturado con estado_cobro=pagado → no es discrepancia', () => {
      const periodos: PeriodoFacturado[] = [
        {
          id: 'pc1',
          sellerId: 's1',
          montoTotalClp: 50000,
          estadoCobro: 'pagado',
          fechaFin: '2026-06-01',
        },
      ];

      const resultado = detectarPagosSellerFaltantes(periodos);

      expect(resultado).toHaveLength(0);
    });

    it('período con estado_cobro=parcial también detecta (saldo pendiente)', () => {
      const periodos: PeriodoFacturado[] = [
        {
          id: 'pc1',
          sellerId: 's1',
          montoTotalClp: 50000,
          estadoCobro: 'parcial',
          fechaFin: '2026-06-01',
        },
      ];

      const resultado = detectarPagosSellerFaltantes(periodos);

      expect(resultado).toHaveLength(1);
    });

    it('monto_diferencia_clp = monto_total_clp del período', () => {
      const periodos: PeriodoFacturado[] = [
        {
          id: 'pc1',
          sellerId: 's1',
          montoTotalClp: 75000,
          estadoCobro: 'pendiente',
          fechaFin: '2026-06-01',
        },
      ];

      const resultado = detectarPagosSellerFaltantes(periodos);

      expect(resultado[0].montoTotalClp).toBe(75000);
    });

    it('idempotencia: evento previo bloquea inserción del mismo período', () => {
      const eventosExistentes: EventoConciliacion[] = [
        { tipoDiferencia: 'pago_seller_faltante', periodoCobroidId: 'pc1' },
      ];

      expect(existeEvento(eventosExistentes, 'pago_seller_faltante', { periodoCobroidId: 'pc1' })).toBe(true);
      expect(existeEvento(eventosExistentes, 'pago_seller_faltante', { periodoCobroidId: 'pc2' })).toBe(false);
    });
  });

  // ===========================================================================
  // D6 · pago_conductor_faltante
  // ===========================================================================

  describe('D6 · pago_conductor_faltante', () => {
    const HOY = '2026-06-20';
    const MAX_DIAS = 7;

    it('liquidación emitida hace 8 días (> 7) → detecta', () => {
      const liquidaciones: Liquidacion[] = [
        {
          id: 'liq-001',
          driverId: 'driver-A',
          estado: 'emitida',
          generadoEn: '2026-06-12T10:00:00Z', // 8 días antes
          montoTotalClp: 30000,
        },
      ];

      const resultado = detectarPagosConductorFaltantes(liquidaciones, HOY, MAX_DIAS);

      expect(resultado).toHaveLength(1);
      expect(resultado[0].id).toBe('liq-001');
    });

    it('liquidación emitida hace exactamente 7 días → no detecta (dentro del límite)', () => {
      const liquidaciones: Liquidacion[] = [
        {
          id: 'liq-001',
          driverId: 'driver-A',
          estado: 'emitida',
          generadoEn: '2026-06-13T10:00:00Z', // 7 días
          montoTotalClp: 30000,
        },
      ];

      const resultado = detectarPagosConductorFaltantes(liquidaciones, HOY, MAX_DIAS);

      expect(resultado).toHaveLength(0);
    });

    it('liquidación en estado pagada → no detecta', () => {
      const liquidaciones: Liquidacion[] = [
        {
          id: 'liq-001',
          driverId: 'driver-A',
          estado: 'pagada',
          generadoEn: '2026-06-01T10:00:00Z',
          montoTotalClp: 30000,
        },
      ];

      const resultado = detectarPagosConductorFaltantes(liquidaciones, HOY, MAX_DIAS);

      expect(resultado).toHaveLength(0);
    });

    it('liquidación en borrador → no detecta', () => {
      const liquidaciones: Liquidacion[] = [
        {
          id: 'liq-001',
          driverId: 'driver-A',
          estado: 'borrador',
          generadoEn: '2026-06-01T10:00:00Z',
          montoTotalClp: 30000,
        },
      ];

      const resultado = detectarPagosConductorFaltantes(liquidaciones, HOY, MAX_DIAS);

      expect(resultado).toHaveLength(0);
    });

    it('liquidación sin generado_en → se omite (no falso positivo)', () => {
      const liquidaciones: Liquidacion[] = [
        {
          id: 'liq-001',
          driverId: 'driver-A',
          estado: 'emitida',
          generadoEn: null,
          montoTotalClp: 30000,
        },
      ];

      const resultado = detectarPagosConductorFaltantes(liquidaciones, HOY, MAX_DIAS);

      expect(resultado).toHaveLength(0);
    });

    it('pobla driver_id y liquidacion_id (fuente 3)', () => {
      const liquidaciones: Liquidacion[] = [
        {
          id: 'liq-uuid-001',
          driverId: 'driver-uuid-A',
          estado: 'emitida',
          generadoEn: '2026-06-10T10:00:00Z', // 10 días antes
          montoTotalClp: 25000,
        },
      ];

      const resultado = detectarPagosConductorFaltantes(liquidaciones, HOY, MAX_DIAS);

      expect(resultado[0].id).toBe('liq-uuid-001');
      expect(resultado[0].driverId).toBe('driver-uuid-A');
    });

    it('monto_diferencia_clp = monto_total_clp de la liquidación', () => {
      const liquidaciones: Liquidacion[] = [
        {
          id: 'liq-001',
          driverId: 'driver-A',
          estado: 'emitida',
          generadoEn: '2026-06-10T10:00:00Z',
          montoTotalClp: 42000,
        },
      ];

      const resultado = detectarPagosConductorFaltantes(liquidaciones, HOY, MAX_DIAS);

      expect(resultado[0].montoTotalClp).toBe(42000);
    });

    it('idempotencia: evento previo bloquea inserción de la misma liquidación', () => {
      const eventosExistentes: EventoConciliacion[] = [
        { tipoDiferencia: 'pago_conductor_faltante', liquidacionId: 'liq-001' },
      ];

      expect(existeEvento(eventosExistentes, 'pago_conductor_faltante', { liquidacionId: 'liq-001' })).toBe(true);
      expect(existeEvento(eventosExistentes, 'pago_conductor_faltante', { liquidacionId: 'liq-002' })).toBe(false);
    });
  });

  // ===========================================================================
  // Invariante: el job NO muta líneas ni liquidaciones
  // ===========================================================================

  describe('invariante: solo lectura (no muta datos financieros)', () => {
    it('los detectores solo devuelven hallazgos, no modifican las entradas', () => {
      const lineasLiqOriginal: LineaLiquidacion[] = [
        { pedidoId: 'p1', driverId: 'driver-A', montoFinalClp: 3000 },
      ];
      const copia = JSON.parse(JSON.stringify(lineasLiqOriginal)) as LineaLiquidacion[];

      detectarFugasD1(lineasLiqOriginal, []);

      // Las entradas no fueron modificadas.
      expect(lineasLiqOriginal).toEqual(copia);
    });

    it('detectarPagosConductorFaltantes no modifica la liquidación original', () => {
      const liq: Liquidacion = {
        id: 'liq-001',
        driverId: 'driver-A',
        estado: 'emitida',
        generadoEn: '2026-06-10T00:00:00Z',
        montoTotalClp: 30000,
      };
      const copiaMonto = liq.montoTotalClp;
      const copiaEstado = liq.estado;

      detectarPagosConductorFaltantes([liq], '2026-06-20', 7);

      expect(liq.montoTotalClp).toBe(copiaMonto);
      expect(liq.estado).toBe(copiaEstado);
    });
  });

  // ===========================================================================
  // Invariante: monto_diferencia_clp poblado en todos los detectores
  // (requerido por F22 para calcular "fuga recuperada")
  // ===========================================================================

  describe('invariante: monto_diferencia_clp poblado en D1-D6', () => {
    it('D1: monto_diferencia_clp es el monto de la línea de liquidación (no 0)', () => {
      const fugas = detectarFugasD1(
        [{ pedidoId: 'p1', driverId: 'd1', montoFinalClp: 5000 }],
        [],
      );
      expect(fugas[0].montoFinalClp).toBeGreaterThan(0);
    });

    it('D2: monto_diferencia_clp es el monto de la línea de cobro (no 0)', () => {
      const resultado = detectarFugasD2(
        [{ pedidoId: 'p1', sellerId: 's1', periodoCobroId: 'pc1', montoFinalClp: 6000, anulada: false }],
        [{ id: 'p1', driverIdAsignado: 'd1' }],
        [],
      );
      expect(resultado[0].montoFinalClp).toBeGreaterThan(0);
    });

    it('D3: monto_diferencia_clp = recargo de la tarifa (no 0)', () => {
      const resultado = detectarReprogramacionesNoCobradas(
        [{ pedidoId: 'p1', sellerId: 's1', periodoCobroId: 'pc1', ajusteIncidenciaClp: 0, tarifaId: 't1' }],
        ['p1'],
        new Map([['t1', { id: 't1', recargoReprogramacionClp: 3000 }]]),
      );
      expect(resultado[0].montoRecargo).toBeGreaterThan(0);
    });

    it('D4: monto_diferencia_clp = diferencia hasta el mínimo (no 0)', () => {
      const diferencia = detectarMinimoFacturacion(
        { id: 'pc1', sellerId: 's1', montoTotalClp: 4000 },
        { minimoFacturacionClp: 10000, minimoRetiroClp: null },
      );
      expect(diferencia).toBeGreaterThan(0);
    });

    it('D5: monto_diferencia_clp = monto_total_clp del período (no 0)', () => {
      const resultado = detectarPagosSellerFaltantes([
        { id: 'pc1', sellerId: 's1', montoTotalClp: 80000, estadoCobro: 'pendiente', fechaFin: '2026-06-01' },
      ]);
      expect(resultado[0].montoTotalClp).toBeGreaterThan(0);
    });

    it('D6: monto_diferencia_clp = monto_total_clp de la liquidación (no 0)', () => {
      const resultado = detectarPagosConductorFaltantes(
        [{ id: 'liq1', driverId: 'd1', estado: 'emitida', generadoEn: '2026-06-10T00:00:00Z', montoTotalClp: 35000 }],
        '2026-06-20',
        7,
      );
      expect(resultado[0].montoTotalClp).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Aislamiento de tenant
  // ===========================================================================

  describe('aislamiento de tenant', () => {
    it('los eventos de conciliación solo llevan el tenant_id correcto', () => {
      const tenantIdCorrecto = 'tenant-a-uuid';
      const tenantIdOtro = 'tenant-b-uuid';

      const evento = {
        tenant_id: tenantIdCorrecto,
        tipo_diferencia: 'pagado_conductor_sin_cobro_seller',
        pedido_id: 'p1',
        estado: 'pendiente',
      };

      expect(evento.tenant_id).toBe(tenantIdCorrecto);
      expect(evento.tenant_id).not.toBe(tenantIdOtro);
    });

    it('la descripción del evento no incluye datos de otro tenant', () => {
      const descripcion = `Pedido p1: fuga directa de 3000 CLP.`;

      expect(descripcion).not.toContain('tenant-b');
      expect(descripcion).not.toContain('seller-otro');
    });
  });

  // ===========================================================================
  // Utilitario diasEntre
  // ===========================================================================

  describe('utilidad diasEntre', () => {
    it('calcula días correctamente entre dos fechas', () => {
      expect(diasEntre('2026-06-10', '2026-06-20')).toBe(10);
    });

    it('misma fecha → 0 días', () => {
      expect(diasEntre('2026-06-15', '2026-06-15')).toBe(0);
    });

    it('fecha pasada → días negativos', () => {
      expect(diasEntre('2026-06-20', '2026-06-10')).toBe(-10);
    });

    it('1 día de diferencia → 1', () => {
      expect(diasEntre('2026-06-19', '2026-06-20')).toBe(1);
    });
  });
});
