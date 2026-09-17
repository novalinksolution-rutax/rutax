/**
 * Backstage — dar de baja / reactivar cuentas de PERSONAS desde `/admin/cuentas`.
 * =============================================================================
 * Alcance: cuentas de personas (`interno`, `seller`, `conductor`). El tenant/
 * courier como entidad NUNCA se toca desde acá — para eso está `plataforma`
 * (suscripciones) por otra vía.
 *
 * -----------------------------------------------------------------------------
 * LA REGLA DE ORO: "DAR DE BAJA" = DESENGANCHAR TODO, Y BORRAR SOLO SI SE PUEDE
 * -----------------------------------------------------------------------------
 * Si la cuenta NO tiene ninguna relación con pedidos ni dinero, se ELIMINA
 * (borrado duro, irreversible). Si SÍ la tiene, se DESACTIVA (reversible). El
 * predicado (`tieneRelacionConPedidosODinero`, estilo
 * `dinero/pedidos-entregados-por-rutax.ts`) decide de ANTEMANO qué mostrarle al
 * admin — pero NO es la única barrera.
 *
 * -----------------------------------------------------------------------------
 * EL BORRADO DURO ES UNA RPC ATÓMICA, NO UNA SECUENCIA DE `.delete()` SUELTOS
 * -----------------------------------------------------------------------------
 * `identidad.eliminar_cuenta_persona` (migración `20260917000001`, envoltorio
 * `eliminar-cuenta-persona-rpc.ts`) borra, EN UNA transacción SQL, los hijos con
 * FK restrict + el perfil + la ficha. Si algo lanza (una FK que la función no
 * enumeró), Postgres hace ROLLBACK ENTERO — nada queda borrado a medias. Antes
 * de esta migración, el borrado por pasos desde TypeScript dejaba huérfanos:
 * `identidad.seller_bodegas.seller_id → sellers(id)` es `on delete restrict` y
 * **todo seller de autoservicio tiene al menos una bodega** (el wizard la
 * exige), así que el intento chocaba SIEMPRE — pero recién después de haber
 * borrado ya el perfil. Ver la migración para el detalle completo (incluida la
 * FK COMPUESTA de `conexiones_seller_ml`/`conexiones_seller_shopify`, que es NO
 * ACTION aunque su FK simple diga `on delete cascade`).
 *
 * Esta función SOLO llama `auth.admin.deleteUser` cuando la RPC devolvió éxito.
 * Si la RPC falla (por cualquier motivo), el flujo cae al camino de
 * DESACTIVACIÓN — sin tocar `auth.users`, sin nada a medio borrar.
 *
 * -----------------------------------------------------------------------------
 * TRAZABILIDAD: SOLO BITÁCORA
 * -----------------------------------------------------------------------------
 * El usuario decidió que esto NO agrega columnas nuevas. Cada baja/reactivación
 * deja una fila en `bitacora_auditoria` con `actorUsuarioId` (RNF-04) ANTES de
 * tocar nada — patrón `emitirFacturaPeriodo`/`cerrarPeriodoManualmente`
 * (`src/modules/dinero/acciones.ts`). El `detalle` incluye la acción/sub-camino
 * resuelto (legacy, multi-courier con repunte, purga de última membresía, etc.)
 * para poder reconstruir después CUÁL de los caminos se tomó, no solo que "se
 * dio de baja".
 *
 * -----------------------------------------------------------------------------
 * SELLER MULTI-COURIER (migración `20260916000001`)
 * -----------------------------------------------------------------------------
 * Un seller puede tener membresías en varios couriers (`identidad.seller_membresias`,
 * llave `auth_user_id`). Si la identidad NUNCA tuvo una fila ahí (seller "clásico",
 * anterior a la migración), la baja es directa sobre su única ficha. Si SÍ tiene
 * membresías, la baja es de LA MEMBRESÍA DEL COURIER MOSTRADO, no de la persona:
 * se bloquea esa membresía, se suspende la fila `sellers` de ESE tenant y se
 * desenganchan sus conexiones/bodegas — la identidad (`seller_identidades`,
 * `auth.users`) solo se borra cuando es la ÚLTIMA membresía que existió jamás y
 * el predicado da 0 relación en ella. Si queda otra membresía ACTIVA en otro
 * courier, `usuarios_perfil` se repunta ahí (`cambiarCourierActivo`) — nunca se
 * deja apuntando a una membresía bloqueada.
 *
 * ⚠️ **Riesgo aceptado, documentado, NO se corrige**: tras el repunte, el claim
 * `tenant_id` del JWT del courier viejo puede tardar hasta ~1 h en refrescar
 * (mismo mecanismo que cualquier claim del `custom_access_token_hook`). Se
 * auto-corrige solo, no es una fuga cross-tenant (las políticas RLS igual
 * evalúan contra el tenant del claim, que sigue siendo válido mientras no se
 * refresca — el seller simplemente ve el courier viejo un rato más), y hoy no
 * hay sellers multi-courier en producción.
 *
 * -----------------------------------------------------------------------------
 * LA SESIÓN: REVOCAR + EL GATE LEE ESTADO VIVO
 * -----------------------------------------------------------------------------
 * `revocarSesionUsuario` marca al usuario de Auth con `ban_duration` (~100
 * años) — corta cualquier refresco de token futuro. Pero la expulsión REAL de
 * quien ya tiene un access token vivo la hace el gate de sesión
 * (`src/lib/identidad/usuario-actual-servidor.ts`): lee `usuarios_perfil.estado`
 * EN VIVO (no el claim del JWT, que puede quedar stale hasta que el token se
 * refresque) y `tieneCapacidad`/`estaActivo` niegan toda acción apenas
 * `estado !== 'activo'`. Los dos mecanismos son independientes a propósito: si
 * uno falla (Auth caído, red), el otro igual expulsa.
 *
 * -----------------------------------------------------------------------------
 * TOCTOU: `accionEsperada` — la previsualización puede quedar stale
 * -----------------------------------------------------------------------------
 * `previsualizarBajaCuenta` es 100% lectura y el diálogo del admin decide, con
 * ese veredicto, si pide confirmación tipeada (solo para "eliminada"). Entre el
 * preview y el confirm, el estado real puede cambiar (alguien más movió un
 * pedido, se creó una liquidación). `darDeBajaCuenta` acepta `accionEsperada` y
 * vuelve a evaluar TODO desde cero al momento de escribir; si la evaluación
 * fresca da "eliminada" pero el admin solo confirmó "desactivada" (sin la
 * fricción de la confirmación tipeada), la función ABORTA sin escribir nada. La
 * dirección contraria —previsto "eliminada", real "desactivada"— NUNCA se
 * bloquea: es más segura que lo que el admin confirmó, no menos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import {
  bloquearSellerMembresia,
  desbloquearSellerMembresia,
  cambiarCourierActivo,
} from "@/modules/identidad/seller-membresias";
import {
  obtenerConexionesPorSeller as obtenerConexionesMlPorSeller,
  revocarConexionMlPorAdministrador,
} from "@/modules/integraciones/ml/puerto";
import {
  obtenerConexionesPorSeller as obtenerConexionesShopifyPorSeller,
  desconectarTienda as desconectarTiendaShopify,
} from "@/modules/integraciones/shopify/puerto";
import { revocarDestinatario } from "./whatsapp-destinatarios";
import { eliminarCuentaPersonaRpc } from "./eliminar-cuenta-persona-rpc";

// =============================================================================
// El predicado — ¿esta ficha tiene relación con pedidos o con dinero?
// =============================================================================

export type TipoEntidadFinanciera = "seller" | "conductor";

interface TablaRelacionada {
  schema: string;
  tabla: string;
  columna: string;
}

/**
 * Tablas verificadas contra las migraciones reales (no supuestas):
 * `operacion.pedidos`/`sesiones_retiro`/`evidencias_entrega` usan `seller_id`;
 * `dinero.lineas_cobro`/`periodos_cobro`/`documentos_dte`/`pagos_recibidos`/
 * `config_periodos`/`eventos_conciliacion` también. Todas `tenant_id` +
 * `seller_id` con FK `on delete restrict` hacia `identidad.sellers(id)`
 * (confirmado en `20260601000005_operacion_base.sql`,
 * `20260601000006_dinero_base.sql:594` (`eventos_conciliacion.seller_id`),
 * `20260601000008_dinero_cobranza_fintoc.sql`, `20260813000004_...qr.sql`,
 * `20260622000001_operacion_evidencias_entrega.sql`).
 */
const TABLAS_SELLER: readonly TablaRelacionada[] = [
  { schema: "operacion", tabla: "pedidos", columna: "seller_id" },
  { schema: "operacion", tabla: "sesiones_retiro", columna: "seller_id" },
  { schema: "operacion", tabla: "evidencias_entrega", columna: "seller_id" },
  { schema: "dinero", tabla: "lineas_cobro", columna: "seller_id" },
  { schema: "dinero", tabla: "periodos_cobro", columna: "seller_id" },
  { schema: "dinero", tabla: "documentos_dte", columna: "seller_id" },
  { schema: "dinero", tabla: "pagos_recibidos", columna: "seller_id" },
  { schema: "dinero", tabla: "config_periodos", columna: "seller_id" },
  { schema: "dinero", tabla: "eventos_conciliacion", columna: "seller_id" },
];

/**
 * ⚠️ El nombre de columna NO es uniforme entre tablas: `asignaciones_pedido`
 * y las tres tablas de `dinero` usan `driver_id`; `pruebas_entrega`,
 * `cierres_conductor`, `sesiones_retiro` y `evidencias_entrega` (que las
 * comparte con el seller) usan `conductor_id`. Verificado migración por
 * migración — no asumido. Todas `on delete restrict` hacia
 * `identidad.conductores(id)`. `dinero.lineas_liquidacion` (`driver_id`,
 * `20260601000006_dinero_base.sql:520`) es la tabla NÚCLEO de la liquidación
 * al conductor — sin ella, el predicado podía decir "eliminar" para un
 * conductor con liquidaciones reales.
 */
const TABLAS_CONDUCTOR: readonly TablaRelacionada[] = [
  { schema: "operacion", tabla: "asignaciones_pedido", columna: "driver_id" },
  { schema: "operacion", tabla: "pruebas_entrega", columna: "conductor_id" },
  { schema: "operacion", tabla: "cierres_conductor", columna: "conductor_id" },
  { schema: "operacion", tabla: "sesiones_retiro", columna: "conductor_id" },
  { schema: "operacion", tabla: "evidencias_entrega", columna: "conductor_id" },
  { schema: "dinero", tabla: "liquidaciones", columna: "driver_id" },
  { schema: "dinero", tabla: "lineas_liquidacion", columna: "driver_id" },
  { schema: "dinero", tabla: "payouts_conductor", columna: "driver_id" },
  { schema: "dinero", tabla: "eventos_conciliacion", columna: "driver_id" },
];

/**
 * ¿Esta ficha (seller o conductor) tiene alguna fila en pedidos o en dinero?
 *
 * Lo más PERMISIVO que sigue siendo cierto, a propósito: los dos errores no
 * cuestan lo mismo. Decir que SÍ tiene relación cuando no la tiene solo hace
 * que una cuenta vacía se desactive en vez de borrarse (molesto, reversible).
 * Decir que NO tiene relación cuando SÍ la tiene borraría facturas, líneas de
 * cobro y liquidaciones reales — irreversible. Por eso se recorren TODAS las
 * tablas (no se corta al primer "probablemente no") y cualquier fila cuenta,
 * sin importar su estado.
 */
export async function tieneRelacionConPedidosODinero(
  cliente: SupabaseClient,
  entrada: { tipo: TipoEntidadFinanciera; tenantId: string; entidadId: string },
): Promise<boolean> {
  const tablas = entrada.tipo === "seller" ? TABLAS_SELLER : TABLAS_CONDUCTOR;

  for (const { schema, tabla, columna } of tablas) {
    const { count, error } = await cliente
      .schema(schema)
      .from(tabla)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", entrada.tenantId)
      .eq(columna, entrada.entidadId);

    if (error) {
      throw new Error(`No se pudo comprobar ${schema}.${tabla}: ${error.message}`);
    }
    if ((count ?? 0) > 0) return true;
  }

  return false;
}

// =============================================================================
// Sesión — revocar / reactivar (Supabase Auth) + azúcar de bitácora
// =============================================================================

/** ~100 años. Mismo valor que documenta el SDK de Supabase para "banear". */
const DURACION_BAN = "876000h";

/**
 * Corta cualquier refresco de token futuro. NO es lo que expulsa a alguien con
 * un access token todavía vivo — eso lo hace el gate de sesión leyendo estado
 * en vivo (ver cabecera del archivo). Nunca lanza: si Auth falla, la baja de
 * negocio (que ya ocurrió) no se revierte por esto.
 */
async function revocarSesionUsuario(cliente: SupabaseClient, usuarioId: string): Promise<void> {
  try {
    await cliente.auth.admin.updateUserById(usuarioId, { ban_duration: DURACION_BAN });
  } catch {
    // Silencio deliberado — ver comentario de arriba.
  }
}

async function reactivarSesionUsuario(cliente: SupabaseClient, usuarioId: string): Promise<void> {
  try {
    await cliente.auth.admin.updateUserById(usuarioId, { ban_duration: "none" });
  } catch {
    // Idem.
  }
}

async function eliminarUsuarioAuth(cliente: SupabaseClient, usuarioId: string): Promise<void> {
  const { error } = await cliente.auth.admin.deleteUser(usuarioId);
  if (error) {
    throw new Error(`No se pudo eliminar la cuenta de Auth: ${error.message}`);
  }
}

// =============================================================================
// Lectura del perfil + bordes
// =============================================================================

interface PerfilCuenta {
  id: string;
  tenantId: string | null;
  tipoUsuario: "interno" | "seller" | "conductor" | "super_admin";
  rol: string;
  estado: "activo" | "invitado" | "suspendido";
  sellerId: string | null;
  driverId: string | null;
}

async function leerPerfil(cliente: SupabaseClient, usuarioId: string): Promise<PerfilCuenta | null> {
  const { data, error } = await cliente
    .schema("identidad")
    .from("usuarios_perfil")
    .select("id, tenant_id, tipo_usuario, rol, estado, seller_id, driver_id")
    .eq("id", usuarioId)
    .maybeSingle();

  if (error) throw new Error(`No se pudo leer el perfil: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id as string,
    tenantId: (data.tenant_id as string | null) ?? null,
    tipoUsuario: data.tipo_usuario as PerfilCuenta["tipoUsuario"],
    rol: data.rol as string,
    estado: data.estado as PerfilCuenta["estado"],
    sellerId: (data.seller_id as string | null) ?? null,
    driverId: (data.driver_id as string | null) ?? null,
  };
}

const MOTIVO_ULTIMO_DUENO =
  "Es el único dueño activo de este courier. Gestiona esto desde Suscripciones (transferir titularidad), no dando de baja su cuenta.";
const MOTIVO_SUPER_ADMIN_BAJA = "Las cuentas de plataforma no se dan de baja desde aquí.";
const MOTIVO_SUPER_ADMIN_REACTIVAR = "Las cuentas de plataforma no se reactivan desde aquí.";
/** TOCTOU (ver cabecera): la evaluación fresca da más grave que lo confirmado. */
const MOTIVO_CAMBIO_DE_SITUACION =
  "La situación de la cuenta cambió: ahora se eliminaría, no se desactivaría. Revisá y confirmá de nuevo.";

/**
 * Borde: dar de baja al ÚLTIMO dueño ACTIVO de un tenant se BLOQUEA. Sin un
 * dueño activo, nadie del courier puede gestionar su suscripción ni su
 * equipo — eso se resuelve desde Suscripciones (transferir titularidad), no
 * borrando cuentas.
 */
async function esUltimoDuenoActivo(cliente: SupabaseClient, perfil: PerfilCuenta): Promise<boolean> {
  if (perfil.tipoUsuario !== "interno" || perfil.rol !== "dueno" || perfil.estado !== "activo") {
    return false;
  }
  if (!perfil.tenantId) return false;

  const { count, error } = await cliente
    .schema("identidad")
    .from("usuarios_perfil")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", perfil.tenantId)
    .eq("tipo_usuario", "interno")
    .eq("rol", "dueno")
    .eq("estado", "activo")
    .neq("id", perfil.id);

  if (error) throw new Error(`No se pudo verificar otros dueños activos: ${error.message}`);
  return (count ?? 0) === 0;
}

/**
 * Borde `entidad_compartida`: ¿otra cuenta (auth distinto) sigue apuntando a
 * esta MISMA ficha (`seller_id`/`driver_id`)? Si sí, la ficha NUNCA se borra
 * al eliminar esta cuenta — la otra la necesita. Por eso NUNCA se llama la RPC
 * de borrado duro en este caso: la RPC borra la ficha entera, y acá la ficha
 * sigue viva para otro.
 */
async function otraCuentaReferenciaFicha(
  cliente: SupabaseClient,
  entrada: { tipo: TipoEntidadFinanciera; entidadId: string; excluirUsuarioId: string },
): Promise<boolean> {
  const columna = entrada.tipo === "seller" ? "seller_id" : "driver_id";
  const { count, error } = await cliente
    .schema("identidad")
    .from("usuarios_perfil")
    .select("id", { count: "exact", head: true })
    .eq(columna, entrada.entidadId)
    .neq("id", entrada.excluirUsuarioId);

  if (error) throw new Error(`No se pudo comprobar entidad compartida: ${error.message}`);
  return (count ?? 0) > 0;
}

// =============================================================================
// Desenganche de integraciones del seller (conexiones/bodegas/WhatsApp/fuentes)
// =============================================================================

/**
 * Desengancha TODO lo que un seller tiene conectado en ESTE tenant. Ninguna
 * llamada de acá le pega a una API externa directo: ML pasa por
 * `revocarConexionMlPorAdministrador` (adaptador `integraciones/ml`), Shopify
 * por `desconectarTiendaShopify` (adaptador `integraciones/shopify`) — ninguno
 * de los dos habla con el proveedor externo (no hay endpoint de revocación
 * documentado para ninguno de los dos), solo apagan la ingesta y olvidan el
 * secreto.
 *
 * Cada paso está aislado con su propio `catch`: una integración caída no
 * puede impedir que la cuenta quede suspendida, que es lo que se pidió.
 */
async function revocarConexionesSeller(
  cliente: SupabaseClient,
  entrada: { tenantId: string; sellerId: string; actorUsuarioId: string },
): Promise<void> {
  try {
    const conexionesMl = await obtenerConexionesMlPorSeller(entrada.sellerId);
    for (const conexion of conexionesMl) {
      if (conexion.estadoSalud === "desvinculada") continue;
      await revocarConexionMlPorAdministrador({
        conexionId: conexion.id,
        tenantId: entrada.tenantId,
        actorUsuarioId: entrada.actorUsuarioId,
      });
    }
  } catch {
    // No bloquea la baja por una integración caída.
  }

  try {
    const tiendas = await obtenerConexionesShopifyPorSeller(entrada.tenantId, entrada.sellerId);
    for (const tienda of tiendas) {
      if (!tienda.activa) continue;
      await desconectarTiendaShopify({
        conexionId: tienda.id,
        tenantId: entrada.tenantId,
        usuarioId: entrada.actorUsuarioId,
      });
    }
  } catch {
    // Idem.
  }

  try {
    await cliente
      .schema("identidad")
      .from("seller_bodegas")
      .update({ activa: false })
      .eq("tenant_id", entrada.tenantId)
      .eq("seller_id", entrada.sellerId)
      .eq("activa", true);
  } catch {
    // Idem — no hay borrado, así que no hay nada irreversible que proteger.
  }

  try {
    const { data: contactos } = await cliente
      .schema("integraciones")
      .from("whatsapp_contactos")
      .select("id")
      .eq("tenant_id", entrada.tenantId)
      .eq("seller_id", entrada.sellerId)
      .neq("opt_in_estado", "revocado");
    for (const contacto of (contactos ?? []) as Array<{ id: string }>) {
      await revocarDestinatario({ contactoId: contacto.id, actorUsuarioId: entrada.actorUsuarioId });
    }
  } catch {
    // Idem.
  }

  try {
    await cliente
      .schema("identidad")
      .from("seller_fuentes_declaradas")
      .update({ estado: "desvinculada" })
      .eq("tenant_id", entrada.tenantId)
      .eq("seller_id", entrada.sellerId)
      .neq("estado", "desvinculada");
  } catch {
    // Idem.
  }
}

// =============================================================================
// darDeBajaCuenta
// =============================================================================

export type AccionBaja = "eliminada" | "desactivada";

export type ResultadoBaja = { ok: true; accion: AccionBaja } | { ok: false; motivo: string };

/** `true` si la evaluación fresca es MÁS grave que lo que el admin confirmó. */
function chocaConLoEsperado(accionReal: AccionBaja, accionEsperada: AccionBaja | undefined): boolean {
  return accionEsperada === "desactivada" && accionReal === "eliminada";
}

/**
 * Da de baja la cuenta de una persona. Bitácora ANTES del efecto, con el
 * `actorUsuarioId` del super-admin (RNF-04) — el llamador (Server Action)
 * DEBE haber pasado ya por `exigirActorAdmin()`.
 *
 * `accionEsperada` es OPCIONAL (retrocompatible) pero el llamador de
 * `/admin/cuentas` SIEMPRE debe enviarlo con lo que `previsualizarBajaCuenta`
 * mostró — ver "TOCTOU" en la cabecera del archivo.
 */
export async function darDeBajaCuenta(entrada: {
  actorUsuarioId: string;
  usuarioId: string;
  accionEsperada?: AccionBaja;
}): Promise<ResultadoBaja> {
  const cliente = crearClienteServiceRole();
  const perfil = await leerPerfil(cliente, entrada.usuarioId);

  // `sin_perfil`: existe en Auth, ocupa el correo, no tiene ficha que proteger.
  // Siempre se borra — no hay nada más que desenganchar. Nunca es una sorpresa
  // más grave que "eliminada" (es lo único que este camino produce).
  if (!perfil) {
    await registrarEnBitacora(cliente, {
      tenantId: null,
      actorUsuarioId: entrada.actorUsuarioId,
      actorTipo: "usuario",
      accion: "cuenta.dada_de_baja",
      entidadTipo: "usuario_auth",
      entidadId: entrada.usuarioId,
      detalle: { marca: "sin_perfil" },
    });
    await eliminarUsuarioAuth(cliente, entrada.usuarioId);
    return { ok: true, accion: "eliminada" };
  }

  if (await esUltimoDuenoActivo(cliente, perfil)) {
    return { ok: false, motivo: MOTIVO_ULTIMO_DUENO };
  }

  if (perfil.tipoUsuario === "super_admin") {
    return { ok: false, motivo: MOTIVO_SUPER_ADMIN_BAJA };
  }

  if (perfil.tipoUsuario === "interno") {
    // Nunca produce "eliminada": no hay mismatch posible que bloquear.
    return darDeBajaInterno(cliente, perfil, entrada.actorUsuarioId);
  }
  if (perfil.tipoUsuario === "conductor") {
    return darDeBajaConductor(cliente, perfil, entrada.actorUsuarioId, entrada.accionEsperada);
  }
  return darDeBajaSeller(cliente, perfil, entrada.actorUsuarioId, entrada.accionEsperada);
}

async function darDeBajaInterno(
  cliente: SupabaseClient,
  perfil: PerfilCuenta,
  actorUsuarioId: string,
): Promise<ResultadoBaja> {
  await registrarEnBitacora(cliente, {
    tenantId: perfil.tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "cuenta.dada_de_baja",
    entidadTipo: "usuario_perfil",
    entidadId: perfil.id,
    detalle: { tipo_usuario: "interno", rol: perfil.rol, accion: "desactivada" },
  });

  const { error } = await cliente
    .schema("identidad")
    .from("usuarios_perfil")
    .update({ estado: "suspendido" })
    .eq("id", perfil.id);
  if (error) throw new Error(`No se pudo suspender la cuenta: ${error.message}`);

  await revocarSesionUsuario(cliente, perfil.id);
  return { ok: true, accion: "desactivada" };
}

// -----------------------------------------------------------------------------
// Conductor
// -----------------------------------------------------------------------------

async function desactivarFichaConductor(
  cliente: SupabaseClient,
  entrada: { tenantId: string; driverId: string },
): Promise<void> {
  const { error } = await cliente
    .schema("identidad")
    .from("conductores")
    .update({ estado: "inactivo", disponible: false })
    .eq("id", entrada.driverId)
    .eq("tenant_id", entrada.tenantId);
  if (error) throw new Error(`No se pudo desactivar al conductor: ${error.message}`);
}

/**
 * Intenta el borrado duro (RPC atómica) si `!tieneRelacion` y la ficha no es
 * compartida; degrada a desactivación ante CUALQUIER fallo (incluida una FK
 * restrict que el predicado no vio venir — la RPC hace rollback completo, así
 * que "falló" nunca significa "a medias").
 */
async function bajaDuraOSuaveConductor(
  cliente: SupabaseClient,
  entrada: { tenantId: string; driverId: string; usuarioId: string; tieneRelacion: boolean },
): Promise<AccionBaja> {
  if (!entrada.tieneRelacion) {
    const compartida = await otraCuentaReferenciaFicha(cliente, {
      tipo: "conductor",
      entidadId: entrada.driverId,
      excluirUsuarioId: entrada.usuarioId,
    });

    if (compartida) {
      // La ficha es de otra cuenta también: NUNCA se llama la RPC (borraría la
      // ficha que la otra cuenta necesita). Solo esta cuenta se borra.
      const { error } = await cliente
        .schema("identidad")
        .from("usuarios_perfil")
        .delete()
        .eq("id", entrada.usuarioId);
      if (!error) return "eliminada";
      // Si ni siquiera esto se pudo borrar, cae a desactivación abajo.
    } else {
      const exito = await eliminarCuentaPersonaRpc(cliente, {
        usuarioId: entrada.usuarioId,
        tipo: "conductor",
        tenantId: entrada.tenantId,
        entidadId: entrada.driverId,
      });
      if (exito) return "eliminada";
      // La RPC falló (rollback completo — nada se borró): cae a desactivación.
    }
  }

  await desactivarFichaConductor(cliente, { tenantId: entrada.tenantId, driverId: entrada.driverId });
  await cliente
    .schema("identidad")
    .from("usuarios_perfil")
    .update({ estado: "suspendido" })
    .eq("id", entrada.usuarioId);
  return "desactivada";
}

async function darDeBajaConductor(
  cliente: SupabaseClient,
  perfil: PerfilCuenta,
  actorUsuarioId: string,
  accionEsperada: AccionBaja | undefined,
): Promise<ResultadoBaja> {
  const tenantId = perfil.tenantId as string;
  const driverId = perfil.driverId as string;

  const tieneRelacion = await tieneRelacionConPedidosODinero(cliente, {
    tipo: "conductor",
    tenantId,
    entidadId: driverId,
  });

  // TOCTOU: evaluación fresca ANTES de escribir nada. Solo se anticipa el
  // caso peligroso (esperaban desactivar, ahora tocaría eliminar) — el intento
  // de borrado duro puede seguir degradando a desactivación más abajo, eso
  // nunca es un problema.
  const accionPlaneada: AccionBaja = tieneRelacion ? "desactivada" : "eliminada";
  if (chocaConLoEsperado(accionPlaneada, accionEsperada)) {
    return { ok: false, motivo: MOTIVO_CAMBIO_DE_SITUACION };
  }

  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "cuenta.dada_de_baja",
    entidadTipo: "usuario_perfil",
    entidadId: perfil.id,
    detalle: {
      tipo_usuario: "conductor",
      tiene_relacion_financiera: tieneRelacion,
      accion_planeada: accionPlaneada,
    },
  });

  const accion = await bajaDuraOSuaveConductor(cliente, {
    tenantId,
    driverId,
    usuarioId: perfil.id,
    tieneRelacion,
  });

  if (accion === "eliminada") {
    await eliminarUsuarioAuth(cliente, perfil.id);
    return { ok: true, accion: "eliminada" };
  }

  await revocarSesionUsuario(cliente, perfil.id);
  return { ok: true, accion: "desactivada" };
}

// -----------------------------------------------------------------------------
// Seller (con la variante multi-courier)
// -----------------------------------------------------------------------------

interface FilaMembresia {
  id: string;
  tenant_id: string;
  seller_id: string;
  estado: "activa" | "bloqueada";
}

async function leerMembresias(cliente: SupabaseClient, authUserId: string): Promise<FilaMembresia[]> {
  const { data, error } = await cliente
    .schema("identidad")
    .from("seller_membresias")
    .select("id, tenant_id, seller_id, estado")
    .eq("auth_user_id", authUserId);

  if (error) throw new Error(`No se pudieron leer las membresías del seller: ${error.message}`);
  return (data ?? []) as FilaMembresia[];
}

/**
 * Seller "clásico": identidad que NUNCA tuvo una fila en `seller_membresias`
 * (anterior a la migración `20260916000001`, o dado de alta directo por el
 * courier). Se comporta como una baja de una sola entidad, igual que
 * conductor: borrado duro (RPC) si `!tieneRelacion` y la ficha no es
 * compartida; si no, desactivación.
 */
async function bajaDuraOSuaveSellerClasico(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    sellerId: string;
    usuarioId: string;
    actorUsuarioId: string;
    tieneRelacion: boolean;
  },
): Promise<AccionBaja> {
  if (!entrada.tieneRelacion) {
    const compartida = await otraCuentaReferenciaFicha(cliente, {
      tipo: "seller",
      entidadId: entrada.sellerId,
      excluirUsuarioId: entrada.usuarioId,
    });

    if (compartida) {
      // La ficha es de otra cuenta también: NUNCA se llama la RPC. Solo esta
      // cuenta se borra; la ficha (y sus conexiones) sigue viva para la otra.
      const { error } = await cliente
        .schema("identidad")
        .from("usuarios_perfil")
        .delete()
        .eq("id", entrada.usuarioId);
      if (!error) return "eliminada";
    } else {
      const exito = await eliminarCuentaPersonaRpc(cliente, {
        usuarioId: entrada.usuarioId,
        tipo: "seller",
        tenantId: entrada.tenantId,
        entidadId: entrada.sellerId,
      });
      if (exito) return "eliminada";
      // La RPC falló (rollback completo): cae a desactivación.
    }
  }

  await revocarConexionesSeller(cliente, {
    tenantId: entrada.tenantId,
    sellerId: entrada.sellerId,
    actorUsuarioId: entrada.actorUsuarioId,
  });
  await cliente
    .schema("identidad")
    .from("sellers")
    .update({ estado: "suspendido" })
    .eq("id", entrada.sellerId)
    .eq("tenant_id", entrada.tenantId);
  await cliente
    .schema("identidad")
    .from("usuarios_perfil")
    .update({ estado: "suspendido" })
    .eq("id", entrada.usuarioId);
  return "desactivada";
}

/**
 * Última membresía (la única que existió jamás) + sin relación financiera:
 * intenta la purga completa de la identidad vía RPC. Devuelve `true` solo si
 * la RPC + `auth.admin.deleteUser` completaron — el llamador NUNCA debe borrar
 * `auth.users` si esto devuelve `false`.
 */
async function purgarIdentidadSellerCompleta(
  cliente: SupabaseClient,
  entrada: { tenantId: string; sellerId: string; usuarioId: string },
): Promise<boolean> {
  const compartida = await otraCuentaReferenciaFicha(cliente, {
    tipo: "seller",
    entidadId: entrada.sellerId,
    excluirUsuarioId: entrada.usuarioId,
  });

  if (compartida) {
    // Solo esta cuenta se borra; la ficha (compartida) y sus membresías de
    // otros couriers siguen intactas. NUNCA se llama la RPC.
    const { error } = await cliente
      .schema("identidad")
      .from("usuarios_perfil")
      .delete()
      .eq("id", entrada.usuarioId);
    if (error) return false;
    await eliminarUsuarioAuth(cliente, entrada.usuarioId);
    return true;
  }

  const exito = await eliminarCuentaPersonaRpc(cliente, {
    usuarioId: entrada.usuarioId,
    tipo: "seller",
    tenantId: entrada.tenantId,
    entidadId: entrada.sellerId,
  });
  if (!exito) return false; // Rollback completo: NO se toca auth.users.

  await eliminarUsuarioAuth(cliente, entrada.usuarioId);
  return true;
}

async function darDeBajaSeller(
  cliente: SupabaseClient,
  perfil: PerfilCuenta,
  actorUsuarioId: string,
  accionEsperada: AccionBaja | undefined,
): Promise<ResultadoBaja> {
  const tenantId = perfil.tenantId as string;
  const sellerId = perfil.sellerId as string;

  const membresias = await leerMembresias(cliente, perfil.id);
  const tieneRelacion = await tieneRelacionConPedidosODinero(cliente, {
    tipo: "seller",
    tenantId,
    entidadId: sellerId,
  });

  const objetivo = membresias.find((m) => m.tenant_id === tenantId) ?? null;
  const otrasActivas = membresias.filter((m) => m.tenant_id !== tenantId && m.estado === "activa");

  // La MISMA decisión que se ejecuta más abajo, calculada ANTES de escribir
  // nada — es lo que compara contra `accionEsperada` (TOCTOU) y lo que va al
  // detalle de la bitácora (sub-camino).
  let accionPlaneada: AccionBaja;
  let subCamino: string;
  if (membresias.length === 0) {
    accionPlaneada = tieneRelacion ? "desactivada" : "eliminada";
    subCamino = "clasico";
  } else if (!objetivo) {
    accionPlaneada = "desactivada";
    subCamino = "membresia_no_encontrada";
  } else if (otrasActivas.length > 0) {
    accionPlaneada = "desactivada";
    subCamino = "multi_courier_repunte";
  } else if (membresias.length === 1 && !tieneRelacion) {
    accionPlaneada = "eliminada";
    subCamino = "ultima_membresia_purga";
  } else {
    accionPlaneada = "desactivada";
    subCamino = "multi_courier_sin_otras_activas";
  }

  if (chocaConLoEsperado(accionPlaneada, accionEsperada)) {
    return { ok: false, motivo: MOTIVO_CAMBIO_DE_SITUACION };
  }

  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "cuenta.dada_de_baja",
    entidadTipo: "usuario_perfil",
    entidadId: perfil.id,
    detalle: {
      tipo_usuario: "seller",
      tiene_relacion_financiera: tieneRelacion,
      multi_courier: membresias.length > 0,
      sub_camino: subCamino,
      accion_planeada: accionPlaneada,
    },
  });

  // Caso A — seller clásico: sin fila de membresía en NINGÚN courier.
  if (subCamino === "clasico") {
    const accion = await bajaDuraOSuaveSellerClasico(cliente, {
      tenantId,
      sellerId,
      usuarioId: perfil.id,
      actorUsuarioId,
      tieneRelacion,
    });
    if (accion === "eliminada") {
      await eliminarUsuarioAuth(cliente, perfil.id);
      return { ok: true, accion: "eliminada" };
    }
    await revocarSesionUsuario(cliente, perfil.id);
    return { ok: true, accion: "desactivada" };
  }

  // Caso B — inconsistencia: el perfil apunta a un tenant sin fila de
  // membresía. Se suspende SOLO este seller/perfil, sin tocar
  // seller_membresias/seller_identidades/auth.users de la identidad
  // compartida — no hay forma segura de saber si otra membresía depende de
  // ese estado.
  if (subCamino === "membresia_no_encontrada") {
    await revocarConexionesSeller(cliente, { tenantId, sellerId, actorUsuarioId });
    await cliente
      .schema("identidad")
      .from("sellers")
      .update({ estado: "suspendido" })
      .eq("id", sellerId)
      .eq("tenant_id", tenantId);
    await cliente
      .schema("identidad")
      .from("usuarios_perfil")
      .update({ estado: "suspendido" })
      .eq("id", perfil.id);
    await revocarSesionUsuario(cliente, perfil.id);
    return { ok: true, accion: "desactivada" };
  }

  // Caso C, D, E — multi-courier real: bloquear SOLO la membresía mostrada,
  // suspender la ficha de ESE tenant, desenganchar sus conexiones. Esto
  // ocurre SIEMPRE en el camino multi-courier, sea cual sea el desenlace final.
  try {
    await bloquearSellerMembresia(cliente, { tenantId, sellerId, actorUsuarioId });
  } catch (error) {
    // Carrera estrecha (la membresía ya no existe/cambió entre la lectura y
    // acá): no tumba toda la función, se traduce a un resultado de negocio.
    const mensaje = error instanceof Error ? error.message : "No se pudo bloquear la membresía.";
    return { ok: false, motivo: mensaje };
  }
  await revocarConexionesSeller(cliente, { tenantId, sellerId, actorUsuarioId });
  await cliente
    .schema("identidad")
    .from("sellers")
    .update({ estado: "suspendido" })
    .eq("id", sellerId)
    .eq("tenant_id", tenantId);

  if (subCamino === "multi_courier_repunte") {
    // Sigue operando con otro courier: se le corta el acceso a ESTE nada más.
    // Nunca se revoca la sesión ni se toca la identidad compartida.
    await cambiarCourierActivo(cliente, { authUserId: perfil.id, tenantId: otrasActivas[0].tenant_id });
    return { ok: true, accion: "desactivada" };
  }

  if (subCamino === "ultima_membresia_purga") {
    const purgada = await purgarIdentidadSellerCompleta(cliente, { tenantId, sellerId, usuarioId: perfil.id });
    if (purgada) return { ok: true, accion: "eliminada" };
    // La RPC falló (rollback completo, auth.users NUNCA se tocó): cae a
    // suspensión total, igual que el resto de los desenlaces "desactivada".
  }

  // `multi_courier_sin_otras_activas`, o la purga de arriba no se pudo
  // completar: la cuenta entera queda suspendida (no puede operar en ningún
  // courier), sin borrar nada de la identidad compartida.
  await cliente.schema("identidad").from("usuarios_perfil").update({ estado: "suspendido" }).eq("id", perfil.id);
  await revocarSesionUsuario(cliente, perfil.id);
  return { ok: true, accion: "desactivada" };
}

// =============================================================================
// previsualizarBajaCuenta — el veredicto SIN efecto (para el diálogo del admin)
// =============================================================================

export interface PrevisualizacionBajaOk {
  ok: true;
  accionPrevista: AccionBaja;
  /** `null` cuando la cuenta solo existe en Auth (sin perfil). */
  tipoUsuario: PerfilCuenta["tipoUsuario"] | null;
  /** Seller multi-courier: otros couriers donde SEGUIRÍA activo tras esta baja. */
  otrosCouriersActivos: number;
}
export type PrevisualizacionBaja = PrevisualizacionBajaOk | { ok: false; motivo: string };

/**
 * Calcula qué haría `darDeBajaCuenta` (eliminar vs desactivar, o si está
 * bloqueada) SIN tocar nada. Es lo que el diálogo del admin muestra antes de
 * pedir la confirmación tipeada — y lo que el diálogo debe reenviar como
 * `accionEsperada` al confirmar (ver "TOCTOU" en la cabecera del archivo).
 *
 * ⚠️ Espeja la lógica de decisión de `darDeBajaCuenta`/`darDeBajaSeller`: si
 * una cambia, la otra también. La guarda de `accionEsperada` en
 * `darDeBajaCuenta` es la red de seguridad si este espejo alguna vez se
 * desincroniza — nunca deja pasar una sorpresa hacia "eliminada".
 */
export async function previsualizarBajaCuenta(usuarioId: string): Promise<PrevisualizacionBaja> {
  const cliente = crearClienteServiceRole();
  const perfil = await leerPerfil(cliente, usuarioId);

  if (!perfil) {
    // sin_perfil: solo Auth, nada que proteger → siempre se elimina.
    return { ok: true, accionPrevista: "eliminada", tipoUsuario: null, otrosCouriersActivos: 0 };
  }
  if (await esUltimoDuenoActivo(cliente, perfil)) {
    return { ok: false, motivo: MOTIVO_ULTIMO_DUENO };
  }
  if (perfil.tipoUsuario === "super_admin") {
    return { ok: false, motivo: MOTIVO_SUPER_ADMIN_BAJA };
  }
  if (perfil.tipoUsuario === "interno") {
    return { ok: true, accionPrevista: "desactivada", tipoUsuario: "interno", otrosCouriersActivos: 0 };
  }

  const tipo: TipoEntidadFinanciera = perfil.tipoUsuario === "seller" ? "seller" : "conductor";
  const entidadId = (perfil.tipoUsuario === "seller" ? perfil.sellerId : perfil.driverId) as string;
  const tenantId = perfil.tenantId as string;
  const tieneRelacion = await tieneRelacionConPedidosODinero(cliente, { tipo, tenantId, entidadId });

  if (perfil.tipoUsuario === "conductor") {
    return {
      ok: true,
      accionPrevista: tieneRelacion ? "desactivada" : "eliminada",
      tipoUsuario: "conductor",
      otrosCouriersActivos: 0,
    };
  }

  // seller
  const membresias = await leerMembresias(cliente, perfil.id);
  if (membresias.length === 0) {
    return {
      ok: true,
      accionPrevista: tieneRelacion ? "desactivada" : "eliminada",
      tipoUsuario: "seller",
      otrosCouriersActivos: 0,
    };
  }
  const objetivo = membresias.find((m) => m.tenant_id === tenantId) ?? null;
  const otrosCouriersActivos = membresias.filter(
    (m) => m.tenant_id !== tenantId && m.estado === "activa",
  ).length;
  // Solo se purga la identidad compartida cuando: hay membresía para ESTE
  // tenant, es la ÚNICA que existió jamás, y sin relación financiera.
  const accionPrevista: AccionBaja =
    objetivo && membresias.length === 1 && !tieneRelacion ? "eliminada" : "desactivada";
  return { ok: true, accionPrevista, tipoUsuario: "seller", otrosCouriersActivos };
}

// =============================================================================
// reactivarCuenta
// =============================================================================

export interface ResultadoReactivacion {
  ok: boolean;
  motivo?: string;
  /** Lo que la reactivación NO restaura, para que la UI se lo diga al admin. */
  noReenganchado: string[];
}

const NO_REENGANCHADO_SELLER: readonly string[] = [
  "Conexión de Mercado Libre — el seller debe reconectarla desde su portal.",
  "Conexión de Shopify — el seller debe reconectarla desde su portal.",
  "Consentimiento de WhatsApp — el seller debe volver a dejar su número.",
  "Bodegas — quedaron desactivadas; revísalas y actívalas si corresponde.",
];

/**
 * Reactiva una cuenta previamente desactivada. Solo tiene sentido —y solo se
 * permite— si `estado === 'suspendido'`: reactivar una cuenta `invitado` (que
 * nunca canjeó su invitación) la promovería a `activo` sin que la persona
 * jamás haya confirmado nada, y reactivar una ya `activo` no tiene efecto
 * salvo re-encender cosas que no se apagaron (p. ej. `disponible` de un
 * conductor que nunca se dio de baja).
 *
 * NO restaura tokens ML/Shopify (se revocaron en origen — reconectar es una
 * acción del seller, no de Rutax), ni el consentimiento de WhatsApp, ni
 * bodegas — se listan en `noReenganchado` para que la UI lo diga.
 */
export async function reactivarCuenta(entrada: {
  actorUsuarioId: string;
  usuarioId: string;
}): Promise<ResultadoReactivacion> {
  const cliente = crearClienteServiceRole();
  const perfil = await leerPerfil(cliente, entrada.usuarioId);

  if (!perfil) {
    return {
      ok: false,
      motivo: "Esta cuenta ya no existe: fue eliminada, no desactivada. No se puede reactivar.",
      noReenganchado: [],
    };
  }

  if (perfil.tipoUsuario === "super_admin") {
    return { ok: false, motivo: MOTIVO_SUPER_ADMIN_REACTIVAR, noReenganchado: [] };
  }

  if (perfil.estado !== "suspendido") {
    return {
      ok: false,
      motivo: "Esta cuenta no está desactivada — no hay nada que reactivar.",
      noReenganchado: [],
    };
  }

  await registrarEnBitacora(cliente, {
    tenantId: perfil.tenantId,
    actorUsuarioId: entrada.actorUsuarioId,
    actorTipo: "usuario",
    accion: "cuenta.reactivada",
    entidadTipo: "usuario_perfil",
    entidadId: perfil.id,
    detalle: { tipo_usuario: perfil.tipoUsuario },
  });

  let noReenganchado: string[] = [];

  if (perfil.tipoUsuario === "interno") {
    const { error } = await cliente
      .schema("identidad")
      .from("usuarios_perfil")
      .update({ estado: "activo" })
      .eq("id", perfil.id);
    if (error) throw new Error(`No se pudo reactivar la cuenta: ${error.message}`);
  } else if (perfil.tipoUsuario === "conductor") {
    const driverId = perfil.driverId as string;
    await cliente
      .schema("identidad")
      .from("conductores")
      .update({ estado: "activo", disponible: true })
      .eq("id", driverId)
      .eq("tenant_id", perfil.tenantId as string);
    await cliente.schema("identidad").from("usuarios_perfil").update({ estado: "activo" }).eq("id", perfil.id);
  } else {
    // seller
    const tenantId = perfil.tenantId as string;
    const sellerId = perfil.sellerId as string;

    const { data: membresia } = await cliente
      .schema("identidad")
      .from("seller_membresias")
      .select("estado")
      .eq("auth_user_id", perfil.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (membresia && (membresia as { estado: string }).estado === "bloqueada") {
      await desbloquearSellerMembresia(cliente, { tenantId, sellerId, actorUsuarioId: entrada.actorUsuarioId });
    }

    await cliente.schema("identidad").from("sellers").update({ estado: "activo" }).eq("id", sellerId).eq("tenant_id", tenantId);
    await cliente.schema("identidad").from("usuarios_perfil").update({ estado: "activo" }).eq("id", perfil.id);

    noReenganchado = [...NO_REENGANCHADO_SELLER];
  }

  await reactivarSesionUsuario(cliente, perfil.id);
  return { ok: true, noReenganchado };
}
