/**
 * Pruebas del job G-06 — notificacion-incidencias-sin-gestion.
 *
 * Se prueba la lógica pura de detección (`filtrarIncidenciasSinGestion`,
 * `esIncidenciaSinGestion`, `horasDesde`), igual que `generar-lineas.test.ts`
 * prueba `evaluarElegibilidad` directamente — sin infraestructura de Supabase.
 *
 * La deduplicación por `(tenant_id, accion, entidad_tipo, entidad_id)` dentro
 * del mismo día (Santiago) y el registro en bitácora se verifican a nivel
 * pgTAP/integración; aquí se cubre la regla de negocio de "incidencia sin
 * gestión" que decide qué incidencias entran al paso 2.
 *
 * Casos cubiertos:
 * 1. Incidencia 'abierta' hace más de 4h → detectada como sin gestión.
 * 2. Incidencia 'abierta' dentro del umbral (< 4h) → NO detectada.
 * 3. Incidencia 'en_gestion' (independiente de cuánto tiempo lleve) → NO detectada.
 * 4. Tenant sin incidencias → lista vacía, sin notificaciones.
 */

import { describe, it, expect } from 'vitest';
import {
  esIncidenciaSinGestion,
  filtrarIncidenciasSinGestion,
  horasDesde,
  UMBRAL_INCIDENCIA_SIN_GESTION_HORAS,
  type IncidenciaParaNotificar,
} from './notificacion-incidencias-sin-gestion';

const TENANT_A = 'aaaa0000-0000-0000-0000-000000000001';
const TENANT_B = 'aaaa0000-0000-0000-0000-000000000002';

/** Devuelve un ISO string que representa `horas` horas atrás desde ahora. */
function hace(horas: number): string {
  return new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();
}

function incidencia(overrides: Partial<IncidenciaParaNotificar>): IncidenciaParaNotificar {
  return {
    id: 'incidencia-1',
    tenant_id: TENANT_A,
    seller_id: 'seller-1',
    pedido_id: 'pedido-1',
    tipo: 'destinatario_ausente',
    estado: 'abierta',
    abierta_en: hace(5),
    ...overrides,
  };
}

describe('Job G-06 — notificacion-incidencias-sin-gestion', () => {
  describe('horasDesde', () => {
    it('calcula correctamente las horas transcurridas', () => {
      const horas = horasDesde(hace(3));
      expect(horas).toBeGreaterThan(2.99);
      expect(horas).toBeLessThan(3.01);
    });
  });

  describe('esIncidenciaSinGestion', () => {
    it('incidencia abierta hace más de 4h → true', () => {
      expect(esIncidenciaSinGestion('abierta', hace(5))).toBe(true);
    });

    it('incidencia abierta dentro del umbral (< 4h) → false', () => {
      expect(esIncidenciaSinGestion('abierta', hace(2))).toBe(false);
    });

    it('incidencia en_gestion, sin importar cuánto tiempo, → false', () => {
      expect(esIncidenciaSinGestion('en_gestion', hace(48))).toBe(false);
    });

    it('justo en el umbral (no estrictamente mayor) → false', () => {
      expect(esIncidenciaSinGestion('abierta', hace(UMBRAL_INCIDENCIA_SIN_GESTION_HORAS))).toBe(false);
    });
  });

  describe('filtrarIncidenciasSinGestion', () => {
    it('caso 1: incidencia abierta sin gestión hace > 4h → detectada', () => {
      const incidencias = [
        incidencia({ id: 'inc-1', tenant_id: TENANT_A, estado: 'abierta', abierta_en: hace(5) }),
      ];

      const resultado = filtrarIncidenciasSinGestion(incidencias);

      expect(resultado).toHaveLength(1);
      expect(resultado[0].id).toBe('inc-1');
    });

    it('caso 2: incidencia dentro del umbral → NO detectada', () => {
      const incidencias = [
        incidencia({ id: 'inc-2', tenant_id: TENANT_A, estado: 'abierta', abierta_en: hace(1) }),
      ];

      const resultado = filtrarIncidenciasSinGestion(incidencias);

      expect(resultado).toHaveLength(0);
    });

    it('caso 3: incidencia en_gestion (aunque lleve mucho tiempo) → NO detectada', () => {
      const incidencias = [
        incidencia({ id: 'inc-3', tenant_id: TENANT_A, estado: 'en_gestion', abierta_en: hace(10) }),
      ];

      const resultado = filtrarIncidenciasSinGestion(incidencias);

      expect(resultado).toHaveLength(0);
    });

    it('caso 4: tenant sin incidencias → lista vacía', () => {
      const resultado = filtrarIncidenciasSinGestion([]);

      expect(resultado).toEqual([]);
    });

    it('mezcla de tenants e incidencias: solo se detectan las que superan el umbral', () => {
      const incidencias = [
        incidencia({ id: 'inc-a', tenant_id: TENANT_A, estado: 'abierta', abierta_en: hace(6) }),
        incidencia({ id: 'inc-b', tenant_id: TENANT_B, estado: 'abierta', abierta_en: hace(0.5) }),
        incidencia({ id: 'inc-c', tenant_id: TENANT_B, estado: 'en_gestion', abierta_en: hace(20) }),
        incidencia({ id: 'inc-d', tenant_id: TENANT_A, estado: 'abierta', abierta_en: hace(4.5) }),
      ];

      const resultado = filtrarIncidenciasSinGestion(incidencias);
      const ids = resultado.map((i) => i.id).sort();

      expect(ids).toEqual(['inc-a', 'inc-d']);
    });
  });
});
