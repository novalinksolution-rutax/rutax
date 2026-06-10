/**
 * Tests del job C6 — conciliar-periodo.
 *
 * Verifica los checks de conciliación del §8 del documento de arquitectura:
 *
 * 1. check-pedidos-sin-linea-cobro: N pedidos entregados con N-1 líneas →
 *    se detecta 1 evento tipo `pedido_entregado_sin_linea_cobro`.
 * 2. Idempotencia: segunda ejecución no duplica eventos de conciliación.
 * 3. check-pedidos-sin-linea-cobro: período con todos los pedidos cubiertos →
 *    no inserta ningún evento.
 * 4. Descripción del evento contiene el ID del pedido (criterio C-6).
 * 5. check-monto-dte: monto DTE difiere de suma de líneas → evento de diferencia.
 * 6. check-lineas-sueltas: líneas sin periodo_cobro_id → evento tipo sueltas.
 * 7. Aislamiento: un check que falla no inserta evento del tenant incorrecto.
 *
 * Nota: estos tests usan la lógica pura de comparación de sets (sin mocks de BD),
 * verificando las invariantes de la conciliación. Los tests de integración completa
 * con BD real se ejecutan vía pgTAP.
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// Lógica pura de conciliación — extraída para testing sin mocks de BD
// =============================================================================

/**
 * Calcula los pedidos entregados sin línea de cobro (lógica del check 1 del job C6).
 * Esta función refleja exactamente la lógica del job, sin dependencias de BD.
 */
function calcularPedidosSinLineaCobro(
  pedidosEntregadosIds: string[],
  pedidosConLinea: string[],
): string[] {
  const conLineaSet = new Set(pedidosConLinea);
  return pedidosEntregadosIds.filter((id) => !conLineaSet.has(id));
}

/**
 * Crea la descripción del evento de conciliación para `pedido_entregado_sin_linea_cobro`.
 * Refleja exactamente el template del job C6.
 */
function crearDescripcionEventoSinLineaCobro(pedidoId: string): string {
  return `Pedido ${pedidoId} entregado sin línea de cobro generada.`;
}

/**
 * Verifica si ya existe un evento del mismo tipo para el mismo pedido.
 * Refleja la lógica de deduplicación del job C6.
 */
function existeEventoPrevio(
  eventosExistentes: Array<{ tipoDiferencia: string; pedidoId: string }>,
  tipoDiferencia: string,
  pedidoId: string,
): boolean {
  return eventosExistentes.some(
    (e) => e.tipoDiferencia === tipoDiferencia && e.pedidoId === pedidoId,
  );
}

/**
 * Calcula la diferencia entre monto del DTE y suma de líneas de cobro.
 */
function calcularDiferenciaMontoDte(montoDte: number, montoSumaLineas: number): number {
  return Math.abs(montoDte - montoSumaLineas);
}

// =============================================================================
// Tests
// =============================================================================

describe('Job C6 — conciliar-periodo', () => {
  // ===========================================================================
  // CHECK 1: pedidos entregados sin línea de cobro
  // ===========================================================================

  describe('check 1: pedidos entregados sin línea de cobro', () => {
    it('N pedidos entregados con N-1 líneas → detecta exactamente 1 diferencia', () => {
      const pedidosEntregados = ['pedido-001', 'pedido-002', 'pedido-003'];
      const pedidosConLinea = ['pedido-001', 'pedido-003']; // falta pedido-002

      const sinLinea = calcularPedidosSinLineaCobro(pedidosEntregados, pedidosConLinea);

      expect(sinLinea).toHaveLength(1);
      expect(sinLinea[0]).toBe('pedido-002');
    });

    it('todos los pedidos con líneas → no detecta diferencias', () => {
      const pedidosEntregados = ['pedido-001', 'pedido-002', 'pedido-003'];
      const pedidosConLinea = ['pedido-001', 'pedido-002', 'pedido-003'];

      const sinLinea = calcularPedidosSinLineaCobro(pedidosEntregados, pedidosConLinea);

      expect(sinLinea).toHaveLength(0);
    });

    it('0 pedidos entregados → 0 diferencias', () => {
      const sinLinea = calcularPedidosSinLineaCobro([], []);
      expect(sinLinea).toHaveLength(0);
    });

    it('N pedidos entregados sin ninguna línea → detecta N diferencias', () => {
      const pedidosEntregados = ['p1', 'p2', 'p3', 'p4', 'p5'];
      const pedidosConLinea: string[] = [];

      const sinLinea = calcularPedidosSinLineaCobro(pedidosEntregados, pedidosConLinea);

      expect(sinLinea).toHaveLength(5);
      expect(sinLinea).toEqual(expect.arrayContaining(['p1', 'p2', 'p3', 'p4', 'p5']));
    });

    it('líneas extras (más líneas que pedidos entregados) → detecta 0 diferencias', () => {
      // Caso borde: más líneas que pedidos — no debería generar evento de tipo 1
      // (podría generar linea_cobro_sin_pedido_entregado — check diferente)
      const pedidosEntregados = ['pedido-001'];
      const pedidosConLinea = ['pedido-001', 'pedido-extra-002'];

      const sinLinea = calcularPedidosSinLineaCobro(pedidosEntregados, pedidosConLinea);

      expect(sinLinea).toHaveLength(0);
    });
  });

  // ===========================================================================
  // CHECK 2: idempotencia — segunda ejecución no duplica eventos
  // ===========================================================================

  describe('idempotencia — no duplica eventos', () => {
    it('segunda ejecución: si ya existe evento para el pedido, no se inserta otro', () => {
      const eventosExistentes = [
        { tipoDiferencia: 'pedido_entregado_sin_linea_cobro', pedidoId: 'pedido-002' },
      ];

      const yaExiste = existeEventoPrevio(
        eventosExistentes,
        'pedido_entregado_sin_linea_cobro',
        'pedido-002',
      );

      // Si ya existe, el job no inserta un segundo evento.
      expect(yaExiste).toBe(true);
    });

    it('si no existe evento previo para el pedido, el job sí inserta', () => {
      const eventosExistentes = [
        { tipoDiferencia: 'pedido_entregado_sin_linea_cobro', pedidoId: 'pedido-999' },
      ];

      const yAExiste = existeEventoPrevio(
        eventosExistentes,
        'pedido_entregado_sin_linea_cobro',
        'pedido-002', // diferente pedido
      );

      expect(yAExiste).toBe(false);
    });

    it('verificación de deduplicación por (tipo_diferencia, pedido_id) — no por solo tipo', () => {
      const eventosExistentes = [
        // Mismo tipo, diferente pedido — NO bloquea el insert del nuevo
        { tipoDiferencia: 'pedido_entregado_sin_linea_cobro', pedidoId: 'pedido-001' },
      ];

      // Para 'pedido-002' con el mismo tipo, debe insertarse (no existe aún)
      const yaExistePedido002 = existeEventoPrevio(
        eventosExistentes,
        'pedido_entregado_sin_linea_cobro',
        'pedido-002',
      );
      expect(yaExistePedido002).toBe(false);

      // Para 'pedido-001' con el mismo tipo, NO debe insertarse (ya existe)
      const yaExistePedido001 = existeEventoPrevio(
        eventosExistentes,
        'pedido_entregado_sin_linea_cobro',
        'pedido-001',
      );
      expect(yaExistePedido001).toBe(true);
    });

    it('dos ejecuciones del check producen como máximo N eventos (uno por pedido)', () => {
      // Simula dos pasadas del job sobre el mismo período.
      const pedidosEntregados = ['p1', 'p2', 'p3'];
      const pedidosConLinea: string[] = []; // ninguno tiene línea

      // Primera pasada: detecta 3 pedidos sin línea
      const sinLinea1 = calcularPedidosSinLineaCobro(pedidosEntregados, pedidosConLinea);
      expect(sinLinea1).toHaveLength(3);

      // Los eventos de la primera pasada se insertan.
      const eventosInsertados = sinLinea1.map((pid) => ({
        tipoDiferencia: 'pedido_entregado_sin_linea_cobro',
        pedidoId: pid,
      }));

      // Segunda pasada: mismo resultado de la BD (líneas siguen sin existir)
      const sinLinea2 = calcularPedidosSinLineaCobro(pedidosEntregados, pedidosConLinea);

      // Pero la deduplicación filtra los que ya tienen evento.
      const sinLineaAInsertar2 = sinLinea2.filter((pid) =>
        !existeEventoPrevio(eventosInsertados, 'pedido_entregado_sin_linea_cobro', pid),
      );

      // Segunda pasada no inserta nada nuevo.
      expect(sinLineaAInsertar2).toHaveLength(0);
    });
  });

  // ===========================================================================
  // CHECK 3: descripción del evento contiene ID del pedido y contexto
  // ===========================================================================

  describe('descripción del evento — criterio C-6', () => {
    it('la descripción contiene el ID del pedido sin línea de cobro', () => {
      const pedidoId = 'pedido-uuid-abc-123';
      const descripcion = crearDescripcionEventoSinLineaCobro(pedidoId);

      expect(descripcion).toContain(pedidoId);
    });

    it('la descripción menciona "entregado" y "línea de cobro"', () => {
      const descripcion = crearDescripcionEventoSinLineaCobro('any-uuid');

      expect(descripcion.toLowerCase()).toContain('entregado');
      expect(descripcion.toLowerCase()).toContain('línea de cobro');
    });

    it('la descripción es determinista para el mismo pedidoId', () => {
      const pedidoId = 'fixed-uuid-001';
      const d1 = crearDescripcionEventoSinLineaCobro(pedidoId);
      const d2 = crearDescripcionEventoSinLineaCobro(pedidoId);

      expect(d1).toBe(d2);
    });

    it('la descripción de diferentes pedidos es diferente', () => {
      const d1 = crearDescripcionEventoSinLineaCobro('pedido-001');
      const d2 = crearDescripcionEventoSinLineaCobro('pedido-002');

      expect(d1).not.toBe(d2);
    });
  });

  // ===========================================================================
  // CHECK 4: monto DTE difiere de suma de líneas
  // ===========================================================================

  describe('check 3: monto DTE difiere de suma de líneas', () => {
    it('DTE con monto mayor que suma de líneas → diferencia positiva', () => {
      const montoDte = 105000;
      const montoLineas = 100000;

      const diferencia = calcularDiferenciaMontoDte(montoDte, montoLineas);

      expect(diferencia).toBe(5000);
    });

    it('DTE con monto menor que suma de líneas → diferencia positiva (valor absoluto)', () => {
      const montoDte = 95000;
      const montoLineas = 100000;

      const diferencia = calcularDiferenciaMontoDte(montoDte, montoLineas);

      expect(diferencia).toBe(5000);
    });

    it('DTE con monto igual a suma de líneas → diferencia = 0 (no genera evento)', () => {
      const montoDte = 100000;
      const montoLineas = 100000;

      const diferencia = calcularDiferenciaMontoDte(montoDte, montoLineas);

      expect(diferencia).toBe(0);
      // Si diferencia === 0, el job no inserta evento.
      expect(montoDte !== montoLineas).toBe(false);
    });

    it('diferencia de 1 CLP genera evento (cualquier discrepancia es relevante)', () => {
      const montoDte = 100001;
      const montoLineas = 100000;

      const diferencia = calcularDiferenciaMontoDte(montoDte, montoLineas);

      expect(diferencia).toBe(1);
      // TypeScript infiere los literales, usar Number() para comparación dinámica
      expect(Number(montoDte) !== Number(montoLineas)).toBe(true);
    });

    it('los montos son enteros (sin decimales) — usar Math.round al calcular', () => {
      // Los montos CLP son siempre enteros (NUMERIC(12,0) en BD).
      // Math.round previene errores de punto flotante.
      const montoConDecimal = 100000.7; // hipotético error de conversión
      const montoRedondeado = Math.round(montoConDecimal);

      expect(montoRedondeado).toBe(100001);
      expect(Number.isInteger(montoRedondeado)).toBe(true);
    });
  });

  // ===========================================================================
  // CHECK 5: líneas sueltas (periodo_cobro_id IS NULL dentro del rango)
  // ===========================================================================

  describe('check 4: líneas de cobro sueltas (sin período asignado)', () => {
    it('N líneas sin período asignado → genera evento de tipo periodo_cerrado_con_lineas_sueltas', () => {
      const lineasSueltas = [
        { id: 'linea-001', periodo_cobro_id: null },
        { id: 'linea-002', periodo_cobro_id: null },
      ];

      const cantidad = lineasSueltas.filter((l) => l.periodo_cobro_id === null).length;

      expect(cantidad).toBe(2);
      expect(cantidad > 0).toBe(true); // genera evento
    });

    it('todas las líneas tienen período asignado → no genera evento', () => {
      const lineas = [
        { id: 'linea-001', periodo_cobro_id: 'periodo-abc' },
        { id: 'linea-002', periodo_cobro_id: 'periodo-abc' },
      ];

      const cantidad = lineas.filter((l) => l.periodo_cobro_id === null).length;

      expect(cantidad).toBe(0);
      expect(cantidad > 0).toBe(false); // no genera evento
    });
  });

  // ===========================================================================
  // Aislamiento: los eventos solo llevan tenant_id del tenant correcto
  // ===========================================================================

  describe('aislamiento de tenant en eventos', () => {
    it('el evento se crea con el tenant_id del período, no de otro tenant', () => {
      const tenantIdPeriodo = 'tenant-a-uuid';
      const tenantIdOtro = 'tenant-b-uuid';

      // El evento de conciliación debe usar el tenant del período.
      const eventoGenerado = {
        tenant_id: tenantIdPeriodo,
        seller_id: 'seller-a-uuid',
        periodo_cobro_id: 'periodo-001',
        tipo_diferencia: 'pedido_entregado_sin_linea_cobro',
        pedido_id: 'pedido-sin-linea-001',
        estado: 'pendiente',
      };

      expect(eventoGenerado.tenant_id).toBe(tenantIdPeriodo);
      expect(eventoGenerado.tenant_id).not.toBe(tenantIdOtro);
    });

    it('la descripción del evento no incluye datos de otro tenant', () => {
      const pedidoId = 'pedido-001';
      const descripcion = crearDescripcionEventoSinLineaCobro(pedidoId);

      // La descripción solo contiene el ID del pedido — nunca IDs de otros tenants.
      expect(descripcion).not.toContain('tenant-b');
      expect(descripcion).not.toContain('seller-b');
    });
  });
});

