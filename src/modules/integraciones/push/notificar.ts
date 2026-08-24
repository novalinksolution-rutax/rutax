/**
 * `notificarConductor` — la única superficie que ve el resto del producto.
 * =============================================================================
 *
 * Resuelve los dispositivos del conductor, respeta lo que él apagó, manda, y
 * limpia los tokens muertos. Quien llama solo dice a quién y por qué.
 *
 * ⚠️ **No lanza nunca.** Un traspaso guardado no se deshace porque Expo esté
 * caído, y un manifiesto confirmado no vuelve a borrador porque un token estaba
 * vencido. Ver el porqué completo en `puerto.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { enviarPush, redactarAviso, type MotivoPush, type MensajePush } from "./puerto";

/**
 * Los avisos que el conductor puede apagar.
 *
 * `traspaso_recibido` NO está: sin ese aviso el traspaso se queda esperando la
 * aceptación y alguien carga bultos que no son suyos. Es la única del producto
 * que no se apaga, y por eso la lista de apagables se escribe explícita en vez
 * de un booleano por aviso — así se ve de una que falta.
 */
export const AVISOS_APAGABLES: readonly MotivoPush[] = ["ruta_lista", "retiro_nuevo"];

export function sePuedeApagar(motivo: MotivoPush): boolean {
  return AVISOS_APAGABLES.includes(motivo);
}

interface FilaDispositivo {
  id: string;
  token: string;
}

export interface ResultadoNotificacion {
  dispositivos: number;
  enviados: number;
  fallidos: number;
  /** `true` si el conductor tiene el aviso apagado: no se intentó nada. */
  silenciado: boolean;
}

export async function notificarConductor(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    conductorId: string;
    motivo: MotivoPush;
    datos?: { paradas?: number; deQuien?: string; bultos?: number; bodega?: string };
    /**
     * Los avisos que este conductor apagó. Se pasan de fuera —quien llama ya
     * suele tener la fila— y si no vienen, se asume que no apagó nada.
     */
    apagados?: readonly MotivoPush[];
  },
): Promise<ResultadoNotificacion> {
  const vacio: ResultadoNotificacion = {
    dispositivos: 0,
    enviados: 0,
    fallidos: 0,
    silenciado: false,
  };

  // El apagado se respeta ANTES de tocar la base: no tiene sentido leer los
  // dispositivos de alguien que pidió no recibir esto.
  if (sePuedeApagar(entrada.motivo) && entrada.apagados?.includes(entrada.motivo)) {
    return { ...vacio, silenciado: true };
  }

  let filas: FilaDispositivo[] = [];
  try {
    const { data, error } = await cliente
      .schema("identidad")
      .from("dispositivos_conductor")
      .select("id, token")
      .eq("tenant_id", entrada.tenantId)
      .eq("conductor_id", entrada.conductorId);
    if (error) throw error;
    filas = (data ?? []) as FilaDispositivo[];
  } catch {
    // Sin dispositivos legibles no hay aviso, y no hay nada que reportar hacia
    // arriba: el llamador es una operación que ya ocurrió.
    return vacio;
  }

  if (filas.length === 0) return vacio;

  const texto = redactarAviso(entrada.motivo, entrada.datos ?? {});
  const mensajes: MensajePush[] = filas.map((f) => ({
    token: f.token,
    titulo: texto.titulo,
    cuerpo: texto.cuerpo,
    destino: texto.destino,
    motivo: entrada.motivo,
  }));

  const r = await enviarPush(mensajes);

  // Los tokens que Expo declaró muertos se borran acá y no en el puerto: el
  // puerto no sabe de base de datos, y esa separación es la que permite
  // probarlo sin una.
  if (r.tokensMuertos.length > 0) {
    try {
      await cliente
        .schema("identidad")
        .from("dispositivos_conductor")
        .delete()
        .eq("tenant_id", entrada.tenantId)
        .in("token", r.tokensMuertos);
    } catch {
      // Que no se hayan podido borrar no cambia nada de lo ya enviado.
    }
  }

  return {
    dispositivos: filas.length,
    enviados: r.enviados,
    fallidos: r.fallidos,
    silenciado: false,
  };
}

/** Registra (o refresca) el dispositivo de un conductor. */
export async function registrarDispositivo(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    conductorId: string;
    token: string;
    plataforma: "ios" | "android";
  },
): Promise<void> {
  // `upsert` por token y no por conductor: **el token es la identidad del
  // teléfono**. Si un aparato cambia de dueño, la fila se REASIGNA al conductor
  // nuevo en vez de duplicarse — sin esto, el conductor anterior seguiría
  // recibiendo las paradas del actual.
  const { error } = await cliente
    .schema("identidad")
    .from("dispositivos_conductor")
    .upsert(
      {
        tenant_id: entrada.tenantId,
        conductor_id: entrada.conductorId,
        token: entrada.token,
        plataforma: entrada.plataforma,
        visto_en: new Date().toISOString(),
      },
      { onConflict: "token" },
    );

  if (error) throw new Error(`No se pudo registrar el dispositivo: ${error.message}`);
}

/** Da de baja un dispositivo: el conductor apagó las notificaciones o cerró sesión. */
export async function olvidarDispositivo(
  cliente: SupabaseClient,
  entrada: { tenantId: string; token: string },
): Promise<void> {
  const { error } = await cliente
    .schema("identidad")
    .from("dispositivos_conductor")
    .delete()
    .eq("tenant_id", entrada.tenantId)
    .eq("token", entrada.token);

  if (error) throw new Error(`No se pudo olvidar el dispositivo: ${error.message}`);
}
