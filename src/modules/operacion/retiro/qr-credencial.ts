/**
 * Credencial del QR de un bulto — cifra y guarda lo irrecuperable de la
 * etiqueta escaneada (`operacion.bultos_retiro_qr`, deny-all, ver la
 * migración 20260813000004 §5).
 *
 * SOLO ESCRIBE. En v1 este módulo NO expone ninguna función de descifrado: el
 * valor en claro nunca debe volver a una respuesta HTTP (alcance del retiro,
 * ver CLAUDE.md). Si algún día se construye la regeneración de QR (transversal
 * fuera de esta etapa, con sus propios 5 controles — RBAC, motivo, bitácora,
 * contador, sin descarga), ese es el único lugar autorizado a llamar
 * `descifrarPaquete` sobre esta tabla.
 *
 * AAD = `tenant_id + ':' + bulto_id` — NUNCA `pedido_id`: es NULL en un bulto
 * sin resolver y cambia al resolverse, y una AAD que muta deja el criptograma
 * ilegible para siempre (handoff de la migración 20260813000004, §5 comentario
 * de `aad_esquema`). Ambas mitades del par son inmutables una vez creado el bulto.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cifrarPaquete, KID_ACTIVO, resolverClave } from "@/modules/integraciones/secretos";
import type { CredencialQr } from "./parser-codigo";

/** Versión de la receta del AAD — ver el comentario de la columna en la migración. */
const AAD_ESQUEMA = "v1";

function construirAad(tenantId: string, bultoId: string): string {
  return `${tenantId}:${bultoId}`;
}

/** Qué se cifra, según el tipo de credencial — nunca el string crudo completo para flex_qr. */
function empaquetarPlano(credencial: CredencialQr): string {
  if (credencial.tipoPayload === "flex_hash") {
    // Solo lo irrecuperable (alcance §1.5): `id` y `sender_id` ya viven en
    // operacion.pedidos (ml_shipment_id / ml_user_id) — no hace falta
    // duplicarlos aquí, y duplicarlos sería una segunda copia que mantener
    // sincronizada.
    return JSON.stringify({ hashCode: credencial.hashCode, securityDigit: credencial.securityDigit });
  }
  return credencial.valor;
}

export interface GuardarCredencialQrEntrada {
  tenantId: string;
  bultoId: string;
  /** `null` = este formato no necesita credencial (p. ej. rutax_interno). No-op. */
  credencial: CredencialQr | null;
}

/**
 * Cifra y persiste la credencial de un bulto YA INSERTADO en `bultos_retiro`
 * (la FK compuesta `bultos_retiro_qr_bulto_pertenece_al_tenant` exige que la
 * fila exista primero). NO-OP si `credencial` es `null`.
 *
 * `cliente` debe ser `service_role`: la tabla es deny-all para cualquier rol
 * de cliente (RLS enable+force sin políticas, `revoke all` — migración
 * 20260813000004 §7.2).
 */
export async function guardarCredencialQr(
  cliente: SupabaseClient,
  entrada: GuardarCredencialQrEntrada,
): Promise<void> {
  if (!entrada.credencial) return;

  const clave = resolverClave(KID_ACTIVO);
  const aad = construirAad(entrada.tenantId, entrada.bultoId);
  const paquete = cifrarPaquete(empaquetarPlano(entrada.credencial), clave, aad);

  const { error } = await cliente
    .schema("operacion")
    .from("bultos_retiro_qr")
    .insert({
      bulto_id: entrada.bultoId,
      tenant_id: entrada.tenantId,
      tipo_payload: entrada.credencial.tipoPayload,
      // Mismo formato de entrada bytea que `integraciones/secretos/cifrado.ts`
      // (`\x<hex>`) — supabase-js/PostgREST serializaría un Buffer crudo como
      // JSON `{"type":"Buffer","data":[...]}`, que es texto, no bytes: el
      // secreto quedaría irrecuperable (bug ya cometido una vez en este repo).
      payload_cifrado: `\\x${paquete.toString("hex")}`,
      kid: KID_ACTIVO,
      aad_esquema: AAD_ESQUEMA,
    });

  if (error) {
    // El mensaje de Postgres aquí solo puede referenciar bulto_id/tenant_id
    // (únicas columnas con restricción en esta tabla) — nunca el contenido
    // cifrado ni, mucho menos, el valor en claro.
    throw new Error(`No se pudo guardar la credencial del QR: ${error.message}`);
  }
}
