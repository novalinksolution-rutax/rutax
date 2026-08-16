/**
 * Tests del job C1 — generar-lineas.
 *
 * Se prueban los comportamientos de idempotencia y la regla de cancelado
 * usando la función pura `evaluarElegibilidad` directamente (no el job Inngest
 * completo, que requiere infraestructura de Supabase). El motor es la unidad
 * testeable clave; la idempotencia en BD se verifica a nivel pgTAP.
 *
 * Tests cubiertos:
 * 1. Idempotencia: ejecutar con el mismo pedidoId dos veces → ON CONFLICT DO NOTHING.
 *    Verificado probando que evaluarElegibilidad con el mismo input produce el mismo
 *    output (función pura), y que el concepto de idempotencia se cumple.
 * 2. pedido.estado = 'cancelado' → generaCobro: false, generaLiquidacion: false → no inserta nada.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluarElegibilidad, evaluarMotivoElegibilidad, construirSnapshotRegla } from '../motor';
import type { EntradaMotor, TarifaSnapshotInput, IncidenciaSnapshotInput } from '../motor';
import { decidirReatribucionLiquidacion } from '../reatribucion-liquidacion';
import { ESTADOS_NO_TERMINALES_CONCILIACION } from '../conciliacion-clasificacion';
import type { crearClienteServiceRole } from '@/lib/supabase/service-role';

// `levantarExcepcionLineaNoAnulable` (H2) llama a `registrarEnBitacora` — se
// mockea igual que en `acciones-anular-lineas.test.ts` para poder verificar
// el ORDEN bitácora→INSERT sin tocar Supabase real. El `supabase` que recibe
// la función SÍ se pasa como doble de prueba directo (no via
// `crearClienteServiceRole()`), así que no hace falta mockear ese módulo.
vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import {
  derivarMotivoAnulacion,
  derivarAccionBitacoraAnulacion,
  levantarExcepcionLineaNoAnulable,
} from './generar-lineas';

describe('Job C1 — generar-lineas', () => {
  // =========================================================================
  // Idempotencia: el mismo input produce siempre el mismo output
  // =========================================================================
  describe('idempotencia', () => {
    it('ejecutar evaluarElegibilidad dos veces con el mismo input produce el mismo resultado', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'entregado',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      };

      const resultado1 = evaluarElegibilidad(entrada);
      const resultado2 = evaluarElegibilidad(entrada);

      // Una función pura produce siempre el mismo output — idempotencia garantizada
      expect(resultado1).toEqual(resultado2);
    });

    it('pedido en estado entregado con conductor: dos invocaciones producen mismos flags', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'entregado',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      };

      // Primera invocación
      const r1 = evaluarElegibilidad(entrada);
      expect(r1.generaCobro).toBe(true);
      expect(r1.generaLiquidacion).toBe(true);

      // Segunda invocación (simula reintento del job) — mismo resultado
      const r2 = evaluarElegibilidad(entrada);
      expect(r2.generaCobro).toBe(r1.generaCobro);
      expect(r2.generaLiquidacion).toBe(r1.generaLiquidacion);

      // En BD el ON CONFLICT (pedido_id) DO NOTHING absorbe el segundo INSERT.
      // El job no tiene que preguntar si ya existe — Postgres lo dice con el conflicto.
    });

    it('pedido en estado entregado sin conductor: dos invocaciones idempotentes', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'entregado',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: false,
      };

      const r1 = evaluarElegibilidad(entrada);
      const r2 = evaluarElegibilidad(entrada);

      expect(r1).toEqual(r2);
      expect(r1.generaCobro).toBe(true);
      expect(r1.generaLiquidacion).toBe(false);
    });
  });

  // =========================================================================
  // Regla: pedido cancelado → no inserta líneas
  // =========================================================================
  describe('pedido cancelado — no genera nada', () => {
    it('cancelado → generaCobro=false, generaLiquidacion=false → no inserta líneas', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'cancelado',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: true, // incluso con conductor: cancelado no genera nada
      };

      const resultado = evaluarElegibilidad(entrada);

      // El job usa estos flags para decidir si hace el INSERT.
      // Si ambos son false → no inserta en lineas_cobro ni en lineas_liquidacion.
      expect(resultado.generaCobro).toBe(false);
      expect(resultado.generaLiquidacion).toBe(false);
    });

    it('cancelado sin conductor → generaCobro=false, generaLiquidacion=false', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'cancelado',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: false,
      };

      const resultado = evaluarElegibilidad(entrada);

      expect(resultado.generaCobro).toBe(false);
      expect(resultado.generaLiquidacion).toBe(false);
    });

    it('cancelado con esGastoPropio=true → sigue sin generar nada', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'cancelado',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: true,
        tieneDriverAsignado: true,
      };

      const resultado = evaluarElegibilidad(entrada);

      expect(resultado.generaCobro).toBe(false);
      expect(resultado.generaLiquidacion).toBe(false);
    });
  });

  // =========================================================================
  // Regla: devuelto también no genera nada
  // =========================================================================
  describe('pedido devuelto — no genera nada', () => {
    it('devuelto → generaCobro=false, generaLiquidacion=false', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'devuelto',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      };

      const resultado = evaluarElegibilidad(entrada);

      expect(resultado.generaCobro).toBe(false);
      expect(resultado.generaLiquidacion).toBe(false);
    });
  });

  // =========================================================================
  // Regla: fallido con afectaCobro=null (sin incidencia) → no cobra
  // =========================================================================
  describe('fallido sin incidencia', () => {
    it('fallido con afectaCobro=null → no genera cobro (incidencia sin datos)', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'fallido',
        afectaCobro: null,   // null = incidencia no tiene ese campo definido
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      };

      const resultado = evaluarElegibilidad(entrada);

      // null !== true → no genera cobro
      expect(resultado.generaCobro).toBe(false);
      // null !== true → no genera liquidación
      expect(resultado.generaLiquidacion).toBe(false);
    });
  });

  // =========================================================================
  // Regla: tarifaAplicableId nula → monto_base = 0, no crashea
  // Esta es la especificación del job C1: si no hay tarifa, el monto queda en 0.
  // El motor en sí es agnóstico al monto; la lógica de fallback al 0 vive en
  // el job. Aquí verificamos que el motor retorna los flags de elegibilidad
  // correctos independientemente del monto — la cobertura de "sin tarifa"
  // se verifica comprobando que evaluarElegibilidad no crashea y que los flags
  // son correctos (la inserción en BD usará monto_base=0).
  // =========================================================================
  describe('tarifa nula (tarifaAplicableId = null)', () => {
    it('entregado sin tarifa → motor devuelve generaCobro=true (monto_base=0 es responsabilidad del job)', () => {
      // El motor puro no conoce el monto; solo decide elegibilidad.
      // El job C1 ya maneja tarifaAplicableId=null poniendo montoCobroBase=0.
      const entrada: EntradaMotor = {
        estadoPedido: 'entregado',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      };

      // No debe lanzar ningún error — la función es pura y no requiere tarifa.
      expect(() => evaluarElegibilidad(entrada)).not.toThrow();

      const resultado = evaluarElegibilidad(entrada);
      // El motor sí indica "genera cobro" — el monto 0 lo resuelve el job C1.
      expect(resultado.generaCobro).toBe(true);
      expect(resultado.generaLiquidacion).toBe(true);
    });

    it('fallido sin tarifa → motor evalúa por afecta_cobro/afecta_liquidacion', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'fallido',
        afectaCobro: true,
        afectaLiquidacion: true,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      };

      expect(() => evaluarElegibilidad(entrada)).not.toThrow();

      const resultado = evaluarElegibilidad(entrada);
      expect(resultado.generaCobro).toBe(true);
      expect(resultado.generaLiquidacion).toBe(true);
    });
  });

  // =========================================================================
  // Idempotencia de flags: segunda ejecución con estado ya generado
  // En el job C1, el paso 'actualizar-flags-pedido' usa
  //   WHERE cobro_generado = false
  // para no sobreescribir si ya fue procesado.
  // Aquí verificamos la propiedad semántica: el valor calculado de
  // generaCobro/generaLiquidacion es idempotente para el mismo pedido.
  // =========================================================================
  describe('idempotencia de flags de generación', () => {
    it('segunda invocación con mismo pedido entregado produce los mismos flags → ON CONFLICT absorbe', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'entregado',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      };

      const r1 = evaluarElegibilidad(entrada);
      const r2 = evaluarElegibilidad(entrada); // simula segundo disparo del evento

      // Mismos flags → el UPDATE con WHERE cobro_generado=false no afectará filas ya procesadas.
      expect(r1.generaCobro).toBe(r2.generaCobro);
      expect(r1.generaLiquidacion).toBe(r2.generaLiquidacion);
      expect(r1.ajusteCobroCLP).toBe(r2.ajusteCobroCLP);
      expect(r1.ajusteLiquidacionCLP).toBe(r2.ajusteLiquidacionCLP);
    });

    it('segunda invocación con fallido afecta_cobro=true es idempotente', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'fallido',
        afectaCobro: true,
        afectaLiquidacion: false,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      };

      expect(evaluarElegibilidad(entrada)).toEqual(evaluarElegibilidad(entrada));
    });

    it('cancelado sigue siendo cancelado en dos invocaciones (flags siempre false)', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'cancelado',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      };

      const r1 = evaluarElegibilidad(entrada);
      const r2 = evaluarElegibilidad(entrada);

      // Ninguna línea se insertar → ON CONFLICT no aplica, pero los flags son
      // consistentemente false en ambas invocaciones.
      expect(r1).toEqual(r2);
      expect(r1.generaCobro).toBe(false);
      expect(r1.generaLiquidacion).toBe(false);
    });
  });

  // =========================================================================
  // Regla de no duplicar cobro en reintentos fallidos
  // El job usa ON CONFLICT (pedido_id) DO NOTHING — esto garantiza que aunque
  // el job se ejecute N veces, solo existe una fila en lineas_cobro y una en
  // lineas_liquidacion por pedido. Aquí lo verificamos a nivel de contrato del motor.
  // =========================================================================
  describe('no duplicar cobro en reintentos', () => {
    it('el mismo pedido fallido con afecta_cobro=true ejecutado N veces produce exactamente una decisión de cobro', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'fallido',
        afectaCobro: true,
        afectaLiquidacion: true,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      };

      // Si el motor fuera no-puro (e.g., acumulara estado) este array tendría
      // valores distintos. Al ser pura, todos los resultados son iguales → ON CONFLICT
      // en BD absorbe los INSERTs duplicados correctamente.
      const resultados = Array.from({ length: 5 }, () => evaluarElegibilidad(entrada));
      const primerResultado = resultados[0];
      for (const r of resultados) {
        expect(r).toEqual(primerResultado);
      }
    });

    it('devuelto no genera cobro en ningún reintento', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'devuelto',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      };

      // Todos los reintentos producen generaCobro=false → el job no intenta INSERT.
      const resultados = Array.from({ length: 3 }, () => evaluarElegibilidad(entrada));
      for (const r of resultados) {
        expect(r.generaCobro).toBe(false);
        expect(r.generaLiquidacion).toBe(false);
      }
    });
  });
});

// =============================================================================
// Reglas de anulación pre-cierre (flujo fallido → devuelto)
//
// El job C1 anula líneas existentes cuando estadoNuevo='devuelto' y ya existe
// línea generada. Las reglas de elegibilidad del MOTOR son la base de esta
// lógica: si generaCobro=false y generaLiquidacion=false → el job busca líneas
// existentes y las anula (si el período/liquidación está en estado mutable).
//
// Los tests de BD (idempotencia de anulación, guarda de período cerrado) viven
// en pgTAP (supabase/tests/database/). Aquí probamos la función pura del motor.
// =============================================================================

describe('Flujo fallido → devuelto — reglas de elegibilidad que disparan anulación', () => {
  describe('devuelto siempre tiene generaCobro=false y generaLiquidacion=false', () => {
    it('devuelto con conductor asignado → no genera líneas nuevas', () => {
      const resultado = evaluarElegibilidad({
        estadoPedido: 'devuelto',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      });
      // El motor indica "no generar" → el job procederá a buscar/anular líneas previas.
      expect(resultado.generaCobro).toBe(false);
      expect(resultado.generaLiquidacion).toBe(false);
    });

    it('devuelto sin conductor → tampoco genera', () => {
      const resultado = evaluarElegibilidad({
        estadoPedido: 'devuelto',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: false,
      });
      expect(resultado.generaCobro).toBe(false);
      expect(resultado.generaLiquidacion).toBe(false);
    });

    it('devuelto con esGastoPropio=true → tampoco genera cobro ni liquidación', () => {
      // El gasto propio nunca cobra al seller, pero devuelto tampoco genera liquidación.
      const resultado = evaluarElegibilidad({
        estadoPedido: 'devuelto',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: true,
        tieneDriverAsignado: true,
      });
      expect(resultado.generaCobro).toBe(false);
      expect(resultado.generaLiquidacion).toBe(false);
    });
  });

  describe('contraste: fallido SÍ puede generar líneas (las que luego se anulan)', () => {
    it('fallido con afecta_cobro=true y afecta_liquidacion=true → genera cobro Y liquidación', () => {
      // Este es el evento ANTERIOR (fallido) que crea las líneas.
      // El evento POSTERIOR (devuelto) las anulará si el período sigue abierto.
      const resultado = evaluarElegibilidad({
        estadoPedido: 'fallido',
        afectaCobro: true,
        afectaLiquidacion: true,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      });
      expect(resultado.generaCobro).toBe(true);
      expect(resultado.generaLiquidacion).toBe(true);
    });

    it('fallido_manual con afecta_cobro=true → genera cobro; devuelto posterior los anulará', () => {
      const resultadoFallido = evaluarElegibilidad({
        estadoPedido: 'fallido_manual',
        afectaCobro: true,
        afectaLiquidacion: false,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      });
      expect(resultadoFallido.generaCobro).toBe(true);
      expect(resultadoFallido.generaLiquidacion).toBe(false);

      // Cuando llega el devuelto, el motor dice "no generar nada" → job anula lo de arriba.
      const resultadoDevuelto = evaluarElegibilidad({
        estadoPedido: 'devuelto',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      });
      expect(resultadoDevuelto.generaCobro).toBe(false);
      expect(resultadoDevuelto.generaLiquidacion).toBe(false);
    });
  });

  describe('idempotencia del motor para el evento devuelto (reintentos del job)', () => {
    it('devuelto ejecutado N veces produce siempre generaCobro=false (anulación no se re-aplica si ya anulada)', () => {
      const entrada: EntradaMotor = {
        estadoPedido: 'devuelto',
        afectaCobro: null,
        afectaLiquidacion: null,
        esGastoPropio: false,
        tieneDriverAsignado: true,
      };
      // Función pura — mismos resultados en todos los intentos.
      // En BD el UPDATE con WHERE anulada=false es idempotente: el segundo intento
      // no afecta filas (ya está anulada=true) → no-op correcto.
      const resultados = Array.from({ length: 4 }, () => evaluarElegibilidad(entrada));
      for (const r of resultados) {
        expect(r.generaCobro).toBe(false);
        expect(r.generaLiquidacion).toBe(false);
      }
    });
  });
});

// =============================================================================
// Snapshot inmutable de la regla económica (hallazgo P0 de auditoría) — el
// job escribe `snapshot_regla` en el MISMO INSERT/UPDATE que determina
// monto_base_clp/ajuste_incidencia_clp, en los 4 caminos de escritura:
//   1. generar-linea-cobro       → INSERT nuevo
//   2. generar-linea-cobro       → UPDATE de reactivación (existente.anulada)
//   3. generar-linea-liquidacion → INSERT nuevo
//   4. generar-linea-liquidacion → UPDATE de reactivación (existente.anulada)
//
// El job arma el snapshot UNA sola vez por step con `construirSnapshotRegla`
// y reutiliza el MISMO objeto tanto para el INSERT como para la reactivación
// (mismas variables `montoBase`/`ajuste`/`concepto` que ya usaba el código
// existente) — por eso los pares 1/2 y 3/4 aquí comparten el mismo insumo:
// lo que se prueba es que el contenido del envelope es correcto para el
// contexto de cada camino, no que existan dos construcciones distintas.
// =============================================================================
describe('snapshot_regla — contenido escrito en los 4 caminos del job', () => {
  const jobRunId = 'run-test-c1';
  const generadoEn = '2026-07-07T15:00:00.000Z';
  const fechaTransicion = '2026-07-07T14:30:00.000Z';
  const fechaEntregaLocal = '2026-07-07';

  const tarifaFlex: TarifaSnapshotInput = {
    tarifaId: 'tarifa-flex-1',
    tipoEntrega: 'flex',
    modoCalculo: 'monto_fijo',
    zona: 'Zona Poniente',
    zonaId: 'zona-poniente-1',
    vigenteDesde: '2026-01-01',
    vigenteHasta: null,
    estado: 'activa',
    minimoRetiroClp: null,
    minimoFacturacionClp: null,
    recargoReprogramacionClp: 1200,
  };

  // -----------------------------------------------------------------------
  // Camino 1: generar-linea-cobro → INSERT nuevo (pedido entregado normal)
  // -----------------------------------------------------------------------
  it('camino 1 — INSERT nuevo cobro: snapshot con motivo ENTREGADO_GENERA_COBRO y valor_base_clp = monto_clp', () => {
    const entradaMotor: EntradaMotor = {
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };
    const elegibilidad = evaluarElegibilidad(entradaMotor);
    const motivos = evaluarMotivoElegibilidad(entradaMotor);
    expect(elegibilidad.generaCobro).toBe(true); // precondición: este es el único camino en que el job llega al INSERT

    const montoCobroBase = 3800;
    const snapshotCobro = construirSnapshotRegla({
      lado: 'cobro',
      jobRunId,
      generadoEn,
      tarifa: tarifaFlex,
      valorBaseClp: montoCobroBase,
      ajusteIncidenciaClp: elegibilidad.ajusteCobroCLP,
      comunaDestinatario: 'Maipú',
      fechaTransicion,
      fechaEntregaLocal,
      estadoNuevo: 'entregado',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'flex',
      esGastoPropio: false,
      incidencia: null,
      motivo: motivos.cobro,
      genera: true,
    });

    expect(snapshotCobro.origen_snapshot).toBe('generacion_original');
    expect((snapshotCobro.regla as { regla_id: string }).regla_id).toBe('ENTREGADO_GENERA_COBRO');
    expect((snapshotCobro.tarifa as { valor_base_clp: number }).valor_base_clp).toBe(montoCobroBase);
    expect((snapshotCobro.elegibilidad as { genera: boolean; ajuste_clp: number }).genera).toBe(true);
    expect((snapshotCobro.elegibilidad as { ajuste_clp: number }).ajuste_clp).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Camino 2: generar-linea-cobro → UPDATE de reactivación tras anulación
  // (reclasificación B1: una incidencia que ahora SÍ afecta el cobro)
  // -----------------------------------------------------------------------
  it('camino 2 — reactivación cobro tras anulación: snapshot refleja la nueva incidencia (motivo FALLIDO_INCIDENCIA_AFECTA_COBRO)', () => {
    const entradaMotor: EntradaMotor = {
      estadoPedido: 'fallido',
      afectaCobro: true,
      afectaLiquidacion: false,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };
    const elegibilidad = evaluarElegibilidad(entradaMotor);
    const motivos = evaluarMotivoElegibilidad(entradaMotor);
    expect(elegibilidad.generaCobro).toBe(true); // precondición: reactivación solo ocurre si genera === true

    const incidenciaReclasificada: IncidenciaSnapshotInput = {
      id: 'incidencia-reclasificada-1',
      tipo: 'destinatario_ausente',
      afectaCobro: true,
      afectaLiquidacion: false,
    };

    const snapshotCobro = construirSnapshotRegla({
      lado: 'cobro',
      jobRunId,
      generadoEn,
      tarifa: tarifaFlex,
      valorBaseClp: 3800,
      ajusteIncidenciaClp: elegibilidad.ajusteCobroCLP,
      comunaDestinatario: 'Maipú',
      fechaTransicion,
      fechaEntregaLocal,
      estadoNuevo: 'fallido',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'flex',
      esGastoPropio: false,
      incidencia: incidenciaReclasificada,
      motivo: motivos.cobro,
      genera: true,
    });

    // Aunque la escritura sea un UPDATE (reactivación), el envelope sigue
    // marcado 'generacion_original' — no es el backfill de la migración.
    expect(snapshotCobro.origen_snapshot).toBe('generacion_original');
    expect((snapshotCobro.regla as { regla_id: string }).regla_id).toBe('FALLIDO_INCIDENCIA_AFECTA_COBRO');
    expect(snapshotCobro.incidencia).toEqual({
      incidencia_id: 'incidencia-reclasificada-1',
      tipo: 'destinatario_ausente',
      afecta_cobro: true,
      afecta_liquidacion: false,
    });
  });

  // -----------------------------------------------------------------------
  // Camino 3: generar-linea-liquidacion → INSERT nuevo
  // -----------------------------------------------------------------------
  it('camino 3 — INSERT nuevo liquidación: valor_base_clp = monto_conductor_clp, recargos_descuentos SOLO ajuste_incidencia_clp', () => {
    const entradaMotor: EntradaMotor = {
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };
    const elegibilidad = evaluarElegibilidad(entradaMotor);
    const motivos = evaluarMotivoElegibilidad(entradaMotor);
    expect(elegibilidad.generaLiquidacion).toBe(true);

    const montoConductorBase = 2600;
    const snapshotLiquidacion = construirSnapshotRegla({
      lado: 'liquidacion',
      jobRunId,
      generadoEn,
      tarifa: tarifaFlex,
      valorBaseClp: montoConductorBase,
      ajusteIncidenciaClp: elegibilidad.ajusteLiquidacionCLP,
      comunaDestinatario: 'Maipú',
      fechaTransicion,
      fechaEntregaLocal,
      estadoNuevo: 'entregado',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'flex',
      esGastoPropio: false,
      incidencia: null,
      motivo: motivos.liquidacion,
      genera: true,
    });

    expect((snapshotLiquidacion.regla as { regla_id: string }).regla_id).toBe('ENTREGADO_GENERA_LIQUIDACION');
    expect((snapshotLiquidacion.tarifa as { valor_base_clp: number }).valor_base_clp).toBe(montoConductorBase);
    expect(snapshotLiquidacion.recargos_descuentos).toEqual({ ajuste_incidencia_clp: 0 });
    expect(snapshotLiquidacion.recargos_descuentos).not.toHaveProperty('minimo_retiro_clp');
    expect(snapshotLiquidacion.recargos_descuentos).not.toHaveProperty('recargo_reprogramacion_pactado_clp');
  });

  // -----------------------------------------------------------------------
  // Camino 4: generar-linea-liquidacion → UPDATE de reactivación tras anulación
  // -----------------------------------------------------------------------
  it('camino 4 — reactivación liquidación tras anulación: snapshot refleja motivo FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION', () => {
    const entradaMotor: EntradaMotor = {
      estadoPedido: 'fallido',
      afectaCobro: false,
      afectaLiquidacion: true,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };
    const elegibilidad = evaluarElegibilidad(entradaMotor);
    const motivos = evaluarMotivoElegibilidad(entradaMotor);
    expect(elegibilidad.generaLiquidacion).toBe(true); // precondición: reactivación solo ocurre si genera === true

    const incidenciaReclasificada: IncidenciaSnapshotInput = {
      id: 'incidencia-reclasificada-2',
      tipo: 'entrega_parcial',
      afectaCobro: false,
      afectaLiquidacion: true,
    };

    const snapshotLiquidacion = construirSnapshotRegla({
      lado: 'liquidacion',
      jobRunId,
      generadoEn,
      tarifa: tarifaFlex,
      valorBaseClp: 2600,
      ajusteIncidenciaClp: elegibilidad.ajusteLiquidacionCLP,
      comunaDestinatario: 'Maipú',
      fechaTransicion,
      fechaEntregaLocal,
      estadoNuevo: 'fallido',
      estadoAnterior: 'en_ruta',
      tipoPedido: 'flex',
      esGastoPropio: false,
      incidencia: incidenciaReclasificada,
      motivo: motivos.liquidacion,
      genera: true,
    });

    expect(snapshotLiquidacion.origen_snapshot).toBe('generacion_original');
    expect((snapshotLiquidacion.regla as { regla_id: string }).regla_id).toBe('FALLIDO_INCIDENCIA_AFECTA_LIQUIDACION');
    expect(snapshotLiquidacion.incidencia).toEqual({
      incidencia_id: 'incidencia-reclasificada-2',
      tipo: 'entrega_parcial',
      afecta_cobro: false,
      afecta_liquidacion: true,
    });
  });

  // -----------------------------------------------------------------------
  // tarifaAplicableId ausente — el job pasa tarifa: null; el snapshot no
  // debe crashear y debe reflejar tarifa_id null (monto_base=0 es
  // responsabilidad del job, ver test de "tarifa nula" más arriba).
  // -----------------------------------------------------------------------
  it('sin tarifa aplicable → snapshot con tarifa_id null, no crashea', () => {
    const entradaMotor: EntradaMotor = {
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true,
    };
    const motivos = evaluarMotivoElegibilidad(entradaMotor);

    expect(() =>
      construirSnapshotRegla({
        lado: 'cobro',
        jobRunId,
        generadoEn,
        tarifa: null,
        valorBaseClp: 0,
        ajusteIncidenciaClp: 0,
        comunaDestinatario: null,
        fechaTransicion,
        fechaEntregaLocal,
        estadoNuevo: 'entregado',
        estadoAnterior: 'en_ruta',
        tipoPedido: 'flex',
        esGastoPropio: false,
        incidencia: null,
        motivo: motivos.cobro,
        genera: true,
      }),
    ).not.toThrow();
  });
});

// =============================================================================
// BUG "Pedro entrega, Juan cobra" — re-atribución de la línea de liquidación
// cuando el conductor del evento actual difiere del `driver_id` de la línea
// ya existente (conflicto del UNIQUE(pedido_id) en `generar-linea-liquidacion`).
//
// Los 6 casos de `decidirReatribucionLiquidacion` en sí se prueban en
// `../reatribucion-liquidacion.test.ts` (módulo puro, test dedicado — mismo
// patrón que `motor.test.ts` para `motor.ts`). Aquí se prueba el CAMINO
// COMPLETO reproducido con el código de hoy (`maquina-estados.ts:78` permite
// fallido → asignado; `dialog-reasignacion.tsx` reasigna):
//   1. Pedido llega a `fallido` con incidencia afecta_liquidacion=true,
//      conductor A asignado → C1 genera línea de liquidación a nombre de A.
//   2. El pedido vuelve a `asignado` (transición operativa, NO financiera —
//      no dispara C1) y se reasigna al conductor B.
//   3. B entrega → estado `entregado` → C1 vuelve a correr, choca con el
//      UNIQUE(pedido_id): existe la línea de A.
//   4. El job usa `decidirReatribucionLiquidacion` para resolver el conflicto.
// =============================================================================
describe('Camino completo fallido → asignado → reasignación → entregado', () => {
  it('el motor genera liquidación al conductor A en el fallido, y el job re-atribuye a B cuando B entrega (liquidación de A en borrador)', () => {
    // Paso 1: pedido `fallido`, incidencia afecta_liquidacion=true, conductor A.
    const entradaFallido: EntradaMotor = {
      estadoPedido: 'fallido',
      afectaCobro: false,
      afectaLiquidacion: true,
      esGastoPropio: false,
      tieneDriverAsignado: true, // conductor A
    };
    const resultadoFallido = evaluarElegibilidad(entradaFallido);
    // El motor SÍ genera liquidación para el conductor A — esta es la línea
    // que después queda "huérfana" si nadie la re-atribuye.
    expect(resultadoFallido.generaLiquidacion).toBe(true);
    expect(resultadoFallido.generaCobro).toBe(false);

    // Paso 2: `asignado` no es un estado financieramente relevante — el job
    // C1 no corre (no hay evaluarElegibilidad para `asignado`). El pedido se
    // reasigna de A a B por fuera del motor de dinero (operacion/pedidos.ts).

    // Paso 3: B entrega → `entregado`, con conductor B.
    const entradaEntregado: EntradaMotor = {
      estadoPedido: 'entregado',
      afectaCobro: null,
      afectaLiquidacion: null,
      esGastoPropio: false,
      tieneDriverAsignado: true, // conductor B
    };
    const resultadoEntregado = evaluarElegibilidad(entradaEntregado);
    expect(resultadoEntregado.generaCobro).toBe(true);
    expect(resultadoEntregado.generaLiquidacion).toBe(true);

    // Paso 4: C1 vuelve a correr para el mismo pedido_id. El INSERT choca con
    // la línea de A (UNIQUE pedido_id). La liquidación de A sigue en
    // 'borrador' → el job SÍ puede corregir la atribución a B.
    const decision = decidirReatribucionLiquidacion({
      driverIdLineaExistente: 'conductor-A',
      driverIdEvento: 'conductor-B',
      liquidacionIdExistente: 'liquidacion-A-periodo-actual',
      estadoLiquidacionExistente: 'borrador',
    });
    expect(decision).toBe('reatribuir');
    // Con el código ANTERIOR al fix, este mismo conflicto devolvía la línea
    // de A sin comparar driver_id — "B entrega, A cobra" quedaba en silencio.
  });

  it('si la liquidación de A ya se emitió antes de que B entregue, el job NO reatribuye — queda excepción', () => {
    // Mismo camino que el test anterior, pero la liquidación de A alcanzó a
    // emitirse (p.ej. cerró el período de liquidación) antes de que B
    // entregara. La compuerta humana manda: ni se paga a B automáticamente,
    // ni se le quita el pago a A en silencio.
    const decision = decidirReatribucionLiquidacion({
      driverIdLineaExistente: 'conductor-A',
      driverIdEvento: 'conductor-B',
      liquidacionIdExistente: 'liquidacion-A-emitida',
      estadoLiquidacionExistente: 'emitida',
    });
    expect(decision).toBe('excepcion');
  });
});

// =============================================================================
// Fidelidad de la anulación (H1, docs/arquitectura/edicion-y-cancelacion-de-pedidos.md
// §2.4 D-A4). El paso 'anular-lineas-si-devolucion' se dispara para
// estadoNuevo='devuelto' Y para estadoNuevo='cancelado' (ambos hacen
// !generaCobro && !generaLiquidacion), pero antes de este fix el motivo y la
// acción de bitácora quedaban hardcodeados a 'devolucion' sin importar cuál de
// los dos fue realmente. `derivarMotivoAnulacion`/`derivarAccionBitacoraAnulacion`
// son las funciones puras que el job usa en los 4 puntos de escritura (bitácora +
// UPDATE, para lineas_cobro y lineas_liquidacion).
// =============================================================================
describe('derivarMotivoAnulacion / derivarAccionBitacoraAnulacion — fidelidad H1', () => {
  it("estadoNuevo='cancelado' → motivo 'cancelacion'", () => {
    expect(derivarMotivoAnulacion('cancelado')).toBe('cancelacion');
  });

  it("estadoNuevo='devuelto' → motivo 'devolucion' (sin cambios)", () => {
    expect(derivarMotivoAnulacion('devuelto')).toBe('devolucion');
  });

  it("estadoNuevo='cancelado' → acción de bitácora 'dinero.lineas_anuladas_por_cancelacion'", () => {
    expect(derivarAccionBitacoraAnulacion('cancelado')).toBe(
      'dinero.lineas_anuladas_por_cancelacion',
    );
  });

  it("estadoNuevo='devuelto' → acción de bitácora 'dinero.lineas_anuladas_por_devolucion' (sin cambios)", () => {
    expect(derivarAccionBitacoraAnulacion('devuelto')).toBe(
      'dinero.lineas_anuladas_por_devolucion',
    );
  });

  it('cualquier otro estado (defensivo) cae a devolucion — comportamiento previo preservado', () => {
    // ESTADOS_FINANCIEROS solo permite llegar aquí con 'devuelto' o 'cancelado'
    // en la práctica, pero la derivación es defensiva: no debe crashear ante un
    // valor inesperado, y debe mantener el comportamiento anterior (que siempre
    // asumía 'devolucion') para no introducir una regresión silenciosa.
    expect(derivarMotivoAnulacion('fallido')).toBe('devolucion');
    expect(derivarAccionBitacoraAnulacion('fallido')).toBe(
      'dinero.lineas_anuladas_por_devolucion',
    );
  });
});

// =============================================================================
// Punto ciego H2 tapado (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md
// §2.3/§2.4 D-A2, migración 20260811000002): cuando la línea NO se puede
// anular porque el contenedor (período/liquidación) ya cerró, el job levanta
// una excepción BLOQUEANTE en `dinero.eventos_conciliacion` en vez de solo
// loguear. Se prueba `levantarExcepcionLineaNoAnulable` directamente, con un
// doble de prueba encadenable para `supabase` — mismo patrón que
// `acciones-anular-lineas.test.ts` — porque es la función que absorbe TODO el
// I/O (select de idempotencia, bitácora, insert); el job solo decide CUÁNDO
// llamarla (período≠'abierto' / liquidación≠'borrador', ya cubierto arriba).
// =============================================================================
describe('levantarExcepcionLineaNoAnulable — H2, tapa el punto ciego', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Doble de prueba encadenable de un cliente Supabase, especializado para el
   * único camino que usa esta función: `select(...).eq(...).in(...).maybeSingle()`
   * (idempotencia) y `insert(...)` (la fila nueva). `insertMock`/`inMock`
   * quedan expuestos para inspeccionar qué se llamó y con qué payload.
   */
  function mockSupabaseExcepcion(opciones: {
    eventoExistente: { id: string } | null;
    errorInsert?: { message: string } | null;
  }) {
    const insertMock = vi.fn((_payload: Record<string, unknown>) =>
      Promise.resolve({ error: opciones.errorInsert ?? null }),
    );
    const inMock = vi.fn(() => q);
    const q: Record<string, unknown> = {
      schema: vi.fn(() => q),
      from: vi.fn(() => q),
      select: vi.fn(() => q),
      eq: vi.fn(() => q),
      in: inMock,
      maybeSingle: vi.fn(() => Promise.resolve({ data: opciones.eventoExistente, error: null })),
      insert: insertMock,
    };
    return { q, insertMock, inMock };
  }

  const inputCobroBase = {
    tenantId: 'tenant-1',
    pedidoId: 'pedido-1',
    sellerId: 'seller-1',
    tipoLinea: 'cobro' as const,
    lineaId: 'lc-1',
    tipoDiferencia: 'linea_cobro_sin_pedido_entregado' as const,
    estadoNuevo: 'cancelado',
    estadoContenedor: 'facturado',
    periodoCobroId: 'periodo-1',
    bloqueaFacturacion: true,
    bloqueaPago: false,
    jobRunId: 'run-1',
  };

  const inputLiquidacionBase = {
    tenantId: 'tenant-1',
    pedidoId: 'pedido-2',
    sellerId: 'seller-1',
    tipoLinea: 'liquidacion' as const,
    lineaId: 'll-1',
    tipoDiferencia: 'linea_liquidacion_sin_pedido_entregado' as const,
    estadoNuevo: 'cancelado',
    estadoContenedor: 'pagada',
    driverId: 'driver-1',
    liquidacionId: 'liq-1',
    bloqueaFacturacion: false,
    bloqueaPago: true,
    jobRunId: 'run-2',
  };

  it("lado cobro (período 'facturado'): inserta evento con bloquea_facturacion=true, bloquea_pago=false y motivo_bloqueo no vacío", async () => {
    const { q, insertMock } = mockSupabaseExcepcion({ eventoExistente: null });

    const eventoId = await levantarExcepcionLineaNoAnulable(
      q as unknown as ReturnType<typeof crearClienteServiceRole>,
      inputCobroBase,
    );

    expect(eventoId).not.toBeNull();
    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.tipo_diferencia).toBe('linea_cobro_sin_pedido_entregado');
    expect(payload.bloquea_facturacion).toBe(true);
    expect(payload.bloquea_pago).toBe(false);
    expect(payload.periodo_cobro_id).toBe('periodo-1');
    expect(payload.pedido_id).toBe('pedido-1');
    expect(payload.seller_id).toBe('seller-1');
    expect(payload.estado).toBe('pendiente');
    // El CHECK eventos_conciliacion_bloqueo_motivo exige motivo_bloqueo no
    // vacío cuando cualquiera de los dos bloqueos es true — sin esto, el
    // INSERT real caería con 23514.
    expect(typeof payload.motivo_bloqueo).toBe('string');
    expect((payload.motivo_bloqueo as string).trim().length).toBeGreaterThan(0);
    // categoria_negocio/accion_sugerida/fecha_limite son NOT NULL sin default
    // (migración 20260708000001) — deben venir del insert, no quedar ausentes.
    // El lado cobro reusa el tipo YA existente `linea_cobro_sin_pedido_entregado`
    // (integridad_datos, SLA 7 días): la línea viva es un dato feo que un
    // humano corrige antes de facturar, no una fuga que ya salió del bolsillo
    // del courier — a diferencia de su hermano del lado liquidación (ver
    // el test de abajo).
    expect(payload.categoria_negocio).toBe('integridad_datos');
    expect(payload.accion_sugerida).toBeTruthy();
    expect(payload.fecha_limite).toBeTruthy();
  });

  it("lado liquidación (liquidación 'pagada'): inserta evento con bloquea_pago=true, bloquea_facturacion=false, con driver_id y liquidacion_id", async () => {
    const { q, insertMock } = mockSupabaseExcepcion({ eventoExistente: null });

    const eventoId = await levantarExcepcionLineaNoAnulable(
      q as unknown as ReturnType<typeof crearClienteServiceRole>,
      inputLiquidacionBase,
    );

    expect(eventoId).not.toBeNull();
    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.tipo_diferencia).toBe('linea_liquidacion_sin_pedido_entregado');
    expect(payload.bloquea_pago).toBe(true);
    expect(payload.bloquea_facturacion).toBe(false);
    expect(payload.driver_id).toBe('driver-1');
    expect(payload.liquidacion_id).toBe('liq-1');
    expect((payload.motivo_bloqueo as string).trim().length).toBeGreaterThan(0);
    expect(payload.categoria_negocio).toBe('fuga_ingreso');
  });

  it('idempotencia: ya existe un evento vigente (no terminal) para (tenant_id, pedido_id, tipo_diferencia) → no inserta ni audita de nuevo', async () => {
    const { q, insertMock, inMock } = mockSupabaseExcepcion({
      eventoExistente: { id: 'evento-ya-existe' },
    });

    const eventoId = await levantarExcepcionLineaNoAnulable(
      q as unknown as ReturnType<typeof crearClienteServiceRole>,
      inputCobroBase,
    );

    expect(eventoId).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
    expect(registrarEnBitacora).not.toHaveBeenCalled();
    // La clave de idempotencia filtra por estado NO terminal — mismo criterio
    // que el resto del módulo (preflight de bloqueo, avisos de SLA).
    expect(inMock).toHaveBeenCalledWith('estado', ESTADOS_NO_TERMINALES_CONCILIACION);
  });

  it('re-ejecución del job (mismo hallazgo dos veces) no duplica el evento', async () => {
    // Primera "ejecución": no hay evento previo → inserta.
    const primera = mockSupabaseExcepcion({ eventoExistente: null });
    const primerId = await levantarExcepcionLineaNoAnulable(
      primera.q as unknown as ReturnType<typeof crearClienteServiceRole>,
      inputCobroBase,
    );
    expect(primerId).not.toBeNull();
    expect(primera.insertMock).toHaveBeenCalledTimes(1);

    // Segunda "ejecución" (reintento de Inngest): el evento ya existe (mismo
    // id que se acaba de crear) → el select de idempotencia lo encuentra y
    // NO se inserta una segunda fila.
    const segunda = mockSupabaseExcepcion({ eventoExistente: { id: primerId! } });
    const segundoId = await levantarExcepcionLineaNoAnulable(
      segunda.q as unknown as ReturnType<typeof crearClienteServiceRole>,
      inputCobroBase,
    );
    expect(segundoId).toBeNull();
    expect(segunda.insertMock).not.toHaveBeenCalled();
  });

  it('bitácora ANTES del INSERT (invariante CLAUDE.md) — orden verificado', async () => {
    const orden: string[] = [];
    const { q } = mockSupabaseExcepcion({ eventoExistente: null });
    (q as Record<string, unknown>).insert = vi.fn(() => {
      orden.push('insert');
      return Promise.resolve({ error: null });
    });
    vi.mocked(registrarEnBitacora).mockImplementationOnce(async () => {
      orden.push('bitacora');
    });

    await levantarExcepcionLineaNoAnulable(
      q as unknown as ReturnType<typeof crearClienteServiceRole>,
      inputCobroBase,
    );

    expect(orden).toEqual(['bitacora', 'insert']);
  });

  it('la bitácora lleva tipo_linea, linea_id, el estado del contenedor y el evento_conciliacion_id (pre-generado, mismo id del INSERT)', async () => {
    const { q, insertMock } = mockSupabaseExcepcion({ eventoExistente: null });

    const eventoId = await levantarExcepcionLineaNoAnulable(
      q as unknown as ReturnType<typeof crearClienteServiceRole>,
      inputCobroBase,
    );

    expect(registrarEnBitacora).toHaveBeenCalledTimes(1);
    const [, entrada] = vi.mocked(registrarEnBitacora).mock.calls[0];
    expect(entrada.accion).toBe('dinero.linea_no_anulable_por_cancelacion');
    expect(entrada.actorTipo).toBe('sistema');
    expect(entrada.actorUsuarioId).toBeNull();
    expect(entrada.detalle?.tipo_linea).toBe('cobro');
    expect(entrada.detalle?.linea_id).toBe('lc-1');
    expect(entrada.detalle?.estado_periodo).toBe('facturado');
    expect(entrada.detalle?.evento_conciliacion_id).toBe(eventoId);

    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.id).toBe(eventoId);
  });

  it('lado liquidación: la bitácora lleva estado_liquidacion (no estado_periodo)', async () => {
    const { q } = mockSupabaseExcepcion({ eventoExistente: null });

    await levantarExcepcionLineaNoAnulable(
      q as unknown as ReturnType<typeof crearClienteServiceRole>,
      inputLiquidacionBase,
    );

    const [, entrada] = vi.mocked(registrarEnBitacora).mock.calls[0];
    expect(entrada.detalle?.tipo_linea).toBe('liquidacion');
    expect(entrada.detalle?.estado_liquidacion).toBe('pagada');
    expect(entrada.detalle).not.toHaveProperty('estado_periodo');
  });

  it('propaga el error si el INSERT del evento de conciliación falla', async () => {
    const { q } = mockSupabaseExcepcion({
      eventoExistente: null,
      errorInsert: { message: 'boom' },
    });

    await expect(
      levantarExcepcionLineaNoAnulable(
        q as unknown as ReturnType<typeof crearClienteServiceRole>,
        inputCobroBase,
      ),
    ).rejects.toThrow(/boom/);
  });
});
