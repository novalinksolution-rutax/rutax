/**
 * Registro de salud del puerto externo de la Torre de control.
 * =====================================================================
 *
 * Alimenta `contexto.fuentes_estado`: el nombre de la fuente, su edad y su
 * motivo de degradación si lo hay.
 *
 * ⚠️ **Esto NO es la frescura que muestra la Torre v2 (F6).** Son dos cosas
 * distintas y confundirlas es fácil:
 *
 *   · **Esta tabla** mide la salud de un puerto EXTERNO —hoy solo el calendario
 *     de feriados— y es global: los feriados de Chile son los mismos para todos
 *     los couriers.
 *   · **F6** mide cuán reciente es el dato OPERATIVO que la pantalla está
 *     mostrando, y sale del último cierre que un conductor subió por la app de
 *     Rutax. Es dato por tenant y se calcula en vivo en el composer, sin pasar
 *     por acá.
 *
 * Dos reglas que se rompen fácil:
 *
 * 1. **`motivo` es copy para un coordinador, no un stack trace.** Los puertos ya
 *    devuelven `motivo` redactado y `detalleTecnico` saneado por separado; acá
 *    solo entra el primero.
 * 2. **No se deriva de `infra.ejecuciones_job`.** Esa tabla es deny-all de
 *    super-admin y su público es el tablero de salud de la plataforma; este dato
 *    lo consume un courier. Cruzar ambos ámbitos por conveniencia erosiona un
 *    límite que existe por algo.
 *
 * `contexto.fuentes_estado` es una de las tablas GLOBALES del carve-out: no lleva
 * `tenant_id` y se escribe solo con `service_role`.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';

/**
 * Fuentes externas con salud registrada.
 *
 * Eran cinco (`clima`, `aire`, `transito`, `eventos`, `senales`). Las cinco se
 * retiraron o nunca se construyeron; queda el calendario. Ver la migración
 * `20260803000001_contexto_torre_v2_retiro_sin_drop.sql`.
 */
export type IdFuenteContexto = 'calendario';

export type EstadoFuenteContexto = 'ok' | 'atrasada' | 'caida';

interface RegistroSalud {
  id: IdFuenteContexto;
  nombre: string;
  cadenciaMinutos: number;
  estado: EstadoFuenteContexto;
  /** Copy para el usuario final. `null` cuando el estado es 'ok'. */
  motivo: string | null;
  /**
   * Instante de la última obtención EXITOSA. Se deja intacto cuando el ciclo
   * falla: si el proveedor lleva tres intentos fallando, lo que el coordinador
   * necesita ver es que el dato tiene 38 minutos, no que "se actualizó recién".
   * Pisar esta columna en el fallo es exactamente cómo un tablero empieza a
   * mentir sobre su propia frescura.
   */
  actualizadoEn: Date | null;
}

/**
 * Deja registrada la salud de una fuente. Upsert por `id`: la tabla tiene una
 * fila por fuente, no un historial.
 *
 * No lanza. Un fallo al registrar la salud no puede tumbar el job que sí
 * consiguió los datos — sería el colmo de la ironía perder un refresco bueno
 * por no poder anotar que salió bien.
 */
export async function registrarSaludFuente(registro: RegistroSalud): Promise<void> {
  try {
    const supabase = crearClienteServiceRole();

    const fila: Record<string, unknown> = {
      id: registro.id,
      nombre: registro.nombre,
      cadencia_minutos: registro.cadenciaMinutos,
      estado: registro.estado,
      motivo: registro.motivo,
      registrado_en: new Date().toISOString(),
    };

    // Solo se toca `actualizado_en` cuando hubo éxito (ver nota del tipo).
    if (registro.actualizadoEn !== null) {
      fila.actualizado_en = registro.actualizadoEn.toISOString();
    }

    await supabase.schema('contexto').from('fuentes_estado').upsert(fila, { onConflict: 'id' });
  } catch {
    // Silencio deliberado: ver el contrato de la función.
  }
}
