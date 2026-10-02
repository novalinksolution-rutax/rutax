/**
 * Catálogo del perfil comercial del courier (las tres preguntas de «Tu empresa»).
 * =============================================================================
 * Fuente única de etiquetas ↔ valores para el registro, Configuración y el
 * backstage. Los valores son los de los CHECK de
 * `identidad.courier_perfil_comercial` (migración `20261001000001`); la prueba
 * `perfil-comercial.test.ts` los compara contra el SQL para que no diverjan.
 *
 * Propósito del dato: priorizar la atención comercial de Rutax y medir qué
 * e-commerce conviene integrar. NO prellena configuración.
 *
 * Sin `"use server"` ni `"use client"`: son datos puros, los lee cualquiera.
 */

export interface OpcionPerfil<V extends string> {
  valor: V;
  etiqueta: string;
}

export const ENVIOS_DIA_OPCIONES = [
  { valor: "aun_no_opera", etiqueta: "Aún no opero" },
  { valor: "menos_100", etiqueta: "Menos de 100" },
  { valor: "100_300", etiqueta: "100–300" },
  { valor: "300_1000", etiqueta: "300–1.000" },
  { valor: "mas_1000", etiqueta: "Más de 1.000" },
] as const satisfies readonly OpcionPerfil<string>[];

export const CONDUCTORES_OPCIONES = [
  { valor: "1_5", etiqueta: "1–5" },
  { valor: "6_15", etiqueta: "6–15" },
  { valor: "16_40", etiqueta: "16–40" },
  { valor: "mas_40", etiqueta: "Más de 40" },
] as const satisfies readonly OpcionPerfil<string>[];

export const FUENTES_PEDIDOS_OPCIONES = [
  { valor: "mercado_libre_flex", etiqueta: "Mercado Libre Flex" },
  { valor: "falabella", etiqueta: "Falabella" },
  { valor: "paris", etiqueta: "Paris" },
  { valor: "ripley", etiqueta: "Ripley" },
  { valor: "shopify", etiqueta: "Shopify" },
  { valor: "woocommerce", etiqueta: "WooCommerce" },
  { valor: "jumpseller", etiqueta: "Jumpseller" },
  { valor: "vtex", etiqueta: "VTEX" },
  { valor: "venta_directa", etiqueta: "Venta directa (web, redes, WhatsApp)" },
  { valor: "otra", etiqueta: "Otra" },
] as const satisfies readonly OpcionPerfil<string>[];

export type EnviosDiaRango = (typeof ENVIOS_DIA_OPCIONES)[number]["valor"];
export type ConductoresRango = (typeof CONDUCTORES_OPCIONES)[number]["valor"];
export type FuentePedidosPerfil = (typeof FUENTES_PEDIDOS_OPCIONES)[number]["valor"];

/** Largo máximo de «¿Cuál?» — igual que el CHECK `fuente_otra_coherente`. */
export const FUENTE_OTRA_MAX = 80;

export const VALORES_ENVIOS_DIA: readonly string[] = ENVIOS_DIA_OPCIONES.map((o) => o.valor);
export const VALORES_CONDUCTORES: readonly string[] = CONDUCTORES_OPCIONES.map((o) => o.valor);
export const VALORES_FUENTES_PEDIDOS: readonly string[] = FUENTES_PEDIDOS_OPCIONES.map((o) => o.valor);

/** Rango envíos/día → posición (0 = aún no opera … 4 = más de 1.000). Para ordenar. */
export function ordenEnviosDia(valor: string | null | undefined): number {
  const i = valor ? VALORES_ENVIOS_DIA.indexOf(valor) : -1;
  return i;
}

export function ordenConductores(valor: string | null | undefined): number {
  const i = valor ? VALORES_CONDUCTORES.indexOf(valor) : -1;
  return i;
}

export function etiquetaEnviosDia(valor: string | null | undefined): string {
  return ENVIOS_DIA_OPCIONES.find((o) => o.valor === valor)?.etiqueta ?? "Sin responder";
}

export function etiquetaConductores(valor: string | null | undefined): string {
  return CONDUCTORES_OPCIONES.find((o) => o.valor === valor)?.etiqueta ?? "Sin responder";
}

export function etiquetaFuentePedidos(valor: string): string {
  return FUENTES_PEDIDOS_OPCIONES.find((o) => o.valor === valor)?.etiqueta ?? valor;
}

/** Las tres respuestas tal como viven en la base (o `null` = sin responder). */
export interface PerfilComercial {
  enviosDiaRango: string;
  conductoresRango: string;
  fuentesPedidos: string[];
  fuenteOtra: string | null;
}

export type ResultadoValidacionPerfil =
  | { ok: true; perfil: PerfilComercial }
  | { ok: false; mensaje: string };

/**
 * Valida las tres respuestas con las mismas reglas que los CHECK de la base,
 * para rechazar con un mensaje útil antes de llegar a Postgres.
 */
export function validarPerfilComercial(entrada: {
  enviosDiaRango: unknown;
  conductoresRango: unknown;
  fuentesPedidos: unknown;
  fuenteOtra: unknown;
}): ResultadoValidacionPerfil {
  const envios = typeof entrada.enviosDiaRango === "string" ? entrada.enviosDiaRango : "";
  if (!VALORES_ENVIOS_DIA.includes(envios)) {
    return { ok: false, mensaje: "Elige cuántos envíos entregas en un día normal." };
  }
  const conductores = typeof entrada.conductoresRango === "string" ? entrada.conductoresRango : "";
  if (!VALORES_CONDUCTORES.includes(conductores)) {
    return { ok: false, mensaje: "Elige cuántos conductores trabajan contigo." };
  }
  const crudas = Array.isArray(entrada.fuentesPedidos) ? entrada.fuentesPedidos : [];
  const fuentes = [...new Set(crudas.filter((f): f is string => typeof f === "string"))];
  if (fuentes.length === 0 || fuentes.some((f) => !VALORES_FUENTES_PEDIDOS.includes(f))) {
    return { ok: false, mensaje: "Marca al menos un origen de tus pedidos." };
  }
  let fuenteOtra: string | null = null;
  if (fuentes.includes("otra")) {
    fuenteOtra = typeof entrada.fuenteOtra === "string" ? entrada.fuenteOtra.trim() : "";
    if (!fuenteOtra) return { ok: false, mensaje: "Cuéntanos cuál es la otra fuente." };
    if (fuenteOtra.length > FUENTE_OTRA_MAX) {
      return { ok: false, mensaje: `Máximo ${FUENTE_OTRA_MAX} caracteres.` };
    }
  }
  return {
    ok: true,
    perfil: { enviosDiaRango: envios, conductoresRango: conductores, fuentesPedidos: fuentes, fuenteOtra },
  };
}
