/**
 * El composer de la Torre v2 — de la base a `EstadoTorre`.
 * =====================================================================
 *
 * Dos cargadores, y la división NO es arbitraria: es dónde el dato deja de
 * depender de sí mismo.
 *
 *   · `cargarCabecera` — el nombre del courier y el instante de referencia. Una
 *     consulta diminuta que no depende de nada, así que la cabecera pinta primero
 *     y sin esperar al resto.
 *   · `cargarTablero` — todo lo demás, en un `EstadoTorre`.
 *
 * **Ya no hay envoltorio de horizontes.** La v1 devolvía `TorreRespuesta` con
 * `hoy`, `manana` y `72h` precalculados para que el selector de horizonte no
 * disparara un viaje al servidor. Ese selector se retiró: en same-day el
 * horizonte de 72 h estaría vacío siempre. Con un solo horizonte, el envoltorio
 * solo servía para escribir `.horizontes.hoy` en todas partes.
 *
 * **Por qué el tablero no se parte más fino, aunque la pantalla tenga regiones.**
 * Porque las piezas se necesitan entre sí: las comunas necesitan los registros de
 * entrega, los puntos necesitan las mismas comunas para saber cuáles están cerca
 * del corte, y el panel de conductores necesita los mismos registros. Partirlo
 * sería hacer que un cargador esperara al otro con dos nombres distintos. Lo que
 * SÍ es por región es el `<Suspense>` de la pantalla.
 */

import { cache } from 'react';
import {
  ahoraEnSantiago,
  horaAMinutos,
  sumarDiasCalendario,
} from '@/lib/fecha-santiago';
import {
  normalizarComuna,
  resolverComunaCanonica,
} from '@/modules/integraciones/geocoding/normalizacion';
import {
  avanceDeConductores,
  calcularFrescura,
  cargaPorComuna,
  diaCerrado,
  indexarComunaAZona,
  minutosHastaCorte,
  unificarRegistros,
  UMBRAL_FRESCURA_MINUTOS,
  type PedidoAgregable,
  type RegistroDeEntrega,
  type VentanaCorte,
} from '../agregacion';
import {
  HORIZONTE_OLA_DIAS,
  proximasOlas,
  proyectarOlas,
  volumenBasePorDiaSemana,
} from '../olas';
import type { EstadoTorre } from '../contrato-torre';
import {
  ESTADOS_INCIDENCIA_ABIERTA,
  obtenerCapacidadInstalada,
  obtenerCierresDelDia,
  obtenerCourier,
  obtenerEventosComerciales,
  obtenerIncidenciasDeLosPedidos,
  obtenerParadasDelDia,
  obtenerPedidosDelDia,
  obtenerPodDelDia,
  obtenerSellers,
  obtenerVentanasCorte,
  obtenerVolumenBase,
  obtenerZonasConfiguradas,
} from './consultas';
import {
  armarComunas,
  armarIncidencias,
  armarPuntos,
  armarResumen,
  comunasCercaDelCorte,
  resolverEstadoPantalla,
  type PedidoUbicable,
} from './armado';
import { validarEstadoTorre } from './esquema';

// =============================================================================
// Cabecera
// =============================================================================

export interface CabeceraTorre {
  courier: { id: string; nombre: string };
  /** Instante ISO de «ahora», calculado UNA vez en el servidor. */
  ahoraIso: string;
  /** Fecha civil de hoy en Santiago. */
  fecha: string;
}

export const cargarCabecera = cache(async function cargarCabecera(
  tenantId: string,
): Promise<CabeceraTorre> {
  const ahora = ahoraEnSantiago();
  const courier = await obtenerCourier(tenantId);
  return { courier, ahoraIso: ahora.instante.toISOString(), fecha: ahora.fecha };
});

// =============================================================================
// Tablero
// =============================================================================

/** Ventana histórica para la línea base del courier, en días. */
const DIAS_BASE = 56;

/** Cuánto hacia atrás se buscan olas cuya ventana de entregas siga abierta. */
const DIAS_VENTANA_OLA = 15;

export const cargarTablero = cache(async function cargarTablero(
  tenantId: string,
): Promise<EstadoTorre> {
  const ahora = ahoraEnSantiago();
  const fecha = ahora.fecha;
  const ahoraMinutos = horaAMinutos(ahora.hora);
  const ahoraMs = ahora.instante.getTime();

  const [
    cabecera,
    configuradas,
    capacidad,
    sellersFilas,
    ventanas,
    pedidosFilas,
    cierresFilas,
    podFilas,
    paradasFilas,
    eventosComerciales,
    volumenBaseFilas,
  ] = await Promise.all([
    cargarCabecera(tenantId),
    obtenerZonasConfiguradas(tenantId),
    obtenerCapacidadInstalada(tenantId),
    obtenerSellers(tenantId),
    obtenerVentanasCorte(tenantId),
    obtenerPedidosDelDia(tenantId, fecha),
    obtenerCierresDelDia(tenantId, fecha),
    obtenerPodDelDia(tenantId, fecha),
    obtenerParadasDelDia(tenantId, fecha),
    // La ola mira MUCHO más lejos que el día: hasta 45 días hacia adelante, y
    // hacia atrás lo suficiente para no perder una ola cuya ventana de entregas
    // sigue abierta.
    obtenerEventosComerciales(
      sumarDiasCalendario(fecha, -DIAS_VENTANA_OLA),
      sumarDiasCalendario(fecha, HORIZONTE_OLA_DIAS),
    ),
    obtenerVolumenBase(tenantId, sumarDiasCalendario(fecha, -DIAS_BASE), fecha),
  ]);

  // --- Incidencias: dependen de qué pedidos hay hoy ---------------------------
  // Vienen todas en un viaje y se parten acá. Las abiertas son lo único rojo de
  // la pantalla; las cerradas son los intentos previos de cada paquete.
  const todasLasIncidencias = await obtenerIncidenciasDeLosPedidos(
    tenantId,
    pedidosFilas.map((p) => p.id).join(','),
  );
  const abiertas = new Set<string>(ESTADOS_INCIDENCIA_ABIERTA);
  const incidenciasFilas = todasLasIncidencias.filter((i) => abiertas.has(i.estado));

  // Cuántas veces falló antes este paquete. `0` no se guarda: el punto lo
  // resuelve con `?? 0`, así que el mapa solo lleva a los que tienen historia.
  const intentosPrevios = new Map<string, number>();
  for (const incidencia of todasLasIncidencias) {
    if (abiertas.has(incidencia.estado)) continue;
    intentosPrevios.set(
      incidencia.pedido_id,
      (intentosPrevios.get(incidencia.pedido_id) ?? 0) + 1,
    );
  }

  // --- Zonas: solo para resolver el corte y colgar el enlace ------------------
  const comunasPorZona = new Map<string, string[]>();
  for (const fila of configuradas.mapeo) {
    const canonica = resolverComunaCanonica(fila.comuna) ?? fila.comuna;
    const lista = comunasPorZona.get(fila.zona_id);
    if (lista) lista.push(canonica);
    else comunasPorZona.set(fila.zona_id, [canonica]);
  }
  const comunaAZona = indexarComunaAZona(
    configuradas.zonas.map((z) => ({ id: z.id, comunas: comunasPorZona.get(z.id) ?? [] })),
  );

  const ventanasCorte: VentanaCorte[] = ventanas.map((v) => ({
    zonaId: v.zona_id,
    horaCorte: v.hora_corte,
    activa: v.activa,
  }));

  // --- Lo que el conductor declaró en la app de Rutax ------------------------
  // POD del same-day y cierres de Flex se unifican acá: para la Torre las dos
  // responden la misma pregunta. Ver el encabezado de `consultas.ts`.
  const registrosCrudos: RegistroDeEntrega[] = [
    ...podFilas.map((p) => ({
      pedidoId: p.pedido_id,
      conductorId: p.conductor_id,
      entregado: p.tipo_resultado === 'entregado',
      registradoEn: p.capturado_en,
    })),
    ...cierresFilas.map((c) => ({
      pedidoId: c.pedido_id,
      conductorId: c.conductor_id,
      entregado: c.resultado === 'entregado',
      registradoEn: c.cerrado_en,
    })),
  ];
  const registros = unificarRegistros(registrosCrudos);

  // --- Pedidos, en las dos formas que el armado necesita ----------------------
  const pedidos: PedidoAgregable[] = pedidosFilas.map((p) => ({
    id: p.id,
    comuna: p.destinatario_comuna,
    estado: p.estado,
    ubicado: p.geo_estado === 'resuelto' && p.lat !== null && p.long !== null,
  }));
  const pedidosPorId = new Map(pedidos.map((p) => [p.id, p]));

  const codigos = new Map<string, string | null>(
    pedidosFilas.map((p) => [p.id, p.ml_shipment_id ?? p.codigo_interno ?? null]),
  );

  const pedidosConIncidencia = new Set(incidenciasFilas.map((i) => i.pedido_id));
  const incidenciasPorPedido = new Map<string, number>();
  for (const incidencia of incidenciasFilas) {
    incidenciasPorPedido.set(
      incidencia.pedido_id,
      (incidenciasPorPedido.get(incidencia.pedido_id) ?? 0) + 1,
    );
  }

  // --- F7: qué comunas están dentro del margen del corte ---------------------
  const comunasConCarga = [
    ...new Set(
      pedidosFilas
        .map((p) => p.destinatario_comuna)
        .filter((c): c is string => c !== null)
        .map((c) => resolverComunaCanonica(c) ?? c),
    ),
  ];
  const comunasEnRiesgo = comunasCercaDelCorte(
    comunasConCarga,
    comunaAZona,
    normalizarComuna,
    (zonaId) => minutosHastaCorte(ventanasCorte, zonaId, ahoraMinutos),
  );

  // --- Carga por comuna y resumen --------------------------------------------
  const carga = cargaPorComuna(pedidos, registros, incidenciasPorPedido, comunasEnRiesgo);
  const comunas = armarComunas(carga, comunaAZona, normalizarComuna);
  const resumen = armarResumen(carga);

  // --- Puntos del mapa --------------------------------------------------------
  const nombresConductores = new Map(
    capacidad.conductores.map((c) => [c.id, c.nombre_completo]),
  );
  const nombresSellers = new Map(sellersFilas.map((s) => [s.id, s.razon_social]));

  // El conductor de un pedido sale primero del registro que él mismo subió y,
  // si no hay, del denormalizado del pedido. Ese orden importa: el registro dice
  // quién lo tuvo en la mano, el denormalizado dice a quién está asignado ahora.
  const conductorDePedido = new Map<string, string>();
  for (const fila of pedidosFilas) {
    if (fila.driver_id_asignado) conductorDePedido.set(fila.id, fila.driver_id_asignado);
  }
  for (const registro of registros.values()) {
    conductorDePedido.set(registro.pedidoId, registro.conductorId);
  }

  const pedidosUbicables: PedidoUbicable[] = pedidosFilas.flatMap((fila) => {
    if (fila.geo_estado !== 'resuelto' || fila.lat === null || fila.long === null) return [];
    return [
      {
        id: fila.id,
        comuna: fila.destinatario_comuna,
        estado: fila.estado,
        ubicado: true,
        lat: fila.lat,
        long: fila.long,
        codigoEnvio: codigos.get(fila.id) ?? null,
        conductorId: conductorDePedido.get(fila.id) ?? null,
        sellerId: fila.seller_id,
      },
    ];
  });

  const puntos = armarPuntos({
    pedidos: pedidosUbicables,
    registros,
    pedidosConIncidencia,
    nombresConductores,
    nombresSellers,
    intentosPrevios,
    comunasEnRiesgo,
  });

  const incidencias = armarIncidencias({
    incidencias: incidenciasFilas.map((i) => ({
      id: i.id,
      pedidoId: i.pedido_id,
      tipo: i.tipo,
      abiertaEn: i.abierta_en,
    })),
    pedidos: pedidosPorId,
    codigos,
    conductorDePedido,
    nombresConductores,
  });

  // --- F13: avance por conductor ---------------------------------------------
  const cerrado = diaCerrado(ahoraMinutos);
  const conductores = avanceDeConductores({
    paradas: paradasFilas.map((p) => ({ conductorId: p.driver_id, pedidoId: p.pedido_id })),
    nombres: nombresConductores,
    registros,
    pedidos: pedidosPorId,
    ahoraMs,
    diaCerrado: cerrado,
  });

  // --- F9: las olas entrantes -------------------------------------------------
  // La capacidad de la ola la ponen los que van a estar: `activo` **y**
  // `disponible`. El nombre, en cambio, se lee de todos —incluido el que se dio
  // de baja hoy con sus paradas en la calle— porque el panel existe para saber a
  // quién llamar. Ver `obtenerCapacidadInstalada`.
  const disponibles = capacidad.conductores.filter(
    (c) => c.estado === 'activo' && c.disponible,
  );
  const capacidadDiaria = disponibles.reduce((s, c) => s + (c.capacidad_paradas ?? 0), 0);
  const capacidadMediaConductor =
    disponibles.length > 0 ? Math.round(capacidadDiaria / disponibles.length) : 0;

  const olas = proyectarOlas(
    proximasOlas(
      eventosComerciales.map((e) => ({
        id: e.id,
        nombre: e.nombre,
        arquetipo: e.arquetipo,
        organizador: e.organizador,
        inicio: e.inicio,
        fin: e.fin,
        multiplicadorBase: Number(e.multiplicador_base),
        curvaRezago: e.curva_rezago ?? {},
      })),
      fecha,
    ),
    {
      volumenBase: volumenBasePorDiaSemana(
        volumenBaseFilas.map((p) => p.fecha_compromiso).filter(Boolean),
      ),
      capacidadDiaria,
      capacidadPorConductor: capacidadMediaConductor,
      hoy: fecha,
    },
  );

  // --- F6: frescura del dato --------------------------------------------------
  const frescura = calcularFrescura(registrosCrudos, ahoraMs);

  // Última puerta antes de la pantalla: las columnas nullable y los numéricos que
  // llegan como string no los ve el typecheck.
  return validarEstadoTorre({
    courier: cabecera.courier,
    ahora: cabecera.ahoraIso,
    fecha,
    estado: resolverEstadoPantalla(resumen),
    resumen,
    comunas,
    puntos,
    incidencias,
    conductores,
    olas,
    frescura: { ...frescura, umbralMinutos: UMBRAL_FRESCURA_MINUTOS },
    corte: {
      hora: primeraHoraDeCorte(ventanasCorte),
      diaCerrado: cerrado,
      // `zonaId: null` = las ventanas que aplican a todo el courier, el mismo
      // criterio que `primeraHoraDeCorte`. `0` significa vencido: la función
      // trunca en cero a propósito, más allá del corte la urgencia no crece.
      vencido: minutosHastaCorte(ventanasCorte, null, ahoraMinutos) === 0,
    },
  });
});

/**
 * La hora de corte que la pantalla declara. La más temprana entre las activas,
 * por el mismo criterio que `minutosHastaCorte`: el corte que aprieta es el
 * primero que vence.
 *
 * `null` cuando el courier no configuró ninguna — no se inventa una.
 */
function primeraHoraDeCorte(ventanas: readonly VentanaCorte[]): string | null {
  const activas = ventanas.filter((v) => v.activa);
  if (activas.length === 0) return null;
  return activas
    .map((v) => v.horaCorte)
    .sort((a, b) => horaAMinutos(a) - horaAMinutos(b))[0]
    .slice(0, 5);
}
