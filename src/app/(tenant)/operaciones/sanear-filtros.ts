/**
 * Saneamiento de los filtros de `/operaciones` que llegan por `searchParams`.
 *
 * Son la única puerta de entrada entre la URL y `listarPedidos`: un valor
 * inválido (un enlace mal copiado, un marcador viejo, alguien probando
 * `?estado=todos` a mano) se IGNORA — se trata como si el filtro no viniera —
 * en vez de pasarse tal cual a la consulta.
 *
 * BUG real (2026-08-11): sin este saneamiento, `?estado=todos` (o un
 * `?seller=`/`?conductor=` que no es un UUID, o una `?fecha=` fuera de rango)
 * llega intacto a `.eq(...)` sobre una columna enum/uuid/date de Postgres, que
 * responde con un error de Postgres. `listarPedidos` lo relanza como
 * `Error`, y la página entera cae al estado "No pudimos cargar los pedidos.
 * Intenta recargar la página." con los contadores en blanco — para TODOS los
 * pedidos, no solo para el filtro roto.
 *
 * Solo se sanea el VALOR del parámetro. Si la consulta a Supabase falla de
 * verdad (con un filtro ya saneado), ese error sigue propagándose sin tocar —
 * no hay try/catch nuevo aquí.
 */
import { ESTADOS_PEDIDO, type EstadoPedido, FUENTES_PEDIDO, type FuentePedido } from "@/modules/operacion/tipos";

const ESTADOS_VALIDOS = new Set<string>(ESTADOS_PEDIDO);
const FUENTES_VALIDAS = new Set<string>(FUENTES_PEDIDO);

const REGEX_UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const REGEX_FECHA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

const DIAS_POR_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function esAnioBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

/** `filtros.estado` va a `.eq("estado", …)` sobre un enum de Postgres. */
export function sanearFiltroEstadoPedido(valor: string | undefined | null): EstadoPedido | "" {
  if (!valor) return "";
  return ESTADOS_VALIDOS.has(valor) ? (valor as EstadoPedido) : "";
}

/** `filtros.fuente` va a `.eq("fuente", …)` sobre un enum de Postgres. */
export function sanearFiltroFuentePedido(valor: string | undefined | null): FuentePedido | "" {
  if (!valor) return "";
  return FUENTES_VALIDAS.has(valor) ? (valor as FuentePedido) : "";
}

/** `filtros.sellerId` / `filtros.conductorId` van a `.eq(...)` sobre columnas uuid. */
export function sanearFiltroUuid(valor: string | undefined | null): string {
  if (!valor) return "";
  return REGEX_UUID.test(valor) ? valor : "";
}

/**
 * `filtros.fecha` va a `.eq("fecha_compromiso", …)` sobre una columna `date`.
 * No basta el formato `YYYY-MM-DD`: Postgres también rechaza un día/mes fuera
 * de rango (p. ej. `2026-02-30`). La validación es aritmética pura —sin pasar
 * por `Date`— a propósito: este repo tiene un guard (`fecha-santiago.guard.
 * test.ts`) que prohíbe truncar un instante UTC para derivar una fecha civil,
 * justo el patrón que se necesitaría para el roundtrip con `Date`. Como esto
 * no es "hoy en Santiago" sino validar un string YYYY-MM-DD ya dado, la
 * aritmética directa es además más simple que rodear el guard.
 */
export function sanearFiltroFechaCivil(valor: string | undefined | null): string {
  if (!valor || !REGEX_FECHA_CIVIL.test(valor)) return "";
  const [anioStr, mesStr, diaStr] = valor.split("-");
  const anio = Number(anioStr);
  const mes = Number(mesStr);
  const dia = Number(diaStr);
  if (mes < 1 || mes > 12) return "";
  const diasEnMes = mes === 2 && esAnioBisiesto(anio) ? 29 : DIAS_POR_MES[mes - 1];
  if (dia < 1 || dia > diasEnMes) return "";
  return valor;
}

/**
 * `pagina` va a `.range(offset, …)`. `parseInt("abc", 10)` es `NaN`, y
 * `Math.max(1, NaN)` sigue siendo `NaN` — silenciosamente, sin lanzar — así
 * que un `?pagina=` no numérico rompía el `.range()` de PostgREST igual que
 * los filtros de arriba. Cualquier valor no finito o menor a 1 cae a 1.
 */
export function sanearNumeroPagina(valor: string | undefined | null): number {
  const n = parseInt(valor ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
