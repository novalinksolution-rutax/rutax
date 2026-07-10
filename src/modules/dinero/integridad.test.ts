/**
 * Tests del detector de integridad `linea_cobro_sin_pedido_entregado` (QW6).
 *
 * Se prueba el predicado puro `esLineaCobroHuerfana` — la regla de negocio que
 * decide qué línea de cobro activa es inconsistente — sin BD, como el resto de
 * los tests de detectores del repo.
 */

import { describe, it, expect } from 'vitest';
import { esLineaCobroHuerfana } from './integridad';

describe('esLineaCobroHuerfana — detector de líneas de cobro huérfanas', () => {
  it('pedido ausente (undefined) → huérfana (la línea no debe seguir viva)', () => {
    expect(esLineaCobroHuerfana(undefined)).toBe(true);
  });

  it('estados que NO deben tener cobro activo → huérfana', () => {
    for (const estado of ['devuelto', 'cancelado', 'pendiente_asignacion', 'asignado', 'en_ruta']) {
      expect(esLineaCobroHuerfana(estado), `estado=${estado}`).toBe(true);
    }
  });

  it('estados que SÍ pueden tener cobro legítimo → no huérfana (evita falsos positivos)', () => {
    // entregado/entregado_manual generan cobro; fallido/fallido_manual pueden
    // generarlo si la incidencia afecta el cobro — nunca se marcan huérfanas.
    for (const estado of ['entregado', 'entregado_manual', 'fallido', 'fallido_manual']) {
      expect(esLineaCobroHuerfana(estado), `estado=${estado}`).toBe(false);
    }
  });

  it('un estado desconocido no listado → no huérfana (conservador, no falso positivo)', () => {
    expect(esLineaCobroHuerfana('estado_inventado')).toBe(false);
  });
});
