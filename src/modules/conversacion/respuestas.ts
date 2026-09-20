/**
 * El texto que ve el seller — §7 del documento de alcance.
 * =============================================================================
 * «No es un bot conversacional. Es un buscador con tres respuestas fijas y un
 * menú de botones. Nada de lo que responde lo redacta un modelo de lenguaje»
 * (§1). Este archivo es TODO el copy de la v1.
 *
 * Revisado por `copywriter` el 2026-09-20 y corregido tras probarlo con un
 * seller real: sin saludos, sin emojis, sin «gracias por escribir».
 *
 * ⚠️ **El menú es el mensaje que más se lee**, porque es lo que recibe quien
 * todavía no sabe usar el canal. Por eso son tres líneas y no una: la primera
 * versión decía solo «Envía un código o RETIRO» y el usuario probó, no supo
 * qué hacer después, y no había forma de descubrir que se pueden mandar
 * varios. Enseñar acá es la excepción que gana su texto.
 *
 * Reglas duras que SÍ son de este archivo, no de copy:
 *  - Sin dirección, sin nombre del destinatario, sin nombre de conductor, sin
 *    hora estimada.
 *  - `Parada N de M` sí va.
 *  - El callejón sin salida (menú, ambiguo, sin contacto) nunca insinúa que
 *    alguien leyó el mensaje.
 */

import type { EstadoPedidoSeller, RetiroDelDiaSeller } from "../operacion/consultas/seller";

function urlPortal(): string {
  return process.env.APP_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://rutax.io";
}

const TEXTOS_ESTADO: Record<string, string> = {
  pendiente_asignacion: "Pendiente de asignar",
  asignado: "Asignado",
  en_ruta: "En ruta",
  entregado: "Entregado",
  entregado_manual: "Entregado",
  fallido: "No se pudo entregar",
  fallido_manual: "No se pudo entregar",
  devuelto: "Devuelto",
  cancelado: "Cancelado",
};

/**
 * El código que se muestra como ejemplo.
 *
 * ⚠️ Es un `ml_order_id` de Flex (16 dígitos), no un `ml_shipment_id` ni un
 * `RX-XXXX-XXXX` de same-day: la operación real de los couriers hoy es toda
 * Flex, y **el id de la orden es el único código que el seller ve** en su panel
 * de Ventas de Mercado Libre. Un ejemplo con un formato que nunca tiene a mano
 * no le enseña nada (decisión del usuario, 2026-09-20).
 */
const CODIGO_DE_EJEMPLO = "2000017906826300";

/** El segundo del ejemplo, para enseñar que se pueden mandar varios juntos. */
const CODIGO_DE_EJEMPLO_2 = "2000017909507518";

/** Un código consultado, con o sin resultado — insumo de `armarRespuestaPedidos`. */
export interface ResultadoPedidoConsultado {
  /** El identificador con el que se consultó (`ml_shipment_id` o `codigo_interno`), NUNCA el texto crudo del mensaje. */
  codigoConsultado: string;
  estado: EstadoPedidoSeller | null;
}

/**
 * Respuesta agrupada de hasta `TOPE_CODIGOS_POR_MENSAJE` pedidos (§ mejora
 * "varios códigos"): una línea por pedido encontrado (`código · estado` y la
 * parada si la hay), los no encontrados juntos al final SIN distinguir
 * «no existe» de «no es tuyo» (§5/§6 regla 4, sigue intacta con varios), y si
 * el mensaje traía más de 5 códigos, cuántos quedaron fuera — nunca se
 * recortan en silencio.
 */
export function armarRespuestaPedidos(resultados: ResultadoPedidoConsultado[], sobrante = 0): string {
  const lineas: string[] = [];
  const noEncontrados: string[] = [];

  for (const r of resultados) {
    if (!r.estado) {
      noEncontrados.push(r.codigoConsultado);
      continue;
    }
    // ⚠️ Se responde con el código que el seller ESCRIBIÓ, no con el nuestro.
    // Si preguntó por el id de la orden (lo único que ve en su panel de ML) y
    // le contestamos con el id del envío, tiene que adivinar de cuál de sus
    // pedidos le estamos hablando.
    const partes = [`${r.codigoConsultado} · ${TEXTOS_ESTADO[r.estado.estado] ?? r.estado.estado}`];
    if (r.estado.parada) partes.push(`Parada ${r.estado.parada.numero} de ${r.estado.parada.de}.`);
    lineas.push(partes.join(" "));
  }

  if (noEncontrados.length > 0) {
    lineas.push(`No encontramos: ${noEncontrados.join(", ")}.`);
  }

  if (sobrante > 0) {
    lineas.push(`${sobrante} código${sobrante === 1 ? "" : "s"} más sin revisar (máximo 5 por mensaje).`);
  }

  lineas.push(`${urlPortal()}/portal`);
  return lineas.join("\n");
}

export function armarRespuestaRetiro(retiro: RetiroDelDiaSeller): string {
  if (retiro.visitas.length === 0) {
    return `Sin retiro hoy. ${retiro.esperadosHoy} pedidos por retirar.`;
  }

  const cargados = retiro.visitas.reduce((s, v) => s + v.cargados, 0);
  const lineas = [`Hoy: ${cargados} de ${retiro.esperadosHoy} cargados.`];

  if (retiro.faltantes.length > 0) {
    const codigos = retiro.faltantes.slice(0, 5).map((f) => f.codigoVisible);
    const resto = retiro.faltantes.length - codigos.length;
    lineas.push(`Faltan: ${codigos.join(", ")}${resto > 0 ? ` y ${resto} más` : ""}.`);
  }

  return lineas.join("\n");
}

/** Nunca se manda a quien pidió la baja (el webhook filtra ANTES de publicar el evento). */
export function armarMenu(): string {
  // ⚠️ Se enseñan los COMANDOS, no los ice-breakers (§17): los ice-breakers
  // solo aparecen en una conversación NUEVA, así que quien está leyendo esto
  // —que ya escribió— no los va a ver nunca. Nombrárselos sería mandarlo a
  // buscar algo que en su pantalla no existe.
  //
  // Los emojis van como ETIQUETA de cada línea, para escanear el mensaje en un
  // teléfono. Nada de 👋 al abrir ni 😊 al cerrar: ahí un canal operativo
  // empieza a sonar a bot.
  // ⚠️ El ejemplo va al final y con DOS códigos separados por coma: se escribe
  // una sola vez —comando y código en el mismo mensaje— y de paso muestra que
  // se pueden mandar varios, que contado en prosa nadie entiende (idea del
  // usuario, 2026-09-20). Para que ese ejemplo funcione tal como se copia, el
  // parser limpia la coma pegada al número.
  return [
    "📦 */pedido* — cómo va un pedido",
    "🚚 */retiro* — el retiro de hoy",
    "",
    "Puedes mandar varios códigos juntos.",
    "",
    `Ejemplo: /pedido ${CODIGO_DE_EJEMPLO}, ${CODIGO_DE_EJEMPLO_2}`,
  ].join("\n");
}

/**
 * Respuesta al comando `/pedido`.
 *
 * ⚠️ NO puede ser el menú. El menú anuncia `/pedido`, así que si `/pedido`
 * devolviera el menú, el seller leería «usa /pedido», lo escribiría y recibiría
 * otra vez lo mismo: un bucle del que no se sale.
 */
export function armarAyudaConsultarPedido(): string {
  return [
    "Mándame el comando con el código 📦",
    `Ejemplo: /pedido ${CODIGO_DE_EJEMPLO}`,
    "Puedes poner varios códigos en el mismo mensaje, separados por coma.",
  ].join("\n");
}

/** §5: ningún contacto con consentimiento vigente para este número. */
export function armarRespuestaSinContacto(): string {
  // ⚠️ El número lo registra el PROPIO seller en su perfil — no el courier ni
  // Rutax (CLAUDE.md, WhatsApp: «el campo se pide al activar la cuenta y se
  // corrige en /portal/perfil»). Mandarlo a pedírselo a otro es mandarlo a
  // esperar por algo que puede hacer solo en treinta segundos.
  return `Número no registrado. Agrégalo en tu perfil: ${urlPortal()}/portal/perfil`;
}

/**
 * §5.1: el teléfono resuelve a más de un contacto. NO se responde nada sobre
 * ningún pedido — el bot respondería con datos del courier equivocado, y ese
 * error no se puede deshacer.
 */
export function armarRespuestaAmbigua(): string {
  // Este mensaje lo lee alguien que quedó sin canal por algo que no hizo mal.
  // Acá lo corto gana a lo breve: tiene que entender por qué no le
  // respondemos y adónde ir.
  return `Este número está en más de una cuenta. Revisa tus pedidos en ${urlPortal()}/portal`;
}
