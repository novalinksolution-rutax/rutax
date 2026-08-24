/**
 * Lo ESPERADO del día: contra qué se compara lo que ya está en bodega.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTE MÓDULO ES EL CORAZÓN DE LA PANTALLA, Y NO UN DENOMINADOR
 * -----------------------------------------------------------------------------
 * El alcance define el retiro así: **«una conciliación de bodega: lo esperado
 * vs. lo efectivamente cargado, con las diferencias como excepción»**. Hasta hoy
 * la Preparación del día solo sabía la mitad — cuántos bultos se escanearon—, y
 * un conteo sin su denominador no es una conciliación: es un contador.
 *
 * «128» no dice nada. «128 de ~190» dice que faltan 62 y que el despacho no
 * puede salir todavía.
 *
 * -----------------------------------------------------------------------------
 * LA TILDE DEL «~190» NO ES ADORNO
 * -----------------------------------------------------------------------------
 * Lo esperado son los pedidos que Rutax ya conoce y **todavía pueden entrar
 * más**: la ingesta de ML corre cada 30 min y el same-day se crea a mano hasta el
 * corte. El número es una expectativa viva, no un contrato, y la tilde es lo que
 * impide que alguien lo lea como una cifra cerrada y salga a reclamar bultos que
 * el seller nunca prometió.
 *
 * -----------------------------------------------------------------------------
 * LA TARIFA ES POR SELLER, NO POR COMUNA
 * -----------------------------------------------------------------------------
 * El tablero B1a escribe el aviso como «Colina no tiene tarifa configurada». El
 * motor resuelve la tarifa **por seller** (`resolverTarifaVigente`), no por
 * comuna — la misma contradicción que apareció en «Crear pedido same-day» y que
 * se resolvió igual: **el aviso dice lo que el sistema puede verificar**. Si
 * algún día existe tarifa por zona, este módulo es el único lugar que cambia.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";
import { resolverTarifaVigente } from "../tarifas";

export interface SellerSinTarifa {
  id: string;
  nombre: string;
  /** Bultos suyos esperados hoy que no se podrían cobrar. */
  bultos: number;
}

export interface ExpectativaRetiro {
  /** Bultos esperados hoy, por seller. La clave del denominador de cada visita. */
  porSeller: Record<string, number>;
  /** El total del día: el «~190» de la franja. */
  total: number;
  /**
   * Sellers con carga esperada hoy y **sin tarifa vigente**.
   *
   * Es la pieza que conecta esta pantalla con el motor de dinero: son entregas
   * que se van a hacer y que no se van a poder cobrar. Se descubre acá, con
   * horas de margen, o no se descubre hasta el cierre del período.
   */
  sinTarifa: SellerSinTarifa[];
  /** Suma de bultos sin tarifa. El «SIN TARIFA 3 bultos» de la franja. */
  bultosSinTarifa: number;
}

/**
 * Lo que se espera retirar hoy, y de quién.
 *
 * ⚠️ «Esperado» incluye lo que YA SE RETIRÓ. Es el denominador de una
 * conciliación —«4 de ~16»—, no una cola de trabajo: si contara solo lo
 * `pendiente`, cada bulto escaneado bajaría el denominador al mismo tiempo que
 * sube el numerador, y la fracción diría «4 de ~1». Se vio en pantalla, con esa
 * cifra exacta.
 *
 * Los `no_procesado` sí quedan fuera: son los que se decidió NO retirar, y
 * contarlos haría que el denominador no se alcance nunca.
 */
export async function obtenerExpectativaDelDia(
  cliente: SupabaseClient,
  entrada: { tenantId: string; fecha: string },
): Promise<ExpectativaRetiro> {
  const esperados = await leerTodasLasFilas<{ seller_id: string }>(
    "bultos esperados del día",
    (desde, hasta) =>
      cliente
        .schema("operacion")
        .from("pedidos")
        .select("seller_id")
        .eq("tenant_id", entrada.tenantId)
        .eq("fecha_compromiso", entrada.fecha)
        .neq("situacion_retiro", "no_procesado")
        .range(desde, hasta),
  );

  const porSeller: Record<string, number> = {};
  for (const p of esperados) {
    porSeller[p.seller_id] = (porSeller[p.seller_id] ?? 0) + 1;
  }

  const sinTarifa = await detectarSellersSinTarifa(cliente, entrada, porSeller);

  return {
    porSeller,
    total: esperados.length,
    sinTarifa,
    bultosSinTarifa: sinTarifa.reduce((s, v) => s + v.bultos, 0),
  };
}

/**
 * Lo esperado de UN seller, para el encabezado de su visita de retiro.
 * -----------------------------------------------------------------------------
 * La app del conductor solo sabía contar lo escaneado, y un conteo sin
 * denominador no es una conciliación: es un contador. «38» no dice nada; «38 de
 * 42» dice que faltan 4 y que hay que buscarlos antes de cerrar el acta.
 *
 * ⚠️ **Los criterios son EXACTAMENTE los de `obtenerExpectativaDelDia`** —misma
 * fecha, mismo `situacion_retiro <> 'no_procesado'`— y por eso está en este
 * archivo y no en el de sesiones. Si el panel del coordinador y la app del
 * conductor contaran distinto, los dos verían un número y ninguno sabría cuál
 * creer, justo cuando el conductor está decidiendo si se va o sigue buscando.
 *
 * No se usa `obtenerExpectativaDelDia` entera porque esa lee los pedidos de
 * TODOS los sellers del día y además resuelve tarifas: para una cifra de un
 * encabezado, es un barrido completo por cada apertura de pantalla.
 */
export interface BultoEsperado {
  pedidoId: string;
  /** El mismo código que produce un escaneo, para poder cruzarlos. */
  codigoVisible: string;
}

export async function listarEsperadosDeSeller(
  cliente: SupabaseClient,
  entrada: { tenantId: string; sellerId: string; fecha: string },
): Promise<BultoEsperado[]> {
  // Se devuelve la LISTA y no un conteo porque al cerrar con faltantes hay que
  // **nombrarlos**: «vas a cerrar con 4 sin escanear» sin decir cuáles obliga al
  // conductor a recorrer la bodega entera de nuevo. El conteo sale del largo.
  const filas = await leerTodasLasFilas<{
    id: string;
    ml_shipment_id: string | null;
    codigo_interno: string | null;
  }>("bultos esperados del seller", (desde, hasta) =>
    cliente
      .schema("operacion")
      .from("pedidos")
      .select("id, ml_shipment_id, codigo_interno")
      .eq("tenant_id", entrada.tenantId)
      .eq("seller_id", entrada.sellerId)
      .eq("fecha_compromiso", entrada.fecha)
      .neq("situacion_retiro", "no_procesado")
      .range(desde, hasta),
  );

  // El mismo orden de preferencia que `construirDtoPedidoRetiro`: si acá saliera
  // distinto, el cruce contra lo escaneado fallaría y todo bulto figuraría a la
  // vez como escaneado y como faltante.
  return filas.map((f) => ({
    pedidoId: f.id,
    codigoVisible: f.ml_shipment_id ?? f.codigo_interno ?? "",
  }));
}

/**
 * Cuáles de los sellers con carga hoy no tienen tarifa vigente.
 *
 * Se consulta **solo por los que tienen carga**: preguntar por toda la cartera
 * gastaría una consulta por seller para avisar de gente que hoy no despacha
 * nada, y el aviso solo tiene sentido si esa entrega va a ocurrir.
 */
async function detectarSellersSinTarifa(
  cliente: SupabaseClient,
  entrada: { tenantId: string; fecha: string },
  porSeller: Record<string, number>,
): Promise<SellerSinTarifa[]> {
  const ids = Object.keys(porSeller);
  if (ids.length === 0) return [];

  const [tarifas, nombres] = await Promise.all([
    Promise.all(
      ids.map(async (sellerId) => ({
        sellerId,
        tarifaId: await resolverTarifaVigente(cliente, {
          tenantId: entrada.tenantId,
          sellerId,
          // El régimen del retiro es el del same-day: es el que tiene bodega.
          tipoEntrega: "same_day",
          fecha: entrada.fecha,
        }).catch(() => null),
      })),
    ),
    leerTodasLasFilas<{ id: string; razon_social: string }>(
      "sellers con carga hoy",
      (desde, hasta) =>
        cliente
          .from("sellers")
          .select("id, razon_social")
          .eq("tenant_id", entrada.tenantId)
          .in("id", ids)
          .range(desde, hasta),
    ).catch(() => [] as { id: string; razon_social: string }[]),
  ]);

  const nombrePorId = new Map(nombres.map((s) => [s.id, s.razon_social]));

  return tarifas
    .filter((t) => t.tarifaId === null)
    .map((t) => ({
      id: t.sellerId,
      nombre: nombrePorId.get(t.sellerId) ?? "Seller sin nombre",
      bultos: porSeller[t.sellerId] ?? 0,
    }))
    .sort((a, b) => b.bultos - a.bultos);
}

// =============================================================================
// Cuántos conductores hacen falta
// =============================================================================

/**
 * Minutos por parada de la operación real de este rubro.
 *
 * Sale de la aritmética que gobierna el alcance: el despacho arranca a las 16:00
 * y el corte es a las 21:00–22:00, con 25–30 paradas por conductor. Cinco o seis
 * horas para 25–30 paradas dan **~12 min por parada**, en hora punta y saliendo
 * toda la flota junta del mismo punto.
 *
 * ⚠️ Es un promedio, no una ley. Por eso la pantalla lo declara junto al
 * resultado: una estimación con sus supuestos escondidos se lee como una
 * instrucción.
 */
// Los 12 min viven en `holgura-ruta.ts` —un modulo puro, sin dependencias— y se
// re-exportan aca para no partir la cifra en dos: el panel de ruta la consume
// desde el navegador y este modulo desde el servidor.
export { MINUTOS_POR_PARADA } from "../holgura-ruta";
import { MINUTOS_POR_PARADA } from "../holgura-ruta";

export interface ConductoresNecesarios {
  conductores: number;
  bultos: number;
  minutosDisponibles: number;
  /** `false` cuando ya pasó la hora de corte: el cálculo deja de tener sentido. */
  aplicable: boolean;
}

/**
 * Cuántos conductores hacen falta para cerrar la carga antes del corte.
 *
 * `ceil(bultos × 12 min ÷ minutos que quedan)`. Aritmética simple y a la vista:
 * lo valioso no es el algoritmo, es que la cuenta esté hecha a las 15:40 y no en
 * la cabeza de alguien a las 16:10.
 */
export function calcularConductoresNecesarios(
  bultos: number,
  minutosHastaElCorte: number,
): ConductoresNecesarios {
  const aplicable = bultos > 0 && minutosHastaElCorte > 0;
  return {
    conductores: aplicable
      ? Math.ceil((bultos * MINUTOS_POR_PARADA) / minutosHastaElCorte)
      : 0,
    bultos,
    minutosDisponibles: Math.max(0, minutosHastaElCorte),
    aplicable,
  };
}
