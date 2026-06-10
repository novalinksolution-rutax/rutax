/**
 * Route Handler — callback OAuth de Mercado Libre (Pantalla N, §3.2/§3.3).
 *
 * ML redirige aquí con `code`+`state` (éxito de su lado) o con `error` (el
 * seller canceló/rechazó). Esta ruta:
 *   1. Valida el `state` anti-CSRF contra la cookie que `iniciarConexionMl`
 *      dejó (mismo mecanismo documentado en `tipos.ts`: el llamador genera Y
 *      valida el `state` — el puerto no lo hace).
 *   2. Canjea el `code` por tokens vía `intercambiarCodigoPorTokens` (puerto
 *      YA existente — ninguna llamada directa a la API de ML desde aquí).
 *   3. Clasifica el resultado en una de las ramificaciones de la tabla §3.2 y
 *      redirige a `/portal/conectar-ml?resultado=...` — la página renderiza
 *      el contenido de la Pantalla N según ese parámetro (componente
 *      compartido M/N, parametrizable por `modo`).
 *
 * Por qué un redirect con query param y no renderizar aquí mismo: este es un
 * Route Handler (no puede devolver JSX), y la Pantalla N comparte estructura
 * con la M — vive en `/portal/conectar-ml` como un único componente
 * parametrizable (criterio de §3.3). El query param es deliberadamente
 * acotado a un código de resultado — nunca lleva tokens, ids internos
 * sensibles, ni nada que merezca cifrado.
 */

import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarConexionMlPropia } from "@/modules/identidad/capacidades";
import { intercambiarCodigoPorTokens } from "@/modules/integraciones/ml";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { esErrorReintentable } from "@/modules/integraciones/resiliencia";
import {
  COOKIE_MODO_ML,
  COOKIE_STATE_ML,
  obtenerUrlBasePublica,
  type ModoConexionMl,
  type ResultadoCallbackMl,
} from "@/app/portal/conectar-ml/compartido";

function urlResultado(origin: string, resultado: ResultadoCallbackMl, modo: ModoConexionMl): string {
  const parametros = new URLSearchParams({ resultado, modo });
  return `${origin}/portal/conectar-ml?${parametros.toString()}`;
}

/**
 * Limpia las cookies de `state`/`modo` del flujo OAuth — son de un solo uso,
 * no deben sobrevivir más allá de este intercambio (sea cual sea el desenlace).
 */
function limpiarCookiesFlujo(respuesta: NextResponse): void {
  respuesta.cookies.delete(COOKIE_STATE_ML);
  respuesta.cookies.delete(COOKIE_MODO_ML);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin: originPeticion } = new URL(request.url);
  // URL base pública canónica: detrás de un túnel, `originPeticion` es
  // `localhost`; el `redirect_uri` del canje y las redirecciones deben usar el
  // dominio público (el mismo registrado en ML) para no romper el OAuth ni
  // perder las cookies de sesión al saltar de dominio.
  const origin = obtenerUrlBasePublica(originPeticion);

  const almacenCookies = await cookies();
  const stateCookie = almacenCookies.get(COOKIE_STATE_ML)?.value ?? null;
  const modoCookie = almacenCookies.get(COOKIE_MODO_ML)?.value ?? null;
  const modo: ModoConexionMl = modoCookie === "reconexion" ? "reconexion" : "conexion_inicial";

  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    // Sesión perdida durante la redirección externa (p. ej. expiró). No es
    // "tu culpa ni de ML" — es un problema de continuidad de sesión; lo más
    // claro es pedir que vuelva a entrar y reintente desde el portal.
    const respuesta = NextResponse.redirect(`${origin}/login`);
    limpiarCookiesFlujo(respuesta);
    return respuesta;
  }
  if (!puedeGestionarConexionMlPropia(sesion.usuario)) {
    const respuesta = NextResponse.redirect(`${origin}/portal`);
    limpiarCookiesFlujo(respuesta);
    return respuesta;
  }

  const tenantId = sesion.usuario.tenantId;
  const sellerId = sesion.usuario.sellerId;

  // ---------------------------------------------------------------------
  // Caso: el seller canceló/rechazó la autorización en ML — ML redirige con
  // `error` (típicamente `error=access_denied`) y sin `code`.
  // ---------------------------------------------------------------------
  const errorMl = searchParams.get("error");
  const codigo = searchParams.get("code");
  const stateRecibido = searchParams.get("state");

  if (errorMl || !codigo) {
    const respuesta = NextResponse.redirect(urlResultado(origin, "cancelado", modo));
    limpiarCookiesFlujo(respuesta);
    return respuesta;
  }

  // ---------------------------------------------------------------------
  // Validación del `state` anti-CSRF — responsabilidad explícita del
  // llamador (ver `tipos.ts`). Si no calza, no canjeamos el código: alguien
  // pudo forjar este callback (o la cookie expiró/el seller usó otra
  // pestaña). Se trata como conflicto de continuidad, no como "tu culpa".
  // ---------------------------------------------------------------------
  if (!stateCookie || !stateRecibido || stateCookie !== stateRecibido) {
    const respuesta = NextResponse.redirect(urlResultado(origin, "estado_invalido", modo));
    limpiarCookiesFlujo(respuesta);
    return respuesta;
  }

  const redirectUriUsado = `${origin}/oauth/ml/callback`;

  try {
    const conexion = await intercambiarCodigoPorTokens({
      tenantId,
      sellerId,
      codigo,
      redirectUri: redirectUriUsado,
    });

    // -------------------------------------------------------------------
    // "Cuenta ya conectada a otro courier": la unicidad de
    // `conexiones_seller_ml` es por `seller_id` (no por `ml_user_id`) — dos
    // sellers (de tenants distintos) podrían terminar apuntando al mismo
    // `ml_user_id`. Lo detectamos buscando OTRA fila con el mismo
    // `ml_user_id` que no sea la de este seller — requiere `service_role`
    // porque cruza tenants (RLS jamás dejaría ver esa fila ajena, por diseño).
    // -------------------------------------------------------------------
    if (conexion.mlUserId) {
      const colision = await buscarColisionMlUserId(conexion.mlUserId, sellerId);
      if (colision) {
        await auditarColision(tenantId, sesion.usuarioId, sellerId, conexion.mlUserId);
        const respuesta = NextResponse.redirect(urlResultado(origin, "cuenta_en_otro_courier", modo));
        limpiarCookiesFlujo(respuesta);
        return respuesta;
      }
    }

    // -------------------------------------------------------------------
    // "Cuenta colaborador": el adaptador no tiene (todavía) una señal
    // estructurada y confirmada de ML para este caso — la tabla §3.2 lo
    // marca explícitamente como condicional ("si ML lo señala
    // explícitamente"). No inventamos una detección que el puerto no ofrece;
    // solo reaccionamos si `ultimoError` trae un marcador reconocible que
    // `integraciones` deje ahí en el futuro. Mientras eso no exista, este
    // bloque queda como no-op documentado — el caso "éxito" de abajo cubre
    // el resto.
    // -------------------------------------------------------------------
    if (conexion.ultimoError && /colaborador|operador|collaborator/i.test(conexion.ultimoError)) {
      const respuesta = NextResponse.redirect(urlResultado(origin, "cuenta_colaborador", modo));
      limpiarCookiesFlujo(respuesta);
      return respuesta;
    }

    // Éxito (incluye el caso "code ya canjeado/doble callback": la
    // idempotencia del puerto ya devuelve la conexión existente con
    // `estado_salud: 'sana'` — el seller no debe notar el reintento interno).
    const respuesta = NextResponse.redirect(urlResultado(origin, "exito", modo));
    limpiarCookiesFlujo(respuesta);
    return respuesta;
  } catch (error) {
    if (esErrorReintentable(error)) {
      const respuesta = NextResponse.redirect(urlResultado(origin, "error_transitorio", modo));
      limpiarCookiesFlujo(respuesta);
      return respuesta;
    }

    // Cualquier otro fallo (credenciales de la app, error inesperado): no es
    // culpa del seller ni "de ML" en el sentido que el seller pueda resolver
    // — es nuestro sistema. Se audita para que `integraciones`/`devops` lo
    // investiguen, sin filtrar detalles técnicos al seller.
    await auditarFalloSistema(tenantId, sesion.usuarioId, sellerId, error);
    const respuesta = NextResponse.redirect(urlResultado(origin, "error_sistema", modo));
    limpiarCookiesFlujo(respuesta);
    return respuesta;
  }
}

async function buscarColisionMlUserId(mlUserId: string, sellerIdPropio: string): Promise<boolean> {
  const cliente = crearClienteServiceRole();
  const { data, error } = await cliente
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select("seller_id")
    .eq("ml_user_id", mlUserId)
    .neq("seller_id", sellerIdPropio)
    .limit(1)
    .maybeSingle();

  if (error) {
    // No bloqueamos el flujo por un fallo de esta verificación secundaria —
    // mejor dejar pasar como éxito (el caso común) que bloquear una conexión
    // legítima por un error de lectura. Queda para que el sondeo de salud de
    // Fase B lo detecte si de verdad hay colisión.
    return false;
  }
  return Boolean(data);
}

async function auditarColision(
  tenantId: string,
  actorUsuarioId: string,
  sellerId: string,
  mlUserId: string,
): Promise<void> {
  const cliente = crearClienteServiceRole();
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "conexion_ml.colision_detectada",
    entidadTipo: "seller",
    entidadId: sellerId,
    detalle: { ml_user_id: mlUserId },
  });
}

async function auditarFalloSistema(
  tenantId: string,
  actorUsuarioId: string,
  sellerId: string,
  error: unknown,
): Promise<void> {
  const cliente = crearClienteServiceRole();
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "conexion_ml.error_callback",
    entidadTipo: "seller",
    entidadId: sellerId,
    detalle: { mensaje: error instanceof Error ? error.message : "Error desconocido" },
  });
}
