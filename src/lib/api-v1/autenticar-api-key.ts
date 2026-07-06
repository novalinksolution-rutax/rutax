/**
 * Autenticación de API Keys para /api/v1/.
 *
 * Extrae la clave del header `Authorization: Bearer <clave>`, calcula su
 * SHA-256 y lo busca en `integraciones.api_keys` (service_role, sin RLS).
 *
 * Invariantes de seguridad:
 * - La clave en claro NUNCA se loguea ni aparece en mensajes de error.
 * - El hash tampoco se loguea (es información de validación interna).
 * - El UPDATE de `ultima_llamada_en` es fire-and-forget (no se awaita)
 *   para no añadir latencia al path crítico de autenticación.
 */

import crypto from 'node:crypto';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';

export interface ContextoApiKey {
  tenantId: string;
  apiKeyId: string;
  permisos: string[];
}

/**
 * Intenta autenticar la request mediante el header `Authorization: Bearer <clave>`.
 * Devuelve el contexto de la API key si es válida y activa; null en cualquier otro caso.
 *
 * Nunca loguea la clave en claro ni su hash.
 */
export async function autenticarApiKey(request: Request): Promise<ContextoApiKey | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  // Extraer la clave después de "Bearer " — trim para tolerancia de espacios extras.
  const clave = authHeader.slice(7).trim();
  if (!clave) return null;

  // Hash SHA-256 de la clave para comparar con lo almacenado.
  // NUNCA loguear `clave` ni `hashClave`.
  const hashClave = crypto.createHash('sha256').update(clave).digest('hex');

  const supabase = crearClienteServiceRole();

  const { data, error } = await supabase
    .schema('integraciones')
    .from('api_keys')
    .select('id, tenant_id, permisos')
    .eq('hash_clave', hashClave)
    .eq('estado', 'activa')
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  // Fire-and-forget: actualizar `ultima_llamada_en` sin bloquear la respuesta.
  void supabase
    .schema('integraciones')
    .from('api_keys')
    .update({ ultima_llamada_en: new Date().toISOString() })
    .eq('id', data.id as string);

  return {
    tenantId: data.tenant_id as string,
    apiKeyId: data.id as string,
    permisos: (data.permisos as string[]) ?? [],
  };
}
