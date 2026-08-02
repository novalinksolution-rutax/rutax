/**
 * Pruebas del armado del composer.
 * =====================================================================
 *
 * Todo lo que se prueba aquí es puro: convierte filas en lo que la pantalla
 * dibuja. Es la capa donde los errores no lanzan — producen un número plausible
 * y equivocado —, así que se prueba lo que se puede equivocar en silencio: una
 * comuna que no empareja por un acento, un corte que se lee al revés, una franja
 * vencida que resucita, una lista vacía que se lee como «no hay riesgo».
 *
 * Fechas: julio es INVIERNO en Chile, así que Santiago es −04:00. Los instantes
 * de estas pruebas llevan ese offset explícito, nunca `Z`.
 */

import { describe, expect, it } from 'vitest';
import { COMUNAS_RM } from '@/lib/ui/comunas-rm';
import { MACRO_ZONAS_RM } from '../macro-zonas-rm';
import { PESOS_EFECTIVOS_F1 } from '../motor-riesgo';
import {
  armarZonas,
  centroDeZona,
  contarPorZona,
  factoresDesdeDesglose,
  factoresSinCalculo,
  indexarComunaAZona,
  ventanaCorteDeZona,
  type RiesgoDeFranja,
  type ZonaConfigurada,
} from './armado-zonas';
import {
  armarCapas,
  armarCeldasClima,
  armarConductores,
  armarFrescura,
  armarPronosticoAire,
  armarRestricciones,
  armarTimeline,
  instanteSantiago,
  radioDeComuna,
  UMBRAL_LLUVIA_MM_HORA,
} from './armado-mapa';
import {
  armarExcepciones,
  armarMetricas,
  resolverEstadoPantalla,
  variacionContra,
  UMBRAL_EXCEPCION,
} from './armado-riel';
import type { FrescuraFuente, Zona } from '../contrato-torre';

// =============================================================================
// Macro-zonas del fallback
// =============================================================================

describe('MACRO_ZONAS_RM', () => {
  /**
   * Esta es LA prueba de este archivo: si una comuna se cayera de la partición,
   * sus pedidos no sumarían a ninguna zona y desaparecerían del tablero sin un
   * solo error. Un courier sin zonas propias vería menos volumen del que tiene.
   */
  it('particiona exactamente las 52 comunas de la RM, sin repetir ni faltar', () => {
    const todas = MACRO_ZONAS_RM.flatMap((z) => z.comunas);
    expect(todas).toHaveLength(COMUNAS_RM.length);
    expect(new Set(todas).size).toBe(COMUNAS_RM.length);
    expect([...todas].sort()).toEqual([...COMUNAS_RM].sort());
  });
});

// =============================================================================
// Centro de zona
// =============================================================================

describe('centroDeZona', () => {
  it('cae dentro de la Región Metropolitana, no en el hemisferio opuesto', () => {
    // Regresión del bug de B5: el centroide salía espejado y una zona de
    // Santiago aterrizaba en China.
    const centro = centroDeZona(['Las Condes', 'Vitacura', 'Providencia']);
    expect(centro.lat).toBeGreaterThan(-34.5);
    expect(centro.lat).toBeLessThan(-32.5);
    expect(centro.long).toBeGreaterThan(-71.8);
    expect(centro.long).toBeLessThan(-70);
  });

  it('tolera acentos y mayúsculas', () => {
    expect(centroDeZona(['ñuñoa'])).toEqual(centroDeZona(['Ñuñoa']));
  });

  it('sin ninguna comuna reconocible cae al centro de la RM en vez de a (0,0)', () => {
    const centro = centroDeZona(['Valparaíso', 'Concepción']);
    expect(centro.lat).toBeCloseTo(-33.45, 1);
    expect(centro.long).toBeCloseTo(-70.66, 1);
  });
});

// =============================================================================
// Ventana de corte
// =============================================================================

describe('ventanaCorteDeZona', () => {
  const ventanas = [
    { zonaId: 'z1', horaCorte: '18:00', activa: true },
    { zonaId: null, horaCorte: '12:00', activa: true },
    { zonaId: 'z2', horaCorte: '09:00', activa: true },
  ];

  it('toma el corte MÁS TEMPRANO entre los aplicables, no el de la zona', () => {
    // z1 corta a las 18:00, pero la ventana por defecto del seller corta a las
    // 12:00: la presión de la zona es a las 12:00. Tomar el último inventaría
    // seis horas de holgura que no existen para la mitad de los pedidos.
    expect(ventanaCorteDeZona(ventanas, 'z1', 0, 9 * 60).hora).toBe('12:00');
  });

  it('ignora los cortes de OTRAS zonas', () => {
    expect(ventanaCorteDeZona(ventanas, 'z1', 0, 9 * 60).hora).not.toBe('09:00');
  });

  it('ignora las ventanas inactivas', () => {
    const soloInactiva = [{ zonaId: 'z1', horaCorte: '10:00', activa: false }];
    expect(ventanaCorteDeZona(soloInactiva, 'z1', 0, 9 * 60).hora).toBe('21:00');
  });

  it('devuelve minutos NEGATIVOS cuando el corte ya venció', () => {
    // El motor satura en 0 porque mide urgencia; la pantalla informa, y ahí sí
    // importa cuánto se pasó.
    const { minutosRestantes } = ventanaCorteDeZona(ventanas, 'z1', 0, 13 * 60);
    expect(minutosRestantes).toBe(-60);
  });

  it('suma un día completo por cada día de horizonte', () => {
    expect(ventanaCorteDeZona(ventanas, 'z1', 1, 9 * 60).minutosRestantes).toBe(1440 + 180);
  });

  it('sin ninguna ventana configurada cae al fin de la jornada de reparto', () => {
    expect(ventanaCorteDeZona([], 'z1', 0, 9 * 60).hora).toBe('21:00');
  });
});

// =============================================================================
// Factores
// =============================================================================

describe('factores', () => {
  it('sin cálculo devuelve los SEIS factores con su motivo, no una lista vacía', () => {
    // Una lista vacía se leería como «no hay factores», que es distinto de
    // «todavía no se calculan».
    const factores = factoresSinCalculo('Todavía no hay cálculo.');
    expect(factores).toHaveLength(6);
    expect(factores.every((f) => f.valor === 0)).toBe(true);
    expect(factores.every((f) => f.explicacion === 'Todavía no hay cálculo.')).toBe(true);
    expect(factores.find((f) => f.id === 'transito')?.peso).toBe(PESOS_EFECTIVOS_F1.transito);
  });

  it('lee el desglose que dejó el job', () => {
    const desglose = {
      factores: [
        { id: 'clima', etiqueta: 'Clima', valor: 95, peso: 0.235, explicacion: 'Lluvia.' },
      ],
    };
    expect(factoresDesdeDesglose(desglose)).toEqual([
      { id: 'clima', etiqueta: 'Clima', valor: 95, peso: 0.235, explicacion: 'Lluvia.' },
    ]);
  });

  it('descarta ids desconocidos en vez de propagarlos a la pantalla', () => {
    const desglose = { factores: [{ id: 'karma', valor: 99 }] };
    expect(factoresDesdeDesglose(desglose)).toBeNull();
  });

  it('devuelve null ante basura, para que el llamador ponga el motivo honesto', () => {
    expect(factoresDesdeDesglose(null)).toBeNull();
    expect(factoresDesdeDesglose({})).toBeNull();
    expect(factoresDesdeDesglose({ factores: [] })).toBeNull();
    expect(factoresDesdeDesglose('texto')).toBeNull();
  });
});

// =============================================================================
// armarZonas
// =============================================================================

const ZONAS_CONFIG: ZonaConfigurada[] = [
  { id: 'z-oriente', nombre: 'Oriente', comunas: ['Las Condes', 'Ñuñoa'] },
  { id: 'z-centro', nombre: 'Centro', comunas: ['Santiago'] },
];

function filaRiesgo(over: Partial<RiesgoDeFranja> = {}): RiesgoDeFranja {
  return {
    zonaId: 'z-oriente',
    franja: 'manana',
    puntaje: 30,
    desglose: {},
    pedidosPendientes: 10,
    montoComprometidoClp: 1000,
    ...over,
  };
}

function armar(riesgo: RiesgoDeFranja[]) {
  return armarZonas({
    zonas: ZONAS_CONFIG,
    riesgo,
    capacidadPorZona: new Map([
      ['z-oriente', 60],
      ['z-centro', 130],
    ]),
    conductoresPorZona: new Map([
      [
        'z-oriente',
        [
          { id: 'c1', capacidadParadas: 30, disponible: true },
          { id: 'c2', capacidadParadas: 30, disponible: false },
        ],
      ],
      ['z-centro', []],
    ]),
    entregadosPorZona: new Map([['z-oriente', 24]]),
    cargaEnVivoPorZona: new Map([['z-centro', { pendientes: 40, montoClp: 200_000 }]]),
    ventanas: [{ zonaId: null, horaCorte: '18:00', activa: true }],
    diasDeDiferencia: 0,
    ahoraMinutos: 9 * 60,
    motivoSinCalculo: 'Sin cálculo todavía.',
  });
}

describe('armarZonas', () => {
  it('usa la franja que el job marcó como dominante, no la de mayor puntaje', () => {
    // El job descarta las franjas ya vencidas para el horizonte «hoy». Si aquí
    // se recalculara el máximo, esa franja muerta resucitaría y la pantalla
    // mostraría un riesgo que ya pasó.
    const desglose = {
      franja_dominante: 'punta',
      puntaje_colapsado: 55,
      factores: [{ id: 'clima', etiqueta: 'Clima', valor: 80, peso: 0.2, explicacion: 'Lluvia.' }],
    };
    const zonas = armar([
      filaRiesgo({ franja: 'manana', puntaje: 90, desglose }),
      filaRiesgo({ franja: 'punta', puntaje: 55, desglose }),
    ]);

    const oriente = zonas.find((z) => z.id === 'z-oriente')!;
    expect(oriente.riesgo).toBe(55);
    expect(oriente.nivel).toBe('medio');
    expect(oriente.factores[0].explicacion).toBe('Lluvia.');
  });

  it('sin marca de franja cae al máximo puntaje', () => {
    const zonas = armar([
      filaRiesgo({ franja: 'manana', puntaje: 30 }),
      filaRiesgo({ franja: 'tarde', puntaje: 81 }),
    ]);
    expect(zonas.find((z) => z.id === 'z-oriente')!.riesgo).toBe(81);
  });

  it('sin fila de riesgo deja el puntaje en 0 y lo DICE en los seis factores', () => {
    const zonas = armar([]);
    const centro = zonas.find((z) => z.id === 'z-centro')!;
    expect(centro.riesgo).toBe(0);
    expect(centro.nivel).toBe('calmo');
    expect(centro.factores).toHaveLength(6);
    expect(centro.factores[0].explicacion).toBe('Sin cálculo todavía.');
  });

  it('sin fila de riesgo, los pendientes y el monto salen del conteo EN VIVO', () => {
    // Mientras el job no haya corrido, `riesgo_zona` está vacía. Dejar cero ahí
    // mostraría un tablero vacío sobre una operación llena.
    const centro = armar([]).find((z) => z.id === 'z-centro')!;
    expect(centro.pedidosPendientes).toBe(40);
    expect(centro.montoComprometidoClp).toBe(200_000);
  });

  it('CON fila de riesgo manda la fila, aunque el conteo en vivo diga otra cosa', () => {
    // La explicación del motor cita su propio número literal; un conteo más
    // fresco al lado haría que el nivel 1 y el nivel 2 se contradijeran.
    const zonas = armar([filaRiesgo({ zonaId: 'z-centro', pedidosPendientes: 148, montoComprometidoClp: 742_800 })]);
    const centro = zonas.find((z) => z.id === 'z-centro')!;
    expect(centro.pedidosPendientes).toBe(148);
    expect(centro.montoComprometidoClp).toBe(742_800);
  });

  it('sin fila ni conteo en vivo queda en cero, no en undefined', () => {
    const oriente = armar([]).find((z) => z.id === 'z-oriente')!;
    expect(oriente.pedidosPendientes).toBe(0);
    expect(oriente.montoComprometidoClp).toBe(0);
  });

  it('separa conductores asignados de disponibles', () => {
    const oriente = armar([]).find((z) => z.id === 'z-oriente')!;
    expect(oriente.conductoresAsignados).toBe(2);
    expect(oriente.conductoresDisponibles).toBe(1);
  });

  it('ordena de mayor a menor riesgo (el des-solapado de placas depende del orden)', () => {
    const zonas = armar([
      filaRiesgo({ zonaId: 'z-oriente', puntaje: 20 }),
      filaRiesgo({ zonaId: 'z-centro', puntaje: 70 }),
    ]);
    expect(zonas.map((z) => z.id)).toEqual(['z-centro', 'z-oriente']);
  });
});

describe('mapeo comuna → zona', () => {
  it('empareja aunque cambien acentos y mayúsculas', () => {
    const indice = indexarComunaAZona(ZONAS_CONFIG);
    const conteo = contarPorZona(
      [{ comuna: 'NUNOA' }, { comuna: 'ñuñoa' }, { comuna: 'Las Condes' }],
      indice,
    );
    expect(conteo.get('z-oriente')).toBe(3);
  });

  it('una comuna fuera de las zonas del courier no suma a ninguna', () => {
    const conteo = contarPorZona([{ comuna: 'Valparaíso' }], indexarComunaAZona(ZONAS_CONFIG));
    expect(conteo.size).toBe(0);
  });
});

// =============================================================================
// Frescura y capas
// =============================================================================

describe('armarFrescura', () => {
  const ahora = new Date('2026-07-25T09:14:00-04:00');

  it('deriva la edad en minutos desde la última actualización exitosa', () => {
    const [fuente] = armarFrescura(
      [
        {
          id: 'clima',
          nombre: 'Clima',
          actualizado_en: '2026-07-25T08:44:00-04:00',
          cadencia_minutos: 60,
          estado: 'ok',
          motivo: null,
        },
      ],
      ahora,
    );
    expect(fuente.edadMinutos).toBe(30);
  });

  it('una fuente que nunca corrió no finge edad cero: deja `actualizadoEn` vacío', () => {
    const [fuente] = armarFrescura(
      [
        {
          id: 'senales',
          nombre: 'Señales de prensa',
          actualizado_en: null,
          cadencia_minutos: 30,
          estado: 'caida',
          motivo: 'Todavía no se ejecuta la primera actualización.',
        },
      ],
      ahora,
    );
    expect(fuente.actualizadoEn).toBe('');
    expect(fuente.estado).toBe('caida');
  });
});

describe('armarCapas', () => {
  function frescura(estado: FrescuraFuente['estado'], id: string): FrescuraFuente {
    return {
      id,
      nombre: id,
      estado,
      actualizadoEn: '2026-07-25T09:00:00-04:00',
      edadMinutos: 10,
      cadenciaMinutos: 60,
      motivo: estado === 'ok' ? null : 'El proveedor no responde.',
    };
  }

  it('una fuente caída bloquea su capa CON motivo, no la esconde', () => {
    const capas = armarCapas({
      frescura: [frescura('caida', 'clima')],
      hayClima: true,
      hayEventos: true,
      hayConductores: false,
    });
    const clima = capas.find((c) => c.id === 'clima')!;
    expect(clima.disponible).toBe(false);
    expect(clima.motivoNoDisponible).toBe('El proveedor no responde.');
    expect(clima.activa).toBe(false);
  });

  it('una fuente atrasada NO bloquea: el dato viejo sigue siendo dato', () => {
    const capas = armarCapas({
      frescura: [frescura('atrasada', 'clima')],
      hayClima: true,
      hayEventos: true,
      hayConductores: false,
    });
    expect(capas.find((c) => c.id === 'clima')!.disponible).toBe(true);
  });

  it('sin lluvia que dibujar, la capa se bloquea y explica por qué', () => {
    const capas = armarCapas({
      frescura: [frescura('ok', 'clima')],
      hayClima: false,
      hayEventos: false,
      hayConductores: false,
    });
    expect(capas.find((c) => c.id === 'clima')!.disponible).toBe(false);
    expect(capas.find((c) => c.id === 'clima')!.motivoNoDisponible).toMatch(/Sin precipitación/);
  });

  it('tránsito se declara no disponible, no vacío', () => {
    const capas = armarCapas({ frescura: [], hayClima: true, hayEventos: true, hayConductores: true });
    expect(capas.find((c) => c.id === 'transito')!.disponible).toBe(false);
    expect(capas.find((c) => c.id === 'transito')!.motivoNoDisponible).toBeTruthy();
  });

  it('la capa de conductores sigue el dato: se bloquea solo si nadie reporta', () => {
    const sinFlota = armarCapas({ frescura: [], hayClima: true, hayEventos: true, hayConductores: false });
    expect(sinFlota.find((c) => c.id === 'conductores')!.disponible).toBe(false);
    expect(sinFlota.find((c) => c.id === 'conductores')!.motivoNoDisponible).toBeTruthy();

    const conFlota = armarCapas({ frescura: [], hayClima: true, hayEventos: true, hayConductores: true });
    expect(conFlota.find((c) => c.id === 'conductores')!.disponible).toBe(true);
    expect(conFlota.find((c) => c.id === 'conductores')!.motivoNoDisponible).toBeNull();
  });

  it('deja las ocho capas del contrato, ninguna de menos', () => {
    expect(
      armarCapas({ frescura: [], hayClima: true, hayEventos: true, hayConductores: true }),
    ).toHaveLength(8);
  });
});

// =============================================================================
// Flota en vivo
// =============================================================================

describe('armarConductores', () => {
  const AHORA = new Date('2026-07-27T14:00:00-04:00');

  function conductor(over: Partial<Parameters<typeof armarConductores>[0][number]> = {}) {
    return {
      id: 'c1',
      nombre: 'Marcelo Ortiz',
      zonaId: 'z-centro',
      lat: -33.44,
      long: -70.66,
      ultimoPing: '2026-07-27T13:58:00-04:00',
      paradasTotales: 20,
      paradasCompletadas: 5,
      estadoManifiesto: 'en_ruta',
      ...over,
    };
  }

  it('NUNCA devuelve «detenido»', () => {
    // No es un olvido: decir que alguien está detenido exige saber que no se
    // movió, y el modelo guarda a propósito solo la ÚLTIMA posición, sin rastro
    // (minimización Ley 21.431). Emitirlo obligaría a reintroducir el recorrido.
    const estados = armarConductores(
      [
        conductor(),
        conductor({ id: 'c2', ultimoPing: '2026-07-27T10:00:00-04:00' }),
        conductor({ id: 'c3', estadoManifiesto: 'completado' }),
      ],
      AHORA,
    ).map((c) => c.estado);
    expect(estados).not.toContain('detenido');
  });

  it('marca sin señal pasados los 20 minutos', () => {
    const [c] = armarConductores([conductor({ ultimoPing: '2026-07-27T13:30:00-04:00' })], AHORA);
    expect(c.minutosSinPing).toBe(30);
    expect(c.estado).toBe('sin_senal');
  });

  it('terminar la ruta manda sobre la falta de señal', () => {
    // Alguien que cerró su manifiesto y apagó el teléfono no es un problema que
    // el coordinador deba salir a buscar.
    const [c] = armarConductores(
      [conductor({ ultimoPing: '2026-07-27T09:00:00-04:00', estadoManifiesto: 'completado' })],
      AHORA,
    );
    expect(c.estado).toBe('finalizado');
  });

  it('también finaliza cuando completó todas sus paradas', () => {
    const [c] = armarConductores(
      [conductor({ paradasTotales: 12, paradasCompletadas: 12 })],
      AHORA,
    );
    expect(c.estado).toBe('finalizado');
  });

  it('con ping fresco y ruta abierta va en ruta', () => {
    expect(armarConductores([conductor()], AHORA)[0].estado).toBe('en_ruta');
  });

  it('conserva la posición y las paradas tal cual', () => {
    const [c] = armarConductores([conductor()], AHORA);
    expect(c.posicion).toEqual({ lat: -33.44, long: -70.66 });
    expect(c.paradasTotales).toBe(20);
    expect(c.paradasCompletadas).toBe(5);
  });
});

// =============================================================================
// Celdas de lluvia
// =============================================================================

describe('radioDeComuna', () => {
  it('da un radio mayor a una comuna rural que a una urbana apretada', () => {
    expect(radioDeComuna('Melipilla')).toBeGreaterThan(radioDeComuna('Independencia'));
  });

  it('se mantiene dentro de límites razonables', () => {
    for (const comuna of COMUNAS_RM) {
      const radio = radioDeComuna(comuna);
      expect(radio).toBeGreaterThanOrEqual(2_500);
      expect(radio).toBeLessThanOrEqual(15_000);
    }
  });
});

describe('armarCeldasClima', () => {
  const comunaAZona = indexarComunaAZona(ZONAS_CONFIG);

  it('ignora la garúa bajo el umbral', () => {
    const celdas = armarCeldasClima(
      [
        {
          comuna: 'Las Condes',
          hora: '2026-07-25T16:00:00-04:00',
          precipitacion_mm: UMBRAL_LLUVIA_MM_HORA / 2,
          viento_kmh: null,
        },
      ],
      comunaAZona,
      '2026-07-25',
    );
    expect(celdas).toEqual([]);
  });

  it('toma el MÁXIMO de la comuna y la ventana contigua', () => {
    const [celda] = armarCeldasClima(
      [
        { comuna: 'Las Condes', hora: '2026-07-25T16:00:00-04:00', precipitacion_mm: 3, viento_kmh: null },
        { comuna: 'Las Condes', hora: '2026-07-25T17:00:00-04:00', precipitacion_mm: 8, viento_kmh: null },
        { comuna: 'Las Condes', hora: '2026-07-25T18:00:00-04:00', precipitacion_mm: 2, viento_kmh: null },
      ],
      comunaAZona,
      '2026-07-25',
    );
    expect(celda.intensidadMmHora).toBe(8);
    expect(celda.zonasAfectadas).toEqual(['z-oriente']);
    expect(celda.ventana.inicio).toBe(instanteSantiago('2026-07-25', '16:00'));
    expect(celda.ventana.fin).toBe(instanteSantiago('2026-07-25', '19:00'));
  });

  it('descarta las horas de OTRO día — leídas en Santiago, no en UTC', () => {
    // Las 22:00 del 25 en Santiago son las 02:00 del 26 en UTC. Leer la fecha
    // del instante UTC metería esta fila en el día siguiente.
    const celdas = armarCeldasClima(
      [
        { comuna: 'Las Condes', hora: '2026-07-25T22:00:00-04:00', precipitacion_mm: 9, viento_kmh: null },
      ],
      comunaAZona,
      '2026-07-26',
    );
    expect(celdas).toEqual([]);
  });
});

// =============================================================================
// Aire y restricción
// =============================================================================

describe('armarPronosticoAire', () => {
  it('el nivel del día es el PEOR de sus horas, no el promedio', () => {
    const [dia] = armarPronosticoAire(
      [
        { comuna: 'Santiago', hora: '2026-07-25T10:00:00-04:00', pm25: 30, nivel_estimado: 'bueno' },
        { comuna: 'Santiago', hora: '2026-07-25T19:00:00-04:00', pm25: 118, nivel_estimado: 'preemergencia' },
        { comuna: 'Puente Alto', hora: '2026-07-25T19:00:00-04:00', pm25: 90, nivel_estimado: 'alerta' },
      ],
      '2026-07-25',
    );
    expect(dia.nivel).toBe('preemergencia');
    expect(dia.pm25Maximo).toBe(118);
    expect(dia.esProyeccion).toBe(false);
  });

  it('marca como proyección todo lo posterior a hoy', () => {
    const dias = armarPronosticoAire(
      [
        { comuna: 'Santiago', hora: '2026-07-25T10:00:00-04:00', pm25: 30, nivel_estimado: 'bueno' },
        { comuna: 'Santiago', hora: '2026-07-27T10:00:00-04:00', pm25: 96, nivel_estimado: 'preemergencia' },
      ],
      '2026-07-25',
    );
    expect(dias.map((d) => d.esProyeccion)).toEqual([false, true]);
  });
});

describe('armarRestricciones', () => {
  it('deja `vehiculosAfectados` en null: el modelo no guarda patentes', () => {
    const [restriccion] = armarRestricciones([
      { fecha: '2026-07-27', tipo: 'preemergencia', digitos: [2, 3], alcance: 'Sin sello verde' },
    ]);
    expect(restriccion.vehiculosAfectados).toBeNull();
  });
});

// =============================================================================
// Línea de tiempo
// =============================================================================

function zonaDePrueba(over: Partial<Zona> = {}): Zona {
  return {
    id: 'z-oriente',
    nombre: 'Oriente',
    comunas: ['Las Condes'],
    riesgo: 81,
    nivel: 'critico',
    factores: factoresSinCalculo('—'),
    pedidosPendientes: 86,
    pedidosEntregados: 24,
    capacidadEstimada: 60,
    conductoresAsignados: 2,
    conductoresDisponibles: 2,
    ventanaCorte: { hora: '18:00', minutosRestantes: 526 },
    montoComprometidoClp: 486_200,
    centro: { lat: -33.4, long: -70.56 },
    ...over,
  };
}

describe('armarTimeline', () => {
  const base = {
    fecha: '2026-07-25',
    celdasClima: [],
    eventosCiudad: [],
    restricciones: [],
  };

  it('la ventana de reparto se queda con el carril 0', () => {
    const { timeline } = armarTimeline({ ...base, zonas: [zonaDePrueba()] });
    const reparto = timeline.find((b) => b.tipo === 'ventana_reparto')!;
    expect(reparto.carril).toBe(0);
    expect(timeline.filter((b) => b.carril === 0)).toHaveLength(1);
  });

  it('un corte sin pedidos pendientes no entra: no hay nada que dependa de él', () => {
    const { timeline } = armarTimeline({
      ...base,
      zonas: [zonaDePrueba({ pedidosPendientes: 0 })],
    });
    expect(timeline.some((b) => b.tipo === 'corte_en_riesgo')).toBe(false);
  });

  it('marca el corte «en riesgo» solo cuando los pendientes superan la capacidad', () => {
    const conRiesgo = armarTimeline({ ...base, zonas: [zonaDePrueba()] }).timeline;
    expect(conRiesgo.find((b) => b.tipo === 'corte_en_riesgo')!.etiqueta).toBe(
      'Corte de Oriente en riesgo',
    );

    const sinRiesgo = armarTimeline({
      ...base,
      zonas: [zonaDePrueba({ pedidosPendientes: 10 })],
    }).timeline;
    expect(sinRiesgo.find((b) => b.tipo === 'corte_en_riesgo')!.etiqueta).toBe('Corte de Oriente');
  });

  it('los bloques que se solapan van a carriles distintos', () => {
    const { timeline } = armarTimeline({
      ...base,
      zonas: [zonaDePrueba()],
      celdasClima: [
        {
          id: 'c1',
          tipo: 'lluvia',
          centro: { lat: -33.4, long: -70.56 },
          radioMetros: 5000,
          intensidadMmHora: 8,
          ventana: {
            inicio: instanteSantiago('2026-07-25', '16:00'),
            fin: instanteSantiago('2026-07-25', '19:00'),
          },
          zonasAfectadas: ['z-oriente'],
        },
      ],
    });
    const clima = timeline.find((b) => b.tipo === 'clima')!;
    const corte = timeline.find((b) => b.tipo === 'corte_en_riesgo')!;
    expect(clima.carril).not.toBe(corte.carril);
    expect(clima.carril).toBeGreaterThan(0);
  });

  it('recorta lo que desborda la jornada y descarta lo que cae entero fuera', () => {
    const { timeline, rangoTimeline } = armarTimeline({
      ...base,
      zonas: [zonaDePrueba()],
      eventosCiudad: [
        {
          id: 'ev-1',
          nombre: 'Partido nocturno',
          tipo: 'deportivo',
          recinto: 'Estadio Nacional',
          comuna: 'Ñuñoa',
          posicion: { lat: -33.46, long: -70.61 },
          radioMetros: 1800,
          ventana: {
            inicio: instanteSantiago('2026-07-25', '20:00'),
            fin: instanteSantiago('2026-07-25', '23:30'),
          },
          asistenciaEstimada: 45000,
          fuente: 'Calendario',
        },
      ],
    });
    const evento = timeline.find((b) => b.tipo === 'evento')!;
    expect(evento.fin).toBe(rangoTimeline.fin);
    expect(rangoTimeline.inicio).toBe(instanteSantiago('2026-07-25', '08:00'));
  });

  it('la restricción PERMANENTE no entra a la franja; la extraordinaria sí', () => {
    const permanente = armarTimeline({
      ...base,
      zonas: [zonaDePrueba()],
      restricciones: [
        { fecha: '2026-07-25', tipo: 'permanente', digitos: [6, 7], alcance: '', vehiculosAfectados: null },
      ],
    }).timeline;
    expect(permanente.some((b) => b.tipo === 'restriccion')).toBe(false);

    const preemergencia = armarTimeline({
      ...base,
      zonas: [zonaDePrueba()],
      restricciones: [
        { fecha: '2026-07-25', tipo: 'preemergencia', digitos: [2, 3], alcance: '', vehiculosAfectados: null },
      ],
    }).timeline;
    expect(preemergencia.some((b) => b.tipo === 'restriccion')).toBe(true);
  });
});

// =============================================================================
// Métricas
// =============================================================================

describe('variacionContra', () => {
  it('devuelve null sin base con la que comparar, en vez de un infinito', () => {
    expect(variacionContra(120, 0)).toBeNull();
  });

  it('redondea a un decimal, que es lo que la pantalla muestra', () => {
    expect(variacionContra(106, 100)).toBe(6);
    expect(variacionContra(1062, 1000)).toBe(6.2);
  });
});

describe('armarMetricas', () => {
  const zonas = [
    zonaDePrueba({ ventanaCorte: { hora: '18:00', minutosRestantes: 526 } }),
    zonaDePrueba({
      id: 'z-centro',
      nombre: 'Centro',
      pedidosPendientes: 148,
      pedidosEntregados: 61,
      montoComprometidoClp: 742_800,
      ventanaCorte: { hora: '12:00', minutosRestantes: 20 },
    }),
  ];

  it('sin un solo pedido devuelve lista vacía, no cuatro ceros', () => {
    expect(
      armarMetricas({
        zonas,
        etiquetaPedidos: 'Pedidos hoy',
        totalPedidos: 0,
        totalSemanaAnterior: 300,
        montoSemanaAnteriorClp: 0,
        atrasados: 0,
        sinGeocodificar: 0,
      }),
    ).toEqual([]);
  });

  it('el SLA en riesgo suma atrasados y pendientes de zonas cuyo corte ya aprieta', () => {
    const metricas = armarMetricas({
      zonas,
      etiquetaPedidos: 'Pedidos hoy',
      totalPedidos: 412,
      totalSemanaAnterior: 388,
      montoSemanaAnteriorClp: 1_000_000,
      atrasados: 5,
      sinGeocodificar: 7,
    });
    const sla = metricas.find((m) => m.id === 'sla-en-riesgo')!;
    // Centro corta en 20 min (148 pendientes); Oriente en 526 (no cuenta).
    expect(sla.valorCrudo).toBe(5 + 148);
    expect(sla.detalle).toMatch(/atrasados/);
  });

  it('el comprometido suma el de las zonas y se formatea en CLP', () => {
    const metricas = armarMetricas({
      zonas,
      etiquetaPedidos: 'Pedidos hoy',
      totalPedidos: 412,
      totalSemanaAnterior: 388,
      montoSemanaAnteriorClp: 1_000_000,
      atrasados: 0,
      sinGeocodificar: 0,
    });
    const monto = metricas.find((m) => m.id === 'monto-comprometido')!;
    expect(monto.valorCrudo).toBe(486_200 + 742_800);
    expect(monto.valor).toMatch(/^\$1\.229\.000$/);
  });
});

// =============================================================================
// Excepciones
// =============================================================================

describe('armarExcepciones', () => {
  const comun = {
    riesgo: [] as RiesgoDeFranja[],
    senales: [],
    pronosticoAire: [],
    fecha: '2026-07-25',
    ahoraIso: '2026-07-25T09:14:00-04:00',
  };

  it('una zona bajo el umbral no genera excepción (silencio por defecto)', () => {
    const excepciones = armarExcepciones({
      ...comun,
      zonas: [zonaDePrueba({ riesgo: UMBRAL_EXCEPCION - 1, nivel: 'medio' })],
    });
    expect(excepciones).toEqual([]);
  });

  it('titula con el factor que MÁS APORTA, no con el de mayor valor suelto', () => {
    const zona = zonaDePrueba({
      factores: [
        { id: 'presion_operativa', etiqueta: 'Presión operativa', valor: 40, peso: 0.41, explicacion: 'Apretado.' },
        { id: 'historico', etiqueta: 'Histórico propio', valor: 95, peso: 0.06, explicacion: 'Malo.' },
      ],
    });
    const [excepcion] = armarExcepciones({ ...comun, zonas: [zona] });
    // 40×0.41 = 16.4 aporta más que 95×0.06 = 5.7.
    expect(excepcion.titulo).toBe('Oriente sin holgura');
    expect(excepcion.cuerpo).toContain('Apretado.');
  });

  it('la acción de pedidos usa la forma que la ficha sabe convertir en enlace', () => {
    const [excepcion] = armarExcepciones({ ...comun, zonas: [zonaDePrueba()] });
    expect(excepcion.acciones).toHaveLength(1);
    expect(excepcion.acciones[0].etiqueta).toMatch(/^Ver los \d+ pedidos$/);
    // Ninguna acción con confirmación: hoy no ejecutan nada contra el backend.
    expect(excepcion.acciones.every((a) => !a.requiereConfirmacion)).toBe(true);
  });

  it('un episodio de aire genera una excepción SIN zona: no es de una zona, es de la ciudad', () => {
    const excepciones = armarExcepciones({
      ...comun,
      zonas: [],
      pronosticoAire: [
        { fecha: '2026-07-27', pm25Maximo: 118, nivel: 'preemergencia', esProyeccion: true },
      ],
    });
    expect(excepciones).toHaveLength(1);
    expect(excepciones[0].zonaId).toBeNull();
    expect(excepciones[0].pedidosAfectados).toBe(0);
    expect(excepciones[0].acciones[0].etiqueta).toBe('Ver flota expuesta');
  });

  it('ignora un episodio de aire ya pasado', () => {
    const excepciones = armarExcepciones({
      ...comun,
      zonas: [],
      pronosticoAire: [
        { fecha: '2026-07-24', pm25Maximo: 118, nivel: 'preemergencia', esProyeccion: false },
      ],
    });
    expect(excepciones).toEqual([]);
  });

  it('ordena las críticas antes que las altas', () => {
    const excepciones = armarExcepciones({
      ...comun,
      zonas: [
        zonaDePrueba({ id: 'z-a', nombre: 'A', riesgo: 70, nivel: 'alto' }),
        zonaDePrueba({ id: 'z-b', nombre: 'B', riesgo: 90, nivel: 'critico' }),
      ],
    });
    expect(excepciones.map((e) => e.severidad)).toEqual(['critica', 'alta']);
  });
});

// =============================================================================
// Estado de pantalla
// =============================================================================

describe('resolverEstadoPantalla', () => {
  const frescuraOk: FrescuraFuente[] = [
    {
      id: 'clima',
      nombre: 'Clima',
      estado: 'ok',
      actualizadoEn: '2026-07-25T09:00:00-04:00',
      edadMinutos: 5,
      cadenciaMinutos: 60,
      motivo: null,
    },
  ];

  it('sin zonas propias manda sobre todo lo demás', () => {
    expect(
      resolverEstadoPantalla({
        tieneZonasPropias: false,
        totalPedidos: 400,
        hayExcepciones: true,
        frescura: frescuraOk,
      }),
    ).toBe('sin_zonas');
  });

  it('sin pedidos manda sobre las excepciones', () => {
    expect(
      resolverEstadoPantalla({
        tieneZonasPropias: true,
        totalPedidos: 0,
        hayExcepciones: true,
        frescura: frescuraOk,
      }),
    ).toBe('sin_pedidos');
  });

  it('con excepciones manda sobre degradado: la banda es para lo accionable', () => {
    expect(
      resolverEstadoPantalla({
        tieneZonasPropias: true,
        totalPedidos: 400,
        hayExcepciones: true,
        frescura: [{ ...frescuraOk[0], estado: 'caida', motivo: 'Sin respuesta.' }],
      }),
    ).toBe('con_excepciones');
  });

  it('una fuente caída sin excepciones deja el tablero degradado', () => {
    expect(
      resolverEstadoPantalla({
        tieneZonasPropias: true,
        totalPedidos: 400,
        hayExcepciones: false,
        frescura: [{ ...frescuraOk[0], estado: 'caida', motivo: 'Sin respuesta.' }],
      }),
    ).toBe('degradado');
  });

  it('todo en orden y sin riesgo: tranquilo', () => {
    expect(
      resolverEstadoPantalla({
        tieneZonasPropias: true,
        totalPedidos: 400,
        hayExcepciones: false,
        frescura: frescuraOk,
      }),
    ).toBe('tranquilo');
  });
});
