/**
 * Callback PKCE de Supabase Auth — canje de `code` tras Google (F1, login sin
 * contraseña del courier).
 * =============================================================================
 * Distinto de `/auth/confirm` (que canjea `token_hash`+`type` de un enlace de
 * CORREO — la invitación del backstage): este es el retorno de un flujo OAuth
 * de terceros. `@supabase/ssr` usa PKCE por defecto, así que ML... no, aquí es
 * Google el que redirige con `?code=`, y el canje (`exchangeCodeForSession`)
 * tiene que ocurrir en un Route Handler de servidor para poder fijar las
 * cookies de sesión antes de redirigir — mismo criterio que documenta
 * `/auth/confirm`.
 *
 * Sirve a DOS caminos, distinguidos por la presencia de la INTENCIÓN de
 * registro (`src/lib/identidad/intencion-registro.ts`, la cookie que deja el
 * clic en «Continuar con Google» de `/registro`) — nunca por un parámetro que
 * el visitante podría manipular:
 *
 *   - **REGISTRO** (hay intención): este callback ya NO crea el tenant — solo
 *     identifica. Sin perfil → `/registro/empresa` (la intención se conserva: lleva
 *     la evidencia de términos). Con perfil de dueño → se comporta como login. Con
 *     perfil de otro tipo → `correo_ocupado` (H2), ver `buscarPerfilPorAuthUserId`
 *     en `onboarding.ts` para el porqué de esa regla y por qué NO se usa
 *     `buscarCuentaPorEmail`.
 *   - **LOGIN** (sin intención): con perfil, entra. SIN perfil (se identificó y
 *     nunca creó su empresa) → REGRESO AUTOMÁTICO a `/registro/empresa`; ya no se
 *     le cierra la sesión ni se borra la identidad. El mismo regreso lo hacen `/`,
 *     `/login` y los layouts vía `SesionActual.sinPerfil`.
 *
 * H4: `refreshSession()` antes de redirigir cuando hay perfil — si no, el JWT
 * que trae la cookie recién fijada por `exchangeCodeForSession` puede no
 * reflejar aún `tenant_id`/`rol`/`estado_usuario`, y el layout del tenant
 * rebotaría a `/login`.
 *
 * F3 (login sin contraseña, 2026-09) suma una TERCERA rama, ACEPTACIÓN, que se
 * revisa PRIMERO — antes de registro y de login — distinguida por la cookie de
 * `borrador-invitacion.ts` (nunca por un parámetro manipulable): alguien está
 * aceptando una invitación de seller o de equipo interno por Google. El
 * CONDUCTOR no pasa por acá: desde F4 (2026-09-15) se invita por teléfono y
 * entra por WhatsApp OTP desde la app nativa, nunca por este callback; el
 * módulo compartido (`aceptacion-invitacion-passwordless.ts`) bloquea su
 * token tratándolo como "no encontrado".
 *
 * RF-010 rediseño (2026-09-16) suma una CUARTA rama, REGISTRO-SELLER,
 * revisada junto a ACEPTACIÓN (antes de registro/login de courier):
 * distinguida por la cookie de `borrador-registro-seller.ts` — el visitante
 * venía de la landing pública de un enlace permanente de un courier
 * (`/registro-seller/[token]`), que guardó el `tenantId` del enlace ANTES de
 * mandarlo a Google. Tres desenlaces, vía `verificarBarreraAutoRegistroSeller`:
 * (a) identidad bloqueante (conductor/interno/super_admin) → rebota a la
 * landing con error, sin borrar el usuario Auth (identidad legítima
 * preexistente); (b) ya es seller de ESE MISMO courier → idempotente, lo
 * conmuta a ese courier (`cambiarCourierActivo`) y lo manda al portal; (c)
 * barrera OK → arranca el wizard (`borrador-wizard-seller.ts`) y redirige a
 * `/registro-seller/wizard`, donde el commit real ocurre al terminar
 * (`commitAltaSellerAutoservicio`).
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { leerIntencion, limpiarIntencion } from "@/lib/identidad/intencion-registro";
import {
  leerBorrador as leerBorradorInvitacion,
  limpiarBorrador as limpiarBorradorInvitacion,
} from "@/lib/identidad/borrador-invitacion";
import {
  leerBorrador as leerBorradorRegistroSeller,
  limpiarBorrador as limpiarBorradorRegistroSeller,
} from "@/lib/identidad/borrador-registro-seller";
import { guardarBorrador as guardarBorradorWizardSeller } from "@/lib/identidad/borrador-wizard-seller";
import { activarPerfilDueno, buscarPerfilPorAuthUserId } from "@/modules/identidad/onboarding";
import { RUTA_REGISTRO_EMPRESA } from "@/modules/identidad/registro-empresa";
import {
  aplicarAceptacionInvitacionPasswordless,
  buscarInvitacionPorToken,
} from "@/modules/identidad/aceptacion-invitacion-passwordless";
import { verificarBarreraAutoRegistroSeller } from "@/modules/identidad/barrera-auto-registro-seller";
import { cambiarCourierActivo } from "@/modules/identidad/seller-membresias";
import { resolverUrlBaseApp } from "@/modules/identidad/enlace-invitacion";
import { capturarMensaje } from "@/lib/observabilidad";

/**
 * `origin` público a usar en las redirecciones. Detrás de un túnel local
 * (`obtenerUrlBasePublica` es el equivalente que usa el callback de ML), el
 * `origin` de la petición puede ser `localhost` — se prefiere la URL pública
 * declarada (`APP_PUBLIC_URL`/`VERCEL_URL`, ver `enlace-invitacion.ts`) y solo
 * se cae al `origin` de la petición si el entorno no declara ninguna.
 */
function resolverOrigenPublico(origenPeticion: string): string {
  return resolverUrlBaseApp() ?? origenPeticion;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin: origenPeticion } = new URL(request.url);
  const origin = resolverOrigenPublico(origenPeticion);
  const code = searchParams.get("code");

  if (!code) {
    // ML-equivalente de "el visitante canceló/rechazó" — Google no manda
    // `error` de forma tan consistente como ML, así que cualquier llegada sin
    // `code` se trata igual: de vuelta al login, sin canjear nada.
    // Puede ser benigno (el usuario canceló en Google), por eso `warning`.
    await capturarMensaje("Callback OAuth sin `code`", "warning", {
      origen: "auth:callback",
      extra: { fase: "sin_code" },
    });
    return NextResponse.redirect(`${origin}/login?error=oauth_invalido`);
  }

  const supabase = await createClient();
  const { error: errorCanje } = await supabase.auth.exchangeCodeForSession(code);
  if (errorCanje) {
    // ⚠️ INSTRUMENTACIÓN (2026-09-15): el fallo `pkce_code_verifier_not_found`.
    // Se enriquece con el HOST donde corre el callback y los NOMBRES de las
    // cookies `sb-*` presentes (NUNCA sus valores — los nombres no son secretos y
    // `extra` pasa igual por la redacción de PII), más un booleano de si llegó la
    // cookie del `code_verifier`. Con eso se distingue: (a) el callback corre en
    // `www` o en el apex, y (b) si el navegador está mandando o no el verifier —
    // que es lo que decide si el arreglo de dominio de cookie sirvió.
    const nombresCookiesSb = request.cookies
      .getAll()
      .map((c) => c.name)
      .filter((n) => n.startsWith("sb-"));
    await capturarMensaje("Falló exchangeCodeForSession en el callback OAuth", "error", {
      origen: "auth:callback",
      extra: {
        fase: "exchange_code",
        motivo: errorCanje.message,
        codigo_error: errorCanje.code ?? null,
        host: request.headers.get("host"),
        // ⚠️ Estos nombres NO pueden contener «cookie»: el filtro de PII de
        // `redaccion.ts` borra toda clave que lo contenga, y con los nombres
        // viejos (`hay_cookie_verifier`, `cookies_sb`) el diagnóstico llegó a
        // Sentry TACHADO durante 6 días — justo la respuesta que se buscaba.
        // No guardan nada secreto: un sí/no y NOMBRES de cookie, nunca valores.
        llego_verificador_pkce: nombresCookiesSb.some((n) => n.includes("code-verifier")),
        nombres_sb_recibidos: nombresCookiesSb,
      },
    });
    return NextResponse.redirect(`${origin}/login?error=oauth_invalido`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Canje "sin error" pero sesión vacía — no debería pasar; si aparece, es otra
    // forma de la misma carrera de cookies (sesión fijada pero no legible aún).
    await capturarMensaje("Canje OAuth OK pero getUser devolvió null", "error", {
      origen: "auth:callback",
      extra: { fase: "get_user_null" },
    });
    return NextResponse.redirect(`${origin}/login?error=oauth_invalido`);
  }

  const admin = crearClienteServiceRole();

  // ---------------------------------------------------------------------
  // Camino ACEPTACIÓN (F3): hay un borrador de invitación esperando. Va
  // PRIMERO — antes de registro y de login — porque las tres cookies pueden
  // convivir en el mismo navegador y ésta es la más específica.
  // ---------------------------------------------------------------------
  const borradorInvitacion = await leerBorradorInvitacion();
  if (borradorInvitacion) {
    const invitacionToken = borradorInvitacion.token;
    const invitacion = await buscarInvitacionPorToken(admin, invitacionToken);

    if (!invitacion) {
      // Token inexistente, expirado/revocado/ya aceptado, o de un conductor
      // (bloqueado a propósito — ver cabecera). La pantalla pública de la
      // invitación vuelve a resolver el estado real por su cuenta.
      await supabase.auth.signOut();
      await limpiarBorradorInvitacion();
      return NextResponse.redirect(`${origin}/invitacion/${invitacionToken}?error=invitacion_invalida`);
    }

    const emailGoogle = (user.email ?? "").trim().toLowerCase();
    if (emailGoogle !== invitacion.email) {
      // El correo que Google verificó no es el de la invitación — no se
      // acepta en su nombre. NUNCA se borra este usuario Auth: es una
      // identidad Google legítima, solo que no es a quien se invitó.
      await supabase.auth.signOut();
      await limpiarBorradorInvitacion();
      return NextResponse.redirect(`${origin}/invitacion/${invitacionToken}?error=email_no_calza`);
    }

    const nombreCompleto =
      typeof user.user_metadata?.["nombre_completo"] === "string"
        ? (user.user_metadata["nombre_completo"] as string)
        : emailGoogle;

    try {
      const resultado = await aplicarAceptacionInvitacionPasswordless(admin, {
        token: invitacionToken,
        usuarioAuthId: user.id,
        nombreCompleto,
        whatsapp: {
          telefono: borradorInvitacion.telefonoWhatsApp,
          acepta: borradorInvitacion.optInWhatsApp === true,
        },
      });

      await limpiarBorradorInvitacion();
      await supabase.auth.refreshSession();
      return NextResponse.redirect(`${origin}${resultado.destino}`);
    } catch {
      // El correo ya calzaba con una invitación resoluble; si de todos modos
      // falla (expiró/se revocó/se aceptó justo entre medio, o un error de
      // infraestructura), no hay nada mejor que ofrecer que volver a la
      // pantalla pública — ella resuelve el estado real por su cuenta.
      await supabase.auth.signOut();
      await limpiarBorradorInvitacion();
      return NextResponse.redirect(`${origin}/invitacion/${invitacionToken}?error=error_sistema`);
    }
  }

  // ---------------------------------------------------------------------
  // Camino REGISTRO-SELLER (RF-010 rediseño): hay un borrador de
  // "intent=registro-seller" esperando — el visitante venía de la landing
  // pública de un enlace de courier. Va junto a ACEPTACIÓN — antes de
  // REGISTRO/LOGIN de courier — por ser el borrador más específico.
  // ---------------------------------------------------------------------
  const borradorSeller = await leerBorradorRegistroSeller();
  if (borradorSeller) {
    const barrera = await verificarBarreraAutoRegistroSeller(admin, user.id, borradorSeller.tenantId);

    if (!barrera.ok && barrera.motivo === "identidad_no_es_seller") {
      // Esta identidad YA es otra cosa en Rutax (conductor/interno/
      // super_admin) — no se crea un segundo perfil encima. NUNCA se borra:
      // es una identidad Google legítima preexistente.
      await supabase.auth.signOut();
      await limpiarBorradorRegistroSeller();
      return NextResponse.redirect(
        `${origin}/registro-seller/${borradorSeller.enlaceToken}?error=correo_ocupado`,
      );
    }

    if (!barrera.ok && barrera.motivo === "ya_tiene_membresia_en_este_courier") {
      // Idempotencia: ya es seller de ESTE courier (reintento, o volvió a
      // abrir el enlace). Lo dejamos entrar y de paso lo conmutamos a este
      // courier — clickeó el enlace queriendo operar acá.
      try {
        await cambiarCourierActivo(admin, { authUserId: user.id, tenantId: borradorSeller.tenantId });
      } catch {
        // Best-effort: si el switch falla (p. ej. su membresía está
        // bloqueada), igual entra con el courier que tuviera activo — nunca
        // se bloquea un login por esto.
      }
      await limpiarBorradorRegistroSeller();
      await supabase.auth.refreshSession();
      return NextResponse.redirect(`${origin}/portal`);
    }

    // Barrera OK: arranca el wizard. Se inicializa su cookie con el
    // tenantId del enlace (inmutable durante todo el wizard) y se limpia el
    // borrador de intent — de un solo uso.
    await guardarBorradorWizardSeller({ tenantId: borradorSeller.tenantId });
    await limpiarBorradorRegistroSeller();
    return NextResponse.redirect(`${origin}/registro-seller/wizard`);
  }

  const perfilExistente = await buscarPerfilPorAuthUserId(admin, user.id);
  const intencion = await leerIntencion();

  // ---------------------------------------------------------------------
  // Camino REGISTRO: hay una intención de registro (la persona pulsó
  // «Continuar con Google» en /registro). Este callback ya NO crea nada: solo
  // identifica. La empresa se crea en /registro/empresa, con la sesión viva.
  // ---------------------------------------------------------------------
  if (intencion) {
    if (!perfilExistente) {
      // Identificada y sin empresa. La intención SE CONSERVA: lleva la evidencia
      // de qué aviso de términos vio, y la consume la acción de /registro/empresa.
      return NextResponse.redirect(`${origin}${RUTA_REGISTRO_EMPRESA}`);
    }

    if (perfilExistente.tipoUsuario === "interno" && perfilExistente.rol === "dueno") {
      // Ya era dueño: era un login, no un registro. Se comporta como tal (abajo
      // se activa si sigue `invitado`). La intención ya no aplica.
      await limpiarIntencion();
    } else {
      // H2 — un correo, una cuenta: este correo YA es otra cosa en Rutax
      // (seller, conductor, o miembro de equipo de otro courier). No se crea un
      // segundo perfil encima; nunca se borra este usuario Auth (es una
      // identidad legítima preexistente, no algo que este canje haya creado).
      await supabase.auth.signOut();
      await limpiarIntencion();
      return NextResponse.redirect(`${origin}/registro?error=correo_ocupado`);
    }
  }

  // ---------------------------------------------------------------------
  // Camino LOGIN (o dueño que pulsó «registrarse»).
  // ---------------------------------------------------------------------
  if (!perfilExistente) {
    // REGRESO AUTOMÁTICO: Google resolvió una identidad que se identificó pero
    // nunca creó su empresa (cerró la pestaña en «Tu empresa» y hoy vuelve por
    // /login). Antes se la cerraba y se la borraba por huérfana; ahora se la
    // devuelve donde se quedó. No hay bucle: /registro/empresa solo manda a otro
    // lado a quien YA tiene perfil, y acá no lo tiene.
    return NextResponse.redirect(`${origin}${RUTA_REGISTRO_EMPRESA}`);
  }

  // Caso borde real (ver el comentario de `buscarPerfilPorAuthUserId`): un
  // dueño invitado por el backstage que entra por Google ANTES de aceptar
  // nunca el enlace de correo. Confirmar su identidad acá es, como mínimo,
  // tan fuerte como clickear ese enlace — se activa en el mismo paso, en vez
  // de dejarlo entrar con `estado: invitado` y que el layout del tenant lo
  // atrape en un bucle (`/login` → `/` → `/dashboard` → `/login`, porque
  // `/login` manda a `/` a cualquiera con `tenantId`, sin mirar `estado`).
  if (perfilExistente.estado === "invitado") {
    await activarPerfilDueno(admin, user.id);
  }

  await supabase.auth.refreshSession();
  return NextResponse.redirect(`${origin}/`);
}
