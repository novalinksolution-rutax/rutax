/**
 * Estado de la puesta en marcha del courier (v2) — docs/ux/puesta-en-marcha-v2.md §6 y §8.
 * =============================================================================
 *
 * Dos preguntas distintas, que NO se mezclan:
 *
 *   · **El gate** (`leerGatePuestaEnMarcha`): «¿este courier puede entrar al
 *     producto?». Una sola lectura de `courier_config_operacion.
 *     puesta_en_marcha_completada_en`. Corre en CADA navegación del layout, por
 *     eso es ligera. La verdad es esa marca y nada más: un courier existente
 *     que el backfill dejó completado entra aunque no tenga bodega.
 *
 *   · **Los pasos** (`leerEstadoPuestaEnMarcha`): «¿qué falta llenar?». Cada
 *     paso se DERIVA de los datos (§6), no de un contador que se desincronice;
 *     `puesta_en_marcha_paso` es solo la pista para retomar. Lo lee el asistente
 *     y la validación de `Entrar`.
 *
 * ⚠️ FALLA CERRADO. Sin fila en `courier_config_operacion` (un courier nuevo
 * nace sin ella) o con un error de lectura, el courier está BLOQUEADO. Nunca se
 * asume «completado» ante la duda.
 *
 * Este módulo no escribe. Las escrituras viven en las Server Actions de
 * `/puesta-en-marcha`, que dejan la bitácora ANTES de marcar nada.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyEnSantiago } from "@/lib/fecha-santiago";

/**
 * Pick, no `SupabaseClient` a secas: tiparlo entero deja de calzar con
 * `crearClienteServiceRole()` y tumba el build de producción sin que el
 * typecheck lo note (CLAUDE.md, «Un correo, una cuenta»).
 */
export type ClienteLectura = Pick<SupabaseClient, "from" | "schema">;

export type NumeroPaso = 1 | 2 | 3 | 4;
export const PASOS_PUESTA_EN_MARCHA: readonly NumeroPaso[] = [1, 2, 3, 4];

// -----------------------------------------------------------------------------
// Datos crudos → estado (función pura)
// -----------------------------------------------------------------------------

export interface DatosPuestaEnMarcha {
  empresa: {
    nombreFantasia: string | null;
    telefono: string | null;
    email: string | null;
  };
  /** La bodega de courier principal y ACTIVA, o `null` si no hay. */
  bodegaPrincipal: { geoEstado: string | null } | null;
  /** La fila de `courier_config_operacion`, o `null` si no existe. */
  config: {
    horaSalida: string;
    horaCorte: string;
    pasoGuardado: number | null;
    completadaEn: string | null;
  } | null;
  /** Existe la tarifa general activa (ver `existeTarifaGeneralActiva`). */
  tarifaGeneralActiva: boolean;
}

export interface EstadoPuestaEnMarcha {
  /** `false` si la lectura falló: el estado es el de fail-closed, no un dato. */
  leido: boolean;
  /** Completo o no, por paso (índice 0 = paso 1). */
  pasos: readonly [boolean, boolean, boolean, boolean];
  /** La marca `puesta_en_marcha_completada_en`: lo único que abre el producto. */
  completada: boolean;
  /** Los cuatro pasos tienen sus datos. Habilita `Entrar`. */
  todosLosPasosCompletos: boolean;
  /** El primer paso sin datos, o `null` si están los cuatro. */
  primerPasoIncompleto: NumeroPaso | null;
  /** Último paso al que el asistente llegó con `Continuar` (pista para retomar). */
  pasoGuardado: number | null;
}

const BLOQUEADO: EstadoPuestaEnMarcha = {
  leido: false,
  pasos: [false, false, false, false],
  completada: false,
  todosLosPasosCompletos: false,
  primerPasoIncompleto: 1,
  pasoGuardado: null,
};

function lleno(valor: string | null | undefined): boolean {
  return typeof valor === "string" && valor.trim().length > 0;
}

/** «16:00:00» y «16:00» se comparan bien como texto: HH:MM[:SS] de ancho fijo. */
function horasValidas(salida: string, corte: string): boolean {
  return /^\d{2}:\d{2}/.test(salida) && /^\d{2}:\d{2}/.test(corte) && corte > salida;
}

export function evaluarPuestaEnMarcha(datos: DatosPuestaEnMarcha | null): EstadoPuestaEnMarcha {
  if (!datos) return BLOQUEADO;

  const paso1 =
    lleno(datos.empresa.nombreFantasia) && lleno(datos.empresa.telefono) && lleno(datos.empresa.email);
  const paso2 = datos.bodegaPrincipal?.geoEstado === "resuelto";
  const paso3 = datos.config !== null && horasValidas(datos.config.horaSalida, datos.config.horaCorte);
  const paso4 = datos.tarifaGeneralActiva === true;

  const pasos = [paso1, paso2, paso3, paso4] as const;
  const indice = pasos.findIndex((p) => !p);

  return {
    leido: true,
    pasos,
    // Sin fila no hay marca: fail-closed.
    completada: Boolean(datos.config?.completadaEn),
    todosLosPasosCompletos: indice === -1,
    primerPasoIncompleto: indice === -1 ? null : ((indice + 1) as NumeroPaso),
    pasoGuardado: datos.config?.pasoGuardado ?? null,
  };
}

/**
 * Resuelve a qué paso se puede ir dado el que se pidió por `?paso=`.
 *
 * Volver a un paso anterior es libre; saltar ADELANTE de un paso incompleto no.
 * `5` es el cierre y exige los cuatro completos. Un valor ilegible cae al primer
 * paso incompleto (o al cierre si no falta ninguno).
 */
export function resolverPasoPermitido(
  estado: EstadoPuestaEnMarcha,
  pedido: string | undefined,
): NumeroPaso | 5 {
  const destinoNatural: NumeroPaso | 5 = estado.primerPasoIncompleto ?? 5;
  const n = Number(pedido);
  if (!pedido || !Number.isInteger(n) || n < 1 || n > 5) return destinoNatural;
  if (n <= destinoNatural) return n as NumeroPaso | 5;
  return destinoNatural;
}

// -----------------------------------------------------------------------------
// Lectores
// -----------------------------------------------------------------------------

/**
 * Paso 4 (§6): existe la tarifa GENERAL activa del tenant — sin seller, sin
 * fuente, sin régimen legado y sin zona (`identidad.resolver_tarifa` cae a ella
 * cuando nada más específico calza; migración 20260928000002).
 *
 * ⚠️ Vive detrás de su propia función a propósito: la tarea del paso 4 (zonas y
 * tarifas) puede refinar esta definición sin tocar el resto del estado. Ante un
 * error de lectura devuelve `false` (fail-closed).
 */
export async function existeTarifaGeneralActiva(
  cliente: ClienteLectura,
  tenantId: string,
): Promise<boolean> {
  const hoy = hoyEnSantiago();
  const { data, error } = await cliente
    .schema("identidad")
    .from("tarifas")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("estado", "activa")
    .is("seller_id", null)
    .is("fuente", null)
    .is("tipo_entrega", null)
    .is("zona_id", null)
    .lte("vigente_desde", hoy)
    .or(`vigente_hasta.is.null,vigente_hasta.gte.${hoy}`)
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/** Lee los datos y devuelve el estado. Nunca lanza: un error es «bloqueado». */
export async function leerEstadoPuestaEnMarcha(
  cliente: ClienteLectura,
  tenantId: string,
): Promise<EstadoPuestaEnMarcha> {
  try {
    const [tenant, bodega, config, tarifa] = await Promise.all([
      cliente
        .schema("identidad")
        .from("tenants")
        .select("nombre_fantasia, telefono_contacto, email_contacto")
        .eq("id", tenantId)
        .maybeSingle(),
      cliente
        .schema("identidad")
        .from("courier_bodegas")
        .select("geo_estado")
        .eq("tenant_id", tenantId)
        .eq("activa", true)
        .eq("es_principal", true)
        .limit(1)
        .maybeSingle(),
      cliente
        .schema("identidad")
        .from("courier_config_operacion")
        .select(
          "hora_salida_reparto, hora_corte_reparto, puesta_en_marcha_paso, puesta_en_marcha_completada_en",
        )
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      existeTarifaGeneralActiva(cliente, tenantId),
    ]);

    if (tenant.error || bodega.error || config.error || !tenant.data) return BLOQUEADO;

    const c = config.data as {
      hora_salida_reparto: string;
      hora_corte_reparto: string;
      puesta_en_marcha_paso: number | null;
      puesta_en_marcha_completada_en: string | null;
    } | null;
    const t = tenant.data as {
      nombre_fantasia: string | null;
      telefono_contacto: string | null;
      email_contacto: string | null;
    };

    return evaluarPuestaEnMarcha({
      empresa: {
        nombreFantasia: t.nombre_fantasia,
        telefono: t.telefono_contacto,
        email: t.email_contacto,
      },
      bodegaPrincipal: bodega.data
        ? { geoEstado: (bodega.data as { geo_estado: string | null }).geo_estado }
        : null,
      config: c
        ? {
            horaSalida: c.hora_salida_reparto,
            horaCorte: c.hora_corte_reparto,
            pasoGuardado: c.puesta_en_marcha_paso,
            completadaEn: c.puesta_en_marcha_completada_en,
          }
        : null,
      tarifaGeneralActiva: tarifa,
    });
  } catch {
    return BLOQUEADO;
  }
}

/**
 * El gate del layout: UNA lectura.
 *
 *   · `completada` — hay marca: pasa.
 *   · `pendiente`  — no hay fila, o la fila no tiene marca: bloqueado.
 *   · `error`      — no se pudo leer: bloqueado TAMBIÉN, pero distinto de
 *                    `pendiente` para que el layout no redirija en bucle a un
 *                    courier que sí terminó (ver el layout).
 *
 * `porAsistente` es verdadero cuando la marca la puso una persona (el dueño, al
 * pulsar `Entrar`) y falso cuando la puso el backfill de la migración, sin
 * autor. Sirve para no mostrarle el banner del asistente viejo a quien pasó por
 * el nuevo.
 */
export type ResultadoGate = "completada" | "pendiente" | "error";

export interface LecturaGate {
  estado: ResultadoGate;
  porAsistente: boolean;
}

export async function leerGatePuestaEnMarcha(
  cliente: Pick<SupabaseClient, "from">,
  tenantId: string,
): Promise<LecturaGate> {
  try {
    const { data, error } = await cliente
      .from("courier_config_operacion")
      .select("puesta_en_marcha_completada_en, puesta_en_marcha_completada_por")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return { estado: "error", porAsistente: false };
    const fila = data as {
      puesta_en_marcha_completada_en: string | null;
      puesta_en_marcha_completada_por: string | null;
    } | null;
    if (!fila?.puesta_en_marcha_completada_en) return { estado: "pendiente", porAsistente: false };
    return { estado: "completada", porAsistente: (fila.puesta_en_marcha_completada_por ?? null) !== null };
  } catch {
    return { estado: "error", porAsistente: false };
  }
}
