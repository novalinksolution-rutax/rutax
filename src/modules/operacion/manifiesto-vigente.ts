/**
 * "El manifiesto de hoy de este conductor" — punto ÚNICO de resolución.
 * =====================================================================
 *
 * POR QUÉ ESTO ES UN MÓDULO Y NO UNA CONSULTA REPETIDA EN CADA PANTALLA.
 *
 * Las dos superficies del conductor —la ruta que alimenta la app nativa
 * (`api/conductor/manifiesto`) y la PWA (`conductor/manifiesto`)— tenían la
 * MISMA consulta copiada, hasta el `.limit(1)`. Copiada quiere decir que
 * también tenían el mismo defecto, y que arreglarlo en una dejaba la otra rota.
 *
 * EL DEFECTO QUE DEFIENDE. Ambas tomaban el manifiesto más reciente del día y
 * descartaban el resto en silencio. Si alguna vez existen DOS manifiestos vivos
 * del mismo conductor para el mismo día, **las paradas del otro desaparecen de
 * su pantalla, en plena calle y sin ningún aviso**: el conductor no entrega esos
 * paquetes y nadie se entera hasta el cierre del día.
 *
 * POR QUÉ NO SE FUSIONAN LOS DOS MANIFIESTOS, que sería lo "robusto". La app
 * nativa usa `manifiesto.id` para iniciar y terminar la ruta, y `manifiesto.
 * estado` gobierna toda su interfaz (borrador → confirmado → en_ruta →
 * completado). Fusionar dos manifiestos con estados distintos obliga a inventar
 * un estado que no existe y a decidir sobre cuál de los dos ids opera "iniciar
 * ruta". Se elige mostrar uno —el mismo que ya se mostraba— y **delatar la
 * anomalía**, que convierte una pérdida silenciosa de paradas en una alarma.
 *
 * POR QUÉ EL ESQUEMA NO LO IMPIDE. `idx_manifiestos_driver_fecha` existe y NO es
 * único, a propósito: hace falta poder abrir un segundo manifiesto para la
 * segunda vuelta después de un `completado`. El invariante "un manifiesto VIVO
 * por conductor y día" lo sostienen sus dos escritores
 * (`operacion.asignar_pedidos_en_bloque` y `marcarConductorNoDisponibleY-
 * Redistribuir`), no la base. Esta función es la red por si esa disciplina se
 * rompe.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { capturarMensaje } from "@/lib/observabilidad";

/** Estados en los que un manifiesto todavía se le muestra al conductor. */
export const ESTADOS_MANIFIESTO_VISIBLE = [
  "borrador",
  "confirmado",
  "en_ruta",
  "completado",
] as const;

/**
 * Estados en los que un manifiesto está VIVO — todavía puede recibir paradas y
 * el conductor todavía tiene trabajo en él.
 *
 * `completado` queda FUERA a propósito, y no es un descuido: un manifiesto
 * completado más uno nuevo es exactamente la segunda vuelta del día, que el
 * motor de asignación en bloque crea a propósito. Contarla como anomalía sería
 * una alarma falsa recurrente, y una alarma falsa recurrente entrena a ignorar
 * la alarma de verdad.
 */
const ESTADOS_MANIFIESTO_VIVO: readonly string[] = ["borrador", "confirmado", "en_ruta"];

export interface ManifiestoVigente {
  id: string;
  nombre: string;
  fechaOperacion: string;
  estado: string;
}

interface FilaManifiesto {
  id: string;
  nombre: string;
  fecha_operacion: string;
  estado: string;
  creado_en: string;
}

/**
 * Devuelve el manifiesto que hay que mostrarle hoy al conductor, o `null`.
 *
 * Criterio de desempate: el más reciente por `creado_en`, con `id` como
 * desempate determinista. **Es el mismo criterio que usa
 * `operacion.asignar_pedidos_en_bloque` para decidir a cuál agregar** — si las
 * dos mitades usaran criterios distintos, el coordinador estaría llenando un
 * manifiesto y el conductor mirando otro.
 */
export async function obtenerManifiestoVigenteDelConductor(
  cliente: SupabaseClient,
  entrada: { tenantId: string; driverId: string; fecha: string },
): Promise<ManifiestoVigente | null> {
  const { data, error } = await cliente
    .from("manifiestos")
    .select("id, nombre, fecha_operacion, estado, creado_en")
    .eq("driver_id", entrada.driverId)
    .eq("tenant_id", entrada.tenantId)
    .eq("fecha_operacion", entrada.fecha)
    .in("estado", [...ESTADOS_MANIFIESTO_VISIBLE])
    .order("creado_en", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    throw new Error(`Error al leer el manifiesto del conductor: ${error.message}`);
  }

  const filas = (data ?? []) as FilaManifiesto[];
  if (filas.length === 0) return null;

  const vivos = filas.filter((m) => ESTADOS_MANIFIESTO_VIVO.includes(m.estado));
  if (vivos.length > 1) {
    // La anomalía. Se reporta y se sigue mostrando el más reciente: dejar al
    // conductor sin ruta por un problema de datos sería peor que mostrarle una
    // ruta incompleta. Lo que no puede pasar es que ocurra en silencio.
    //
    // Ningún dato personal en el evento: solo identificadores internos.
    await capturarMensaje(
      "Un conductor tiene más de un manifiesto vivo para el mismo día: las paradas de los demás no se le están mostrando",
      "error",
      {
        origen: "operacion:manifiesto-vigente",
        tenantId: entrada.tenantId,
        etiquetas: { driverId: entrada.driverId, fecha: entrada.fecha },
        extra: {
          manifiestosVivos: vivos.map((m) => ({ id: m.id, estado: m.estado })),
          mostrado: filas[0].id,
        },
      },
    );
  }

  const m = filas[0];
  return {
    id: m.id,
    nombre: m.nombre,
    fechaOperacion: m.fecha_operacion,
    estado: m.estado,
  };
}
