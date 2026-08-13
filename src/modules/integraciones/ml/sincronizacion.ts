/**
 * Superficie del puerto ML para pedir una sincronización manual.
 * =============================================================================
 * El botón «Sincronizar ahora» del panel de conexiones NO llama a `inngest.send`
 * directo: llama a esto. Así el núcleo/la UI no conocen el nombre del evento ni
 * el orquestador — solo el puerto (regla de CLAUDE.md: el núcleo no depende del
 * proveedor concreto, y `integraciones` es el único que habla con el exterior).
 *
 * BITÁCORA: publicar este evento NO es una acción financiera, pero sí una acción
 * del usuario sobre una integración. La acción de servidor que llama a esta
 * función es la responsable de registrar en `bitacora_auditoria` ANTES de
 * llamarla, según el patrón del proyecto (bitácora antes que efecto externo).
 *
 * NUNCA viaja un token ni una referencia a secreto en el payload: el job resuelve
 * la conexión por su id y descifra dentro del paso.
 */

import { inngest } from "@/lib/inngest/cliente";

export interface SolicitarSincronizacionMlEntrada {
  conexionId: string;
  sellerId: string;
  tenantId: string;
  /** UUID de auth de quien la pidió; `null` si la dispara el sistema. */
  actorUsuarioId: string | null;
}

/**
 * Cubo de idempotencia: minutos transcurridos desde la época.
 *
 * Es un CONTADOR, no una fecha — a propósito. La primera versión usaba
 * `toISOString().slice(0,16)` y el guard del repo la marcó con razón: en este
 * proyecto un `YYYY-MM-DDTHH:mm` derivado de UTC es una fecha civil mal
 * calculada esperando a que alguien la lea. Aquí no hay ninguna fecha que leer,
 * solo un número que cambia cada 60 s, así que se expresa como tal y el
 * problema desaparece en vez de esquivarse.
 */
function cuboDeMinuto(): number {
  return Math.floor(Date.now() / 60_000);
}

/**
 * Publica `ml/sincronizacion.solicitada` para una conexión concreta.
 *
 * Idempotencia deliberadamente ACOTADA AL MINUTO: dos clics seguidos del mismo
 * usuario no disparan dos barridos, pero volver a pulsar un minuto después sí
 * sincroniza de nuevo — que es justo lo que espera quien aprieta un botón
 * llamado «Sincronizar ahora». Una llave sin tiempo dejaría el botón muerto
 * para siempre tras el primer uso.
 */
export async function solicitarSincronizacionMl(
  entrada: SolicitarSincronizacionMlEntrada,
): Promise<void> {
  await inngest.send({
    name: "ml/sincronizacion.solicitada",
    id: `ml-sync-${entrada.conexionId}-${cuboDeMinuto()}`,
    data: {
      conexionId: entrada.conexionId,
      sellerId: entrada.sellerId,
      tenantId: entrada.tenantId,
      actorUsuarioId: entrada.actorUsuarioId,
    },
  });
}
