/**
 * Reglas puras del paso 4 (Zonas y tarifas) — docs/ux/puesta-en-marcha-v2.md §3.7 y §14.
 * =============================================================================
 *
 * Sin React y sin acceso a datos, a propósito: es lo que la pantalla y la Server
 * Action comparten (la acción re-valida todo lo que la pantalla ya validó, porque
 * lo que llega del navegador no es de fiar) y lo que se puede probar sin montar
 * nada.
 *
 * Vive fuera de `actions.ts` porque un módulo `"use server"` solo puede exportar
 * funciones async: una constante ahí tumba el build de producción.
 */

import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { FUENTES_PEDIDO, type FuentePedido } from "@/modules/operacion/tipos";

// -----------------------------------------------------------------------------
// Valores sugeridos — UNA sola constante (§3.7, decisión Q9/Q3 de §14).
// Montos NETOS, sin IVA: cobro y pago al conductor en la misma base.
// -----------------------------------------------------------------------------

export const ZONAS_SUGERIDAS = {
  zona1: { nombre: "Gran Santiago urbano", cobro: 3500, pago: 2400 },
  zona2: { nombre: "Periferia", cobro: 4000, pago: 2900 },
} as const;

/**
 * Comunas de la Zona 1: las 32 de la provincia de Santiago + Puente Alto + San
 * Bernardo (34). Todo lo demás del catálogo es Zona 2 / Periferia (18), que es la
 * zona de respaldo.
 */
const COMUNAS_PERIFERIA: readonly string[] = [
  "Alhué",
  "Buin",
  "Calera de Tango",
  "Colina",
  "Curacaví",
  "El Monte",
  "Isla de Maipo",
  "Lampa",
  "María Pinto",
  "Melipilla",
  "Padre Hurtado",
  "Paine",
  "Peñaflor",
  "Pirque",
  "San José de Maipo",
  "San Pedro",
  "Talagante",
  "Tiltil",
];

export const COMUNAS_ZONA_1_SUGERIDAS: readonly string[] = COMUNAS_RM.filter(
  (c) => !COMUNAS_PERIFERIA.includes(c),
);

export const LARGO_MAXIMO_NOMBRE_ZONA = 60;
export const MONTO_MAXIMO_CLP = 10_000_000;

export type NumeroZona = 1 | 2;

export const ETIQUETA_PLATAFORMA: Record<FuentePedido, string> = {
  rutax_manual: "Pedidos propios",
  ml_flex: "Mercado Libre Flex",
  shopify: "Shopify",
};

/**
 * Plataformas para las que se puede diferenciar: «Pedidos propios» siempre; Flex
 * y Shopify solo si el paso 3 las encendió. El orden es el de la pantalla.
 */
export function plataformasEncendidas(config: {
  ofreceFlex: boolean;
  ofreceShopify: boolean;
}): FuentePedido[] {
  return [
    "rutax_manual",
    ...(config.ofreceFlex ? (["ml_flex"] as const) : []),
    ...(config.ofreceShopify ? (["shopify"] as const) : []),
  ];
}

// -----------------------------------------------------------------------------
// Dinero: enteros CLP
// -----------------------------------------------------------------------------

/** Lo que se teclea → entero, ignorando todo lo que no sea dígito. Vacío = null. */
export function parsearMonto(texto: string): number | null {
  const digitos = texto.replace(/\D/g, "");
  if (digitos === "") return null;
  return Math.min(Number(digitos), MONTO_MAXIMO_CLP);
}

/** `3.500` — miles con punto, sin símbolo (el `$` lo pone el campo). */
export function miles(monto: number | null): string {
  if (monto === null) return "";
  return Math.round(monto)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** `$3.500`. Deliberadamente sin espacio: es la forma del diseño. */
export function pesos(monto: number): string {
  return `${monto < 0 ? "-" : ""}$${miles(Math.abs(monto))}`;
}

export interface Margen {
  /** CLP por entrega; puede ser negativo. */
  monto: number;
  /** Entero, sobre lo que se cobra. `null` si no hay cobro. */
  porcentaje: number | null;
}

export function calcularMargen(cobro: number | null, pago: number | null): Margen | null {
  if (cobro === null || pago === null) return null;
  return {
    monto: cobro - pago,
    porcentaje: cobro > 0 ? Math.round(((cobro - pago) / cobro) * 100) : null,
  };
}

// -----------------------------------------------------------------------------
// Estado del paso
// -----------------------------------------------------------------------------

export interface MontosZona {
  cobro: number | null;
  pago: number | null;
}

export interface EstadoZona extends MontosZona {
  id: string | null;
  nombre: string;
}

/** Excepciones editadas a mano; la que no está sigue el valor de su zona. */
export type Excepciones = Partial<Record<`${NumeroZona}:${FuentePedido}`, MontosZona>>;

export interface EstadoPaso4 {
  zona1: EstadoZona;
  zona2: EstadoZona;
  /** Comuna → zona. Las 52 siempre tienen una. */
  asignacion: Readonly<Record<string, NumeroZona>>;
  diferenciar: boolean;
  excepciones: Excepciones;
}

export function comunasDe(
  asignacion: Readonly<Record<string, NumeroZona>>,
  zona: NumeroZona,
): string[] {
  return COMUNAS_RM.filter((c) => asignacion[c] === zona);
}

/** La otra zona: 1 ↔ 2. */
export function zonaOpuesta(zona: NumeroZona): NumeroZona {
  return zona === 1 ? 2 : 1;
}

/**
 * Un clic en una comuna la pasa a la otra zona. Devuelve una asignación nueva
 * (la original no se toca) y NO crea claves: una comuna fuera del catálogo se
 * ignora, porque la acción del servidor rechaza cualquier nombre ajeno.
 */
export function alternarZona(
  asignacion: Readonly<Record<string, NumeroZona>>,
  comuna: string,
): Readonly<Record<string, NumeroZona>> {
  const actual = asignacion[comuna];
  if (actual === undefined) return asignacion;
  return { ...asignacion, [comuna]: zonaOpuesta(actual) };
}

/** Fija la zona de una comuna. Si ya la tenía, devuelve la misma referencia. */
export function asignarZona(
  asignacion: Readonly<Record<string, NumeroZona>>,
  comuna: string,
  zona: NumeroZona,
): Readonly<Record<string, NumeroZona>> {
  if (asignacion[comuna] === undefined || asignacion[comuna] === zona) return asignacion;
  return { ...asignacion, [comuna]: zona };
}

/** Minúsculas y sin tildes: «nunoa» encuentra «Ñuñoa». */
export function normalizarBusqueda(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Comunas del catálogo que contienen el texto, en orden alfabético estable. */
export function filtrarComunas(consulta: string): string[] {
  const q = normalizarBusqueda(consulta);
  return [...COMUNAS_RM]
    .sort((a, b) => a.localeCompare(b, "es"))
    .filter((c) => q === "" || normalizarBusqueda(c).includes(q));
}

export function asignacionSugerida(): Record<string, NumeroZona> {
  const a: Record<string, NumeroZona> = {};
  for (const c of COMUNAS_RM) a[c] = COMUNAS_ZONA_1_SUGERIDAS.includes(c) ? 1 : 2;
  return a;
}

export function estadoSugerido(): EstadoPaso4 {
  return {
    zona1: { id: null, nombre: ZONAS_SUGERIDAS.zona1.nombre, cobro: ZONAS_SUGERIDAS.zona1.cobro, pago: ZONAS_SUGERIDAS.zona1.pago },
    zona2: { id: null, nombre: ZONAS_SUGERIDAS.zona2.nombre, cobro: ZONAS_SUGERIDAS.zona2.cobro, pago: ZONAS_SUGERIDAS.zona2.pago },
    asignacion: asignacionSugerida(),
    diferenciar: false,
    excepciones: {},
  };
}

/** Montos efectivos de una excepción: los suyos si se editó, si no los de la zona. */
export function montosDeExcepcion(
  estado: Pick<EstadoPaso4, "zona1" | "zona2" | "excepciones">,
  zona: NumeroZona,
  fuente: FuentePedido,
): MontosZona {
  const propia = estado.excepciones[`${zona}:${fuente}`];
  if (propia) return propia;
  const z = zona === 1 ? estado.zona1 : estado.zona2;
  return { cobro: z.cobro, pago: z.pago };
}

// -----------------------------------------------------------------------------
// Validación (mismos textos en pantalla y en la acción)
// -----------------------------------------------------------------------------

export const TEXTO_FALTA_MONTO = "Ingresa un monto.";
export const TEXTO_FALTA_COMUNA = "Asigna al menos una comuna.";
export const TEXTO_FALTA_NOMBRE = "Obligatorio.";
export const TEXTO_NOMBRE_REPETIDO = "Los nombres deben ser distintos.";

export interface ErroresPaso4 {
  nombre: Partial<Record<NumeroZona, string>>;
  cobro: Partial<Record<NumeroZona, string>>;
  pago: Partial<Record<NumeroZona, string>>;
  comunas: Partial<Record<NumeroZona, string>>;
  /** Clave `zona:fuente` → mensaje; solo con «Diferenciar» activo. */
  excepciones: Record<string, { cobro?: string; pago?: string }>;
}

function montoValido(m: number | null): boolean {
  return m !== null && Number.isInteger(m) && m > 0 && m <= MONTO_MAXIMO_CLP;
}

export function validarPaso4(
  estado: EstadoPaso4,
  plataformas: readonly FuentePedido[],
): { ok: boolean; errores: ErroresPaso4 } {
  const errores: ErroresPaso4 = { nombre: {}, cobro: {}, pago: {}, comunas: {}, excepciones: {} };

  for (const n of [1, 2] as const) {
    const z = n === 1 ? estado.zona1 : estado.zona2;
    const nombre = z.nombre.trim();
    if (!nombre || nombre.length > LARGO_MAXIMO_NOMBRE_ZONA) errores.nombre[n] = TEXTO_FALTA_NOMBRE;
    if (!montoValido(z.cobro)) errores.cobro[n] = TEXTO_FALTA_MONTO;
    if (!montoValido(z.pago)) errores.pago[n] = TEXTO_FALTA_MONTO;
    if (comunasDe(estado.asignacion, n).length === 0) errores.comunas[n] = TEXTO_FALTA_COMUNA;
  }
  if (
    !errores.nombre[1] &&
    !errores.nombre[2] &&
    estado.zona1.nombre.trim().toLowerCase() === estado.zona2.nombre.trim().toLowerCase()
  ) {
    errores.nombre[2] = TEXTO_NOMBRE_REPETIDO;
  }

  if (estado.diferenciar) {
    for (const n of [1, 2] as const) {
      for (const f of plataformas) {
        const m = montosDeExcepcion(estado, n, f);
        const e: { cobro?: string; pago?: string } = {};
        if (!montoValido(m.cobro)) e.cobro = TEXTO_FALTA_MONTO;
        if (!montoValido(m.pago)) e.pago = TEXTO_FALTA_MONTO;
        if (e.cobro || e.pago) errores.excepciones[`${n}:${f}`] = e;
      }
    }
  }

  const hayError =
    Object.keys(errores.nombre).length +
      Object.keys(errores.cobro).length +
      Object.keys(errores.pago).length +
      Object.keys(errores.comunas).length +
      Object.keys(errores.excepciones).length >
    0;
  return { ok: !hayError, errores };
}

// -----------------------------------------------------------------------------
// Contrato con la Server Action
// -----------------------------------------------------------------------------

export interface EntradaZonaGuardar {
  id: string | null;
  nombre: string;
  comunas: string[];
  cobro: number;
  pago: number;
  excepciones: { fuente: FuentePedido; cobro: number; pago: number }[];
}

export interface EntradaGuardarPaso4 {
  zona1: EntradaZonaGuardar;
  zona2: EntradaZonaGuardar;
}

/** Del estado de la pantalla a lo que viaja al servidor. Asume estado válido. */
export function construirEntrada(
  estado: EstadoPaso4,
  plataformas: readonly FuentePedido[],
): EntradaGuardarPaso4 {
  const armar = (n: NumeroZona): EntradaZonaGuardar => {
    const z = n === 1 ? estado.zona1 : estado.zona2;
    return {
      id: z.id,
      nombre: z.nombre.trim(),
      comunas: comunasDe(estado.asignacion, n),
      cobro: z.cobro ?? 0,
      pago: z.pago ?? 0,
      excepciones: estado.diferenciar
        ? plataformas.map((fuente) => {
            const m = montosDeExcepcion(estado, n, fuente);
            return { fuente, cobro: m.cobro ?? 0, pago: m.pago ?? 0 };
          })
        : [],
    };
  };
  return { zona1: armar(1), zona2: armar(2) };
}

/** Re-validación del lado servidor. Devuelve el primer mensaje, o `null`. */
export function validarEntradaServidor(
  entrada: EntradaGuardarPaso4,
  plataformasPermitidas: readonly FuentePedido[],
): { mensaje: string; campo?: string } | null {
  const catalogo = new Set<string>(COMUNAS_RM);
  const vistas = new Set<string>();
  const nombres = new Set<string>();

  for (const [clave, z] of [
    ["zona1", entrada.zona1],
    ["zona2", entrada.zona2],
  ] as const) {
    if (!z || typeof z !== "object") return { mensaje: "No pudimos guardar. Reintenta." };
    const nombre = String(z.nombre ?? "").trim();
    if (!nombre || nombre.length > LARGO_MAXIMO_NOMBRE_ZONA) {
      return { mensaje: TEXTO_FALTA_NOMBRE, campo: `${clave}.nombre` };
    }
    if (nombres.has(nombre.toLowerCase())) return { mensaje: TEXTO_NOMBRE_REPETIDO, campo: `${clave}.nombre` };
    nombres.add(nombre.toLowerCase());

    if (!Array.isArray(z.comunas) || z.comunas.length === 0) {
      return { mensaje: TEXTO_FALTA_COMUNA, campo: `${clave}.comunas` };
    }
    for (const c of z.comunas) {
      if (typeof c !== "string" || !catalogo.has(c) || vistas.has(c)) {
        return { mensaje: "No pudimos guardar. Reintenta.", campo: `${clave}.comunas` };
      }
      vistas.add(c);
    }
    if (!montoValido(z.cobro)) return { mensaje: TEXTO_FALTA_MONTO, campo: `${clave}.cobro` };
    if (!montoValido(z.pago)) return { mensaje: TEXTO_FALTA_MONTO, campo: `${clave}.pago` };

    const fuentes = new Set<string>();
    for (const e of Array.isArray(z.excepciones) ? z.excepciones : []) {
      if (
        !(FUENTES_PEDIDO as readonly string[]).includes(e?.fuente) ||
        !plataformasPermitidas.includes(e.fuente) ||
        fuentes.has(e.fuente)
      ) {
        return { mensaje: "No pudimos guardar. Reintenta.", campo: `${clave}.excepciones` };
      }
      fuentes.add(e.fuente);
      if (!montoValido(e.cobro) || !montoValido(e.pago)) {
        return { mensaje: TEXTO_FALTA_MONTO, campo: `${clave}.excepciones` };
      }
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Reentrada: lo guardado → estado de la pantalla
// -----------------------------------------------------------------------------

export interface DatosGuardadosPaso4 {
  zonas: { id: string; nombre: string; esRespaldo: boolean; creadoEn: string }[];
  comunas: { zonaId: string; comuna: string }[];
  /** Solo tarifas activas abiertas (sin vigente_hasta), sin seller ni régimen legado. */
  tarifas: { zonaId: string | null; fuente: FuentePedido | null; cobro: number; pago: number }[];
}

/**
 * Reconstruye el estado con lo que ya hay en la base. Sin zonas guardadas cae a
 * los sugeridos. Una comuna que no esté en ninguna de las dos zonas se muestra en
 * la de respaldo, que es donde el motor la cobra (Q6).
 *
 * Una excepción solo se marca «editada» si difiere de su zona; una idéntica
 * sigue a la zona, igual que recién creada.
 */
export function hidratarPaso4(
  datos: DatosGuardadosPaso4,
  plataformas: readonly FuentePedido[],
): EstadoPaso4 {
  const base = estadoSugerido();
  const respaldo = datos.zonas.find((z) => z.esRespaldo);
  const otra = datos.zonas
    .filter((z) => !z.esRespaldo)
    .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn))[0];
  if (!respaldo && !otra) return base;

  const montosDe = (zonaId: string, fuente: FuentePedido | null): MontosZona | null => {
    const t = datos.tarifas.find((x) => x.zonaId === zonaId && x.fuente === fuente);
    return t ? { cobro: t.cobro, pago: t.pago } : null;
  };

  const armar = (z: typeof respaldo, sugerida: EstadoZona): EstadoZona => {
    if (!z) return sugerida;
    const m = montosDe(z.id, null);
    return { id: z.id, nombre: z.nombre, cobro: m?.cobro ?? sugerida.cobro, pago: m?.pago ?? sugerida.pago };
  };
  const zona1 = armar(otra, base.zona1);
  const zona2 = armar(respaldo, base.zona2);

  const asignacion: Record<string, NumeroZona> = {};
  const deZona1 = new Set(datos.comunas.filter((c) => c.zonaId === otra?.id).map((c) => c.comuna));
  const deZona2 = new Set(datos.comunas.filter((c) => c.zonaId === respaldo?.id).map((c) => c.comuna));
  const hayMapeo = deZona1.size + deZona2.size > 0;
  for (const c of COMUNAS_RM) {
    if (!hayMapeo) asignacion[c] = base.asignacion[c];
    else asignacion[c] = deZona1.has(c) ? 1 : 2;
  }

  const excepciones: Excepciones = {};
  let hayExcepciones = false;
  for (const [n, z] of [
    [1, zona1],
    [2, zona2],
  ] as const) {
    if (!z.id) continue;
    for (const f of plataformas) {
      const m = montosDe(z.id, f);
      if (!m) continue;
      hayExcepciones = true;
      if (m.cobro !== z.cobro || m.pago !== z.pago) excepciones[`${n}:${f}`] = m;
    }
  }

  return { zona1, zona2, asignacion, diferenciar: hayExcepciones, excepciones };
}
