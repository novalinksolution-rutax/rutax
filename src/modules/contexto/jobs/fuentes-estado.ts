/**
 * Registro de salud de las fuentes externas de la Torre de control.
 * =====================================================================
 *
 * Alimenta `contexto.fuentes_estado`, que es lo que la barra superior muestra
 * como FRESCURA: el nombre de cada fuente y su edad en minutos.
 *
 * Por qué esto importa más de lo que parece: en un producto de dinero, saber
 * cuán viejo es el dato es parte de poder confiar en él. El handoff no muestra
 * un icono de estado — muestra la EDAD EN MINUTOS, siempre visible. Una fuente
 * caída se marca con su motivo; nunca desaparece en silencio.
 *
 * Dos reglas que se rompen fácil:
 *
 * 1. **`motivo` es copy para un coordinador, no un stack trace.** Lo lee una
 *    persona en la barra superior. Los puertos ya devuelven `motivo` redactado
 *    y `detalleTecnico` saneado por separado; aquí solo entra el primero.
 * 2. **No se deriva de `infra.ejecuciones_job`.** Esa tabla es deny-all de
 *    super-admin y su público es el tablero de salud de la plataforma; este
 *    dato lo consume un courier. Cruzar ambos ámbitos por conveniencia erosiona
 *    un límite que existe por algo.
 *
 * `contexto.fuentes_estado` es una de las tablas GLOBALES del carve-out: no
 * lleva `tenant_id` porque la salud del proveedor de clima es la misma para
 * todos los couriers. Se escribe solo con `service_role`.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';

/** Los identificadores son los del contrato (`FrescuraFuente.id`). */
export type IdFuenteContexto = 'clima' | 'aire' | 'transito' | 'eventos' | 'senales';

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
