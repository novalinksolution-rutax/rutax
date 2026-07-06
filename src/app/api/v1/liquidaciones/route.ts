/**
 * GET /api/v1/liquidaciones
 *
 * Endpoint público para listar liquidaciones del tenant autenticado por API key.
 * Permiso requerido: 'liquidaciones:leer'.
 *
 * Query params:
 *   - estado    : filtrar por estado de la liquidación (opcional)
 *   - driver_id : filtrar por conductor (opcional)
 *   - page      : número de página, default 1
 *   - limit     : filas por página, default 50, máximo 100
 *
 * Respuesta: { data: [...], page: number, limit: number }
 * Header: X-Request-Id con UUID único por request.
 */

import crypto from 'node:crypto';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { autenticarApiKey } from '@/lib/api-v1/autenticar-api-key';
import { verificarPermiso } from '@/lib/api-v1/verificar-permiso';

export async function GET(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const headers = { 'X-Request-Id': requestId, 'Content-Type': 'application/json' };

  try {
    // Autenticación por API key.
    const ctx = await autenticarApiKey(request);
    if (!ctx) {
      return Response.json({ error: 'No autorizado' }, { status: 401, headers });
    }

    // Verificación de permiso granular.
    if (!verificarPermiso(ctx, 'liquidaciones:leer')) {
      return Response.json({ error: 'Sin permiso' }, { status: 403, headers });
    }

    // Parsear query params.
    const url = new URL(request.url);
    const estado = url.searchParams.get('estado');
    const driverId = url.searchParams.get('driver_id');
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const limitRaw = parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
    const limit = Math.min(Math.max(1, limitRaw), 100);

    const supabase = crearClienteServiceRole();

    // Construir query dentro del tenant (aislamiento).
    let query = supabase
      .schema('dinero')
      .from('liquidaciones')
      .select(
        'id, driver_id, estado, monto_total_clp, bono_clp, penalizacion_clp, tipo_relacion_conductor, periodo_inicio, periodo_fin, generada_en',
      )
      .eq('tenant_id', ctx.tenantId);

    if (estado) {
      query = query.eq('estado', estado);
    }
    if (driverId) {
      query = query.eq('driver_id', driverId);
    }

    // Paginación offset-based.
    const desde = (page - 1) * limit;
    const hasta = page * limit - 1;

    const { data, error } = await query
      .order('generada_en', { ascending: false })
      .range(desde, hasta);

    if (error) {
      console.error('[/api/v1/liquidaciones] Error de consulta:', error.message);
      return Response.json({ error: 'Error interno' }, { status: 500, headers });
    }

    return Response.json({ data: data ?? [], page, limit }, { status: 200, headers });
  } catch (err) {
    console.error('[/api/v1/liquidaciones] Error inesperado:', err instanceof Error ? err.message : 'desconocido');
    return Response.json({ error: 'Error interno' }, { status: 500, headers });
  }
}
