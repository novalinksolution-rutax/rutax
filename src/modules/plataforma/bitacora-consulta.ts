/**
 * Visor de bitácora de auditoría a nivel PLATAFORMA (gap 5, quick win — ver
 * `docs/plataforma/informe-gaps-administracion-plataforma.md`).
 * =============================================================================
 * `identidad.bitacora_auditoria` ya se ESCRIBE en todo el sistema (RNF-04) pero
 * hasta ahora no se LEE desde el backstage `/admin`. Esta es la única función
 * de lectura: solo-lectura, sin side effects, `crearClienteServiceRole()`
 * (bypassa el RLS por-tenant de la bitácora — es el operador viendo TODA la
 * plataforma, no un courier viendo la suya).
 *
 * Cross-schema (identidad + plataforma + identidad de nuevo para tenants):
 * PostgREST no hace joins entre schemas en un solo query — se resuelven con
 * queries separadas y se combinan en TypeScript, mismo patrón que
 * `consultas.ts` (`obtenerTodasSuscripciones`).
 *
 * Minimización: `detalle` YA viene saneado de secretos por
 * `identidad/auditoria.ts` (constraint SQL + filtro de aplicación) — esta
 * función NO re-filtra ni agrega PII nueva; solo decora con nombres para que
 * el humano no tenga que leer UUIDs crudos.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import type { ActorTipo } from '@/modules/identidad/auditoria';

/** Límite máximo de filas por página — guard rail contra consultas sin acotar. */
const LIMITE_MAXIMO = 500;
const LIMITE_DEFAULT = 100;

export interface ConsultarBitacoraPlataformaOpts {
  tenantId?: string;
  accion?: string;
  actorUsuarioId?: string;
  /** Filtra `creado_en >=` (ISO date o datetime). */
  desde?: string;
  /** Filtra `creado_en <=` (ISO date o datetime). */
  hasta?: string;
  /** Filas por página. Default 100, tope 500. */
  limite?: number;
  offset?: number;
}

/** Fila curada de la bitácora — nombres resueltos, lista para pintar en una tabla. */
export interface FilaBitacoraPlataforma {
  id: number;
  creadoEn: string;
  accion: string;
  actorTipo: ActorTipo;
  actorUsuarioId: string | null;
  /** Nombre del super-admin si el actor es uno conocido; nombre del usuario
   *  interno (`identidad.usuarios_perfil.nombre_completo`) si es un actor
   *  `usuario` identificable; `null` en cualquier otro caso (actor `sistema`,
   *  o `usuario`/`super_admin` que ya no existe/no se resolvió). */
  actorNombre: string | null;
  tenantId: string | null;
  nombreFantasiaTenant: string | null;
  entidadTipo: string;
  entidadId: string | null;
  /** jsonb ya saneado por el escritor (`registrarEnBitacora`) — no re-filtrar. */
  detalle: Record<string, unknown>;
}

export interface ConsultarBitacoraPlataformaResultado {
  filas: FilaBitacoraPlataforma[];
  /** Total de filas que matchean el filtro (para paginar), no solo la página actual. */
  total: number;
}

/**
 * Lee `identidad.bitacora_auditoria` con filtros para el admin, ordenada por
 * `creado_en desc` (lo más reciente primero), paginada. Admin-only: expone
 * columnas internas (tenant, actor) que nunca deben llegar a superficies del
 * courier.
 */
export async function consultarBitacoraPlataforma(
  opts: ConsultarBitacoraPlataformaOpts = {},
): Promise<ConsultarBitacoraPlataformaResultado> {
  const supabase = crearClienteServiceRole();

  const limite = Math.min(Math.max(opts.limite ?? LIMITE_DEFAULT, 1), LIMITE_MAXIMO);
  const offset = Math.max(opts.offset ?? 0, 0);

  let query = supabase
    .schema('identidad')
    .from('bitacora_auditoria')
    .select(
      'id, tenant_id, actor_usuario_id, actor_tipo, accion, entidad_tipo, entidad_id, detalle, creado_en',
      { count: 'exact' },
    );

  if (opts.tenantId) query = query.eq('tenant_id', opts.tenantId);
  if (opts.accion) query = query.eq('accion', opts.accion);
  if (opts.actorUsuarioId) query = query.eq('actor_usuario_id', opts.actorUsuarioId);
  if (opts.desde) query = query.gte('creado_en', opts.desde);
  if (opts.hasta) query = query.lte('creado_en', opts.hasta);

  const { data, error, count } = await query
    .order('creado_en', { ascending: false })
    .range(offset, offset + limite - 1);
  if (error) throw new Error(`Error al consultar bitácora de plataforma: ${error.message}`);

  const filas = data ?? [];
  if (filas.length === 0) return { filas: [], total: count ?? 0 };

  // Resolver nombres de actores conocidos: primero super_admins, luego
  // usuarios_perfil para los que no aparezcan ahí (actor_tipo 'usuario').
  const actorIds = [
    ...new Set(
      filas
        .map((f) => f.actor_usuario_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const nombrePorActor = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: admins, error: errAdmins } = await supabase
      .schema('plataforma')
      .from('super_admins')
      .select('usuario_id, nombre')
      .in('usuario_id', actorIds);
    if (errAdmins) throw new Error(`Error al resolver nombres de super-admins: ${errAdmins.message}`);
    for (const admin of admins ?? []) {
      nombrePorActor.set(admin.usuario_id as string, admin.nombre as string);
    }

    const idsSinResolver = actorIds.filter((id) => !nombrePorActor.has(id));
    if (idsSinResolver.length > 0) {
      const { data: perfiles, error: errPerfiles } = await supabase
        .schema('identidad')
        .from('usuarios_perfil')
        .select('id, nombre_completo')
        .in('id', idsSinResolver);
      if (errPerfiles) throw new Error(`Error al resolver nombres de usuarios: ${errPerfiles.message}`);
      for (const perfil of perfiles ?? []) {
        nombrePorActor.set(perfil.id as string, perfil.nombre_completo as string);
      }
    }
  }

  // Resolver nombre_fantasia de los tenants involucrados.
  const tenantIds = [
    ...new Set(
      filas.map((f) => f.tenant_id as string | null).filter((id): id is string => Boolean(id)),
    ),
  ];
  const nombrePorTenant = new Map<string, string | null>();
  if (tenantIds.length > 0) {
    const { data: tenants, error: errTenants } = await supabase
      .schema('identidad')
      .from('tenants')
      .select('id, nombre_fantasia')
      .in('id', tenantIds);
    if (errTenants) throw new Error(`Error al resolver tenants: ${errTenants.message}`);
    for (const tenant of tenants ?? []) {
      nombrePorTenant.set(tenant.id as string, (tenant.nombre_fantasia as string | null) ?? null);
    }
  }

  return {
    filas: filas.map((f) => {
      const actorUsuarioId = (f.actor_usuario_id as string | null) ?? null;
      const tenantId = (f.tenant_id as string | null) ?? null;
      return {
        id: f.id as number,
        creadoEn: f.creado_en as string,
        accion: f.accion as string,
        actorTipo: f.actor_tipo as ActorTipo,
        actorUsuarioId,
        actorNombre: actorUsuarioId ? nombrePorActor.get(actorUsuarioId) ?? null : null,
        tenantId,
        nombreFantasiaTenant: tenantId ? nombrePorTenant.get(tenantId) ?? null : null,
        entidadTipo: f.entidad_tipo as string,
        entidadId: (f.entidad_id as string | null) ?? null,
        detalle: (f.detalle as Record<string, unknown>) ?? {},
      };
    }),
    total: count ?? filas.length,
  };
}
