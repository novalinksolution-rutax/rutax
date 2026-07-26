/**
 * GET /api/v1/pedidos
 *
 * Endpoint público para listar pedidos del tenant autenticado por API key.
 * Permiso requerido: 'pedidos:leer'.
 *
 * Query params:
 *   - estado       : filtrar por estado del pedido (opcional)
 *   - fecha_desde  : ISO date YYYY-MM-DD (opcional)
 *   - fecha_hasta  : ISO date YYYY-MM-DD (opcional)
 *   - page         : número de página, default 1
 *   - limit        : filas por página, default 50, máximo 100
 *
 * Respuesta: { data: [...], page: number, limit: number }
 * Header: X-Request-Id con UUID único por request.
 */

import crypto from 'node:crypto';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { autenticarApiKey } from '@/lib/api-v1/autenticar-api-key';
import { verificarPermiso } from '@/lib/api-v1/verificar-permiso';
import { limitesDelDiaSantiago } from '@/lib/fecha-santiago';

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
    if (!verificarPermiso(ctx, 'pedidos:leer')) {
      return Response.json({ error: 'Sin permiso' }, { status: 403, headers });
    }

    // Parsear query params.
    const url = new URL(request.url);
    const estado = url.searchParams.get('estado');
    const fechaDesde = url.searchParams.get('fecha_desde');
    const fechaHasta = url.searchParams.get('fecha_hasta');
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const limitRaw = parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
    const limit = Math.min(Math.max(1, limitRaw), 100);

    const supabase = crearClienteServiceRole();

    // Construir query dentro del tenant (aislamiento).
    let query = supabase
      .schema('operacion')
      .from('pedidos')
      .select(
        'id, numero_seguimiento, estado, tipo_pedido, fecha_compromiso, seller_id, conductor_id, creado_en',
      )
      .eq('tenant_id', ctx.tenantId);

    if (estado) {
      query = query.eq('estado', estado);
    }
    if (fechaDesde) {
      query = query.gte('creado_en', fechaDesde);
    }
    if (fechaHasta) {
      // Incluir el día completo EN CALENDARIO DE SANTIAGO. Antes se pegaba
      // `T23:59:59.999Z` a la fecha recibida, o sea se interpretaba como
      // instante UTC: el "día completo" terminaba a las 20:59 de Santiago y la
      // API dejaba fuera los pedidos de la noche. Rango semiabierto contra el
      // inicio del día siguiente.
      query = query.lt('creado_en', limitesDelDiaSantiago(fechaHasta).hasta.toISOString());
    }

    // Paginación offset-based.
    const desde = (page - 1) * limit;
    const hasta = page * limit - 1;

    const { data, error } = await query
      .order('creado_en', { ascending: false })
      .range(desde, hasta);

    if (error) {
      console.error('[/api/v1/pedidos] Error de consulta:', error.message);
      return Response.json({ error: 'Error interno' }, { status: 500, headers });
    }

    return Response.json({ data: data ?? [], page, limit }, { status: 200, headers });
  } catch (err) {
    console.error('[/api/v1/pedidos] Error inesperado:', err instanceof Error ? err.message : 'desconocido');
    return Response.json({ error: 'Error interno' }, { status: 500, headers });
  }
}
