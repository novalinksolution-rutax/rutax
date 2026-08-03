/**
 * Agregación de la Torre v2 — de filas planas a las cifras de la pantalla.
 * =====================================================================
 *
 * Entre las consultas (I/O, en `composer/consultas.ts`) y el armado del payload
 * falta un paso que no es ninguna de las dos cosas: convertir filas de pedidos,
 * cierres e incidencias en **la carga por comuna**, los puntos del mapa y el
 * avance de cada conductor.
 *
 * Ese paso vive aquí, separado y **puro**: sin base, sin reloj propio, todo por
 * parámetro. Es lo que más fácil se equivoca en silencio —una comuna que no
 * empareja por un acento, un pedido contado dos veces, un corte leído en UTC— y
 * nada de eso lanza: produce un número plausible y equivocado. Aislado y puro, se
 * puede probar.
 *
 * -----------------------------------------------------------------------------
 * QUÉ CAMBIÓ RESPECTO DE LA v1
 * -----------------------------------------------------------------------------
 * La versión anterior agregaba **por zona y por franja** para alimentar los seis
 * factores del motor de riesgo. Con el puntaje retirado, cayeron enteros el clima
 * por zona, el aire por zona, los eventos por zona, las tres franjas del día y la
 * tasa histórica de fallidos. Lo único que sobrevive de aquel archivo es la
 * aritmética del corte (`minutosHastaCorte`), porque F7 sigue necesitándola —
 * ahora para marcar lo que está cerca del corte, no para puntuar.
 */

import { horaAMinutos } from '@/lib/fecha-santiago';
import {
  normalizarComuna,
  resolverComunaCanonica,
} from '@/modules/integraciones/geocoding/normalizacion';

// =============================================================================
// Índice comuna → zona
// =============================================================================

/** Una zona del courier con las comunas que cubre. */
export interface ZonaConComunas {
  id: string;
  comunas: readonly string[];
}

/**
 * Índice `comuna normalizada → zonaId`.
 *
 * En la v2 la zona **no agrega el mapa**, pero sigue decidiendo qué ventana de
 * corte aplica a cada comuna. Una comuna que no está en ninguna zona no es un
 * error: es un courier que todavía no la configuró, y su corte cae en la ventana
 * por defecto.
 *
 * Si dos zonas declaran la misma comuna gana la primera, que es el mismo criterio
 * que ya usaba el guard de `zona_comunas` en la base.
 */
export function indexarComunaAZona(zonas: readonly ZonaConComunas[]): Map<string, string> {
  const indice = new Map<string, string>();
  for (const zona of zonas) {
    for (const comuna of zona.comunas) {
      const clave = normalizarComuna(comuna);
      if (!indice.has(clave)) indice.set(clave, zona.id);
    }
  }
  return indice;
}

// =============================================================================
// Minutos hasta el corte — F7, cálculo interno
// =============================================================================

/** Fila de `identidad.ventanas_corte`, ya filtrada por tenant. */
export interface VentanaCorte {
  /** `null` = ventana por defecto; con valor = override de esa zona. */
  zonaId: string | null;
  /** Hora local de Santiago, `HH:MM` o `HH:MM:SS`. */
  horaCorte: string;
  activa: boolean;
}

/**
 * Minutos que faltan para el primer corte aplicable a una zona.
 *
 * **La más temprana entre las activas aplicables**, no la de la zona ni la media:
 * el corte que aprieta es el primero que vence. Una zona con un seller que corta
 * a las 12:00 y otro a las 18:00 tiene su presión a las 12:00 — tomar la última
 * diría que hay seis horas de holgura que no existen para la mitad de los
 * pedidos.
 *
 * Aplicables = activas y con `zonaId` igual al de la zona **o** `null`.
 *
 * Devuelve `null` si el courier no configuró ninguna ventana: «sin dato» es
 * distinto de «sin tiempo», y marcar de urgente todo lo de un courier que aún no
 * configuró su corte sería ruido puro. Un corte ya vencido devuelve 0, no un
 * negativo — más allá del corte la urgencia ya no crece.
 */
export function minutosHastaCorte(
  ventanas: readonly VentanaCorte[],
  zonaId: string | null,
  ahoraMinutos: number,
): number | null {
  const aplicables = ventanas.filter(
    (v) => v.activa && (v.zonaId === zonaId || v.zonaId === null),
  );
  if (aplicables.length === 0) return null;

  const minutoCorte = Math.min(...aplicables.map((v) => horaAMinutos(v.horaCorte)));
  return Math.max(0, minutoCorte - ahoraMinutos);
}

/**
 * A cuántos minutos del corte un pendiente se considera «en riesgo» (F7).
 *
 * Noventa minutos es una hora y media de reparto: es el margen en que todavía se
 * puede llamar al conductor y redistribuir, y por debajo del cual ya no. No es un
 * umbral calibrado con datos —no los hay todavía— y por eso vive acá arriba, con
 * nombre, en vez de estar enterrado como un `90` suelto en una comparación.
 */
export const MINUTOS_RIESGO_DE_CORTE = 90;

/** Un pendiente está en riesgo si el corte de su comuna vence dentro del margen. */
export function estaEnRiesgoDeCorte(minutosRestantes: number | null): boolean {
  return minutosRestantes !== null && minutosRestantes <= MINUTOS_RIESGO_DE_CORTE;
}

// =============================================================================
// Entregas declaradas en la app de Rutax
// =============================================================================

/**
 * Lo que un conductor declaró sobre una parada, viniendo de cualquiera de las dos
 * tablas: el POD autoritativo del same-day o el cierre operativo de Flex.
 *
 * Unificarlas acá y no en la consulta es a propósito: son dos tablas con
 * semántica distinta —una mueve el estado del pedido y la otra no— y esa
 * distinción importa en `operacion` y en el motor de dinero. Para la Torre, en
 * cambio, las dos responden la misma pregunta: ¿este paquete ya se resolvió, y
 * cuándo lo dijo el conductor?
 */
export interface RegistroDeEntrega {
  pedidoId: string;
  conductorId: string;
  entregado: boolean;
  /** Instante ISO en que el conductor lo declaró. */
  registradoEn: string;
}

/**
 * Junta POD y cierres en un solo registro por pedido.
 *
 * Cuando un pedido tiene los dos (un same-day con POD que además se cerró), gana
 * el **más reciente**: es la última declaración del conductor sobre esa parada, y
 * el cierre es explícitamente corregible por diseño (la tabla tiene `unique` por
 * pedido y se actualiza, no se acumula).
 */
export function unificarRegistros(
  registros: readonly RegistroDeEntrega[],
): Map<string, RegistroDeEntrega> {
  const porPedido = new Map<string, RegistroDeEntrega>();
  for (const registro of registros) {
    const previo = porPedido.get(registro.pedidoId);
    if (!previo || registro.registradoEn > previo.registradoEn) {
      porPedido.set(registro.pedidoId, registro);
    }
  }
  return porPedido;
}

// =============================================================================
// Carga por comuna — F1
// =============================================================================

/** Pedido del día, reducido a lo que la agregación necesita. */
export interface PedidoAgregable {
  id: string;
  comuna: string | null;
  /** Estado oficial. Solo se usa como respaldo cuando no hay registro de Rutax. */
  estado: string;
  ubicado: boolean;
}

export interface CargaComuna {
  pendientes: number;
  total: number;
  entregados: number;
  incidenciasAbiertas: number;
  enRiesgoDeCorte: number;
  sinUbicar: number;
}

/** Estados oficiales que ya cerraron el ciclo del pedido. */
const ESTADOS_CERRADOS = new Set(['entregado', 'entregado_manual', 'fallido', 'fallido_manual']);

/** Estados oficiales que cuentan como entrega lograda. */
const ESTADOS_ENTREGADOS = new Set(['entregado', 'entregado_manual']);

/**
 * ¿Este pedido ya está resuelto, y lo está por entrega?
 *
 * **Manda el registro de la app de Rutax**; el estado oficial es el respaldo para
 * los pedidos que nadie cerró en la app (un same-day marcado a mano desde el
 * backoffice, un Flex que sincronizó antes de que el conductor cerrara).
 *
 * Ese orden ES la decisión de producto: la Torre va por delante del estado
 * oficial en Flex, a propósito. Invertirlo la volvería a atrasar. Ver el
 * encabezado de `composer/consultas.ts`.
 */
export function resolverPedido(
  pedido: PedidoAgregable,
  registro: RegistroDeEntrega | undefined,
): { cerrado: boolean; entregado: boolean } {
  if (registro) return { cerrado: true, entregado: registro.entregado };
  return {
    cerrado: ESTADOS_CERRADOS.has(pedido.estado),
    entregado: ESTADOS_ENTREGADOS.has(pedido.estado),
  };
}

/**
 * La carga del día por comuna: la fracción «38 de 120» y lo que la acompaña.
 *
 * Un pedido sin comuna resuelta no se descarta: se agrupa bajo `null` y el
 * composer lo cuenta en el resumen global. Descartarlo sería exactamente lo que
 * prohíbe la regla 5 del alcance — el mapa nunca esconde carga.
 */
export function cargaPorComuna(
  pedidos: readonly PedidoAgregable[],
  registros: ReadonlyMap<string, RegistroDeEntrega>,
  incidenciasPorPedido: ReadonlyMap<string, number>,
  comunaEnRiesgo: ReadonlySet<string>,
): Map<string | null, CargaComuna> {
  const carga = new Map<string | null, CargaComuna>();

  for (const pedido of pedidos) {
    const clave = pedido.comuna === null ? null : resolverComunaCanonica(pedido.comuna) ?? pedido.comuna;

    const actual =
      carga.get(clave) ??
      {
        pendientes: 0,
        total: 0,
        entregados: 0,
        incidenciasAbiertas: 0,
        enRiesgoDeCorte: 0,
        sinUbicar: 0,
      };

    const { cerrado, entregado } = resolverPedido(pedido, registros.get(pedido.id));

    actual.total += 1;
    if (entregado) actual.entregados += 1;
    if (!cerrado) {
      actual.pendientes += 1;
      if (clave !== null && comunaEnRiesgo.has(clave)) actual.enRiesgoDeCorte += 1;
    }
    if (!pedido.ubicado) actual.sinUbicar += 1;
    actual.incidenciasAbiertas += incidenciasPorPedido.get(pedido.id) ?? 0;

    carga.set(clave, actual);
  }

  return carga;
}

// =============================================================================
// Colapso de puntos que comparten ubicación — el `+N` de F3
// =============================================================================

/**
 * Precisión del colapso, en grados decimales.
 *
 * `0.0002°` son ~22 m de latitud en Santiago: la escala de un edificio.
 *
 * **Por coordenada redondeada y no por radio**, que era la otra opción abierta:
 * redondear es determinístico y O(n), mientras que agrupar por radio depende del
 * orden en que llegan los puntos —dos corridas con los mismos datos pueden dar
 * agrupaciones distintas— y obliga a un clustering que la medición dice que no
 * hace falta.
 *
 * ⚠️ **Lo que una grilla NO garantiza:** que dos puntos cercanos caigan siempre
 * en la misma celda. Dos coordenadas separadas por un metro pueden quedar a ambos
 * lados de un borde y no colapsar. Toda grilla tiene bordes; el radio los cambia
 * por no-determinismo, que es peor.
 *
 * En la práctica casi no muerde, y vale la pena saber por qué: el geocoding
 * resuelve la DIRECCIÓN, no el departamento, así que las seis entregas de una
 * misma torre llegan con la coordenada IDÉNTICA y colapsan siempre. El borde solo
 * afecta a direcciones distintas que caen muy cerca, y ahí el peor caso es ver
 * dos puntos en vez de uno — no perder ninguno.
 */
export const PRECISION_COLAPSO_GRADOS = 0.0002;

/** Clave de agrupación de una coordenada. Expuesta para poder probarla. */
export function claveDeUbicacion(lat: number, long: number): string {
  const factor = 1 / PRECISION_COLAPSO_GRADOS;
  return `${Math.round(lat * factor)}:${Math.round(long * factor)}`;
}

/**
 * Cuántos pedidos comparten ubicación con cada uno.
 *
 * Devuelve el conteo por clave, no los puntos ya colapsados: quién se queda como
 * representante del grupo es decisión del armado, que sí sabe cuál estado tiene
 * prioridad visual (una incidencia nunca puede quedar escondida detrás de un
 * entregado).
 */
export function contarPorUbicacion(
  puntos: readonly { lat: number; long: number }[],
): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const punto of puntos) {
    const clave = claveDeUbicacion(punto.lat, punto.long);
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }
  return conteo;
}

// =============================================================================
// Avance por conductor — F13
// =============================================================================

/**
 * Hora local a partir de la cual el día se considera cerrado y los pendientes
 * pasan a contarse como **paquetes rezagados**.
 *
 * Las 23:00, una hora después del corte de despacho (~21:00–22:00), por decisión
 * del usuario (2026-08-03): da margen para que entren los últimos cierres que el
 * conductor sube desde la calle antes de contar a nadie.
 *
 * **Antes de esta hora no existe «rezagado»**, y eso no es un detalle de
 * presentación: a las 10 de la mañana todos los conductores tienen casi todo
 * pendiente, así que la palabra no significaría nada y la pantalla estaría
 * gritando por diseño.
 */
export const HORA_CIERRE_DIA = '23:00';

/** ¿El día ya cerró? Decide si F13 habla de avance o de rezago. */
export function diaCerrado(ahoraMinutos: number): boolean {
  return ahoraMinutos >= horaAMinutos(HORA_CIERRE_DIA);
}

export interface AvanceConductor {
  id: string;
  nombre: string;
  asignados: number;
  completados: number;
  pendientes: number;
  /** `null` mientras el día sigue abierto. */
  rezagados: number | null;
  ultimoRegistroEn: string | null;
  minutosSinRegistrar: number | null;
}

/**
 * El avance de cada conductor con paradas hoy.
 *
 * Se arma sobre las paradas del MANIFIESTO, no sobre `pedidos.driver_id_asignado`:
 * una reasignación deja el denormalizado apuntando al último conductor y las
 * paradas del primero desaparecerían de su cuenta.
 *
 * El orden es por **cuánto le falta**, descendente — no alfabético. La lista
 * existe para decidir a quién mirar primero, y un orden alfabético entierra al
 * que está trabado detrás de los que ya terminaron.
 */
export function avanceDeConductores(params: {
  /** Paradas del manifiesto de hoy: qué pedido lleva cada conductor. */
  paradas: readonly { conductorId: string; pedidoId: string }[];
  nombres: ReadonlyMap<string, string>;
  registros: ReadonlyMap<string, RegistroDeEntrega>;
  pedidos: ReadonlyMap<string, PedidoAgregable>;
  /** Instante de referencia, en milisegundos. */
  ahoraMs: number;
  diaCerrado: boolean;
}): AvanceConductor[] {
  const { paradas, nombres, registros, pedidos, ahoraMs } = params;

  const acumulado = new Map<
    string,
    { asignados: number; completados: number; pendientes: number; ultimo: string | null }
  >();

  for (const parada of paradas) {
    const actual =
      acumulado.get(parada.conductorId) ??
      { asignados: 0, completados: 0, pendientes: 0, ultimo: null as string | null };

    actual.asignados += 1;

    const pedido = pedidos.get(parada.pedidoId);
    const registro = registros.get(parada.pedidoId);
    const { cerrado } = pedido
      ? resolverPedido(pedido, registro)
      : { cerrado: registro !== undefined };

    if (cerrado) actual.completados += 1;
    else actual.pendientes += 1;

    // El ritmo se mide con lo que el conductor DECLARÓ, no con el estado del
    // pedido: el estado no guarda cuándo cambió, y en Flex además cambia por la
    // sincronización con ML y no por una acción suya.
    if (registro && (actual.ultimo === null || registro.registradoEn > actual.ultimo)) {
      actual.ultimo = registro.registradoEn;
    }

    acumulado.set(parada.conductorId, actual);
  }

  const salida: AvanceConductor[] = [];
  for (const [id, datos] of acumulado) {
    const ultimoMs = datos.ultimo ? Date.parse(datos.ultimo) : Number.NaN;
    salida.push({
      id,
      nombre: nombres.get(id) ?? 'Conductor sin nombre',
      asignados: datos.asignados,
      completados: datos.completados,
      pendientes: datos.pendientes,
      rezagados: params.diaCerrado ? datos.pendientes : null,
      ultimoRegistroEn: datos.ultimo,
      minutosSinRegistrar: Number.isNaN(ultimoMs)
        ? null
        : Math.max(0, Math.floor((ahoraMs - ultimoMs) / 60_000)),
    });
  }

  return salida.sort(
    (a, b) => b.pendientes - a.pendientes || a.nombre.localeCompare(b.nombre, 'es'),
  );
}

// =============================================================================
// Frescura — F6
// =============================================================================

/**
 * A partir de cuántos minutos sin un solo registro la pantalla deja de estar
 * callada.
 *
 * Cuarenta y cinco minutos: en una operación de última milla activa entra un
 * cierre cada pocos minutos, así que tres cuartos de hora sin ninguno ya no es
 * una pausa de almuerzo — es la app sin subir datos, o la operación detenida. Las
 * dos cosas ameritan que el coordinador desconfíe del contador que está mirando.
 */
export const UMBRAL_FRESCURA_MINUTOS = 45;

/**
 * Cuán reciente es el último registro que subió cualquier conductor del courier.
 *
 * Un courier que todavía no tiene ningún registro hoy **no está atrasado**:
 * está empezando el día. Marcar de atrasada la pantalla a las 7 de la mañana,
 * antes de la primera entrega, sería la alarma que enseña a ignorar la alarma.
 */
export function calcularFrescura(
  registros: readonly RegistroDeEntrega[],
  ahoraMs: number,
): { ultimoRegistroEn: string | null; edadMinutos: number | null; atrasada: boolean } {
  let ultimo: string | null = null;
  for (const registro of registros) {
    if (ultimo === null || registro.registradoEn > ultimo) ultimo = registro.registradoEn;
  }

  if (ultimo === null) {
    return { ultimoRegistroEn: null, edadMinutos: null, atrasada: false };
  }

  const ultimoMs = Date.parse(ultimo);
  if (Number.isNaN(ultimoMs)) {
    return { ultimoRegistroEn: null, edadMinutos: null, atrasada: false };
  }

  const edadMinutos = Math.max(0, Math.floor((ahoraMs - ultimoMs) / 60_000));
  return {
    ultimoRegistroEn: ultimo,
    edadMinutos,
    atrasada: edadMinutos > UMBRAL_FRESCURA_MINUTOS,
  };
}
