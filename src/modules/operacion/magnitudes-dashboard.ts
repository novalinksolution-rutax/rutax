/**
 * Las magnitudes del mosaico del dashboard que `metricas.ts` no producía.
 * =============================================================================
 *
 * El tablero B1c reemplaza la pila de nueve secciones del dashboard por un
 * mosaico de ocho magnitudes. Cinco salían de `obtenerMetricasDelDia`; estas
 * son las que hubo que construir, y cada una tiene una decisión detrás que no
 * es obvia al leer la consulta.
 *
 * -----------------------------------------------------------------------------
 * «ENTREGADOS HOY · 82 DE 120 · 68 %» NO ES LA TASA DE ENTREGA
 * -----------------------------------------------------------------------------
 * `metricas.tasaEntrega` divide por lo que YA CERRÓ (entregados + fallidos +
 * devueltos), así que responde «¿qué tan bien sale lo que va cerrando?». A las
 * 16:30, con 30 entregados de 120 y un fallido, da **97 %** — y se lee como un
 * día excelente cuando recién va en un cuarto.
 *
 * El mosaico usa la otra división: entregados sobre el TOTAL del día. Parte en
 * 0 % a las 16:00 y sube hasta el corte. Responde «¿cuánto llevo del día?», que
 * es la primera de las dos preguntas que el tablero dice que la pantalla
 * contesta en cinco segundos. Decisión del usuario, 23-08-2026.
 *
 * -----------------------------------------------------------------------------
 * «AYER A ESTA HORA» SALE DE LO QUE DECLARA LA APP, COMO LA TORRE
 * -----------------------------------------------------------------------------
 * `operacion.pedidos` **no guarda cuándo se entregó**: solo `creado_en` y un
 * `actualizado_en` que pisa cualquier UPDATE. Los únicos instantes de entrega
 * del sistema son los dos que ya usa la Torre — `pruebas_entrega.capturado_en`
 * (same-day, POD autoritativo) y `cierres_conductor.cerrado_en` (Flex, registro
 * paralelo del courier).
 *
 * Consecuencia asumida, la misma que la Torre declara: esto cuenta lo que el
 * conductor cerró en la app de Rutax, no el estado oficial que llega desde ML
 * con retraso.
 *
 * ⚠️ **Y por eso la comparación puede no existir.** Si ayer no hubo un solo
 * cierre declarado —la flota de ese courier no usa la app, o simplemente no era
 * día hábil—, la función devuelve `null` y la tarjeta **omite la línea**. Nunca
 * «ayer a esta hora, 0 %»: un cero inventado se lee como un día pésimo, y sería
 * mentir sobre un dato que no tenemos (regla 35).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  combinarFechaHoraSantiago,
  fechaLocalEnSantiago,
  horaLocalEnSantiago,
  limitesDelDiaSantiago,
  sumarDiasCalendario,
} from "@/lib/fecha-santiago";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";

/**
 * El filtro de «pedidos del día», idéntico al de `obtenerMetricasDelDia`: por
 * fecha de compromiso, o creados ese día cuando no tienen una (el same-day sin
 * fecha fija). Se repite acá a propósito en vez de exportarse desde `metricas`:
 * son la misma regla y tienen que moverse juntas, así que va con esta nota en
 * los dos lados.
 */
function filtroPedidosDelDia(fechaStr: string): string {
  const { desde, hasta } = limitesDelDiaSantiago(fechaStr);
  return (
    `fecha_compromiso.eq.${fechaStr},` +
    `and(fecha_compromiso.is.null,` +
    `creado_en.gte.${desde.toISOString()},` +
    `creado_en.lt.${hasta.toISOString()})`
  );
}

const ESTADOS_ENTREGADO = ["entregado", "entregado_manual"] as const;

// =============================================================================
// «EN RUTA AHORA · 34 · 7 conductores»
// =============================================================================

/**
 * Cuántos conductores distintos tienen al menos un pedido de HOY en ruta.
 *
 * Se acota a los pedidos del día a propósito: el mosaico entero habla de hoy y
 * las ocho cifras comparten universo, así que ninguna se pisa con otra. Un
 * rezagado de ayer que volvió a la van cuenta en «rezagados de ayer», su propia
 * tarjeta, y no infla ésta. Decisión del usuario, 23-08-2026.
 *
 * `conductoresListosHoy` de `metricas.ts` **no sirve** para esto: cuenta
 * manifiestos confirmados o en ruta, que es cuántos salieron, no cuántos andan
 * con carga viva en este momento.
 */
export async function contarConductoresEnRuta(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: Date,
): Promise<number> {
  const fechaStr = fechaLocalEnSantiago(fecha);

  const filas = await leerTodasLasFilas<{ driver_id_asignado: string | null }>(
    "conductores en ruta",
    (desde, hasta) =>
      cliente
        .schema("operacion")
        .from("pedidos")
        .select("driver_id_asignado")
        .eq("tenant_id", tenantId)
        .eq("estado", "en_ruta")
        .or(filtroPedidosDelDia(fechaStr))
        .range(desde, hasta),
  );

  return new Set(
    filas.map((f) => f.driver_id_asignado).filter((id): id is string => Boolean(id)),
  ).size;
}

// =============================================================================
// «68 % · ayer a esta hora, 61 %»
// =============================================================================

export interface ComparacionAyer {
  /** Porcentaje del día que llevaba ayer a esta misma hora. */
  pct: number;
  /** Cierres declarados ayer hasta esta hora — el numerador, para poder auditarlo. */
  entregados: number;
  /** Total de pedidos de ayer — el denominador. */
  total: number;
}

/**
 * El avance que llevaba AYER a esta misma hora, para poder juzgar el de hoy.
 *
 * Devuelve `null` cuando la comparación no se puede sostener: ayer no tuvo
 * pedidos, o no hubo ni un cierre declarado en la app. En los dos casos la
 * tarjeta omite la línea en vez de mostrar un 0 % que se leería como desastre.
 */
export async function obtenerComparacionAyerAEstaHora(
  cliente: SupabaseClient,
  tenantId: string,
  ahora: Date,
): Promise<ComparacionAyer | null> {
  const hoyStr = fechaLocalEnSantiago(ahora);
  const ayerStr = sumarDiasCalendario(hoyStr, -1);

  // «A esta hora» = la misma hora local, sobre el día de ayer. Combinar fecha y
  // hora por el helper de Santiago y no restar 24 h del instante: los cambios
  // de horario de verano hacen que el día anterior no siempre mida 24 h.
  const { desde: inicioAyer } = limitesDelDiaSantiago(ayerStr);
  const corteAyer = combinarFechaHoraSantiago(ayerStr, horaLocalEnSantiago(ahora));

  const [pedidosAyer, cierres, pods] = await Promise.all([
    leerTodasLasFilas<{ id: string }>("pedidos de ayer", (desde, hasta) =>
      cliente
        .schema("operacion")
        .from("pedidos")
        .select("id")
        .eq("tenant_id", tenantId)
        .or(filtroPedidosDelDia(ayerStr))
        .range(desde, hasta),
    ),
    leerTodasLasFilas<{ pedido_id: string }>("cierres de ayer", (desde, hasta) =>
      cliente
        .schema("operacion")
        .from("cierres_conductor")
        .select("pedido_id")
        .eq("tenant_id", tenantId)
        .eq("resultado", "entregado")
        .gte("cerrado_en", inicioAyer.toISOString())
        .lt("cerrado_en", corteAyer.toISOString())
        .range(desde, hasta),
    ),
    leerTodasLasFilas<{ pedido_id: string }>("POD de ayer", (desde, hasta) =>
      cliente
        .schema("operacion")
        .from("pruebas_entrega")
        .select("pedido_id")
        .eq("tenant_id", tenantId)
        .eq("tipo_resultado", "entregado")
        .gte("capturado_en", inicioAyer.toISOString())
        .lt("capturado_en", corteAyer.toISOString())
        .range(desde, hasta),
    ),
  ]);

  const total = pedidosAyer.length;
  if (total === 0) return null;

  // Un pedido puede tener cierre Y prueba de entrega (el same-day cierra en la
  // app y además captura el POD): se cuenta el PEDIDO, no la fila.
  const idsDeAyer = new Set(pedidosAyer.map((p) => p.id));
  const entregadosIds = new Set<string>();
  for (const fila of [...cierres, ...pods]) {
    if (idsDeAyer.has(fila.pedido_id)) entregadosIds.add(fila.pedido_id);
  }

  if (entregadosIds.size === 0) return null;

  return {
    pct: Math.round((entregadosIds.size / total) * 100),
    entregados: entregadosIds.size,
    total,
  };
}

// =============================================================================
// «Entregas por día · últimos 14»
// =============================================================================

export interface DiaEntregas {
  /** Fecha civil de Santiago, `YYYY-MM-DD`. */
  fecha: string;
  entregados: number;
}

/**
 * La serie del gráfico que va bajo el pliegue: entregados por día.
 *
 * Agrupa por **fecha de compromiso**, no por instante de entrega — es la misma
 * base que el resto del mosaico, así que la barra de hoy coincide con la cifra
 * de «entregados hoy». La contrapartida, dicha: un pedido de ayer entregado hoy
 * suma en la barra de ayer, que es donde se había prometido.
 *
 * Los pedidos sin fecha de compromiso quedan fuera de la serie: no tienen día al
 * que pertenecer. Son el same-day sin fecha fija, y en el día de hoy sí entran
 * al mosaico por la otra mitad del filtro.
 */
export async function obtenerSerieEntregasDiarias(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: Date,
  dias = 14,
): Promise<DiaEntregas[]> {
  const hoyStr = fechaLocalEnSantiago(fecha);
  const primerDia = sumarDiasCalendario(hoyStr, -(dias - 1));

  const filas = await leerTodasLasFilas<{ fecha_compromiso: string; estado: string }>(
    "serie de entregas diarias",
    (desde, hasta) =>
      cliente
        .schema("operacion")
        .from("pedidos")
        .select("fecha_compromiso, estado")
        .eq("tenant_id", tenantId)
        .gte("fecha_compromiso", primerDia)
        .lte("fecha_compromiso", hoyStr)
        .in("estado", ESTADOS_ENTREGADO)
        .range(desde, hasta),
  );

  const conteo = new Map<string, number>();
  for (const f of filas) {
    if (!f.fecha_compromiso) continue;
    conteo.set(f.fecha_compromiso, (conteo.get(f.fecha_compromiso) ?? 0) + 1);
  }

  // La serie se arma sobre el calendario, no sobre lo que devolvió la consulta:
  // un día sin entregas tiene que dibujarse como barra en cero, no desaparecer y
  // dejar el gráfico con trece días que parecen catorce.
  const serie: DiaEntregas[] = [];
  for (let i = dias - 1; i >= 0; i--) {
    const dia = sumarDiasCalendario(hoyStr, -i);
    serie.push({ fecha: dia, entregados: conteo.get(dia) ?? 0 });
  }
  return serie;
}

// =============================================================================
// «16:04 · asignación lista a las 15:48»
// =============================================================================

/**
 * La hora en que quedó lista la asignación del día: el primer manifiesto
 * confirmado.
 *
 * ⚠️ **No es la hora en que salió la flota, y por eso no lo dice.** El tablero
 * dibuja «despacho salió a las 16:02», pero `operacion.manifiestos` guarda
 * `confirmado_en` y `completado_en` y **ninguna marca del paso a `en_ruta`** —
 * la transición existe, la hace el conductor, y nadie anota la hora;
 * `actualizado_en` lo pisa cualquier cambio posterior.
 *
 * Se usa lo que el dato sí sabe —cuándo terminó la asignación— con el texto
 * cambiado a eso. Decisión del usuario, 23-08-2026, sobre la alternativa de
 * agregar la columna. Si algún día se agrega `en_ruta_en`, esta función es el
 * único lugar que cambia.
 */
export async function obtenerAsignacionListaEn(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: Date,
): Promise<Date | null> {
  const fechaStr = fechaLocalEnSantiago(fecha);

  const { data, error } = await cliente
    .schema("operacion")
    .from("manifiestos")
    .select("confirmado_en")
    .eq("tenant_id", tenantId)
    .eq("fecha_operacion", fechaStr)
    .not("confirmado_en", "is", null)
    .order("confirmado_en", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.confirmado_en) return null;
  return new Date(data.confirmado_en as string);
}
