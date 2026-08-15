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
import { resolverBultoRetiroRpc } from "./rpc";

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
  /**
   * Se lee SOLO en el camino de fusión, y para una cosa: saber si el bulto
   * entró tecleado (`flex_manual`) y por lo tanto todavía no tiene su QR
   * guardado. Ver `rescatarQrDeBultoTecleado`.
   */
  codigo_formato?: string;
}

/** Columnas que devuelve el INSERT y el SELECT de fusión. Una sola lista. */
const COLUMNAS_BULTO_TRAS_ESCRIBIR = "id, escaneo_id, codigo_normalizado, pedido_id, codigo_formato";

/**
 * El bulto ya existía porque el conductor lo TECLEÓ, y ahora llega el escaneo
 * del QR del mismo bulto. Guarda la credencial que la fila no tenía y asciende
 * su formato a `flex_qr`.
 *
 * ## Por qué esto no es un adorno
 *
 * El `hash_code` de la etiqueta Flex es una firma de ML que no se puede
 * calcular, y `GET /shipment_labels` exige `ready_to_ship`: una vez retirado el
 * bulto, ML tampoco reimprime la etiqueta. **Este escaneo es la única
 * oportunidad de capturarlo, y no vuelve.** Sin este rescate, el camino normal
 * la descarta —la fila ya existe, así que el flujo la trata como
 * `duplicado_fusionado` y se salta los efectos "solo del recién insertado"— y
 * ese QR se pierde para siempre por haber tecleado primero.
 *
 * ## El orden de las dos escrituras NO es indiferente
 *
 * Primero la credencial, después el formato. Si fallara la segunda, queda un
 * `flex_manual` CON credencial: inconsistente con el invariante
 * (`flex_manual` ⟺ sin QR), pero **el dato irrecuperable está a salvo** y el
 * próximo escaneo del mismo QR reintenta. Al revés —formato primero— un fallo
 * dejaría un `flex_qr` SIN credencial: mentiría diciendo que el QR se capturó,
 * y nadie volvería a intentarlo. Entre dos inconsistencias se elige la que
 * conserva el dato y se puede reparar sola.
 *
 * ## La carrera entre dos lotes
 *
 * El UPDATE del formato lleva `codigo_formato = 'flex_manual'` en su WHERE: es
 * un compare-and-swap. Si dos lotes traen el mismo QR a la vez, el segundo no
 * casa con ninguna fila y no hace nada — y su intento de credencial choca
 * contra la PK de `bultos_retiro_qr` (1:1 por esquema), que se traga aquí
 * mismo. Nadie pisa nada.
 *
 * ## Best-effort, como el camino normal
 *
 * Nunca lanza. Perder SOLO la credencial es un problema menor que tumbar el
 * ítem del lote: "nunca se pierde un escaneo" es el invariante duro y este
 * bulto ya está registrado desde que se tecleó.
 */
async function rescatarQrDeBultoTecleado(
  cliente: SupabaseClient,
  lote: RegistrarLoteEscaneosEntrada,
  bultoId: string,
  parseo: CodigoBultoParseado,
): Promise<void> {
  try {
    await guardarCredencialQr(cliente, {
      tenantId: lote.tenantId,
      bultoId,
      credencial: parseo.credencial,
    });
  } catch (err) {
    // Incluye el 23505 del segundo lote de una carrera: la credencial ya está,
    // que es exactamente el resultado buscado. No se distingue del fallo real
    // a propósito — en los dos casos lo correcto es no tocar el formato, y así
    // un `flex_manual` con credencial nunca se convierte en un `flex_qr` sin ella.
    console.error(
      "[operacion/retiro] no se pudo rescatar el QR de un bulto tecleado",
      bultoId,
      err instanceof Error ? err.message : "error desconocido",
    );
    return;
  }

  // Ya hay QR: la fila deja de ser "tecleada sin QR". Se completa además
  // `ml_user_id`, que el ingreso manual no podía conocer y el QR sí trae.
  const { error } = await cliente
    .from("bultos_retiro")
    .update({ codigo_formato: "flex_qr", ml_user_id: parseo.mlUserId })
    .eq("tenant_id", lote.tenantId)
    .eq("id", bultoId)
    .eq("codigo_formato", "flex_manual");

  if (error) {
    console.error(
      "[operacion/retiro] credencial rescatada pero el formato quedó en flex_manual",
      bultoId,
      error.message,
    );
  }
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
    .select(COLUMNAS_BULTO_TRAS_ESCRIBIR)
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
      .select(COLUMNAS_BULTO_TRAS_ESCRIBIR)
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

    // El bulto entró TECLEADO y ahora llega su QR: es la única oportunidad de
    // capturarlo, y no vuelve. Ver `rescatarQrDeBultoTecleado`.
    if (parseo.credencial && bultoFinal.codigo_formato === "flex_manual") {
      await rescatarQrDeBultoTecleado(cliente, lote, bultoFinal.id, parseo);
    }
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

  // FUERA del bloque de "solo el recién insertado", a propósito — ver el porqué
  // en el comentario de la función.
  if (lote.sesionCerrada && candidato) {
    await marcarPedidoRetiradoTrasCierre(cliente, lote, bultoFinal.id, candidato.pedidoId);
  }

  return {
    escaneoId: escaneo.escaneoId,
    estado,
    resolucion,
    bultoId: bultoFinal.id,
    pedido: pedidoDto,
  };
}

/**
 * Marca el pedido como `retirado` cuando el escaneo llegó DESPUÉS del cierre.
 * =====================================================================
 *
 * EL AGUJERO QUE TAPA (encontrado el 2026-08-13, al construir la etapa 5). Un
 * bulto que se casa con su pedido en el mismo INSERT no pasa por ningún lado que
 * escriba `operacion.pedidos.situacion_retiro`: ese campo lo escriben SOLO
 * `operacion.cerrar_sesion_retiro()` y `operacion.resolver_bulto_retiro()`.
 * Mientras la visita sigue abierta da igual, porque el cierre barre todos los
 * bultos de la sesión. Pero si la visita YA CERRÓ, el cierre ya pasó y no vuelve:
 * el bulto queda con su `pedido_id` puesto y el pedido en `pendiente` **para
 * siempre**.
 *
 * Y no es un caso raro: la señal en bodega es mala, el conductor cierra la visita
 * adentro y la cola sin conexión drena cuando sale a la calle. Ese lote entero
 * llega `posterior_al_cierre`. El bulto está arriba de la van, cuenta en la carga
 * por comuna, y su pedido no aparece en la bandeja de asignación — dos pantallas
 * vecinas mostrando números que no cuadran.
 *
 * La función SQL existía desde el día uno para esto (su propio comentario:
 * "sin ese segundo paso... eso se descubre en producción") y **no la llamaba
 * nadie**: su único llamador en todo el repo era su propia prueba.
 *
 * POR QUÉ VA FUERA DEL BLOQUE DE "solo el recién insertado". Los otros dos
 * efectos —guardar la credencial y publicar la resolución diferida— no deben
 * repetirse en una fusión. Éste sí: `resolver_bulto_retiro` es idempotente (su
 * UPDATE lleva `situacion_retiro <> 'retirado'` y devuelve si marcó o no), y el
 * reintento del lote es la ÚNICA vía de recuperación que existe. Si viviera
 * dentro del bloque, un fallo dejaría el pedido en `pendiente` sin segunda
 * oportunidad, porque el reintento entra siempre por la rama de fusión.
 *
 * BEST-EFFORT, y no es pereza: el bulto ya está guardado y confirmado. Lanzar
 * aquí devolvería `rechazado` por algo que SÍ se guardó, dejando el escaneo
 * atascado en la cola del conductor — y el reintento tampoco arreglaría el
 * pedido. Se registra fuerte y se sigue: "nunca se pierde un escaneo" manda.
 */
async function marcarPedidoRetiradoTrasCierre(
  cliente: SupabaseClient,
  lote: RegistrarLoteEscaneosEntrada,
  bultoId: string,
  pedidoId: string,
): Promise<void> {
  try {
    await resolverBultoRetiroRpc(cliente, { tenantId: lote.tenantId, bultoId, pedidoId });
  } catch (err) {
    // Con identificadores, porque sin ellos este log no sirve para reparar nada
    // a mano. Ninguno es dato personal: son UUID internos.
    console.error(
      "[operacion/retiro] el pedido de un bulto posterior al cierre quedó SIN marcar como retirado",
      { bultoId, pedidoId, sesionId: lote.sesionId },
      err instanceof Error ? err.message : "error desconocido",
    );
  }
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
