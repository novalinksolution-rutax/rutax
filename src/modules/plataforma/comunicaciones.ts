/**
 * Comunicaciones de Rutax a los couriers (F3 · Gap 7 del backstage).
 * =============================================================================
 * Canal "uno a muchos" de Rutax (super-admin) hacia sus clientes (couriers):
 * mantención, novedades, alertas — banner in-app en el área `(tenant)` del
 * courier y, opcionalmente, email. DISTINTO de los avisos operativos que el
 * courier se genera solo (conexiones caídas, folios bajos, etc. — ver
 * `src/lib/avisos/obtener-avisos.ts`).
 *
 * Esquema: `plataforma.comunicaciones` (migración 20260713000001) — deny-all
 * para `authenticated`/`anon`, solo `service_role` (mismo patrón que el resto
 * de `plataforma`, ver CLAUDE.md "base-datos-rls"). Sin DELETE en los grants:
 * la baja es lógica (`activa=false`).
 *
 * ALCANCE — GLOBAL por ahora (a TODOS los couriers, sin segmentación por
 * tenant — ver comentario de la migración).
 *
 * MODELO HÍBRIDO A (courier lee vía service_role en el agregador server-side):
 * el courier JAMÁS lee esta tabla directo. `obtenerComunicacionesActivasParaCourier`
 * es la ÚNICA proyección courier-safe — la consume `src/lib/avisos/obtener-avisos.ts`
 * como una fuente más del agregador de avisos in-app.
 *
 * AUTORIZACIÓN — este módulo NO valida la sesión de super-admin por su cuenta
 * (a diferencia de las ~7 funciones legadas de `acciones.ts`, que todavía
 * validan `SUPER_ADMIN_SECRET` — "Paso 2" pendiente, ver `sesion-admin.ts`).
 * Las funciones de ESCRITURA (`crearComunicacion`/`activarDesactivarComunicacion`)
 * asumen que el CALLER (una Server Action bajo `src/app/admin/**`) YA pasó por
 * el gate vigente `exigirSuperAdminEscritura()`/`exigirActorAdmin()`
 * (`modules/plataforma/autorizacion-admin.ts` / `app/admin/sesion-admin.ts`) —
 * exigen `admin_total` + AAL2 — y le pasan el `actorUsuarioId` YA VERIFICADO de
 * esa sesión. Nunca exponer estas funciones a una ruta sin ese gate delante.
 *
 * Bitácora ANTES que efectos externos (RNF-04): cada función registra en
 * `bitacora_auditoria` ANTES del INSERT/UPDATE y, en `crearComunicacion`,
 * ANTES de publicar el evento Inngest del broadcast por email.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { inngest } from '@/lib/inngest/cliente';
import type { Aviso, UrgenciaAviso } from '@/lib/avisos/obtener-avisos';

// =============================================================================
// Tipos
// =============================================================================

/** Categoría editorial de Rutax — ortogonal al nivel/color del banner. */
export type TipoComunicacion = 'info' | 'mantencion' | 'novedad' | 'alerta';

/**
 * Comunicación tal como la ve el super-admin (`obtenerComunicaciones`) —
 * incluye campos que el courier NUNCA ve (p. ej. `creadoPor`).
 */
export interface Comunicacion {
  id: string;
  titulo: string;
  cuerpo: string;
  tipo: TipoComunicacion;
  nivel: UrgenciaAviso;
  activa: boolean;
  vigenteDesde: string;
  vigenteHasta: string | null;
  enviarEmail: boolean;
  creadoPor: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

const TIPOS_VALIDOS: readonly TipoComunicacion[] = ['info', 'mantencion', 'novedad', 'alerta'];
const NIVELES_VALIDOS: readonly UrgenciaAviso[] = ['informativo', 'importante', 'urgente'];

function mapearFilaComunicacion(fila: Record<string, unknown>): Comunicacion {
  return {
    id: fila.id as string,
    titulo: fila.titulo as string,
    cuerpo: fila.cuerpo as string,
    tipo: fila.tipo as TipoComunicacion,
    nivel: fila.nivel as UrgenciaAviso,
    activa: Boolean(fila.activa),
    vigenteDesde: fila.vigente_desde as string,
    vigenteHasta: (fila.vigente_hasta as string | null) ?? null,
    enviarEmail: Boolean(fila.enviar_email),
    creadoPor: (fila.creado_por as string | null) ?? null,
    creadoEn: fila.creado_en as string,
    actualizadoEn: fila.actualizado_en as string,
  };
}

const COLUMNAS_COMUNICACION =
  'id, titulo, cuerpo, tipo, nivel, activa, vigente_desde, vigente_hasta, enviar_email, creado_por, creado_en, actualizado_en';

// =============================================================================
// crearComunicacion
// =============================================================================

/**
 * Publica una comunicación nueva. `activa=true` por defecto (columna en BD) —
 * queda visible de inmediato para los couriers salvo que se desactive después.
 *
 * Si `enviarEmail=true`, publica `plataforma/comunicacion.publicada` DESPUÉS
 * del INSERT (id determinístico por `comunicacionId` — un reintento del
 * caller no duplica el broadcast) para que el job `notificarComunicacion`
 * (Ola de email) haga el fan-out a los couriers.
 *
 * Bitácora ANTES del INSERT (RNF-04) — `tenantId: null` porque es una acción
 * de PLATAFORMA (no de un tenant específico), mismo criterio que `crearPlan`.
 */
export async function crearComunicacion(opts: {
  titulo: string;
  cuerpo: string;
  tipo: TipoComunicacion;
  nivel: UrgenciaAviso;
  /** `null`/`undefined` = sin expiración. */
  vigenteHasta?: string | null;
  enviarEmail: boolean;
  /** UUID de auth REAL del super-admin actor — ya verificado por el gate del caller. */
  actorUsuarioId: string;
}): Promise<{ ok: true; comunicacionId: string }> {
  const titulo = opts.titulo.trim();
  const cuerpo = opts.cuerpo.trim();
  if (!titulo) throw new Error('El título de la comunicación no puede estar vacío.');
  if (!cuerpo) throw new Error('El cuerpo de la comunicación no puede estar vacío.');
  if (!TIPOS_VALIDOS.includes(opts.tipo)) {
    throw new Error(`Tipo de comunicación inválido: ${opts.tipo}`);
  }
  if (!NIVELES_VALIDOS.includes(opts.nivel)) {
    throw new Error(`Nivel de comunicación inválido: ${opts.nivel}`);
  }
  if (!opts.actorUsuarioId) {
    throw new Error('actorUsuarioId es obligatorio (RNF-04) — el caller debe resolverlo del gate de super-admin.');
  }
  if (opts.vigenteHasta && Number.isNaN(Date.parse(opts.vigenteHasta))) {
    throw new Error('vigenteHasta debe ser una fecha ISO válida.');
  }

  const supabase = crearClienteServiceRole();

  // Bitácora ANTES del INSERT (RNF-04). El id definitivo aún no existe — mismo
  // criterio que `crearPlan` (`entidadId: null` en el registro de alta).
  await registrarEnBitacora(supabase, {
    tenantId: null,
    actorUsuarioId: opts.actorUsuarioId,
    actorTipo: 'super_admin',
    accion: 'plataforma.comunicacion_creada',
    entidadTipo: 'comunicacion',
    entidadId: null,
    detalle: {
      titulo,
      tipo: opts.tipo,
      nivel: opts.nivel,
      vigente_hasta: opts.vigenteHasta ?? null,
      enviar_email: opts.enviarEmail,
    },
  });

  const { data, error } = await supabase
    .schema('plataforma')
    .from('comunicaciones')
    .insert({
      titulo,
      cuerpo,
      tipo: opts.tipo,
      nivel: opts.nivel,
      vigente_hasta: opts.vigenteHasta ?? null,
      enviar_email: opts.enviarEmail,
      creado_por: opts.actorUsuarioId,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Error al crear la comunicación: ${error.message}`);
  if (!data) throw new Error('El INSERT de la comunicación no devolvió datos.');

  const comunicacionId = data.id as string;

  if (opts.enviarEmail) {
    await inngest.send({
      name: 'plataforma/comunicacion.publicada',
      id: `comunicacion-publicada-${comunicacionId}`,
      data: {
        comunicacionId,
        titulo,
        cuerpo,
        tipo: opts.tipo,
        nivel: opts.nivel,
      },
    });
  }

  return { ok: true, comunicacionId };
}

// =============================================================================
// activarDesactivarComunicacion
// =============================================================================

/**
 * Activa o desactiva (baja lógica) una comunicación — NUNCA la borra (sin
 * grant de DELETE en la tabla, mismo criterio que `activarDesactivarPlan`).
 */
export async function activarDesactivarComunicacion(opts: {
  id: string;
  activa: boolean;
  /** UUID de auth REAL del super-admin actor — ya verificado por el gate del caller. */
  actorUsuarioId: string;
}): Promise<{ ok: true }> {
  if (!opts.actorUsuarioId) {
    throw new Error('actorUsuarioId es obligatorio (RNF-04) — el caller debe resolverlo del gate de super-admin.');
  }

  const supabase = crearClienteServiceRole();

  const { data: comunicacion, error: errLectura } = await supabase
    .schema('plataforma')
    .from('comunicaciones')
    .select('id, activa')
    .eq('id', opts.id)
    .maybeSingle();
  if (errLectura) throw new Error(`Error al leer la comunicación: ${errLectura.message}`);
  if (!comunicacion) throw new Error(`Comunicación ${opts.id} no encontrada.`);

  // Bitácora ANTES del UPDATE (RNF-04).
  await registrarEnBitacora(supabase, {
    tenantId: null,
    actorUsuarioId: opts.actorUsuarioId,
    actorTipo: 'super_admin',
    accion: opts.activa ? 'plataforma.comunicacion_activada' : 'plataforma.comunicacion_desactivada',
    entidadTipo: 'comunicacion',
    entidadId: opts.id,
    detalle: { activa_anterior: Boolean(comunicacion.activa), activa_nueva: opts.activa },
  });

  const { error } = await supabase
    .schema('plataforma')
    .from('comunicaciones')
    .update({ activa: opts.activa })
    .eq('id', opts.id);
  if (error) throw new Error(`Error al actualizar la comunicación: ${error.message}`);

  return { ok: true };
}

// =============================================================================
// obtenerComunicaciones — lector ADMIN (todas, para la pantalla /admin)
// =============================================================================

/** Lista TODAS las comunicaciones (activas e inactivas), más recientes primero. Solo para `/admin/*`. */
export async function obtenerComunicaciones(): Promise<Comunicacion[]> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema('plataforma')
    .from('comunicaciones')
    .select(COLUMNAS_COMUNICACION)
    .order('creado_en', { ascending: false });

  if (error) throw new Error(`Error al listar comunicaciones: ${error.message}`);
  return (data ?? []).map(mapearFilaComunicacion);
}

// =============================================================================
// obtenerComunicacionesActivasParaCourier — lector COURIER-SAFE (modelo híbrido A)
// =============================================================================

/**
 * Comunicaciones VIGENTES (`activa=true` y dentro de la ventana de vigencia),
 * proyectadas directo a `Aviso` para que `src/lib/avisos/obtener-avisos.ts` las
 * pueda sumar como una fuente más del banner in-app, SIN que el courier lea
 * `plataforma.comunicaciones` directo (deny-all — modelo híbrido A).
 *
 * `nivel` → `urgencia` sin traducción: el dominio de la columna está alineado
 * a propósito con `UrgenciaAviso` (ver migración 20260713000001).
 *
 * Defensivo (mismo criterio que el resto de fuentes de `obtener-avisos.ts`):
 * cualquier error de lectura se traga y devuelve `[]` — una comunicación
 * caída nunca debe tumbar el layout del courier.
 */
export async function obtenerComunicacionesActivasParaCourier(): Promise<Aviso[]> {
  try {
    const supabase = crearClienteServiceRole();
    const ahoraIso = new Date().toISOString();

    const { data, error } = await supabase
      .schema('plataforma')
      .from('comunicaciones')
      .select('id, titulo, cuerpo, nivel, vigente_desde, vigente_hasta')
      .eq('activa', true)
      .lte('vigente_desde', ahoraIso)
      .or(`vigente_hasta.is.null,vigente_hasta.gte.${ahoraIso}`)
      .order('vigente_desde', { ascending: false });

    if (error) throw error;

    return (data ?? []).map((fila) => ({
      id: `comunicacion-${fila.id as string}`,
      urgencia: fila.nivel as UrgenciaAviso,
      titulo: fila.titulo as string,
      descripcion: fila.cuerpo as string,
      // Sin destino accionable propio (es un anuncio, no una tarea pendiente) —
      // el `Link` del centro de avisos no navega a ningún lado real.
      href: '#',
      accion: 'Entendido',
    }));
  } catch {
    return [];
  }
}
