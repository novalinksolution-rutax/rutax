/**
 * El texto que ve el seller — §7 del documento de alcance.
 * =============================================================================
 * «No es un bot conversacional. Es un buscador con tres respuestas fijas y un
 * menú de botones. Nada de lo que responde lo redacta un modelo de lenguaje»
 * (§1). Este archivo es TODO el copy de la v1.
 *
 * ⚠️ MÍNIMO A PROPÓSITO, Y SIN CERRAR. El copy final lo revisa `copywriter`
 * (gate obligatorio del proyecto): cada string de acá está marcado como texto
 * de trabajo, no definitivo. Se optó por lo más corto posible en vez de
 * adornar, siguiendo la regla del proyecto («menos texto» es a menudo la
 * respuesta correcta) — pero la decisión final de tono es de `copywriter`.
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

/** Ejemplo del §7: `4476 0788 901 · En ruta`. */
export function armarRespuestaPedido(estado: EstadoPedidoSeller | null): string {
  if (!estado) {
    // No distingue «no existe» de «no es tuyo» (§5/§6 regla 4): la
    // indistinguibilidad es intencional.
    return "No encontramos ese pedido.";
  }

  const lineas = [`${estado.codigo} · ${TEXTOS_ESTADO[estado.estado] ?? estado.estado}`];

  const partes: string[] = [];
  if (estado.ultimoHito) partes.push(estado.ultimoHito.texto);
  if (estado.parada) partes.push(`Parada ${estado.parada.numero} de ${estado.parada.de}.`);
  if (partes.length > 0) lineas.push(partes.join(" "));

  lineas.push(`${urlPortal()}/portal`);
  return lineas.join("\n");
}

export function armarRespuestaRetiro(retiro: RetiroDelDiaSeller): string {
  if (retiro.visitas.length === 0) {
    return `Todavía no hay retiro hoy. Esperados: ${retiro.esperadosHoy}.`;
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
  return "Escribe el código de tu pedido o la palabra RETIRO.";
}

/** §5: ningún contacto con consentimiento vigente para este número. */
export function armarRespuestaSinContacto(): string {
  return `No tenemos este número asociado a tu cuenta. Pídele a tu courier que lo agregue desde ${urlPortal()}/portal.`;
}

/**
 * §5.1: el teléfono resuelve a más de un contacto. NO se responde nada sobre
 * ningún pedido — el bot respondería con datos del courier equivocado, y ese
 * error no se puede deshacer.
 */
export function armarRespuestaAmbigua(): string {
  return `Este número está asociado a más de una cuenta. Revisa tus pedidos en ${urlPortal()}/portal.`;
}
