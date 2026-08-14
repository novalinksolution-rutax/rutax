/**
 * Bitácora de auditoría — utilidad de escritura para `identidad`.
 *
 * Contrato (§11 regla 1 del documento de arquitectura): nadie fuera de
 * `identidad` escribe en `bitacora_auditoria` directamente. Esta es la única
 * puerta de entrada que usan `onboarding.ts` e `invitaciones.ts` (y, a futuro,
 * cualquier otra función de servidor de este módulo).
 *
 * Regla dura (CLAUDE.md + constraint `bitacora_auditoria_detalle_sin_secretos`
 * en la migración 0004): `detalle` JAMÁS contiene tokens, contraseñas,
 * certificados ni valores cifrados. Esta utilidad:
 *   - solo acepta un `detalle` ya saneado por el llamador (no intenta adivinar
 *     qué es secreto — esa responsabilidad es del llamador, que conoce la forma
 *     de sus datos), pero
 *   - además aplica un filtro de defensa en profundidad que elimina cualquier
 *     clave de la lista negra antes de insertar, como red de seguridad.
 *
 * Usa `service_role` (bypass deliberado de RLS): la tabla es append-only y no
 * tiene política de INSERT para `authenticated` (ver migración 0004) — un
 * INSERT vía cliente normal fallaría siempre. `service_role` es el único rol
 * capaz de escribir aquí, y por eso esta utilidad vive junto a las funciones
 * que ya necesitan ese cliente (alta de tenant, invitaciones).
 *
 * El llamador DEBE pasar un cliente `service_role` (`crearClienteServiceRole()`).
 * Pasar la sesión del usuario es un error de programación —no una restricción
 * que haya que relajar en la BD— y esta utilidad lo rechaza explícitamente
 * cuando puede detectarlo (`esClienteQueNoEsServiceRole`).
 *
 * Nota de acceso: se inserta a través de `public.bitacora_auditoria` (la vista
 * `security_invoker = true` que espeja `identidad.bitacora_auditoria`), herencia
 * de cuando el esquema `identidad` no estaba expuesto a PostgREST. Hoy SÍ lo
 * está (`api.schemas` en `supabase/config.toml`), así que la vista no es una
 * barrera de nada: quien no tiene privilegio sobre la tabla base tampoco escribe
 * por la vista, y quien lo tiene puede ir por cualquiera de las dos. Lo que
 * protege la bitácora es el privilegio de tabla, no la indirección. El rol
 * `service_role` tiene `BYPASSRLS`, así que `security_invoker` no lo restringe:
 * el INSERT llega íntegro a la tabla base pese a que `authenticated`/`anon` no
 * tienen privilegio de escritura sobre ella.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Claves que NUNCA deben aparecer en `detalle` — espejo de la lista negra del
 * constraint SQL `bitacora_auditoria_detalle_sin_secretos` (migración 0004),
 * más algunas variantes adicionales de defensa en profundidad a nivel de
 * aplicación (la BD valida solo el nivel superior del jsonb; aquí también
 * recorremos anidados).
 */
const CLAVES_PROHIBIDAS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "password",
  "contrasena",
  "contraseña",
  "secret",
  "secreto",
  "certificado",
  "valor_cifrado",
  "credenciales",
  "api_key",
  "apikey",
  // Retiro en bodega (etapa 3): el string del QR de Flex es credencial-símil —
  // quien lo tenga puede reconstruir un QR escaneable, y ML no reimprime la
  // etiqueta una vez retirado el bulto. La base ya lo rechaza con 23514, pero
  // eso tumba el asiento y con él la acción financiera que lo precede; aquí se
  // sanea antes para que nunca llegue.
  "hash_code",
  "qr_payload",
  "qr",
  "security_digit",
  "codigo_crudo",
  // Punto de término del conductor (etapa 7): el asiento registra el HECHO
  // (`conductor.punto_termino.definido` / `.revocado`), NUNCA la coordenada.
  // La bitácora del courier la puede leer su dueño, así que una coordenada aquí
  // sería la misma fuga que el §4 del documento de privacidad cierra por todos
  // los demás canales. `lat`/`long`/`latitud`/`longitud` se agregan en general y
  // no solo con prefijo: se comprobó por grep que ningún asiento legítimo del
  // repo usa esas claves (el único lugar que las menciona es un comentario en
  // `operacion/pedidos.ts` recordando NO incluirlas).
  // Ver docs/seguridad/punto-de-termino-conductor.md §4.3 canal 9 y §8.8.
  "punto_termino",
  "punto_termino_lat",
  "punto_termino_long",
  "lat",
  "long",
  "latitud",
  "longitud",
]);

/** Recorre el objeto y elimina recursivamente cualquier clave de la lista negra. */
function sanearDetalle(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map(sanearDetalle);
  }
  if (valor !== null && typeof valor === "object") {
    const limpio: Record<string, unknown> = {};
    for (const [clave, sub] of Object.entries(valor as Record<string, unknown>)) {
      if (CLAVES_PROHIBIDAS.has(clave.toLowerCase())) continue;
      limpio[clave] = sanearDetalle(sub);
    }
    return limpio;
  }
  return valor;
}

/**
 * ¿El cliente recibido es, con certeza, uno que NO es `service_role`?
 *
 * Existe porque el 2026-08-11 el alta de conductores se rompió en producción
 * pasando aquí el cliente de la SESIÓN del usuario: la BD lo rechazó (bien) con
 * "permission denied for view bitacora_auditoria", pero el error solo aparecía
 * en runtime, en el flujo del usuario final, y era críptico. Esto convierte ese
 * fallo en un error de programación explícito, ANTES de tocar la BD.
 *
 * Detección conservadora — solo afirma cuando puede probarlo:
 *   - `supabaseKey` es la clave con la que se construyó el cliente (existe tanto
 *     en `@supabase/supabase-js` como en `@supabase/ssr`).
 *   - Si esa clave falta (dobles de prueba) o si no hay clave de service_role en
 *     el entorno, devuelve `false`: preferimos no bloquear antes que bloquear un
 *     caso legítimo por una heurística. La barrera REAL sigue siendo la base de
 *     datos (sin privilegio de INSERT para `authenticated`/`anon`), no esto.
 *
 * NUNCA se loguea ni se incluye el valor de ninguna clave en el mensaje.
 */
function esClienteQueNoEsServiceRole(cliente: SupabaseClient): boolean {
  const claveDelCliente = (cliente as unknown as { supabaseKey?: unknown }).supabaseKey;
  const claveServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (typeof claveDelCliente !== "string" || claveDelCliente.length === 0) return false;
  if (typeof claveServiceRole !== "string" || claveServiceRole.length === 0) return false;

  return claveDelCliente !== claveServiceRole;
}

/** Identifica quién ejecuta la acción — espejo de `actor_tipo_auditoria` (migración 0004). */
export type ActorTipo = "usuario" | "sistema" | "super_admin";

export interface RegistrarEnBitacoraInput {
  /** `null` solo para acciones de plataforma (alta de tenant, soporte super-admin). */
  tenantId: string | null;
  /** `null` si la acción la ejecutó un job/sistema sin actor humano. */
  actorUsuarioId: string | null;
  actorTipo: ActorTipo;
  /** Código de acción, p. ej. `tenant.alta`, `invitacion.creada`, `usuario.rol_cambiado`. */
  accion: string;
  entidadTipo: string;
  entidadId: string | null;
  /** jsonb — sin secretos ni tokens (se sanea igualmente como red de seguridad). */
  detalle?: Record<string, unknown>;
}

/**
 * Inserta una fila en `bitacora_auditoria` usando el cliente `service_role`
 * recibido. No crea su propio cliente: lo recibe por parámetro para que el
 * llamador controle el ciclo de vida (y para poder probar esta función con un
 * doble de prueba sin tocar Supabase real).
 *
 * Lanza si el INSERT falla — el llamador decide si una falla de auditoría debe
 * abortar la operación de negocio o solo registrarse aparte (en Fase A,
 * preferimos que SÍ aborte: una acción financiera/de acceso sin bitácora viola
 * RF-004/RNF-04, que son P0).
 */
export async function registrarEnBitacora(
  cliente: SupabaseClient,
  entrada: RegistrarEnBitacoraInput,
): Promise<void> {
  // Guarda de programación (defensa en profundidad, NO el control de acceso):
  // la bitácora solo se escribe con `service_role`. Ampliar el privilegio de
  // INSERT a `authenticated` para que "funcione" con la sesión del usuario
  // permitiría fabricar entradas de auditoría desde el navegador vía PostgREST
  // — por eso la salida correcta es siempre traer el cliente adecuado.
  if (esClienteQueNoEsServiceRole(cliente)) {
    throw new Error(
      `No se pudo registrar en bitácora_auditoria (${entrada.accion}): se recibió un ` +
        `cliente Supabase que no es service_role (probablemente la sesión del usuario). ` +
        `bitacora_auditoria es append-only y ningún rol de cliente tiene INSERT sobre ella; ` +
        `usa crearClienteServiceRole() para auditar.`,
    );
  }

  const detalleSaneado = sanearDetalle(entrada.detalle ?? {});

  const { error } = await cliente.from("bitacora_auditoria").insert({
    tenant_id: entrada.tenantId,
    actor_usuario_id: entrada.actorUsuarioId,
    actor_tipo: entrada.actorTipo,
    accion: entrada.accion,
    entidad_tipo: entrada.entidadTipo,
    entidad_id: entrada.entidadId,
    detalle: detalleSaneado,
  });

  if (error) {
    throw new Error(`No se pudo registrar en bitácora_auditoria (${entrada.accion}): ${error.message}`);
  }
}
