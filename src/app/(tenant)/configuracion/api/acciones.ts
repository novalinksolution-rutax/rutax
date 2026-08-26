'use server';

/**
 * Server Actions del módulo de API pública e integración (F23).
 *
 * Todas las acciones:
 * - Verifican sesión + RBAC (gate: `puedeGestionarTarifas` — dueño/admin).
 * - Registran en bitácora ANTES de efectos externos (invariante RNF-04).
 * - Usan service_role para escribir en `integraciones.*` (bypass RLS).
 * - NUNCA loguean claves, hashes ni tokens.
 *
 * `accionCrearApiKey` devuelve la clave en claro UNA SOLA VEZ — nunca se
 * puede recuperar después porque solo el hash SHA-256 se persiste en BD.
 *
 * PUNTO DE GATE de entitlements (F2 "Ola 1", pendiente de decisión de
 * producto — NO implementado aquí a propósito): `obtenerEntitlementsTenant`
 * (`@/modules/plataforma/superficie-courier`) YA expone `apiPublica`/
 * `webhooks` (con el merge de `caracteristicas_override`), y este archivo
 * (`accionCrearApiKey`/`accionCrearWebhookEndpoint`) sería el chokepoint
 * barato para condicionar el alta a que el plan del tenant incluya la
 * feature. NO se activa en esta iteración porque un tenant SIN suscripción
 * (`estadoSuscripcion: null`, p. ej. el tenant de demo/seed, que no tiene fila
 * en `plataforma.suscripciones`) resuelve `apiPublica: false`/`webhooks:
 * false` por el fail-open BLANDO de `obtenerEntitlementsTenant` — bloquear
 * aquí con ese valor rompería el flujo de demo/QA sin que exista todavía una
 * suscripción real para probarlo. Activarlo requiere decidir el trato para
 * `sin_suscripcion` (¿acceso total mientras no haya plan asignado, o
 * bloqueo?) — decisión de producto, no de esta iteración de backend.
 */

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { obtenerSesionActual } from '@/lib/identidad/usuario-actual-servidor';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { puedeGestionarTarifas } from '@/modules/identidad/capacidades';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { validarUrlWebhook } from '@/modules/integraciones/api-publica/url-webhook';

// =============================================================================
// Helper interno de RBAC
// =============================================================================

/** Gate RBAC compartido — dueño o administración. */
async function verificarSesionYPermiso() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false as const, mensaje: 'No autenticado.' };
  }
  if (!puedeGestionarTarifas(sesion.usuario)) {
    return { ok: false as const, mensaje: 'Sin permiso para gestionar integraciones.' };
  }
  return { ok: true as const, sesion, tenantId: sesion.usuario.tenantId };
}

// =============================================================================
// accionCrearApiKey
// =============================================================================

/**
 * Crea una nueva API key para el tenant.
 * La clave en claro se devuelve UNA SOLA VEZ — no es recuperable después.
 *
 * Proceso:
 * 1. Generar clave aleatoria: `ak_` + 32 bytes hex → 67 chars.
 * 2. Calcular prefijo: primeros 16 chars (sin hash, para identificarla en lista).
 * 3. Calcular hash SHA-256 con `node:crypto` → el único valor que persiste en BD.
 * 4. INSERT en `integraciones.api_keys`.
 * 5. Bitácora (sin hash ni clave — solo el id, nombre y permisos).
 * 6. Devolver `{ ok: true, clave: rawClave }` — única oportunidad.
 */
export async function accionCrearApiKey(
  formData: FormData,
): Promise<{ ok: boolean; clave?: string; mensaje?: string }> {
  const gate = await verificarSesionYPermiso();
  if (!gate.ok) return { ok: false, mensaje: gate.mensaje };

  const { sesion, tenantId } = gate;

  const nombre = (formData.get('nombre') as string | null)?.trim();
  if (!nombre) return { ok: false, mensaje: 'El nombre de la clave es obligatorio.' };

  const permisos = formData.getAll('permisos') as string[];
  if (permisos.length === 0) {
    return { ok: false, mensaje: 'Selecciona al menos un permiso.' };
  }

  try {
    // Generar clave en claro con `node:crypto` — NUNCA loguear.
    const rawClave = 'ak_' + crypto.randomBytes(32).toString('hex');
    // Prefijo: primeros 16 chars para identificarla en la lista (no es secreto por sí solo).
    const prefijo = rawClave.slice(0, 16);
    // Hash SHA-256 — lo único que persiste en BD.
    const hashClave = crypto.createHash('sha256').update(rawClave).digest('hex');

    const supabase = crearClienteServiceRole();

    const { data: inserted, error } = await supabase
      .schema('integraciones')
      .from('api_keys')
      .insert({
        tenant_id: tenantId,
        nombre,
        prefijo,
        hash_clave: hashClave,
        permisos,
        estado: 'activa',
      })
      .select('id')
      .single();

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return { ok: false, mensaje: `Ya existe una clave con el nombre "${nombre}".` };
      }
      throw new Error(error.message);
    }

    const insertedId = (inserted as Record<string, unknown>).id as string;

    // Bitácora ANTES de devolver al cliente (RNF-04 — quién y qué).
    // NUNCA incluir hash_clave ni rawClave en el detalle.
    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: 'usuario',
      accion: 'integraciones.api_key_creada',
      entidadTipo: 'api_key',
      entidadId: insertedId,
      detalle: { nombre, permisos },
    });

    revalidatePath('/configuracion/api');
    // Devolver la clave en claro: única oportunidad de mostrarla.
    return { ok: true, clave: rawClave };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : 'Error al crear la clave.',
    };
  }
}

// =============================================================================
// accionRevocarApiKey
// =============================================================================

/**
 * Revoca una API key del tenant del usuario en sesión.
 * Verifica pertenencia al tenant antes de actualizar (aislamiento).
 */
export async function accionRevocarApiKey(
  keyId: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const gate = await verificarSesionYPermiso();
  if (!gate.ok) return { ok: false, mensaje: gate.mensaje };

  const { sesion, tenantId } = gate;

  try {
    const supabase = crearClienteServiceRole();

    // Verificar que la clave pertenece al tenant (aislamiento).
    const { data: key, error: errLectura } = await supabase
      .schema('integraciones')
      .from('api_keys')
      .select('id, nombre, estado')
      .eq('id', keyId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (errLectura) throw new Error(errLectura.message);
    if (!key) return { ok: false, mensaje: 'No encontramos esa clave.' };

    const keyData = key as Record<string, unknown>;
    if (keyData.estado === 'revocada') {
      return { ok: false, mensaje: 'Esa clave ya estaba revocada.' };
    }

    // Bitácora ANTES del UPDATE (RNF-04).
    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: 'usuario',
      accion: 'integraciones.api_key_revocada',
      entidadTipo: 'api_key',
      entidadId: keyId,
      detalle: { nombre: keyData.nombre },
    });

    const { error: errUpdate } = await supabase
      .schema('integraciones')
      .from('api_keys')
      .update({ estado: 'revocada', revocada_en: new Date().toISOString() })
      .eq('id', keyId)
      .eq('tenant_id', tenantId);

    if (errUpdate) throw new Error(errUpdate.message);

    revalidatePath('/configuracion/api');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : 'Error al revocar la clave.',
    };
  }
}

// =============================================================================
// accionCrearWebhookEndpoint
// =============================================================================

/**
 * Registra un nuevo endpoint HTTPS para recibir webhooks salientes.
 * La URL debe comenzar con `https://` (validación en app + constraint en BD).
 */
export async function accionCrearWebhookEndpoint(
  formData: FormData,
): Promise<{ ok: boolean; mensaje?: string }> {
  const gate = await verificarSesionYPermiso();
  if (!gate.ok) return { ok: false, mensaje: gate.mensaje };

  const { sesion, tenantId } = gate;

  const url = (formData.get('url') as string | null)?.trim() ?? '';
  const eventos = formData.getAll('eventos') as string[];

  // Validación anti-SSRF: HTTPS + host público (bloquea loopback/privadas/
  // link-local/metadata). Misma función que revalida el job al entregar.
  const urlValida = validarUrlWebhook(url);
  if (!urlValida.ok) {
    return { ok: false, mensaje: urlValida.motivo ?? 'La URL del webhook no es válida.' };
  }
  if (eventos.length === 0) {
    return { ok: false, mensaje: 'Selecciona al menos un tipo de evento.' };
  }

  try {
    const supabase = crearClienteServiceRole();

    const { data: inserted, error } = await supabase
      .schema('integraciones')
      .from('webhook_endpoints')
      .insert({
        tenant_id: tenantId,
        url,
        eventos,
        activo: true,
        reintentos_max: 3,
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);

    const insertedId = (inserted as Record<string, unknown>).id as string;

    // Bitácora ANTES de revalidar (RNF-04).
    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: 'usuario',
      accion: 'integraciones.webhook_endpoint_creado',
      entidadTipo: 'webhook_endpoint',
      entidadId: insertedId,
      detalle: { url, eventos },
    });

    revalidatePath('/configuracion/api');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : 'Error al crear el webhook endpoint.',
    };
  }
}

// =============================================================================
// accionToggleWebhookEndpoint
// =============================================================================

/**
 * Activa o desactiva un webhook endpoint del tenant.
 * Verifica pertenencia al tenant antes de actualizar.
 */
export async function accionToggleWebhookEndpoint(
  endpointId: string,
  activo: boolean,
): Promise<{ ok: boolean; mensaje?: string }> {
  const gate = await verificarSesionYPermiso();
  if (!gate.ok) return { ok: false, mensaje: gate.mensaje };

  const { sesion, tenantId } = gate;

  try {
    const supabase = crearClienteServiceRole();

    // Verificar pertenencia al tenant.
    const { data: endpoint, error: errLectura } = await supabase
      .schema('integraciones')
      .from('webhook_endpoints')
      .select('id')
      .eq('id', endpointId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (errLectura) throw new Error(errLectura.message);
    if (!endpoint) return { ok: false, mensaje: 'Webhook endpoint no encontrado.' };

    // Bitácora ANTES del UPDATE (RNF-04).
    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: 'usuario',
      accion: activo
        ? 'integraciones.webhook_endpoint_activado'
        : 'integraciones.webhook_endpoint_desactivado',
      entidadTipo: 'webhook_endpoint',
      entidadId: endpointId,
      detalle: { activo },
    });

    const { error: errUpdate } = await supabase
      .schema('integraciones')
      .from('webhook_endpoints')
      .update({ activo, actualizado_en: new Date().toISOString() })
      .eq('id', endpointId)
      .eq('tenant_id', tenantId);

    if (errUpdate) throw new Error(errUpdate.message);

    revalidatePath('/configuracion/api');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : 'Error al actualizar el webhook endpoint.',
    };
  }
}

// =============================================================================
// accionEliminarWebhookEndpoint
// =============================================================================

/**
 * Elimina un webhook endpoint del tenant.
 * Las filas de `webhook_outbox` asociadas se eliminan en cascada (FK ON DELETE CASCADE).
 * Verifica pertenencia al tenant antes de eliminar.
 */
export async function accionEliminarWebhookEndpoint(
  endpointId: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const gate = await verificarSesionYPermiso();
  if (!gate.ok) return { ok: false, mensaje: gate.mensaje };

  const { sesion, tenantId } = gate;

  try {
    const supabase = crearClienteServiceRole();

    // Verificar pertenencia al tenant.
    const { data: endpoint, error: errLectura } = await supabase
      .schema('integraciones')
      .from('webhook_endpoints')
      .select('id, url')
      .eq('id', endpointId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (errLectura) throw new Error(errLectura.message);
    if (!endpoint) return { ok: false, mensaje: 'Webhook endpoint no encontrado.' };

    // Bitácora ANTES del DELETE (RNF-04).
    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: 'usuario',
      accion: 'integraciones.webhook_endpoint_eliminado',
      entidadTipo: 'webhook_endpoint',
      entidadId: endpointId,
      detalle: { url: (endpoint as Record<string, unknown>).url },
    });

    const { error: errDelete } = await supabase
      .schema('integraciones')
      .from('webhook_endpoints')
      .delete()
      .eq('id', endpointId)
      .eq('tenant_id', tenantId);

    if (errDelete) throw new Error(errDelete.message);

    revalidatePath('/configuracion/api');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : 'Error al eliminar el webhook endpoint.',
    };
  }
}
