import { describe, expect, it } from 'vitest';
import { fechaLocalEnSantiago } from '@/lib/fecha-santiago';
import {
  diaSemanaDeFecha,
  fechasLimiteDeCompra,
  hitosDePreparacion,
  plazoMedianoPorZona,
  proximaOla,
  proyectarOla,
  ventanaDeEntregas,
  volumenBasePorDiaSemana,
  type EventoComercialCatalogo,
  type VolumenBasePorDiaSemana,
} from './olas';

const CYBERDAY: EventoComercialCatalogo = {
  id: 'cyberday-2026',
  nombre: 'CyberDay',
  arquetipo: 'venta',
  organizador: 'Cámara de Comercio de Santiago',
  inicio: '2026-06-01',
  fin: '2026-06-03',
  multiplicadorBase: 2.4,
  curvaRezago: { '1': 0.2, '2': 0.3, '3': 0.25, '4': 0.15, '5': 0.1 },
};

const DIA_DEL_NINO: EventoComercialCatalogo = {
  id: 'dia-del-nino-2026',
  nombre: 'Día del Niño',
  arquetipo: 'regalo',
  organizador: null,
  inicio: '2026-08-09',
  fin: '2026-08-09',
  multiplicadorBase: 1.38,
  curvaRezago: { '-6': 0.05, '-5': 0.12, '-4': 0.2, '-3': 0.3, '-2': 0.25, '-1': 0.08 },
};

/** 100 pedidos todos los días: aísla el efecto del evento del del día de semana. */
const BASE_PLANA: VolumenBasePorDiaSemana = { 0: 100, 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100 };

function proyectar(evento: EventoComercialCatalogo, over: Partial<Parameters<typeof proyectarOla>[0]> = {}) {
  return proyectarOla({
    evento,
    volumenBase: BASE_PLANA,
    capacidadDiaria: 150,
    capacidadPorConductor: 30,
    hoy: '2026-07-27',
    ...over,
  });
}

describe('ventanaDeEntregas', () => {
  it('un evento de VENTA entrega DESPUÉS: la ventana arranca al día siguiente', () => {
    expect(ventanaDeEntregas(CYBERDAY)).toEqual({ inicio: '2026-06-02', fin: '2026-06-06' });
  });

  it('una fecha REGALO entrega ANTES y termina en la víspera', () => {
    expect(ventanaDeEntregas(DIA_DEL_NINO)).toEqual({ inicio: '2026-08-03', fin: '2026-08-08' });
  });
});

describe('proximaOla', () => {
  const catalogo = [CYBERDAY, DIA_DEL_NINO];

  it('elige la más próxima dentro del horizonte', () => {
    expect(proximaOla(catalogo, '2026-07-27')?.id).toBe('dia-del-nino-2026');
  });

  it('mira la VENTANA DE ENTREGAS, no la fecha del evento', () => {
    // El 5 de junio el CyberDay (1–3 jun) ya pasó como fecha, pero el courier
    // sigue entregando su ola: tiene que seguir mostrándose.
    expect(proximaOla([CYBERDAY], '2026-06-05')?.id).toBe('cyberday-2026');
  });

  it('descarta la ola cuya ventana ya terminó entera', () => {
    expect(proximaOla([CYBERDAY], '2026-06-07')).toBeNull();
  });

  it('no muestra eventos demasiado lejanos', () => {
    expect(proximaOla([DIA_DEL_NINO], '2026-01-01')).toBeNull();
  });
});

describe('proyectarOla', () => {
  it('reparte el extra según la curva y lo suma a la base del día', () => {
    // extra_total = 100 × (2,4 − 1) × 3 días = 420.
    // D+2 lleva el 30 % → 100 + 126 = 226.
    const ola = proyectar(CYBERDAY)!;
    const d2 = ola.curva.find((p) => p.offsetDias === 2)!;
    expect(d2.pedidosBase).toBe(100);
    expect(d2.pedidosProyectados).toBe(226);
  });

  it('con multiplicador 1 no hay ola: la proyección es la base', () => {
    const ola = proyectar({ ...CYBERDAY, multiplicadorBase: 1 })!;
    expect(ola.curva.every((p) => p.pedidosProyectados === p.pedidosBase)).toBe(true);
    expect(ola.variacionEsperadaPct).toBe(0);
  });

  it('marca el peak sobre el volumen proyectado, no sobre la proporción', () => {
    // El sábado 6 de junio tiene una base mucho más alta; aunque su proporción
    // de curva (0,15 en D+5... ) sea menor, puede terminar siendo el peak real.
    const base: VolumenBasePorDiaSemana = { ...BASE_PLANA, 6: 400 };
    const ola = proyectar(CYBERDAY, { volumenBase: base })!;
    const peaks = ola.curva.filter((p) => p.esPeak);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].fecha).toBe('2026-06-06'); // sábado
  });

  it('el día CRÍTICO es el de mayor brecha contra la capacidad, no el de mayor volumen', () => {
    const ola = proyectar(CYBERDAY)!;
    const critico = ola.curva.find((p) => p.fecha === ola.diaCritico)!;
    const peorBrecha = Math.max(
      ...ola.curva.map((p) => p.pedidosProyectados - p.capacidadEstimada),
    );
    expect(critico.pedidosProyectados - critico.capacidadEstimada).toBe(peorBrecha);
  });

  it('traduce la brecha a conductores, en negativo porque FALTAN', () => {
    // Día crítico 226 contra capacidad 150 → faltan 76 paradas → 3 conductores.
    expect(proyectar(CYBERDAY)!.brechaConductores).toBe(-3);
  });

  it('sin brecha, cero conductores: no se inventa un refuerzo que no hace falta', () => {
    expect(proyectar(CYBERDAY, { capacidadDiaria: 5000 })!.brechaConductores).toBe(0);
  });

  it('sin volumen base histórico devuelve null en vez de una curva de ceros', () => {
    expect(proyectar(CYBERDAY, { volumenBase: {} })).toBeNull();
  });

  it('la variación esperada se mide sobre toda la ventana de entregas', () => {
    // 5 días de base 100 = 500; extra 420 repartido entero → 920 → +84 %.
    expect(proyectar(CYBERDAY)!.variacionEsperadaPct).toBe(84);
  });

  it('cuenta los días que faltan para el evento', () => {
    expect(proyectar(DIA_DEL_NINO)!.diasParaEvento).toBe(13);
  });
});

describe('fecha límite de compra (solo arquetipo regalo)', () => {
  it('un evento de VENTA no la tiene: nadie compra para que llegue antes', () => {
    const plazos = new Map([['z1', 2]]);
    expect(proyectar(CYBERDAY, { plazoPorZona: plazos })!.fechaLimiteCompraPorZona).toBeNull();
  });

  it('descuenta el plazo de la zona desde la VÍSPERA del evento', () => {
    // Día del Niño el 9; tiene que estar en casa el 8; zona con 2 días de plazo
    // → última compra el 6.
    const plazos = new Map([['z-lenta', 2], ['z-rapida', 0]]);
    const limites = proyectar(DIA_DEL_NINO, { plazoPorZona: plazos })!.fechaLimiteCompraPorZona!;
    expect(limites).toEqual([
      { zonaId: 'z-lenta', fecha: '2026-08-06' },
      { zonaId: 'z-rapida', fecha: '2026-08-08' },
    ]);
  });

  it('sin plazos medidos NO promete ninguna fecha', () => {
    // Prometer una fecha límite sobre un supuesto es lo que hace que un seller
    // pierda una venta.
    expect(proyectar(DIA_DEL_NINO)!.fechaLimiteCompraPorZona).toBeNull();
    expect(fechasLimiteDeCompra(DIA_DEL_NINO, new Map())).toBeNull();
  });
});

describe('hitosDePreparacion', () => {
  it('devuelve los cuatro hitos con su fecha límite', () => {
    const hitos = hitosDePreparacion('2026-08-09', '2026-07-27');
    expect(hitos.map((h) => h.tMenosDias)).toEqual([21, 14, 7, 3]);
    expect(hitos[0].fechaLimite).toBe('2026-07-19');
    expect(hitos[3].fechaLimite).toBe('2026-08-06');
  });

  it('marca vencido lo que ya pasó y pendiente lo que viene', () => {
    // Con el evento el 9 de agosto y hoy el 27 de julio: T−21 cayó el 19 de
    // julio y T−14 el 26 — los dos ya pasaron. T−7 (2 ago) y T−3 (6 ago) no.
    const hitos = hitosDePreparacion('2026-08-09', '2026-07-27');
    expect(hitos.map((h) => h.estado)).toEqual(['vencido', 'vencido', 'pendiente', 'pendiente']);
  });

  it('el hito de HOY todavía cuenta como pendiente, no como vencido', () => {
    // El borde importa: un hito cuyo plazo vence hoy se puede cumplir hoy.
    const hitos = hitosDePreparacion('2026-08-09', '2026-07-19');
    expect(hitos[0].estado).toBe('pendiente');
  });

  it('nunca marca «hecho»: no hay dónde registrar que alguien lo hizo', () => {
    const hitos = hitosDePreparacion('2026-08-09', '2027-01-01');
    expect(hitos.every((h) => h.estado === 'vencido')).toBe(true);
  });
});

describe('volumenBasePorDiaSemana', () => {
  it('promedia por día de semana, no en general', () => {
    // Dos lunes (10 y 20 pedidos) y un sábado (100). El lunes vale 15, no 43.
    const fechas = [
      ...Array(10).fill('2026-07-06'), // lunes
      ...Array(20).fill('2026-07-13'), // lunes
      ...Array(100).fill('2026-07-11'), // sábado
    ];
    const base = volumenBasePorDiaSemana(fechas);
    expect(base[1]).toBe(15);
    expect(base[6]).toBe(100);
  });

  it('un día sin operación no arrastra su media a cero', () => {
    // Solo hay un domingo con dato en todo el rango: la media del domingo es ese
    // día, no ese día dividido por las semanas del rango.
    const base = volumenBasePorDiaSemana([...Array(40).fill('2026-07-12')]);
    expect(base[0]).toBe(40);
  });

  it('sin pedidos devuelve un objeto vacío, que la proyección sabe rechazar', () => {
    expect(volumenBasePorDiaSemana([])).toEqual({});
  });
});

describe('plazoMedianoPorZona', () => {
  const comunaAZona = new Map([['santiago', 'z1']]);
  const normalizar = (c: string) => c.toLowerCase();
  // El helper REAL, no un atajo: derivar la fecha civil truncando el instante
  // UTC es justo el bug que el guard de este módulo prohíbe, y usarlo aquí
  // además dejaría sin probar el comportamiento que importa (un pedido de las
  // 21:30 de Santiago es de ESE día, no del siguiente).
  const fechaLocal = fechaLocalEnSantiago;

  function pedido(creadoEn: string, fechaCompromiso: string) {
    return { comuna: 'Santiago', creadoEn, fechaCompromiso };
  }

  it('usa la MEDIANA, para que una preventa no arrastre a toda la zona', () => {
    const pedidos = [
      pedido('2026-07-01T12:00:00Z', '2026-07-02'), // 1 día
      pedido('2026-07-01T12:00:00Z', '2026-07-03'), // 2 días
      pedido('2026-07-01T12:00:00Z', '2026-07-04'), // 3 días
      pedido('2026-07-01T12:00:00Z', '2026-08-15'), // 45 días: una preventa
    ];
    // Media sería 12,75; mediana 2,5.
    expect(plazoMedianoPorZona(pedidos, comunaAZona, normalizar, fechaLocal).get('z1')).toBe(2.5);
  });

  it('descarta plazos negativos: son regularizaciones, no tiempos de entrega', () => {
    const pedidos = [
      pedido('2026-07-10T12:00:00Z', '2026-07-01'), // cargado 9 días tarde
      pedido('2026-07-01T12:00:00Z', '2026-07-03'),
    ];
    expect(plazoMedianoPorZona(pedidos, comunaAZona, normalizar, fechaLocal).get('z1')).toBe(2);
  });

  it('una comuna fuera de las zonas del courier no aporta plazo', () => {
    const pedidos = [{ comuna: 'Valparaíso', creadoEn: '2026-07-01T12:00:00Z', fechaCompromiso: '2026-07-03' }];
    expect(plazoMedianoPorZona(pedidos, comunaAZona, normalizar, fechaLocal).size).toBe(0);
  });
});

describe('diaSemanaDeFecha', () => {
  it('lee la fecha civil tal cual, sin corrimiento de huso', () => {
    // Una fecha civil desnuda no es un instante; leerla con `new Date(iso)` la
    // pondría en medianoche UTC y en Santiago caería el día anterior.
    expect(diaSemanaDeFecha('2026-08-09')).toBe(0); // domingo
    expect(diaSemanaDeFecha('2026-06-01')).toBe(1); // lunes
  });
});
