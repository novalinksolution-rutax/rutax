/**
 * Armado del payload de la Torre v2 — puro, sin base y sin reloj propio.
 * =====================================================================
 *
 * Este archivo convierte lo que `consultas.ts` trajo de la base y lo que
 * `agregacion.ts` agregó en el `EstadoTorre` que consume la pantalla. Todo entra
 * por parámetro, incluido «ahora»: así se prueba sin levantar Supabase y sin que
 * el resultado dependa de a qué hora corran las pruebas.
 *
 * Reemplaza a los tres `armado-*.ts` de la v1 (`armado-zonas`, `armado-mapa`,
 * `armado-riel`). Esa partición espejaba las seis regiones del handoff retirado;
 * con la comuna como unidad, el mapa y la lista muestran **lo mismo** a distinta
 * granularidad, así que partirlo en tres solo obligaba a mantener tres copias de
 * la misma cuenta.
 */

import { CENTROIDES_RM } from '@/lib/geo/centroides-rm';
import type { ComunaRM } from '@/lib/ui/comunas-rm';
import { traducirTipoIncidencia } from '@/lib/ui/traduccion-estados';
// `contexto` puede leer de `operacion`; lo prohibido es el sentido inverso
// (CLAUDE.md). Acá es solo el tipo del enum de incidencias.
import type { TipoIncidencia } from '@/modules/operacion/tipos';
import { resolverComunaCanonica } from '@/modules/integraciones/geocoding/normalizacion';
import type {
  ComunaEnTorre,
  Coordenada,
  EstadoPantalla,
  EstadoPunto,
  IncidenciaEnTorre,
  PuntoEntrega,
  ResumenTorre,
} from '../contrato-torre';
import {
  claveDeUbicacion,
  estaEnRiesgoDeCorte,
  resolverPedido,
  type CargaComuna,
  type PedidoAgregable,
  type RegistroDeEntrega,
} from '../agregacion';

/** Centro de la RM. Solo se usa si una comuna no tiene centroide conocido. */
const CENTRO_RM: Coordenada = { lat: -33.4489, long: -70.6693 };

// =============================================================================
// Comunas — F1
// =============================================================================

/**
 * Las comunas con carga hoy, ordenadas por **cuántas faltan**, descendente.
 *
 * Ese orden es la lista de F10 (el equivalente sin mapa) y también el orden en
 * que la pantalla decide a quién dar más peso visual. Alfabético enterraría la
 * comuna que duele detrás de las que ya cerraron.
 *
 * Una comuna sin carga hoy **no aparece**: la Torre muestra el día, no el
 * catálogo de las 52 comunas de la RM. El mapa las dibuja todas igual, porque la
 * geometría la tiene el cliente; las que no están acá se pintan neutras.
 */
export function armarComunas(
  carga: ReadonlyMap<string | null, CargaComuna>,
  comunaAZona: ReadonlyMap<string, string>,
  normalizar: (comuna: string) => string,
): ComunaEnTorre[] {
  const salida: ComunaEnTorre[] = [];

  for (const [nombre, datos] of carga) {
    // La clave `null` agrupa los pedidos sin comuna resuelta. No son una comuna:
    // se cuentan en el resumen global y no se dibujan en el mapa.
    if (nombre === null) continue;

    salida.push({
      nombre,
      pendientes: datos.pendientes,
      total: datos.total,
      entregados: datos.entregados,
      incidenciasAbiertas: datos.incidenciasAbiertas,
      enRiesgoDeCorte: datos.enRiesgoDeCorte,
      centro: CENTROIDES_RM[nombre as ComunaRM] ?? CENTRO_RM,
      zonaId: comunaAZona.get(normalizar(nombre)) ?? null,
    });
  }

  return salida.sort(
    (a, b) => b.pendientes - a.pendientes || a.nombre.localeCompare(b.nombre, 'es'),
  );
}

// =============================================================================
// Puntos del mapa — F2 nivel 3 y F3
// =============================================================================

/**
 * Prioridad visual cuando varios pedidos comparten ubicación.
 *
 * Mayor gana. **Una incidencia nunca puede quedar escondida detrás de un
 * entregado**: es lo único accionable de la pantalla, y un edificio con cinco
 * entregas correctas y una fallida tiene que verse rojo.
 */
const PRIORIDAD_ESTADO: Record<EstadoPunto, number> = {
  incidencia: 3,
  pendiente: 2,
  en_ruta: 1,
  entregado: 0,
};

/** Entrada de un pedido ubicado, con todo lo que el punto necesita. */
export interface PedidoUbicable extends PedidoAgregable {
  lat: number;
  long: number;
  codigoEnvio: string | null;
  conductorId: string | null;
}

/**
 * Los puntos del mapa, ya colapsados por ubicación.
 *
 * **Los pedidos van por la fuente GeoJSON de MapLibre y ahí se quedan.** Está
 * medido: 600 pedidos promovidos a anclas HTML cuestan 31,77 ms por frame (~31
 * fps), mientras que por GeoJSON los dibuja la GPU. La capa HTML es solo para las
 * placas de comuna y los conductores. Ver `docs/arquitectura/mapa-torre-v2.md` §2.
 *
 * El colapso deja **un punto por ubicación** con su `agrupados`, y el
 * representante es el de mayor prioridad visual. Sin esto, un edificio con seis
 * entregas se ve como una mancha de seis círculos encimados.
 */
export function armarPuntos(params: {
  pedidos: readonly PedidoUbicable[];
  registros: ReadonlyMap<string, RegistroDeEntrega>;
  pedidosConIncidencia: ReadonlySet<string>;
  nombresConductores: ReadonlyMap<string, string>;
  comunasEnRiesgo: ReadonlySet<string>;
}): PuntoEntrega[] {
  const { pedidos, registros, pedidosConIncidencia, nombresConductores, comunasEnRiesgo } = params;

  const porUbicacion = new Map<string, { punto: PuntoEntrega; total: number }>();

  for (const pedido of pedidos) {
    const { cerrado, entregado } = resolverPedido(pedido, registros.get(pedido.id));
    const comuna = pedido.comuna === null ? null : resolverComunaCanonica(pedido.comuna) ?? pedido.comuna;

    const estado: EstadoPunto = pedidosConIncidencia.has(pedido.id)
      ? 'incidencia'
      : entregado
        ? 'entregado'
        : cerrado
          ? // Cerrado sin entregar y sin incidencia abierta: alguien lo resolvió.
            // No es accionable, así que no puede robarle el rojo a la incidencia.
            'entregado'
          : pedido.estado === 'en_ruta'
            ? 'en_ruta'
            : 'pendiente';

    const punto: PuntoEntrega = {
      id: pedido.id,
      posicion: { lat: pedido.lat, long: pedido.long },
      codigoEnvio: pedido.codigoEnvio,
      estado,
      comuna,
      conductorId: pedido.conductorId,
      conductorNombre: pedido.conductorId
        ? nombresConductores.get(pedido.conductorId) ?? null
        : null,
      agrupados: 1,
      cercaDelCorte: !cerrado && comuna !== null && comunasEnRiesgo.has(comuna),
    };

    const clave = claveDeUbicacion(pedido.lat, pedido.long);
    const grupo = porUbicacion.get(clave);

    if (!grupo) {
      porUbicacion.set(clave, { punto, total: 1 });
      continue;
    }

    grupo.total += 1;
    if (PRIORIDAD_ESTADO[estado] > PRIORIDAD_ESTADO[grupo.punto.estado]) {
      grupo.punto = punto;
    }
  }

  return [...porUbicacion.values()].map(({ punto, total }) => ({ ...punto, agrupados: total }));
}

// =============================================================================
// Incidencias — F4
// =============================================================================

/**
 * Las incidencias abiertas, de la más reciente a la más antigua.
 *
 * Cada una lleva el código de envío y el nombre del conductor porque son las dos
 * cosas que el coordinador necesita para actuar: a quién llamar y qué paquete
 * nombrarle. No lleva nada del destinatario.
 */
export function armarIncidencias(params: {
  incidencias: readonly { id: string; pedidoId: string; tipo: string; abiertaEn: string }[];
  pedidos: ReadonlyMap<string, PedidoUbicable | PedidoAgregable>;
  codigos: ReadonlyMap<string, string | null>;
  conductorDePedido: ReadonlyMap<string, string>;
  nombresConductores: ReadonlyMap<string, string>;
}): IncidenciaEnTorre[] {
  const { incidencias, pedidos, codigos, conductorDePedido, nombresConductores } = params;

  return incidencias
    .map((incidencia) => {
      const pedido = pedidos.get(incidencia.pedidoId);
      const comunaCruda = pedido?.comuna ?? null;
      const conductorId = conductorDePedido.get(incidencia.pedidoId);

      return {
        id: incidencia.id,
        pedidoId: incidencia.pedidoId,
        tipo: incidencia.tipo,
        etiqueta: traducirTipoIncidencia(incidencia.tipo as TipoIncidencia),
        comuna: comunaCruda === null ? null : resolverComunaCanonica(comunaCruda) ?? comunaCruda,
        codigoEnvio: codigos.get(incidencia.pedidoId) ?? null,
        conductorNombre: conductorId ? nombresConductores.get(conductorId) ?? null : null,
        abiertaEn: incidencia.abiertaEn,
      };
    })
    .sort((a, b) => b.abiertaEn.localeCompare(a.abiertaEn));
}

// =============================================================================
// Resumen y estado de pantalla
// =============================================================================

/**
 * Las cifras de cabecera, sumadas sobre TODAS las comunas más los pedidos sin
 * comuna resuelta.
 *
 * El `null` de la carga entra acá aunque no entre en el mapa: si se descartara,
 * el total de la cabecera no cuadraría con la operación real y eso destruye la
 * confianza en toda la pantalla (regla 5 del alcance).
 */
export function armarResumen(carga: ReadonlyMap<string | null, CargaComuna>): ResumenTorre {
  const resumen: ResumenTorre = {
    total: 0,
    pendientes: 0,
    entregados: 0,
    incidenciasAbiertas: 0,
    enRiesgoDeCorte: 0,
    sinUbicar: 0,
  };

  for (const datos of carga.values()) {
    resumen.total += datos.total;
    resumen.pendientes += datos.pendientes;
    resumen.entregados += datos.entregados;
    resumen.incidenciasAbiertas += datos.incidenciasAbiertas;
    resumen.enRiesgoDeCorte += datos.enRiesgoDeCorte;
    resumen.sinUbicar += datos.sinUbicar;
  }

  return resumen;
}

/**
 * En qué estado abre la pantalla.
 *
 * De la v1 cayeron `degradado` y `sin_zonas`. El primero era el estado en que la
 * Torre abría SIEMPRE —`fuentes_estado` declaraba `senales` y `transito` caídas
 * de forma permanente, por dos fuentes que se decidió no construir— y el segundo
 * no tiene sentido con la comuna como unidad: las comunas de la RM existen
 * configure o no el courier sus zonas.
 */
export function resolverEstadoPantalla(resumen: ResumenTorre): EstadoPantalla {
  if (resumen.total === 0) return 'sin_pedidos';
  if (resumen.incidenciasAbiertas > 0) return 'con_incidencias';
  return 'tranquilo';
}

// =============================================================================
// Comunas cerca del corte — F7, cálculo interno
// =============================================================================

/**
 * Qué comunas están dentro del margen de su hora de corte.
 *
 * Devuelve un conjunto de nombres canónicos, no una hora: el corte se calcula
 * para MARCAR, y la pantalla no dibuja ninguna cuenta regresiva. El corte del
 * same-day es uno solo y todo el courier lo sabe de memoria, así que un reloj en
 * la cabecera no informaría nada.
 */
export function comunasCercaDelCorte(
  comunas: readonly string[],
  comunaAZona: ReadonlyMap<string, string>,
  normalizar: (comuna: string) => string,
  minutosDeZona: (zonaId: string | null) => number | null,
): Set<string> {
  const enRiesgo = new Set<string>();
  for (const comuna of comunas) {
    const zonaId = comunaAZona.get(normalizar(comuna)) ?? null;
    if (estaEnRiesgoDeCorte(minutosDeZona(zonaId))) enRiesgo.add(comuna);
  }
  return enRiesgo;
}
