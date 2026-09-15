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
 * Sirve a DOS caminos, distinguidos por la presencia del borrador de registro
 * (`src/lib/identidad/borrador-registro.ts`) — nunca por un parámetro que el
 * visitante podría manipular:
 *
 *   - **REGISTRO** (hay borrador): recién se está creando el tenant. Si la
 *     identidad Auth resuelta por Google no tiene perfil todavía, se provisiona
 *     (`provisionarTenantParaAuthUser`, `estado:'activo'` — no hay contraseña
 *     que definir). Si YA tiene perfil, hay que decidir si es un reintento del
 *     mismo registro (H5) o un correo que ya es otra cosa en Rutax (H2) — ver
 *     `buscarPerfilPorAuthUserId` en `onboarding.ts` para el porqué de esa
 *     regla y por qué NO se usa `buscarCuentaPorEmail` para esto.
 *   - **LOGIN** (sin borrador): se EXIGE que la identidad ya tenga perfil. Si
 *     Google resolvió (o creó) un usuario Auth sin perfil de dominio, no hay
 *     cuenta que abrir — se cierra sesión y se limpia el huérfano.
 *
 * H4 en los dos caminos: `refreshSession()` antes de redirigir — si no, el JWT
 * que trae la cookie recién fijada por `exchangeCodeForSession` puede no
 * reflejar aún `tenant_id`/`rol`/`estado_usuario` (el perfil se escribió DESPUÉS
 * de que la sesión existiera), y el layout del tenant rebotaría a `/login`.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { leerBorrador, limpiarBorrador } from "@/lib/identidad/borrador-registro";
import {
  activarPerfilDueno,
  buscarPerfilPorAuthUserId,
  provisionarTenantParaAuthUser,
} from "@/modules/identidad/onboarding";
import { ErrorConflicto } from "@/modules/identidad/errores";
import { resolverUrlBaseApp } from "@/modules/identidad/enlace-invitacion";

/** Umbral para considerar que un usuario Auth es "recién creado por este canje". */
const UMBRAL_IDENTIDAD_RECIEN_CREADA_MS = 60_000;

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

/**
 * ¿Es razonable asumir que ESTE canje creó el usuario Auth recién, en vez de
 * haber resuelto uno preexistente? Supabase no expone "lo creaste tú en esta
 * llamada" de forma directa — se aproxima comparando `created_at` con
 * `last_sign_in_at`: si están a segundos de distancia, es el primer inicio de
 * sesión de toda la vida de la cuenta, que es justo lo que pasa cuando el
 * propio intercambio OAuth de hace un instante creó la fila.
 *
 * Se usa SOLO para decidir si compensar (borrar) un usuario Auth cuando la
 * provisión de REGISTRO falla — nunca para el camino de login, donde "sin
 * perfil" ya es señal suficiente por sí sola (ver más abajo).
 */
function esIdentidadAuthReciente(user: { created_at: string; last_sign_in_at?: string | null }): boolean {
  const creado = new Date(user.created_at).getTime();
  const ultimoIngreso = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : creado;
  return Math.abs(ultimoIngreso - creado) < UMBRAL_IDENTIDAD_RECIEN_CREADA_MS;
}

async function borrarUsuarioAuthHuerfano(authUserId: string): Promise<void> {
  try {
    await crearClienteServiceRole().auth.admin.deleteUser(authUserId);
  } catch {
    // Best-effort: si falla, queda un usuario Auth sin perfil que requiere
    // limpieza manual — nunca un tenant/perfil a medio crear, que es lo que
    // de verdad importa evitar.
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin: origenPeticion } = new URL(request.url);
  const origin = resolverOrigenPublico(origenPeticion);
  const code = searchParams.get("code");

  if (!code) {
    // ML-equivalente de "el visitante canceló/rechazó" — Google no manda
    // `error` de forma tan consistente como ML, así que cualquier llegada sin
    // `code` se trata igual: de vuelta al login, sin canjear nada.
    return NextResponse.redirect(`${origin}/login?error=oauth_invalido`);
  }

  const supabase = await createClient();
  const { error: errorCanje } = await supabase.auth.exchangeCodeForSession(code);
  if (errorCanje) {
    return NextResponse.redirect(`${origin}/login?error=oauth_invalido`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=oauth_invalido`);
  }

  const admin = crearClienteServiceRole();
  const perfilExistente = await buscarPerfilPorAuthUserId(admin, user.id);
  const borrador = await leerBorrador();

  // ---------------------------------------------------------------------
  // Camino REGISTRO: hay un borrador de alta de empresa esperando.
  // ---------------------------------------------------------------------
  if (borrador) {
    if (perfilExistente) {
      if (perfilExistente.tipoUsuario === "interno" && perfilExistente.rol === "dueno") {
        // H5 — idempotencia: reintento del mismo registro (doble pestaña,
        // doble clic sobre "Continuar con Google"). No se provisiona de nuevo.
        // Defensa adicional (caso de borde, ver `buscarPerfilPorAuthUserId`):
        // si por lo que sea este perfil sigue `invitado` (p. ej. colisiona con
        // una invitación del backstage a la misma persona), se activa igual —
        // nunca se deja una sesión con `estado: invitado` camino al layout.
        if (perfilExistente.estado === "invitado") {
          await activarPerfilDueno(admin, user.id);
        }
        await limpiarBorrador();
        await supabase.auth.refreshSession();
        return NextResponse.redirect(`${origin}/`);
      }

      // H2 — un correo, una cuenta: este correo YA es otra cosa en Rutax
      // (seller, conductor, o miembro de equipo de otro courier). No se crea
      // un segundo perfil encima; nunca se borra este usuario Auth (es una
      // identidad legítima preexistente, no algo que este canje haya creado).
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/registro?error=correo_ocupado`);
    }

    try {
      await provisionarTenantParaAuthUser(
        admin,
        user.id,
        {
          tenant: {
            nombreFantasia: borrador.nombreFantasia,
            razonSocial: borrador.razonSocial,
            rut: borrador.rut,
          },
          dueno: { email: borrador.emailDueno, nombreCompleto: borrador.nombreDueno },
          actor: { usuarioId: null, tipo: "sistema" },
        },
        { estado: "activo", compensarAuthUser: false },
      );
    } catch (err) {
      await supabase.auth.signOut();
      // H3: solo se borra el usuario Auth si TODO indica que este mismo canje
      // lo creó recién — nunca si pudo existir de antes (ver
      // `esIdentidadAuthReciente`). Dejarlo vivo en el caso ambiguo es el
      // mismo criterio que "cuentas huérfanas sin perfil" del backstage
      // (`/admin/cuentas`, marca `sin_perfil`): se puede limpiar a mano, y es
      // preferible a borrar una identidad que no era nuestra.
      if (esIdentidadAuthReciente(user)) {
        await borrarUsuarioAuthHuerfano(user.id);
      }
      const tipo = err instanceof ErrorConflicto && /rut/i.test(err.message) ? "conflicto_rut" : "error_sistema";
      return NextResponse.redirect(`${origin}/registro?error=${tipo}`);
    }

    await limpiarBorrador();
    // H4 — refrescar el JWT para que tenant_id/rol/estado lleguen de inmediato.
    await supabase.auth.refreshSession();
    return NextResponse.redirect(`${origin}/`);
  }

  // ---------------------------------------------------------------------
  // Camino LOGIN: sin borrador, se EXIGE un perfil ya existente.
  // ---------------------------------------------------------------------
  if (!perfilExistente) {
    // Google resolvió (o creó) una identidad sin cuenta de dominio en Rutax:
    // no hay a dónde entrar. A diferencia del caso de registro, acá "sin
    // perfil" ya es señal suficiente por sí sola — este canje es el ÚNICO
    // motivo por el que existiría esa fila de Auth en este momento (un login
    // nunca trae borrador ni ninguna otra razón legítima para que Google haya
    // creado o resuelto esa identidad), así que se borra sin la comprobación
    // adicional de "reciente" que sí hace falta en el camino de registro.
    await supabase.auth.signOut();
    await borrarUsuarioAuthHuerfano(user.id);
    return NextResponse.redirect(`${origin}/login?error=sin_cuenta`);
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
