/**
 * Superficie del puerto Shopify para pedir una sincronización manual.
 * =============================================================================
 * Gemelo exacto de `../ml/sincronizacion.ts`, y por la misma razón: el botón
 * «Sincronizar ahora» NO llama a `inngest.send` directo — llama a esto. Así la
 * UI no conoce ni el nombre del evento ni el orquestador; solo el puerto (regla
 * de CLAUDE.md: el núcleo no depende del proveedor concreto, y `integraciones`
 * es el único que habla con el exterior).
 *
 * Que el productor viva aquí y no en la Server Action no es cosmética: la prueba
 * de contrato `lib/inngest/eventos.contrato.test.ts` exige que todo evento con
 * consumidor tenga un productor en el código. Un job disparado por un evento que
 * nadie publica es un manejador muerto.
 *
 * BITÁCORA: publicar este evento no es una acción financiera, pero sí una acción
 * del usuario sobre una integración. La acción de servidor que llame a esta
 * función es la responsable de registrar en `bitacora_auditoria` ANTES de
 * llamarla (bitácora antes que efecto externo).
 *
 * NUNCA viaja un token ni una referencia a secreto en el payload: el job resuelve
 * la conexión por su id y descifra dentro del paso.
 */

import { inngest } from "@/lib/inngest/cliente";

export interface SolicitarSincronizacionShopifyEntrada {
  conexionId: string;
  sellerId: string;
  tenantId: string;
  /** UUID de auth de quien la pidió; `null` si la dispara el sistema. */
  actorUsuarioId: string | null;
}

/**
 * Cubo de idempotencia: minutos transcurridos desde la época.
 *
 * Es un CONTADOR, no una fecha — igual que en ML. Un `YYYY-MM-DDTHH:mm` derivado
 * de UTC sería una fecha civil mal calculada esperando a que alguien la lea;
 * aquí solo hace falta un número que cambie cada 60 s.
 */
function cuboDeMinuto(): number {
  return Math.floor(Date.now() / 60_000);
}

/**
 * Publica `shopify/sincronizacion.solicitada` para una tienda concreta.
 *
 * Idempotencia deliberadamente ACOTADA AL MINUTO: dos clics seguidos no disparan
 * dos barridos contra la misma tienda (que compartirían el balde de puntos y el
 * cursor), pero volver a pulsar un minuto después sí sincroniza de nuevo — que es
 * lo que espera quien aprieta un botón llamado «Sincronizar ahora». Una llave sin
 * tiempo dejaría el botón muerto para siempre tras el primer uso.
 */
export async function solicitarSincronizacionShopify(
  entrada: SolicitarSincronizacionShopifyEntrada,
): Promise<void> {
  await inngest.send({
    name: "shopify/sincronizacion.solicitada",
    id: `shopify-sync-${entrada.conexionId}-${cuboDeMinuto()}`,
    data: {
      conexionId: entrada.conexionId,
      sellerId: entrada.sellerId,
      tenantId: entrada.tenantId,
      actorUsuarioId: entrada.actorUsuarioId,
    },
  });
}
