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
    const partes = [`${r.estado.codigo} · ${TEXTOS_ESTADO[r.estado.estado] ?? r.estado.estado}`];
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
  return [
    "Envía el código de un pedido y te digo cómo va. Puedes mandar varios.",
    "Ejemplo: RX-7K2M-9PQR",
    "RETIRO: cómo fue el retiro de hoy.",
    // ⚠️ Se enseñan los COMANDOS, no los ice-breakers (§17): los ice-breakers
    // solo aparecen en una conversación nueva, así que quien está leyendo esto
    // —que ya escribió— no los va a ver nunca. Decirle que existen sería
    // mandarlo a buscar algo que no está.
    "Atajos: escribe /",
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
