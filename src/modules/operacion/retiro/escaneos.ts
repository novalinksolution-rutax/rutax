/**
 * Escritor de lotes de escaneos — `POST /{sesionId}/escaneos`.
 *
 * EL CONTRATO: lote de hasta `MAX_ESCANEOS_POR_LOTE`, con RESULTADO POR
 * ELEMENTO. Un código que Rutax no puede procesar contra su ingesta se
 * guarda igual — registrarlo es un estado NORMAL (`no_procesado`), no un
 * error. `rechazado` queda solo para lo estructural (un ítem malformado).
 * Nunca se pierde un escaneo: es el único fallo verdaderamente irreversible
 * del retiro (el QR de Flex no se reimprime una vez retirado el bulto).
 *
 * POR QUÉ CADA BULTO ES SU PROPIA PETICIÓN (no un solo INSERT de hasta 50
 * filas): así, un choque de unicidad — o la excepción del trigger cuando la
 * sesión se cerró entre medio — queda AISLADO a ese ítem y nunca tumba a los
 * otros 49. Es además lo que aísla el choque de unicidad, que aquí es el caso
 * NORMAL y no la excepción: la tabla tiene DOS índices únicos relevantes
 * (`bultos_retiro_escaneo_uk` para el reintento del lote,
 * `bultos_retiro_sesion_codigo_uk` para el doble escaneo físico).
 *
 * ⚠️ MEDIDO CONTRA POSTGREST REAL (2026-08-13), porque el comportamiento no es
 * el que uno supondría: `ignoreDuplicates: true` SIN `onConflict` **NO cubre
 * los índices únicos secundarios**. PostgREST usa la PRIMARY KEY como árbitro,
 * así que el segundo escaneo del mismo bulto —`escaneo_id` nuevo, porque cada
 * disparo de la cámara genera uno— llega con PK distinta, no encuentra
 * conflicto por PK, y **choca de verdad**: HTTP 409 / 23505 contra
 * `bultos_retiro_sesion_codigo_uk`. No hay `DO NOTHING` silencioso.
 *
 * Por eso capturar el 23505 y re-buscar la fila NO es una defensa "por si
 * acaso": es el ÚNICO camino que ocurre en la práctica para el doble escaneo,
 * que es justo lo que el alcance manda fusionar sin error (en la bodega nunca
 * se bloquea al conductor, y un bulto no se puede volver a escanear).
 *
 * Y no se usa `onConflict` apuntando a esos índices porque uno de ellos
 * —`sesiones_retiro_abierta_uk`, del lado de la sesión— es PARCIAL, y Postgres
 * solo infiere un índice parcial como árbitro si el `ON CONFLICT` repite su
 * predicado, sintaxis que supabase-js no expone. Comprobado: sin el predicado
 * falla con 42P10 ("no unique or exclusion constraint matching"), y falla
 * SIEMPRE, no solo cuando hay duplicado.
 *
 * NUNCA loguea el `codigo` crudo de un escaneo: puede traer el JSON completo
 * de la etiqueta Flex (`hash_code`, `security_digit`), que
 * `PATRON_LLAVE_SENSIBLE` no redacta por FORMA (las llaves con `{`, `"`, `:`
 * caen fuera de su clase de caracteres) — un log crudo viajaría íntegro a
 * observabilidad. Los mensajes de error que sí se registran (Postgres) solo
 * pueden referenciar columnas seguras (`codigo_normalizado`, `escaneo_id`,
 * `bulto_id`) — nunca el crudo ni la credencial cifrada.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest/cliente";
import type { EventoBultoRetiroSinPedido } from "@/lib/inngest/eventos";
import {
  buscarPedidosPorCodigos,
  construirDtoPedidoRetiro,
  resolverNombresSellers,
  type PedidoCandidatoRetiro,
  type PedidoRetiroDto,
} from "./dto-pedido";
import { derivarResolucionBulto, parsearCodigoBulto, type CodigoBultoParseado, type ResolucionEscaneo } from "./parser-codigo";
import { guardarCredencialQr } from "./qr-credencial";

/** Tope duro del lote — la ruta responde 400 para TODA la petición por encima de esto. */
export const MAX_ESCANEOS_POR_LOTE = 50;

export interface EscaneoEntrada {
  escaneoId: string;
  /** El string crudo que leyó la cámara — NUNCA se loguea tal cual. */
  codigo: string;
  /** ISO 8601 — hora del DISPOSITIVO al momento del escaneo. */
  escaneadoEn: string;
}

export type EstadoResultadoEscaneo = "registrado" | "duplicado_fusionado" | "rechazado";

export interface ResultadoEscaneo {
  escaneoId: string;
  estado: EstadoResultadoEscaneo;
  /** null SOLO cuando el ítem se rechazó antes de poder clasificar el código (forma inválida). */
  resolucion: ResolucionEscaneo | null;
  bultoId: string | null;
  pedido: PedidoRetiroDto | null;
  /** Motivo corto y SEGURO (nunca deriva del `codigo` crudo) — presente en 'rechazado'. */
  motivo?: string;
}

export interface RegistrarLoteEscaneosEntrada {
  tenantId: string;
  sesionId: string;
  conductorId: string;
  /** seller_id de la bodega que se está visitando — para `esDeEstaBodega` en el DTO. */
  sellerIdBodega: string;
  /** true si la sesión YA estaba cerrada al recibir el lote (posterior_al_cierre). */
  sesionCerrada: boolean;
  escaneos: readonly EscaneoEntrada[];
}

function esErrorDeUnicidad(error: { code?: string } | null | undefined): boolean {
  return !!error && error.code === "23505";
}

/** Validación de FORMA — lo único que puede hacer `rechazado` sin haber intentado nada más. */
function validarFormaBasica(escaneo: EscaneoEntrada): string | null {
  if (typeof escaneo.escaneoId !== "string" || escaneo.escaneoId.trim().length === 0) {
    return "falta_escaneo_id";
  }
  if (typeof escaneo.codigo !== "string" || escaneo.codigo.trim().length === 0) {
    return "falta_codigo";
  }
  if (typeof escaneo.escaneadoEn !== "string" || Number.isNaN(Date.parse(escaneo.escaneadoEn))) {
    return "escaneado_en_invalido";
  }
  return null;
}

/**
 * Registra un lote de escaneos. Devuelve SIEMPRE un resultado por elemento,
 * en el mismo orden que `entrada.escaneos` — nunca lanza por un ítem
 * individual malo (eso es justamente lo que 'rechazado' existe para
 * expresar). Solo lanza ante una falla de infraestructura que impide
 * procesar el lote ENTERO (p. ej. Postgres inalcanzable durante la
 * resolución contra la ingesta) — ahí sí no hay nada que reportar por ítem.
 */
export async function registrarLoteEscaneos(
  cliente: SupabaseClient,
  entrada: RegistrarLoteEscaneosEntrada,
): Promise<{ resultados: ResultadoEscaneo[] }> {
  if (entrada.escaneos.length === 0) {
    return { resultados: [] };
  }

  const items = entrada.escaneos.map((escaneo) => {
    const motivoRechazo = validarFormaBasica(escaneo);
    return {
      escaneo,
      motivoRechazo,
      parseo: motivoRechazo ? null : parsearCodigoBulto(escaneo.codigo),
    };
  });

  // Resolver contra la ingesta EN LOTE (una consulta por columna involucrada,
  // no una por ítem) — solo para los que sí se pudieron parsear.
  const parseosValidos = items
    .filter((it): it is typeof it & { parseo: CodigoBultoParseado } => it.parseo !== null)
    .map((it) => it.parseo);

  const candidatos = await buscarPedidosPorCodigos(
    cliente,
    entrada.tenantId,
    parseosValidos.map((p) => ({ formato: p.formato, codigoNormalizado: p.codigoNormalizado })),
  );
  const sellerIds = [...new Set([...candidatos.values()].map((c) => c.sellerId))];
  const nombresSellers = await resolverNombresSellers(cliente, entrada.tenantId, sellerIds);

  const resultados = await Promise.all(
    items.map((item) => {
      if (item.motivoRechazo || !item.parseo) {
        return Promise.resolve<ResultadoEscaneo>({
          escaneoId: item.escaneo.escaneoId || "(sin escaneoId)",
          estado: "rechazado",
          resolucion: null,
          bultoId: null,
          pedido: null,
          motivo: item.motivoRechazo ?? "forma_invalida",
        });
      }
      return registrarUnBulto(cliente, entrada, item.escaneo, item.parseo, candidatos, nombresSellers);
    }),
  );

  return { resultados };
}

interface FilaBultoRetiro {
  id: string;
  escaneo_id: string;
  codigo_normalizado: string;
  pedido_id: string | null;
}

/**
 * Envoltorio que garantiza que ESTE ítem nunca hace `reject` — ni por un
 * `{error}` manejado (eso ya lo cubre `registrarUnBultoImpl`) ni por una
 * excepción de infraestructura inesperada (timeout, respuesta no-JSON, lo que
 * sea). Es lo que impide que un `Promise.all` sobre 50 ítems se caiga ENTERO
 * por el fallo de uno solo — el requisito duro de este endpoint.
 */
async function registrarUnBulto(
  cliente: SupabaseClient,
  lote: RegistrarLoteEscaneosEntrada,
  escaneo: EscaneoEntrada,
  parseo: CodigoBultoParseado,
  candidatos: Map<string, PedidoCandidatoRetiro>,
  nombresSellers: Map<string, string>,
): Promise<ResultadoEscaneo> {
  const resolucion = derivarResolucionBulto(parseo.formato, candidatos.get(parseo.codigoNormalizado)?.pedidoId ?? null);
  try {
    return await registrarUnBultoImpl(cliente, lote, escaneo, parseo, candidatos, nombresSellers);
  } catch (err) {
    console.error(
      "[operacion/retiro] excepción inesperada al registrar un bulto",
      err instanceof Error ? err.name : "error desconocido",
    );
    return {
      escaneoId: escaneo.escaneoId,
      estado: "rechazado",
      resolucion,
      bultoId: null,
      pedido: null,
      motivo: "error_al_guardar",
    };
  }
}

async function registrarUnBultoImpl(
  cliente: SupabaseClient,
  lote: RegistrarLoteEscaneosEntrada,
  escaneo: EscaneoEntrada,
  parseo: CodigoBultoParseado,
  candidatos: Map<string, PedidoCandidatoRetiro>,
  nombresSellers: Map<string, string>,
): Promise<ResultadoEscaneo> {
  const candidato = candidatos.get(parseo.codigoNormalizado) ?? null;
  const resolucion = derivarResolucionBulto(parseo.formato, candidato?.pedidoId ?? null);
  const pedidoDto = candidato
    ? construirDtoPedidoRetiro(candidato, nombresSellers.get(candidato.sellerId) ?? "", lote.sellerIdBodega)
    : null;

  const fila = {
    tenant_id: lote.tenantId,
    sesion_retiro_id: lote.sesionId,
    conductor_id: lote.conductorId,
    escaneo_id: escaneo.escaneoId,
    codigo_formato: parseo.formato,
    codigo_normalizado: parseo.codigoNormalizado,
    muestra_codigo: parseo.muestraCodigo,
    ml_shipment_id: parseo.mlShipmentId,
    ml_user_id: parseo.mlUserId,
    pedido_id: candidato?.pedidoId ?? null,
    seller_id: candidato?.sellerId ?? null,
    posterior_al_cierre: lote.sesionCerrada,
    escaneado_en: escaneo.escaneadoEn,
    resuelto_en: candidato ? new Date().toISOString() : null,
  };

  const { data: insertada, error: errorInsert } = await cliente
    .from("bultos_retiro")
    .upsert(fila, { ignoreDuplicates: true })
    .select("id, escaneo_id, codigo_normalizado, pedido_id")
    .maybeSingle();

  let bultoFinal = insertada as FilaBultoRetiro | null;
  let estado: EstadoResultadoEscaneo = "registrado";

  if (!bultoFinal) {
    // El INSERT no devolvió fila. En la práctica esto llega como 23505 (ver la
    // medición del encabezado: PostgREST arbitra por PK, así que el doble
    // escaneo choca de verdad contra el índice de `(sesión, código)`); se
    // acepta también el caso sin error por si algún día arbitrara distinto.
    // Ambos son la MISMA situación: "el bulto ya existe, hay que re-buscarlo".
    // Cualquier OTRO error es real y no se disfraza de fusión.
    if (errorInsert && !esErrorDeUnicidad(errorInsert)) {
      return {
        escaneoId: escaneo.escaneoId,
        estado: "rechazado",
        resolucion,
        bultoId: null,
        pedido: null,
        motivo: "error_al_guardar",
      };
    }

    const { data: existente, error: errorSelect } = await cliente
      .from("bultos_retiro")
      .select("id, escaneo_id, codigo_normalizado, pedido_id")
      .eq("tenant_id", lote.tenantId)
      .eq("sesion_retiro_id", lote.sesionId)
      .eq("codigo_normalizado", parseo.codigoNormalizado)
      .maybeSingle();

    if (errorSelect || !existente) {
      return {
        escaneoId: escaneo.escaneoId,
        estado: "rechazado",
        resolucion,
        bultoId: null,
        pedido: null,
        motivo: "error_al_guardar",
      };
    }

    bultoFinal = existente as FilaBultoRetiro;
    estado = "duplicado_fusionado";
  }

  // Efectos SOLO para el bulto recién insertado — uno fusionado ya pasó por
  // esto la primera vez.
  if (estado === "registrado") {
    if (parseo.credencial) {
      try {
        await guardarCredencialQr(cliente, {
          tenantId: lote.tenantId,
          bultoId: bultoFinal.id,
          credencial: parseo.credencial,
        });
      } catch (err) {
        // Best-effort A PROPÓSITO: perder SOLO la credencial (mientras el
        // bulto y su resolución quedan a salvo) es un problema menor que
        // perder el escaneo entero — "nunca se pierde un escaneo" es el
        // invariante duro, la credencial es la evidencia de respaldo.
        // NUNCA se loguea el valor cifrado ni el crudo, solo el mensaje de
        // Postgres (que en esta tabla solo puede referenciar bulto_id/tenant_id).
        console.error(
          "[operacion/retiro] no se pudo guardar la credencial del QR",
          bultoFinal.id,
          err instanceof Error ? err.message : "error desconocido",
        );
      }
    }

    if (!candidato && parseo.formato === "flex_qr" && parseo.mlShipmentId) {
      await publicarResolucionDiferida(bultoFinal.id, lote, parseo.mlShipmentId, escaneo.escaneadoEn);
    }
  }

  return {
    escaneoId: escaneo.escaneoId,
    estado,
    resolucion,
    bultoId: bultoFinal.id,
    pedido: pedidoDto,
  };
}

/** Best-effort — un fallo de Inngest no debe tumbar un escaneo que ya quedó guardado. */
async function publicarResolucionDiferida(
  bultoId: string,
  lote: RegistrarLoteEscaneosEntrada,
  mlShipmentId: string,
  escaneadoEn: string,
): Promise<void> {
  try {
    const data: EventoBultoRetiroSinPedido["data"] = {
      bultoId,
      tenantId: lote.tenantId,
      sesionRetiroId: lote.sesionId,
      mlShipmentId,
      escaneadoEn,
    };
    await inngest.send({
      name: "operacion/bulto-retiro.sin-pedido",
      // Determinístico por bulto: un reintento del mismo lote (fusionado
      // contra el mismo bulto) no dispara una segunda resolución diferida.
      id: `bulto-retiro-sin-pedido-${bultoId}`,
      data,
    });
  } catch {
    // Best-effort post-commit: el bulto ya está guardado; si el evento no
    // llega, la resolución diferida simplemente no se dispara para este bulto.
  }
}
