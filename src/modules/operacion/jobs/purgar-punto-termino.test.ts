/**
 * Pruebas de la purga del punto de término del conductor.
 *
 * Aquí, al revés que en `purgar-evidencias`, lo que hay que probar es **que
 * borre**. La evidencia de entrega prueba algo y un borrado de más es
 * irreversible; el punto de término no prueba nada —no respalda un pago, no
 * defiende un cobro, no tiene valor contable— así que el error caro es el
 * contrario: conservar el domicilio de un trabajador cuando ya no hay nada que
 * lo justifique. Esa fue exactamente la falla de `ubicacion_conductor`, que se
 * retiró el 2026-08-14 por no tener ningún job que la purgara.
 */

import { describe, it, expect } from 'vitest';
import {
  clasificarPuntosTermino,
  fechaCorteActividad,
  DIAS_INACTIVIDAD_PUNTO_TERMINO,
  type FilaPuntoTermino,
} from './purgar-punto-termino';

const TENANT = 'aaaa0000-0000-0000-0000-000000000001';

const fila = (id: string): FilaPuntoTermino => ({ conductor_id: id, tenant_id: TENANT });

/** Escenario "todo en regla": conductor activo, con consentimiento y trabajando. */
function escenarioSano(ids: string[]) {
  return {
    filas: ids.map(fila),
    estadoConductor: new Map(ids.map((id) => [id, 'activo'])),
    conConsentimiento: new Set(ids),
    conActividad: new Set(ids),
  };
}

describe('fechaCorteActividad', () => {
  it('resta los días pedidos y devuelve una fecha (no un instante)', () => {
    // `manifiestos.fecha_operacion` es `date`: comparar contra un timestamp con
    // hora la haría depender de a qué hora corre el job.
    const ahora = new Date('2026-08-14T12:00:00.000Z');
    expect(fechaCorteActividad(ahora, 90)).toBe('2026-05-16');
  });

  it('cuenta el calendario de SANTIAGO, no el de UTC', () => {
    // El job corre a las 03:40 de Santiago, que en UTC es el día SIGUIENTE.
    // Restar 90×24 h a ese instante y truncar en UTC daría un corte un día
    // corrido — y el borrado de un dato personal no puede depender de a qué
    // hora se despertó el cron.
    const madrugadaSantiago = new Date('2026-08-15T07:40:00.000Z'); // 03:40 CLT
    expect(fechaCorteActividad(madrugadaSantiago, 90)).toBe('2026-05-17');
  });

  it('la política declarada es 90 días', () => {
    // Fijado como test para que cambiarlo sea deliberado y visible en el diff.
    expect(DIAS_INACTIVIDAD_PUNTO_TERMINO).toBe(90);
  });
});

describe('clasificarPuntosTermino', () => {
  it('no borra al conductor activo, con consentimiento vigente y con actividad reciente', () => {
    expect(clasificarPuntosTermino(escenarioSano(['c1', 'c2']))).toEqual([]);
  });

  it('borra el punto del conductor dado de baja (red de §5.4)', () => {
    const entrada = escenarioSano(['c1']);
    entrada.estadoConductor.set('c1', 'inactivo');

    expect(clasificarPuntosTermino(entrada)).toEqual([
      { fila: fila('c1'), motivo: 'conductor_no_activo' },
    ]);
  });

  it('borra el punto si el conductor NO aparece en la nómina (fallar hacia no conservar)', () => {
    // Si no se pudo leer su estado, el dato personal pierde su justificación.
    // Ante la duda NO se conserva: es lo contrario de la retención de evidencias.
    const entrada = escenarioSano(['c1']);
    entrada.estadoConductor.delete('c1');

    expect(clasificarPuntosTermino(entrada)[0].motivo).toBe('conductor_no_activo');
  });

  it('borra el punto sin consentimiento vigente (red de §5.3)', () => {
    // La fila no puede existir sin la base de licitud que la sostiene. Si una
    // revocación marcó el consentimiento pero falló al borrar la fila, esto lo
    // corrige al día siguiente en vez de dejar el domicilio ahí para siempre.
    const entrada = escenarioSano(['c1']);
    entrada.conConsentimiento.delete('c1');

    expect(clasificarPuntosTermino(entrada)).toEqual([
      { fila: fila('c1'), motivo: 'sin_consentimiento_vigente' },
    ]);
  });

  it('borra por inactividad al conductor sin manifiestos en la ventana', () => {
    const entrada = escenarioSano(['c1']);
    entrada.conActividad.delete('c1');

    expect(clasificarPuntosTermino(entrada)).toEqual([
      { fila: fila('c1'), motivo: 'inactividad' },
    ]);
  });

  it('NUNCA retiene por un asunto abierto: la clasificación no conoce incidencias ni cobros', () => {
    // Guardián del contrato, no del código: `clasificarPuntosTermino` recibe
    // exactamente cuatro cosas y ninguna es una retención legal. Si alguien
    // agregara `pedidosConRetencion()` a este job —copiando el molde de
    // evidencias sin leer §7— tendría que ampliar esta entrada, y este test es
    // el que le avisa de que ese molde NO se copia: el punto de término no
    // prueba nada, así que no hay asunto abierto que justifique conservarlo.
    const entrada = escenarioSano(['c1']);
    expect(Object.keys(entrada).sort()).toEqual([
      'conActividad',
      'conConsentimiento',
      'estadoConductor',
      'filas',
    ]);
  });

  it('reporta el motivo más específico cuando se cumplen varios', () => {
    const entrada = escenarioSano(['c1']);
    entrada.estadoConductor.set('c1', 'inactivo');
    entrada.conConsentimiento.delete('c1');
    entrada.conActividad.delete('c1');

    expect(clasificarPuntosTermino(entrada)).toHaveLength(1);
    expect(clasificarPuntosTermino(entrada)[0].motivo).toBe('conductor_no_activo');
  });

  it('clasifica un lote mixto sin arrastrar el veredicto de una fila a la siguiente', () => {
    const entrada = escenarioSano(['sano', 'baja', 'sin_consent', 'inactivo']);
    entrada.estadoConductor.set('baja', 'inactivo');
    entrada.conConsentimiento.delete('sin_consent');
    entrada.conActividad.delete('inactivo');

    expect(clasificarPuntosTermino(entrada)).toEqual([
      { fila: fila('baja'), motivo: 'conductor_no_activo' },
      { fila: fila('sin_consent'), motivo: 'sin_consentimiento_vigente' },
      { fila: fila('inactivo'), motivo: 'inactividad' },
    ]);
  });
});
