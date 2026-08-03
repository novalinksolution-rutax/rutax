/**
 * El composer de la Torre — de la base a `TorreRespuesta`.
 * =====================================================================
 *
 * Dos cargadores, y la división NO es arbitraria: es dónde el dato deja de
 * depender de sí mismo.
 *
 *   · `cargarCabecera` — el courier y la salud de las cinco fuentes. Dos
 *     consultas diminutas que no dependen de nada más, así que R1 pinta primero
 *     y sin esperar al resto.
 *   · `cargarTablero` — todo lo demás, en un `TorreRespuesta` con los tres
 *     horizontes ya calculados.
 *
 * **Por qué el tablero no se parte más fino, aunque la pantalla tenga seis
 * regiones.** Se intentó: el candidato natural era separar «las capas del mapa»
 * del «núcleo de zonas». No se puede sin mentir, porque las piezas se necesitan
 * entre sí — la línea de tiempo (R5) dibuja los bloques de lluvia, que salen de
 * las celdas de clima (R3); el control de capas necesita saber si hay lluvia que
 * dibujar; y el riel (R4) necesita las zonas que pinta el mapa. Partirlo sería
 * hacer que un cargador esperara al otro con dos nombres distintos.
 *
 * Lo que SÍ es por región es el `<Suspense>`: cada una tiene su propio límite y
 * su propio esqueleto con nombre, como pide el handoff («no hay spinner de
 * página; nombrar lo que falta es parte del diseño»).
 *
 * -----------------------------------------------------------------------------
 * LOS TRES HORIZONTES VIENEN EN EL MISMO PAYLOAD
 * -----------------------------------------------------------------------------
 * Cambiar de horizonte no puede disparar un viaje al servidor: remontaría el
 * tablero y haría saltar la posición de scroll del riel, que el handoff prohíbe
 * expresamente. Por eso `TorreRespuesta` trae `hoy`, `manana` y `72h`
 * precalculados y el cambio es puramente de cliente.
 *
 * **A 72 horas se cuentan solo pedidos YA INGESTADOS, nunca una proyección.**
 * Se verá casi vacío, y es correcto: la proyección de volumen es del calendario
 * comercial (el horizonte `olas`), que va etiquetada como tal y todavía no
 * existe.
 */

import { cache } from 'react';
import {
  ahoraEnSantiago,
  fechaLocalEnSantiago,
  horaAMinutos,
  limitesDelDiaSantiago,
  sumarDiasCalendario,
} from '@/lib/fecha-santiago';
import { normalizarComuna, resolverComunaCanonica } from '@/modules/integraciones/geocoding/normalizacion';
import { capacidadPorZona, cargaPorZona } from '../agregacion';
import {
  HORIZONTE_OLA_DIAS,
  plazoMedianoPorZona,
  proximaOla,
  proyectarOla,
  volumenBasePorDiaSemana,
} from '../olas';
import { MACRO_ZONAS_RM } from '../macro-zonas-rm';
import { HORIZONTES_TORRE, type EstadoTorre, type HorizonteTorre, type TorreRespuesta } from '../contrato-torre';
import {
  obtenerCapacidadInstalada,
  obtenerConteosPedidos,
  obtenerEventosComerciales,
  obtenerFlotaEnVivo,
  obtenerManifiestosDelDia,
  obtenerParadasDelDia,
  obtenerPlazosDeEntrega,
  obtenerVolumenBase,
  obtenerContextoExterno,
  obtenerCourier,
  obtenerEntregados,
  obtenerFrescuraFuentes,
  obtenerMarcasOperativas,
  obtenerPedidosUbicados,
  obtenerNombresDeUsuarios,
  obtenerPedidosPendientes,
  obtenerRiesgoZona,
  obtenerTarifas,
  obtenerSenalesDelTenant,
  obtenerVentanasCorte,
  obtenerZonasConfiguradas,
  DIAS_COMPARACION,
} from './consultas';
import {
  armarZonas,
  contarPorZona,
  indexarComunaAZona,
  type ConductorDeZona,
  type RiesgoDeFranja,
  type ZonaConfigurada,
} from './armado-zonas';
import {
  armarCapas,
  armarCeldasClima,
  armarConductores,
  armarFrescura,
  armarMarcasOperativas,
  armarPedidosEnMapa,
  armarPronosticoAire,
  armarRestricciones,
  armarTimeline,
} from './armado-mapa';
import {
  armarExcepciones,
  armarMetricas,
  etiquetaPedidosDeHorizonte,
  fechaDeHorizonte,
  resolverEstadoPantalla,
} from './armado-riel';
import { validarTorreRespuesta } from './esquema';

// =============================================================================
// Cabecera — R1
// =============================================================================

export interface CabeceraTorre {
  courier: { id: string; nombre: string };
  frescura: ReturnType<typeof armarFrescura>;
  /** Instante ISO de «ahora», calculado UNA vez en el servidor. */
  ahoraIso: string;
}

export const cargarCabecera = cache(async function cargarCabecera(
  tenantId: string,
): Promise<CabeceraTorre> {
  const ahora = ahoraEnSantiago();
  const [courier, fuentes] = await Promise.all([
    obtenerCourier(tenantId),
    obtenerFrescuraFuentes(),
  ]);

  return {
    courier,
    frescura: armarFrescura(fuentes, ahora.instante),
    ahoraIso: ahora.instante.toISOString(),
  };
});

// =============================================================================
// Tablero — R2 a R6
// =============================================================================

/** Ventana histórica para la línea base del courier y sus plazos, en días. */
const DIAS_BASE = 56;

/** Cuánto hacia atrás se buscan olas cuya ventana de entregas siga abierta. */
const DIAS_VENTANA_OLA = 15;

const MOTIVO_SIN_CALCULO_ZONAS =
  'El motor de riesgo empieza a calcular en cuanto agrupes tus comunas en zonas.';
const MOTIVO_SIN_CALCULO_JOB =
  'Todavía no hay un cálculo de riesgo para esta fecha. Se recalcula cada 15 minutos.';

export const cargarTablero = cache(async function cargarTablero(
  tenantId: string,
): Promise<TorreRespuesta> {
  const ahora = ahoraEnSantiago();
  const fechaBase = ahora.fecha;
  const ahoraMinutos = horaAMinutos(ahora.hora);
  const ahoraIso = ahora.instante.toISOString();

  const fechaUltima = sumarDiasCalendario(fechaBase, 2);
  const fechaComparacionDesde = sumarDiasCalendario(fechaBase, -DIAS_COMPARACION);

  // --- Zonas: las del courier, o el fallback de macro-zonas -------------------
  const configuradas = await obtenerZonasConfiguradas(tenantId);
  const tieneZonasPropias = configuradas.zonas.length > 0;

  const comunasPorZona = new Map<string, string[]>();
  for (const fila of configuradas.mapeo) {
    const canonica = resolverComunaCanonica(fila.comuna) ?? fila.comuna;
    const lista = comunasPorZona.get(fila.zona_id);
    if (lista) lista.push(canonica);
    else comunasPorZona.set(fila.zona_id, [canonica]);
  }

  const zonas: ZonaConfigurada[] = tieneZonasPropias
    ? configuradas.zonas.map((z) => ({
        id: z.id,
        nombre: z.nombre,
        comunas: comunasPorZona.get(z.id) ?? [],
      }))
    : MACRO_ZONAS_RM.map((z) => ({ id: z.id, nombre: z.nombre, comunas: [...z.comunas] }));

  const zonaIds = zonas.map((z) => z.id);
  const zonaIdsValidos = new Set(zonaIds);
  const comunaAZona = indexarComunaAZona(zonas);
  const comunasDelTenant = [...new Set(zonas.flatMap((z) => z.comunas))];

  // --- Todo lo demás, en paralelo --------------------------------------------
  const [
    cabecera,
    riesgoFilas,
    capacidad,
    ventanas,
    conteos,
    externo,
    marcasFilas,
    pedidosUbicadosFilas,
    entregadosFilas,
    pendientesFilas,
    tarifasFilas,
    eventosComerciales,
    volumenBaseFilas,
    plazosFilas,
    flotaFilas,
    paradasFilas,
    manifiestosFilas,
  ] = await Promise.all([
      cargarCabecera(tenantId),
      // Las zonas del fallback no existen en `identidad.zonas`, así que tampoco
      // en `riesgo_zona`: pedirlo sería un viaje garantizado a vacío.
      tieneZonasPropias
        ? obtenerRiesgoZona(tenantId, fechaComparacionDesde, fechaUltima)
        : Promise.resolve([]),
      obtenerCapacidadInstalada(tenantId),
      obtenerVentanasCorte(tenantId),
      obtenerConteosPedidos(tenantId, fechaBase),
      obtenerContextoExterno(comunasDelTenant.join(','), fechaBase, fechaUltima),
      obtenerMarcasOperativas(tenantId, fechaBase, fechaUltima),
      obtenerPedidosUbicados(tenantId, fechaBase, fechaUltima),
      obtenerEntregados(tenantId, fechaBase, fechaUltima),
      obtenerPedidosPendientes(tenantId, fechaBase, fechaUltima),
      obtenerTarifas(tenantId),
      // La ola entrante mira MUCHO más lejos que los tres horizontes: hasta 45
      // días hacia adelante, y hacia atrás lo suficiente para no perder una ola
      // cuya ventana de entregas sigue abierta.
      obtenerEventosComerciales(
        sumarDiasCalendario(fechaBase, -DIAS_VENTANA_OLA),
        sumarDiasCalendario(fechaBase, HORIZONTE_OLA_DIAS),
      ),
      obtenerVolumenBase(tenantId, sumarDiasCalendario(fechaBase, -DIAS_BASE), fechaBase),
      obtenerPlazosDeEntrega(tenantId, sumarDiasCalendario(fechaBase, -DIAS_BASE), fechaBase),
      obtenerFlotaEnVivo(tenantId),
      obtenerParadasDelDia(tenantId, fechaBase),
      obtenerManifiestosDelDia(tenantId, fechaBase),
    ]);

  const autores = [
    ...new Set(marcasFilas.map((m) => m.autor_usuario_id).filter((id): id is string => id !== null)),
  ];
  const nombresAutores = await obtenerNombresDeUsuarios(tenantId, autores.join(','));

  // --- Capacidad y conductores por zona --------------------------------------
  const disponibles = capacidad.conductores.filter((c) => c.disponible);
  const capacidadDeZona = capacidadPorZona(
    disponibles.map((c) => ({ id: c.id, capacidadParadas: c.capacidad_paradas ?? 0 })),
    capacidad.asignaciones.map((a) => ({ conductorId: a.conductor_id, zonaId: a.zona_id })),
    zonaIds,
  );

  const conductoresPorZona = new Map<string, ConductorDeZona[]>(zonaIds.map((id) => [id, []]));
  const porId = new Map(capacidad.conductores.map((c) => [c.id, c]));
  for (const asignacion of capacidad.asignaciones) {
    const lista = conductoresPorZona.get(asignacion.zona_id);
    const conductor = porId.get(asignacion.conductor_id);
    if (!lista || !conductor) continue;
    lista.push({
      id: conductor.id,
      capacidadParadas: conductor.capacidad_paradas ?? 0,
      disponible: conductor.disponible,
    });
  }

  const tarifas = new Map(tarifasFilas.map((t) => [t.id, t.monto_clp]));

  const ventanasCorte = ventanas.map((v) => ({
    zonaId: v.zona_id,
    horaCorte: v.hora_corte,
    activa: v.activa,
  }));

  // --- Riesgo indexado por fecha ---------------------------------------------
  const riesgoPorFecha = new Map<string, RiesgoDeFranja[]>();
  for (const fila of riesgoFilas) {
    const lista = riesgoPorFecha.get(fila.fecha) ?? [];
    lista.push({
      zonaId: fila.zona_id,
      franja: fila.franja,
      puntaje: fila.puntaje,
      desglose: fila.desglose,
      pedidosPendientes: fila.pedidos_pendientes,
      montoComprometidoClp: Number(fila.monto_comprometido_clp ?? 0),
    });
    riesgoPorFecha.set(fila.fecha, lista);
  }

  // --- Contexto externo compartido por los tres horizontes -------------------
  const pronosticoAire = armarPronosticoAire(externo.aire, fechaBase);
  const restricciones = armarRestricciones(externo.restricciones);
  const marcasOperativas = armarMarcasOperativas(marcasFilas, nombresAutores);
  // Nivel 3 del mapa. Solo punto y estado — la dirección no entra al payload.
  const pedidosEnMapa = armarPedidosEnMapa(pedidosUbicadosFilas, comunaAZona);

  const motivoSinCalculo = tieneZonasPropias ? MOTIVO_SIN_CALCULO_JOB : MOTIVO_SIN_CALCULO_ZONAS;

  // --- La flota en vivo -------------------------------------------------------
  // Se arma UNA vez: la posición de un conductor no depende del horizonte que el
  // coordinador esté mirando — está donde está.
  const ESTADOS_PARADA_CERRADA = new Set(['entregado', 'entregado_manual', 'fallido', 'fallido_manual']);
  const paradasPorConductor = new Map<string, { total: number; completadas: number }>();
  for (const parada of paradasFilas) {
    const actual = paradasPorConductor.get(parada.driver_id) ?? { total: 0, completadas: 0 };
    actual.total += 1;
    if (ESTADOS_PARADA_CERRADA.has(parada.estado)) actual.completadas += 1;
    paradasPorConductor.set(parada.driver_id, actual);
  }
  const manifiestoPorConductor = new Map(manifiestosFilas.map((m) => [m.driver_id, m.estado]));

  // Zona del conductor: su zona preferente. Un conductor sin asignación queda con
  // zona vacía en vez de quedar fuera del mapa — perder de vista a alguien que
  // está en la calle es peor que no poder filtrarlo por zona.
  const zonaDeConductor = new Map<string, string>();
  for (const a of capacidad.asignaciones) {
    if (!zonaDeConductor.has(a.conductor_id) && zonaIdsValidos.has(a.zona_id)) {
      zonaDeConductor.set(a.conductor_id, a.zona_id);
    }
  }

  const conductoresEnMapa = armarConductores(
    flotaFilas.flatMap((fila) => {
      const conductor = porId.get(fila.conductor_id);
      if (!conductor || fila.lat === null || fila.long === null) return [];
      const paradas = paradasPorConductor.get(fila.conductor_id) ?? { total: 0, completadas: 0 };
      return [
        {
          id: fila.conductor_id,
          nombre: conductor.nombre_completo,
          zonaId: zonaDeConductor.get(fila.conductor_id) ?? '',
          lat: fila.lat,
          long: fila.long,
          ultimoPing: fila.actualizado_en,
          paradasTotales: paradas.total,
          paradasCompletadas: paradas.completadas,
          estadoManifiesto: manifiestoPorConductor.get(fila.conductor_id) ?? null,
        },
      ];
    }),
    ahora.instante,
  );

  // --- La ola entrante --------------------------------------------------------
  // Se proyecta UNA vez y se comparte entre los tres horizontes: la ola no
  // cambia según si el coordinador mira hoy o pasado mañana — es la misma ola.
  const evento = proximaOla(
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
    fechaBase,
  );

  const capacidadDiaria = [...capacidadDeZona.values()].reduce((s, v) => s + v, 0);
  const capacidadMediaConductor =
    disponibles.length > 0
      ? Math.round(
          disponibles.reduce((s, c) => s + (c.capacidad_paradas ?? 0), 0) / disponibles.length,
        )
      : 0;

  const olaEntrante = evento
    ? proyectarOla({
        evento,
        volumenBase: volumenBasePorDiaSemana(
          volumenBaseFilas.map((p) => p.fecha_compromiso).filter(Boolean),
        ),
        capacidadDiaria,
        capacidadPorConductor: capacidadMediaConductor,
        hoy: fechaBase,
        plazoPorZona: plazoMedianoPorZona(
          plazosFilas.map((p) => ({
            comuna: p.destinatario_comuna,
            creadoEn: p.creado_en,
            fechaCompromiso: p.fecha_compromiso,
          })),
          comunaAZona,
          normalizarComuna,
          fechaLocalEnSantiago,
        ),
      })
    : null;

  // --- Un `EstadoTorre` por horizonte ----------------------------------------
  const horizontes = {} as Record<HorizonteTorre, EstadoTorre>;

  for (const horizonte of HORIZONTES_TORRE) {
    const fecha = fechaDeHorizonte(fechaBase, horizonte);
    const diasDeDiferencia = HORIZONTES_TORRE.indexOf(horizonte);
    const riesgoDelDia = riesgoPorFecha.get(fecha) ?? [];

    const entregadosPorZona = contarPorZona(
      entregadosFilas
        .filter((p) => p.fecha_compromiso === fecha)
        .map((p) => ({ comuna: p.destinatario_comuna })),
      comunaAZona,
    );

    // Respaldo para las zonas sin fila de riesgo. Se calcula con `cargaPorZona`
    // —la MISMA función pura que usa el job— y no con una agregación propia: si
    // el composer contara por su cuenta, el mapa y el desglose podrían
    // contradecirse en cuanto una de las dos cuentas cambiara.
    const cargaEnVivoPorZona = cargaPorZona(
      pendientesFilas.map((p) => ({
        destinatarioComuna: p.destinatario_comuna,
        fechaCompromiso: p.fecha_compromiso,
        tarifaAplicableId: p.tarifa_aplicable_id,
      })),
      comunaAZona,
      tarifas,
      fecha,
    );

    const zonasDelHorizonte = armarZonas({
      zonas,
      riesgo: riesgoDelDia,
      capacidadPorZona: capacidadDeZona,
      conductoresPorZona,
      entregadosPorZona,
      cargaEnVivoPorZona,
      ventanas: ventanasCorte,
      diasDeDiferencia,
      ahoraMinutos,
      motivoSinCalculo,
    });

    const celdasClima = armarCeldasClima(externo.clima, comunaAZona, fecha);
    const { timeline, rangoTimeline } = armarTimeline({
      fecha,
      zonas: zonasDelHorizonte,
      celdasClima,
      restricciones,
    });

    const excepciones = armarExcepciones({
      zonas: zonasDelHorizonte,
      riesgo: riesgoDelDia,
      pronosticoAire,
      fecha,
      ahoraIso,
    });

    const montoSemanaAnterior = sumarMontoDeFecha(
      riesgoPorFecha.get(sumarDiasCalendario(fecha, -DIAS_COMPARACION)) ?? [],
    );

    const metricas = armarMetricas({
      zonas: zonasDelHorizonte,
      etiquetaPedidos: etiquetaPedidosDeHorizonte(horizonte),
      totalPedidos: conteos.totalPorFecha[fecha] ?? 0,
      totalSemanaAnterior: conteos.totalSemanaAnteriorPorFecha[fecha] ?? 0,
      montoSemanaAnteriorClp: montoSemanaAnterior,
      atrasados: horizonte === 'hoy' ? conteos.atrasados : 0,
      sinGeocodificar: conteos.sinGeocodificar,
    });

    horizontes[horizonte] = {
      courier: cabecera.courier,
      ahora: ahoraIso,
      horizonte,
      estado: resolverEstadoPantalla({
        tieneZonasPropias,
        totalPedidos: conteos.totalPorFecha[fecha] ?? 0,
        hayExcepciones: excepciones.length > 0,
        frescura: cabecera.frescura,
      }),
      zoom: 'zonas',
      zonaSeleccionada: null,
      metricas,
      zonas: zonasDelHorizonte,
      excepciones,
      // `null` cuando no hay ola a la vista dentro del horizonte, o cuando el
      // courier no tiene todavía historia con la que fijar su línea base. R2 ya
      // sabe no dibujarse en ese caso.
      olaEntrante,
      timeline,
      rangoTimeline,
      capas: armarCapas({
        frescura: cabecera.frescura,
        hayClima: celdasClima.length > 0,
        hayConductores: conductoresEnMapa.length > 0,
      }),
      frescura: cabecera.frescura,
      conductores: conductoresEnMapa,
      celdasClima,
      pedidos: pedidosEnMapa,
      marcasOperativas,
      pronosticoAire,
      restricciones,
      pedidosSinGeocodificar: conteos.sinGeocodificar,
    };
  }

  // Última puerta antes de la pantalla: el `jsonb` de `desglose`, las columnas
  // nullable y los `bigint` que llegan como string no los ve el typecheck.
  return validarTorreRespuesta({ horizonteInicial: 'hoy', horizontes });
});

/**
 * Monto comprometido de un día. Las tres franjas de una zona traen el MISMO
 * monto (el job lo escribe igual en las tres: es del día, no de la franja), así
 * que se suma una sola vez por zona.
 */
function sumarMontoDeFecha(filas: readonly RiesgoDeFranja[]): number {
  const porZona = new Map<string, number>();
  for (const fila of filas) {
    if (!porZona.has(fila.zonaId)) porZona.set(fila.zonaId, fila.montoComprometidoClp);
  }
  let total = 0;
  for (const monto of porZona.values()) total += monto;
  return total;
}
