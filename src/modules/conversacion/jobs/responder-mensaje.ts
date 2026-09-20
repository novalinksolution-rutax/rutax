/**
 * Job de Inngest que responde una consulta de WhatsApp.
 * =============================================================================
 * Consume `whatsapp/mensaje.recibido` (publicado por el webhook SOLO cuando
 * `pideBaja === false`) y hace las cuatro cosas que describe §4 del documento
 * de alcance: resolver quién escribe, entender qué pidió, decidir si tiene
 * derecho a esa respuesta, y armarla.
 *
 * -----------------------------------------------------------------------------
 * UN SOLO `step.run` PARA TODO EL PROCESAMIENTO
 * -----------------------------------------------------------------------------
 * Mismo patrón que `jobEnviarWhatsApp`: el trabajo de negocio (resolver,
 * consultar, escribir la fila, mandar el mensaje) vive en UN paso; lo único
 * que corre FUERA del `step.run` es la decisión de si Inngest debe reintentar
 * — eso sí tiene que estar fuera, porque es lo que convierte un resultado en
 * una excepción que Inngest sabe interpretar.
 *
 * -----------------------------------------------------------------------------
 * ORDEN QUE NO SE PUEDE ALTERAR
 * -----------------------------------------------------------------------------
 * 1. Resolver alcance (§5/§5.1).
 * 2. Si no está resuelto → responder neutro (como mucho una vez cada 24 h) y
 *    terminar. NUNCA se llega a leer un pedido sin alcance resuelto.
 * 3. ⚠️ INTERRUPTOR DEL CANAL (migración `20260920000002`) — lo primero que se
 *    mira una vez que hay `tenantId`, ANTES del tope de abuso y ANTES de tocar
 *    `operacion`. Si `canal_activo` es `false` (courier sin fila incluido):
 *    NO se responde nada, la fila entrante queda con `resolucion: "resuelto"`
 *    (la identidad SÍ se resolvió) y el job termina en ÉXITO, no en error —
 *    apagar el canal no es una falla transitoria que Inngest deba reintentar.
 * 4. Tope de abuso — ANTES de gastar una consulta a `operacion`. El tope y el
 *    umbral de barrido salen de la config leída en el paso 3, no de una
 *    constante.
 * 5. Determinar intención y consultar `operacion` (solo lectura).
 * 6. Escribir `clasificacion`/`hubo_match` en la fila — ANTES de chequear el
 *    corte por barrido, porque el corte cuenta sobre esas columnas y tiene que
 *    ver ESTE intento para reaccionar a él, no solo a los anteriores.
 * 7. Corte por barrido — si corta, NO se responde y NO hay bitácora (no hubo
 *    acceso a datos que auditar).
 * 8. Bitácora ANTES de llamar a Meta (regla dura del proyecto).
 * 9. Enviar por el puerto de WhatsApp.
 *
 * -----------------------------------------------------------------------------
 * `motivo_no_respondido` (migración `20260920000003`)
 * -----------------------------------------------------------------------------
 * Cada salida sin respuesta escribe su motivo explícito — ver
 * `src/modules/conversacion/motivo-no-respondido.ts`. "Canal apagado" y "tope
 * de abuso" ya NO quedan indistinguibles: cada uno escribe el suyo. El corte
 * por barrido (§6.1) también queda persistido como tal, no solo contado en
 * memoria. La superficie de contadores de `canal-admin.ts` usa esta columna.
 */

import { inngest } from "@/lib/inngest/cliente";
import type { EventoMensajeWhatsAppRecibido } from "@/lib/inngest/eventos";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { obtenerPuertoWhatsApp } from "@/modules/integraciones/notificaciones/whatsapp";
import {
  estadoDePedidoParaSeller,
  retiroDelDiaParaSeller,
} from "@/modules/operacion/consultas/seller";
import { resolverAlcanceDesdeContacto } from "../alcance";
import { determinarIntencion } from "../intenciones";
import { excedeTopeDeAbuso, detectaBarridoDeCodigos } from "../abuso";
import { leerConfigCanalConsulta } from "../canal";
import type { ClasificacionCodigo } from "../parser";
import {
  armarRespuestaPedidos,
  armarRespuestaRetiro,
  armarMenu,
  armarAyudaConsultarPedido,
  armarRespuestaSinContacto,
  armarRespuestaAmbigua,
  type ResultadoPedidoConsultado,
} from "../respuestas";

/** Espejo del CHECK `texto is null or length(texto) <= 300`. */
const LARGO_MAX_TEXTO = 300;

/** §5: una sola respuesta neutra por número cada 24 h. */
const VENTANA_AVISO_NEUTRO_MS = 24 * 60 * 60 * 1000;

interface ResultadoProcesamiento {
  respondido: boolean;
  reintentable: boolean;
  motivo?: string;
  errorEnvio?: string;
}

export const jobResponderMensajeWhatsApp = inngest.createFunction(
  {
    id: "conversacion/responderMensajeWhatsApp",
    name: "Conversación · Responder consulta de WhatsApp",
    retries: 3,
    triggers: [{ event: "whatsapp/mensaje.recibido" }],
    // El número de Rutax es UNO para todos los couriers — mismo tope que
    // `jobEnviarWhatsApp`, para no competir con los avisos salientes por el
    // límite de mensajes por segundo de Meta.
    concurrency: { limit: 5 },
  },
  async ({ event, step, logger }) => {
    const { mensajeEntranteId, telefonoE164, texto } = event.data as EventoMensajeWhatsAppRecibido["data"];

    const resultado = await step.run("procesar-consulta", () =>
      procesarConsulta({ mensajeEntranteId, telefonoE164, texto }),
    );

    if (resultado.reintentable) {
      // Fuera del step: es lo que convierte el resultado en una excepción que
      // Inngest reintenta con su propio backoff.
      throw new Error(`Fallo transitorio en conversación por WhatsApp: ${resultado.errorEnvio ?? ""}`);
    }

    if (!resultado.respondido && resultado.motivo) {
      logger.warn(`[conversacion] no se respondió (${resultado.motivo}).`);
    }

    return resultado;
  },
);

/** Exportado solo para pruebas (`responder-mensaje.test.ts`). */
export async function procesarConsulta(entrada: {
  mensajeEntranteId: string;
  telefonoE164: string | null;
  texto: string | null;
}): Promise<ResultadoProcesamiento> {
  const cliente = crearClienteServiceRole();

  const resolucion = await resolverAlcanceDesdeContacto(cliente, entrada.telefonoE164);

  if (resolucion.resolucion === "ilegible") {
    await actualizarFilaEntrante(cliente, entrada.mensajeEntranteId, {
      resolucion: "ilegible",
      motivo_no_respondido: "sin_alcance",
    });
    return { respondido: false, reintentable: false, motivo: "ilegible" };
  }

  // A partir de acá, `resolverAlcanceDesdeContacto` ya garantizó que hay un
  // teléfono legible (es la única forma de llegar a `sin_contacto`, `ambiguo`
  // o `resuelto`).
  const telefono = entrada.telefonoE164 as string;

  if (resolucion.resolucion === "sin_contacto" || resolucion.resolucion === "ambiguo") {
    const yaAvisado = await yaSeAvisoEnLasUltimas24h(cliente, telefono, [resolucion.resolucion]);

    // El motivo depende de si el aviso neutro sale o se omite por la ventana
    // de 24 h (§5), así que va DESPUÉS de esa decisión — no se puede escribir
    // en el mismo update que fija `resolucion`.
    await actualizarFilaEntrante(cliente, entrada.mensajeEntranteId, {
      resolucion: resolucion.resolucion,
      motivo_no_respondido: yaAvisado ? "aviso_neutro_omitido" : "respondido",
    });

    if (yaAvisado) {
      return { respondido: false, reintentable: false, motivo: `${resolucion.resolucion}_ya_avisado` };
    }

    const texto =
      resolucion.resolucion === "sin_contacto" ? armarRespuestaSinContacto() : armarRespuestaAmbigua();
    // ⚠️ Sin bitácora (§9): `bitacora_auditoria` exige tenant, y acá no hay —
    // no es un acceso a datos, es un aviso de que el número no se reconoce.
    const envio = await obtenerPuertoWhatsApp().enviarTexto({ telefonoE164: telefono, texto });
    return {
      respondido: envio.enviado,
      reintentable: !envio.enviado && envio.reintentable,
      motivo: resolucion.resolucion,
      errorEnvio: envio.errorDescripcion,
    };
  }

  // ---- resuelto --------------------------------------------------------
  const { alcance, contactoId } = resolucion;

  // Paso 3: interruptor del canal — lo primero que se mira con tenantId en
  // mano. `false` incluye al courier sin fila (nace apagado). No es un fallo
  // transitorio: la fila queda registrada y el job termina en éxito.
  const config = await leerConfigCanalConsulta(cliente, alcance.tenantId);

  if (!config.canalActivo) {
    await actualizarFilaEntrante(cliente, entrada.mensajeEntranteId, {
      resolucion: "resuelto",
      tenant_id: alcance.tenantId,
      seller_id: alcance.sellerId,
      contacto_id: contactoId,
      motivo_no_respondido: "canal_apagado",
    });
    return { respondido: false, reintentable: false, motivo: "canal_apagado" };
  }

  if (await excedeTopeDeAbuso(cliente, contactoId, config.topeConsultasHora)) {
    await actualizarFilaEntrante(cliente, entrada.mensajeEntranteId, {
      resolucion: "resuelto",
      tenant_id: alcance.tenantId,
      seller_id: alcance.sellerId,
      contacto_id: contactoId,
      motivo_no_respondido: "tope_consultas",
    });
    return { respondido: false, reintentable: false, motivo: "tope_abuso" };
  }

  const intencion = determinarIntencion(entrada.texto);

  let clasificacion: string;
  let huboMatch: boolean | null;
  let respuestaTexto: string;

  if (intencion.tipo === "consulta_pedido") {
    // Cada código itera la función de dominio con el MISMO alcance — nunca un
    // `in (...)` armado a mano (§ mejora "varios códigos").
    const resultados: ResultadoPedidoConsultado[] = [];
    const itemsParaClasificar: Array<{ clasificacion: ClasificacionCodigo; huboMatch: boolean }> = [];
    for (const codigo of intencion.codigos) {
      const estado = await estadoDePedidoParaSeller(cliente, alcance, codigo.identificador);
      resultados.push({ codigoConsultado: codigo.identificador.valor, estado });
      itemsParaClasificar.push({ clasificacion: codigo.clasificacion, huboMatch: estado !== null });
    }

    const fila = clasificacionParaFilaEntrante(itemsParaClasificar);
    clasificacion = fila.clasificacion;
    huboMatch = fila.huboMatch;
    respuestaTexto = armarRespuestaPedidos(resultados, intencion.sobrante);
  } else if (intencion.tipo === "retiro_del_dia") {
    clasificacion = "intencion_retiro";
    const hoy = fechaLocalEnSantiago(new Date());
    const retiro = await retiroDelDiaParaSeller(cliente, alcance, hoy);
    huboMatch = retiro.esperadosHoy > 0;
    respuestaTexto = armarRespuestaRetiro(retiro);
  } else if (intencion.tipo === "como_consultar") {
    // `/pedido`: pidió ayuda, no consultó nada. No es sondeo ni match.
    clasificacion = "sin_match";
    huboMatch = null;
    respuestaTexto = armarAyudaConsultarPedido();
  } else {
    clasificacion = "sin_match";
    huboMatch = null;
    respuestaTexto = armarMenu();
  }

  // Se escribe ANTES de chequear el barrido: el corte de §6.1 cuenta sobre
  // estas columnas y tiene que ver ESTE intento para poder reaccionar a él.
  // `motivo_no_respondido` queda SIN tocar (NULL un instante): escribir
  // `respondido` acá sería mentir si el barrido corta dos líneas más abajo.
  await actualizarFilaEntrante(cliente, entrada.mensajeEntranteId, {
    resolucion: "resuelto",
    tenant_id: alcance.tenantId,
    seller_id: alcance.sellerId,
    contacto_id: contactoId,
    clasificacion,
    hubo_match: huboMatch,
    ...saneaTextoParaGuardar(entrada.texto),
  });

  if (
    clasificacion === "flex_manual" &&
    !huboMatch &&
    (await detectaBarridoDeCodigos(cliente, contactoId, config.topeIntentosSinMatchHora))
  ) {
    // No se responde y NO hay bitácora: no hubo acceso a un dato que auditar,
    // el sondeo se cortó antes de contestar nada.
    await actualizarFilaEntrante(cliente, entrada.mensajeEntranteId, {
      motivo_no_respondido: "barrido_codigos",
    });
    return { respondido: false, reintentable: false, motivo: "barrido" };
  }

  await actualizarFilaEntrante(cliente, entrada.mensajeEntranteId, { motivo_no_respondido: "respondido" });

  // Bitácora ANTES de llamar a Meta — regla dura del proyecto (CLAUDE.md).
  // `actorTipo: "sistema"` con `contacto_id` en el detalle; NUNCA el teléfono.
  await registrarEnBitacora(cliente, {
    tenantId: alcance.tenantId,
    actorUsuarioId: null,
    actorTipo: "sistema",
    accion: "conversacion.consulta_respondida",
    entidadTipo: "whatsapp_contacto",
    entidadId: contactoId,
    detalle: { contacto_id: contactoId, intencion: intencion.tipo },
  });

  const envio = await obtenerPuertoWhatsApp(alcance.tenantId).enviarTexto({
    telefonoE164: telefono,
    texto: respuestaTexto,
  });

  return {
    respondido: envio.enviado,
    reintentable: !envio.enviado && envio.reintentable,
    motivo: intencion.tipo,
    errorEnvio: envio.errorDescripcion,
  };
}

/**
 * Reduce los códigos de un mensaje (1 a `TOPE_CODIGOS_POR_MENSAJE`) a la
 * `clasificacion`/`hubo_match` de UNA fila — el CHECK de la migración
 * `20260920000001` guarda una sola clasificación por mensaje, no un arreglo.
 *
 * ⚠️ No es un promedio ni "la del primer código": es la MÁS RIESGOSA de las
 * presentes, por el orden `flex_manual > ml_shipment_id > codigo_interno`.
 * `flex_manual` es la que alimenta la detección de barrido (§6.1, sonda de
 * existencia de pedidos) y es la que tiene que sobrevivir si el mensaje trae
 * una mezcla — perderla porque venía junto a un código interno escondería el
 * sondeo. Dentro del grupo elegido, `huboMatch` es "alguno de esos coincidió":
 * un solo match dentro del grupo riesgoso ya lo saca de "sondeo sin match".
 */
function clasificacionParaFilaEntrante(
  items: Array<{ clasificacion: ClasificacionCodigo; huboMatch: boolean }>,
): { clasificacion: ClasificacionCodigo; huboMatch: boolean } {
  const PRIORIDAD: ClasificacionCodigo[] = ["flex_manual", "ml_shipment_id", "codigo_interno"];

  for (const candidata of PRIORIDAD) {
    const delGrupo = items.filter((i) => i.clasificacion === candidata);
    if (delGrupo.length > 0) {
      return { clasificacion: candidata, huboMatch: delGrupo.some((i) => i.huboMatch) };
    }
  }

  // No debería alcanzarse con `items.length > 0` garantizado por el llamador.
  return { clasificacion: "codigo_interno", huboMatch: items.some((i) => i.huboMatch) };
}

async function actualizarFilaEntrante(
  cliente: ReturnType<typeof crearClienteServiceRole>,
  mensajeEntranteId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await cliente
    .schema("integraciones")
    .from("whatsapp_mensajes_entrantes")
    .update(patch)
    .eq("id", mensajeEntranteId);

  if (error) {
    throw new Error(`No se pudo actualizar el mensaje entrante de WhatsApp: ${error.message}`);
  }
}

/** `texto` solo se guarda cuando la identidad se resolvió, truncado a 300 y con su largo aparte. */
function saneaTextoParaGuardar(texto: string | null): Record<string, unknown> {
  if (!texto) return {};
  const truncado = texto.slice(0, LARGO_MAX_TEXTO);
  return { texto: truncado, texto_largo: truncado.length };
}

/**
 * ¿Ya se le mandó a este teléfono una respuesta neutra (`sin_contacto` o
 * `ambiguo`) en las últimas 24 h? Se cuenta sobre `telefono_e164` — un
 * contacto sin resolver no tiene `contacto_id` contra el cual filtrar.
 */
async function yaSeAvisoEnLasUltimas24h(
  cliente: ReturnType<typeof crearClienteServiceRole>,
  telefonoE164: string,
  resoluciones: string[],
): Promise<boolean> {
  const desde = new Date(Date.now() - VENTANA_AVISO_NEUTRO_MS).toISOString();

  const { count, error } = await cliente
    .schema("integraciones")
    .from("whatsapp_mensajes_entrantes")
    .select("id", { count: "exact", head: true })
    .eq("telefono_e164", telefonoE164)
    .in("resolucion", resoluciones)
    .gte("recibido_en", desde);

  if (error) {
    throw new Error(`No se pudo comprobar avisos previos de WhatsApp: ${error.message}`);
  }

  return (count ?? 0) > 0;
}
