"use server";

/**
 * Acciones del listado de sellers — hoy solo una: recuperar el enlace de
 * invitación pendiente para entregarlo a mano.
 *
 * POR QUÉ EXISTE: el correo de invitación puede no llegar (cae en spam, el
 * entorno corre en sandbox, el dominio del seller lo rebota). Sin esta salida,
 * un seller que no recibe el correo queda bloqueado y la única forma de
 * destrabarlo es entrar a la base de datos a buscar el token — que es
 * exactamente lo que pasó y por lo que existe este botón.
 *
 * POR QUÉ EL TOKEN SE PIDE AL HACER CLIC Y NO VIENE EN EL HTML DE LA PÁGINA:
 * quien tiene el token ENTRA como ese seller. Renderizar los tokens de todos
 * los sellers pendientes en el listado los dejaría en el HTML, en la caché del
 * navegador y en cualquier extensión que lea el DOM, para una pantalla que se
 * abre a diario. Se entrega uno, bajo demanda, con capacidad verificada y
 * dejando huella en la bitácora.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { solicitarSincronizacionMl } from "@/modules/integraciones/ml";
import { puedeSincronizarConexionesMl, puedeInvitarUsuarios } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";

export type EnlaceInvitacionResultado =
  | { ok: true; token: string; email: string; expiraEn: string }
  | { ok: false; mensaje: string };

/**
 * Devuelve el token de la invitación pendiente de un seller para que el cliente
 * arme el enlace con su propio `window.location.origin` (siempre correcto, sin
 * depender de que una variable de entorno esté bien puesta).
 */
export async function obtenerInvitacionPendienteSeller(
  sellerId: string,
): Promise<EnlaceInvitacionResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No hay una sesión activa." };
  }
  if (!puedeInvitarUsuarios(sesion.usuario)) {
    return {
      ok: false,
      mensaje: "No tienes permiso para ver enlaces de invitación — contacta al dueño de la cuenta.",
    };
  }

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  // El filtro por `tenant_id` es lo que impide que un `sellerId` de otro courier
  // devuelva algo: `service_role` salta RLS, así que el aislamiento acá lo
  // impone esta cláusula y no la base. No quitarla.
  const { data, error } = await cliente
    .from("invitaciones")
    .select("id, token, email, expira_en")
    .eq("seller_id", sellerId)
    .eq("tenant_id", tenantId)
    .eq("estado", "pendiente")
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      mensaje: "No pudimos recuperar el enlace por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }
  if (!data) {
    return {
      ok: false,
      mensaje: "Este seller ya no tiene una invitación pendiente — puede que ya haya entrado.",
    };
  }

  const expiraEn = data.expira_en as string;
  if (new Date(expiraEn).getTime() <= Date.now()) {
    return {
      ok: false,
      mensaje: "Esta invitación venció. Vuelve a invitar al seller para generar una nueva.",
    };
  }

  // Entregar el enlace es dar acceso: queda en bitácora con su autor (RNF-04).
  // El token NUNCA se registra — la BD además lo rechazaría (constraint
  // `bitacora_auditoria_detalle_sin_secretos`).
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId: sesion.usuarioId,
    actorTipo: "usuario",
    accion: "invitacion.enlace_entregado",
    entidadTipo: "invitacion",
    entidadId: data.id as string,
    detalle: { seller_id: sellerId, email: data.email as string, via: "copiar_enlace" },
  });

  return {
    ok: true,
    token: data.token as string,
    email: data.email as string,
    expiraEn,
  };
}

// ---------------------------------------------------------------------------
// "Sincronizar ahora" — el courier fuerza la ingesta de UNA cuenta ML de un
// seller. Existe porque hoy no hay ninguna forma de pedir "trae mis pedidos"
// desde el producto (la única vía era reejecutar un evento a mano en el panel
// de Inngest), y el courier —no solo el seller— opera contra el reloj: el
// despacho arranca a las 16:00 sin excepción.
//
// Esta acción NO trae los pedidos: solo verifica permiso + que la conexión sea
// del tenant de la sesión, y publica `ml/sincronizacion.solicitada`. El
// consumidor real (módulo `integraciones`, construido en paralelo) hace el
// trabajo.
// ---------------------------------------------------------------------------

export type ResultadoSolicitarSincronizacion = { ok: true } | { ok: false; mensaje: string };

/**
 * Pide sincronizar UNA cuenta ML de un seller del tenant. Gate RBAC:
 * `sincronizar_conexiones_ml` — los CUATRO roles internos, `administracion`
 * incluida (decisión del usuario, 2026-08-13). El primer gate fue
 * `asignar_y_reasignar_pedidos`, que dejaba fuera a administración por su
 * "sin reasignación operativa"; pero traer pedidos no asigna a nadie, y sin
 * pedidos ingestados administración no tiene qué facturar ni conciliar.
 */
export async function solicitarSincronizacionMlSeller(
  conexionId: string,
): Promise<ResultadoSolicitarSincronizacion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No hay una sesión activa." };
  }
  if (!puedeSincronizarConexionesMl(sesion.usuario)) {
    return {
      ok: false,
      mensaje: "No tienes permiso para forzar una sincronización — contacta al dueño de la cuenta.",
    };
  }

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  // El filtro por tenant_id es lo que impide operar sobre una conexión de otro
  // courier: service_role salta RLS, así que el aislamiento aquí lo impone
  // esta cláusula — no confiamos en más nada que venga del cliente.
  const { data, error } = await cliente
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select("id, seller_id, tenant_id")
    .eq("id", conexionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      mensaje: "No pudimos pedir la sincronización por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }
  if (!data) {
    return { ok: false, mensaje: "No encontramos esa cuenta de Mercado Libre." };
  }

  // Bitácora ANTES de publicar el evento (mismo patrón que
  // `emitirFacturaPeriodo`/`cerrarPeriodoManualmente`, CLAUDE.md: "Bitácora
  // antes que efectos externos, y con autor"). Si falla, no publicamos: sin
  // registro no hay trazabilidad de quién pidió qué.
  try {
    await registrarEnBitacora(cliente, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "conexion_ml.sincronizacion_solicitada",
      entidadTipo: "conexion_ml",
      entidadId: data.id as string,
      detalle: { seller_id: data.seller_id as string },
    });
  } catch {
    return {
      ok: false,
      mensaje: "No pudimos pedir la sincronización por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  // Por el PUERTO, no con `inngest.send` directo — ver la nota en
  // `portal/actions.ts`: cuando cada pantalla armaba su propia llave de
  // idempotencia, el portal y este panel dejaban de deduplicarse entre sí y
  // apretar en ambos lanzaba dos barridos de la MISMA conexión.
  try {
    await solicitarSincronizacionMl({
      conexionId: data.id as string,
      sellerId: data.seller_id as string,
      tenantId: data.tenant_id as string,
      actorUsuarioId: sesion.usuarioId,
    });
  } catch {
    return {
      ok: false,
      mensaje: "No pudimos pedir la sincronización por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  return { ok: true };
}
