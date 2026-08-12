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
 *      compartido M/N, parametrizable por `modo`). La clasificación usa el
 *      `desenlace` que devuelve el puerto (¿se agregó una cuenta o solo se
 *      revalidó una existente?), NO el `modo` que el seller pidió: son cosas
 *      distintas y tratarlas como una sola producía un "agregaste la cuenta"
 *      falso (ver bloque de comentarios más abajo).
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
import {
  intercambiarCodigoPorTokens,
  ErrorTopeCuentasMlAlcanzado,
  ErrorCuentaMlYaConectada,
} from "@/modules/integraciones/ml";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { esErrorReintentable } from "@/modules/integraciones/resiliencia";
import {
  COOKIE_CONEXION_ML,
  COOKIE_MODO_ML,
  COOKIE_STATE_ML,
  leerModoConexionMl,
  obtenerUrlBasePublica,
  type ModoConexionMl,
  type ResultadoCallbackMl,
} from "@/app/portal/conectar-ml/compartido";

function urlResultado(origin: string, resultado: ResultadoCallbackMl, modo: ModoConexionMl): string {
  const parametros = new URLSearchParams({ resultado, modo });
  return `${origin}/portal/conectar-ml?${parametros.toString()}`;
}

/**
 * Limpia las cookies del flujo OAuth — son de un solo uso, no deben sobrevivir
 * más allá de este intercambio (sea cual sea el desenlace).
 *
 * Incluye `COOKIE_CONEXION_ML`: antes se quedaba viva hasta que `iniciarConexionMl`
 * la pisara en un flujo posterior, así que un "Reconectar" podía dejar su id
 * objetivo colgando y contaminar la evaluación del siguiente intento.
 */
function limpiarCookiesFlujo(respuesta: NextResponse): void {
  respuesta.cookies.delete(COOKIE_STATE_ML);
  respuesta.cookies.delete(COOKIE_MODO_ML);
  respuesta.cookies.delete(COOKIE_CONEXION_ML);
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
  const modo: ModoConexionMl = leerModoConexionMl(modoCookie);
  // Id de la conexión que el seller pidió reconectar. `iniciarConexionMl` solo
  // lo deja tras verificar que la fila es SUYA, así que aquí es de confianza —
  // pero puede faltar (alta/conexión inicial, o si esa verificación falló). Su
  // ausencia no rompe nada: solo impide distinguir "reconectó la que quería" de
  // "reconectó otra de las suyas", y en ese caso se conserva el desenlace previo.
  const conexionObjetivo = almacenCookies.get(COOKIE_CONEXION_ML)?.value ?? null;

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
    // `desenlace` = qué pasó DE VERDAD en `conexiones_seller_ml`: `alta_nueva`
    // (se insertó una cuenta) vs. `conexion_existente_actualizada` (solo se
    // rotaron los tokens de una que ya estaba). Es imprescindible porque ML no
    // admite ningún parámetro de `/authorization` que fuerce el selector de
    // cuenta: con sesión abierta y app ya autorizada, ML devuelve un `code` de
    // la MISMA cuenta sin preguntar nada. Ver `DesenlaceIntercambioMl`.
    const { conexion, desenlace } = await intercambiarCodigoPorTokens({
      tenantId,
      sellerId,
      codigo,
      redirectUri: redirectUriUsado,
    });

    // -------------------------------------------------------------------
    // "Cuenta ya conectada a otro courier": bajo el modelo 1:N la unicidad de
    // `conexiones_seller_ml` es por `(seller_id, ml_user_id)` — NO global —, de
    // modo que la MISMA cuenta ML puede quedar vinculada a sellers de tenants
    // distintos (decisión D2 del diseño). Lo detectamos buscando OTRA fila con
    // el mismo `ml_user_id` que no sea de este seller — requiere `service_role`
    // porque cruza tenants (RLS jamás dejaría ver esa fila ajena, por diseño).
    // Es una ADVERTENCIA (no un bloqueo del esquema): se audita e informa.
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

    // -------------------------------------------------------------------
    // Lo que el seller PIDIÓ vs. lo que REALMENTE pasó.
    //
    // El resultado se decide por `desenlace`, no por `modo`. Confundir ambos
    // es exactamente el bug que se vio en producción: un seller que acababa de
    // reconectar pulsó "Agregar otra cuenta", ML lo devolvió al instante con un
    // `code` de la MISMA cuenta (sesión viva + app autorizada, y ML no ofrece
    // `prompt`/`select_account` ni logout para evitarlo), el puerto hizo UPDATE
    // sin error, y la pantalla le dijo "Agregaste la cuenta correctamente".
    // No había agregado nada.
    // -------------------------------------------------------------------

    // Pidió AGREGAR y la cuenta ya estaba conectada → no se agregó nada. Este
    // es el camino por el que `cuenta_ya_conectada` se alcanza en la práctica:
    // el 23505 del INSERT (la otra vía) solo salta en una carrera, porque el
    // SELECT previo por `(seller_id, ml_user_id)` desvía a UPDATE antes.
    if (modo === "agregar_cuenta" && desenlace === "conexion_existente_actualizada") {
      const respuesta = NextResponse.redirect(urlResultado(origin, "cuenta_ya_conectada", modo));
      limpiarCookiesFlujo(respuesta);
      return respuesta;
    }

    // Pidió RECONECTAR y autorizó con una cuenta distinta, que no tenía fila →
    // no reconectó nada: dio de alta una cuenta nueva, y la conexión que quería
    // arreglar sigue rota. Decirle "¡Listo!" —aunque sea cierto que se agregó
    // algo— lo manda a su portal creyendo que resolvió el problema.
    if (modo === "reconexion" && desenlace === "alta_nueva") {
      const respuesta = NextResponse.redirect(urlResultado(origin, "reconexion_otra_cuenta_nueva", modo));
      limpiarCookiesFlujo(respuesta);
      return respuesta;
    }

    // Pidió RECONECTAR una fila concreta y ML lo devolvió con OTRA de sus
    // cuentas ya conectadas: se renovaron los tokens de esa otra, no los de la
    // que pidió. Es el mismo engaño que el bug original, en su variante más
    // sigilosa — la pantalla decía "Volviste a autorizar el acceso
    // correctamente" y la tarjeta roja seguía roja al volver al portal.
    // Requiere el id objetivo: sin cookie no hay con qué comparar, y entonces
    // no se inventa un diagnóstico (cae al éxito de abajo).
    if (
      modo === "reconexion" &&
      desenlace === "conexion_existente_actualizada" &&
      conexionObjetivo !== null &&
      conexionObjetivo !== conexion.id
    ) {
      const respuesta = NextResponse.redirect(
        urlResultado(origin, "reconexion_otra_cuenta_existente", modo),
      );
      limpiarCookiesFlujo(respuesta);
      return respuesta;
    }

    // Éxito (incluye el caso "code ya canjeado/doble callback": la
    // idempotencia del puerto ya devuelve la conexión existente con
    // `estado_salud: 'sana'` Y el mismo `desenlace` de la primera pasada — el
    // seller no debe notar el reintento interno ni ver dos desenlaces
    // distintos para el mismo clic).
    const respuesta = NextResponse.redirect(urlResultado(origin, "exito", modo));
    limpiarCookiesFlujo(respuesta);
    return respuesta;
  } catch (error) {
    // Reglas del esquema 1:N al conectar una cuenta adicional. No son fallos
    // del sistema ni transitorios: son estados accionables para el seller.
    if (error instanceof ErrorTopeCuentasMlAlcanzado) {
      const respuesta = NextResponse.redirect(urlResultado(origin, "tope_alcanzado", modo));
      limpiarCookiesFlujo(respuesta);
      return respuesta;
    }
    if (error instanceof ErrorCuentaMlYaConectada) {
      const respuesta = NextResponse.redirect(urlResultado(origin, "cuenta_ya_conectada", modo));
      limpiarCookiesFlujo(respuesta);
      return respuesta;
    }

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
