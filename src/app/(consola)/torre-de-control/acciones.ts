"use server";

/**
 * Acciones de la Torre de control.
 * =====================================================================
 *
 * La Torre es de LECTURA salvo por esto: las marcas operativas, la anotación
 * que el coordinador clava en el mapa («calle cortada en Gran Avenida hasta las
 * 14:00») para que el resto del equipo la vea.
 *
 * Por qué existe: es lo más barato que rescata parte del valor que iba a dar el
 * pipeline de señales de prensa —conocimiento local de la calle— sin IA, sin
 * API externa y sin costo por uso. Hasta ahora las marcas se leían y se
 * dibujaban, pero no había forma de crear una: el atajo `M` colocaba una marca
 * provisional en el estado del navegador y ahí moría.
 *
 * AISLAMIENTO. Usa el cliente AUTENTICADO, no `service_role`:
 * `contexto.marcas_operativas` es tabla de negocio (lleva `tenant_id`) y tiene
 * políticas RLS reales para el rol `authenticated`. El `tenant_id` sale del
 * claim del JWT vía la política, no de un parámetro que el cliente pudiera
 * falsear — y aun así se envía explícito para que un fallo de política sea un
 * error y no un insert silencioso en el tenant equivocado.
 *
 * ⚠️ PII. `nota` es TEXTO LIBRE escrito por una persona: puede contener el
 * nombre o la dirección de un destinatario. Por eso no se registra su contenido
 * en la bitácora ni en logs — solo el id de la marca. `seguridad-cumplimiento`
 * todavía debe firmar el tratamiento de este campo.
 */

import { revalidatePath } from "next/cache";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import { puedeVerTorreControl } from "@/modules/identidad/capacidades";
import { combinarFechaHoraSantiago, hoyEnSantiago } from "@/lib/fecha-santiago";
// Ojo: las constantes NO pueden vivir en este archivo — un módulo "use server"
// solo exporta funciones async. Ver la nota de `_lib/marcas.ts`.
import { MAX_CARACTERES_NOTA, RADIO_MARCA_DEFECTO_M } from "./_lib/marcas";

export interface ResultadoAccion {
  ok: boolean;
  error?: string;
}

export interface EntradaMarca {
  nota: string;
  lat: number;
  long: number;
  radioMetros?: number;
  /** Hora local de Santiago 'HH:MM' hasta la que rige. Vacío = sin término. */
  vigenteHasta?: string;
}

/**
 * Crea una marca operativa del courier.
 *
 * La vigencia arranca AHORA y termina en la hora local que indique el
 * coordinador, del mismo día de Santiago. Sin hora, la marca queda vigente sin
 * término conocido (`vigencia_fin = null`), que es lo que el contrato ya
 * modela como `Ventana.fin: null` y la UI lee como «desde las 08:05».
 */
export async function crearMarcaOperativa(entrada: EntradaMarca): Promise<ResultadoAccion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, error: "Tu sesión expiró. Vuelve a entrar." };
  }
  if (!puedeVerTorreControl(sesion.usuario)) {
    return { ok: false, error: "Tu rol no tiene acceso a la Torre de control." };
  }

  const nota = entrada.nota.trim();
  if (nota.length === 0) {
    return { ok: false, error: "Escribe qué está pasando en ese punto." };
  }
  if (nota.length > MAX_CARACTERES_NOTA) {
    return { ok: false, error: `La nota no puede pasar de ${MAX_CARACTERES_NOTA} caracteres.` };
  }
  if (!Number.isFinite(entrada.lat) || !Number.isFinite(entrada.long)) {
    return { ok: false, error: "El punto que marcaste no tiene coordenadas válidas." };
  }

  const radioMetros = entrada.radioMetros ?? RADIO_MARCA_DEFECTO_M;
  if (!Number.isFinite(radioMetros) || radioMetros <= 0) {
    return { ok: false, error: "El radio de la marca tiene que ser mayor que cero." };
  }

  // La hora la escribe una persona mirando un reloj chileno, así que se
  // interpreta en Santiago. Un literal UTC correría la vigencia 3–4 horas.
  let vigenciaFin: string | null = null;
  if (entrada.vigenteHasta) {
    if (!/^\d{2}:\d{2}$/.test(entrada.vigenteHasta)) {
      return { ok: false, error: "La hora tiene que ir como HH:MM." };
    }
    vigenciaFin = combinarFechaHoraSantiago(hoyEnSantiago(), entrada.vigenteHasta).toISOString();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("contexto")
    .from("marcas_operativas")
    .insert({
      tenant_id: sesion.usuario.tenantId,
      lat: entrada.lat,
      long: entrada.long,
      radio_m: Math.round(radioMetros),
      nota,
      vigencia_inicio: new Date().toISOString(),
      vigencia_fin: vigenciaFin,
      autor_usuario_id: sesion.usuarioId,
    })
    .select("id")
    .single();

  if (error) {
    // El mensaje del motor puede citar la fila, y la fila trae la nota: no se
    // propaga al usuario ni al log.
    return { ok: false, error: "No se pudo guardar la marca. Inténtalo de nuevo." };
  }

  void data;
  revalidatePath("/torre-de-control");
  return { ok: true };
}

/**
 * Borra una marca del propio courier.
 *
 * No es una acción financiera ni irreversible en el sentido del invariante de
 * bitácora: es retirar una anotación de un mapa. La RLS impide tocar la de otro
 * tenant, así que no hace falta un filtro extra de tenant aquí — pero se envía
 * igual, por la misma razón que en el insert.
 */
export async function borrarMarcaOperativa(marcaId: string): Promise<ResultadoAccion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, error: "Tu sesión expiró. Vuelve a entrar." };
  }
  if (!puedeVerTorreControl(sesion.usuario)) {
    return { ok: false, error: "Tu rol no tiene acceso a la Torre de control." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .schema("contexto")
    .from("marcas_operativas")
    .delete()
    .eq("id", marcaId)
    .eq("tenant_id", sesion.usuario.tenantId);

  if (error) {
    return { ok: false, error: "No se pudo borrar la marca." };
  }

  revalidatePath("/torre-de-control");
  return { ok: true };
}
