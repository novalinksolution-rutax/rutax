/**
 * Onboarding del courier — alta de tenant (RF-006).
 *
 * Contrato (§11 regla 1 del documento de arquitectura): nadie fuera de
 * `identidad` escribe en `tenants`/`usuarios_perfil`/`bitacora_auditoria`
 * directamente. Esta función es la ÚNICA puerta para crear un tenant nuevo
 * junto con su primer usuario `dueno`, y usa `service_role` (bypass deliberado
 * y controlado de RLS — nunca un atajo general) porque:
 *   - en el momento de la creación no existe todavía un `tenant_id` en los
 *     claims del usuario que la ejecuta (si la ejecuta el propio fundador como
 *     `super_admin`, ese rol no tiene `tenant_id`; si es autoservicio, el
 *     usuario recién se está provisionando), y
 *   - las políticas RLS de `tenants`/`usuarios_perfil` no permiten INSERT a
 *     `authenticated` por diseño (ver migración 0001 §8) — exactamente para
 *     forzar que el alta pase por aquí, auditada.
 *
 * Esta operación es de request/respuesta (no un job en segundo plano): es una
 * acción puntual de onboarding, no un proceso pesado recurrente — coherente
 * con la nota de "no sobre-diseñes con colas" del enunciado.
 *
 * El cliente `service_role` se recibe POR PARÁMETRO (inyección de
 * dependencias): en producción constrúyelo con `crearClienteServiceRole()` de
 * `@/lib/supabase/service-role` (nunca lo expongas al navegador); en pruebas,
 * pásale un doble — ver `onboarding.test.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarEnBitacora } from "./auditoria";
import { AREAS_PRODUCTO } from "./areas-producto";
import { resolverUrlBaseApp } from "./enlace-invitacion";
import { ErrorConflicto, ErrorValidacion } from "./errores";
import { normalizarYValidarRut } from "./rut";

/**
 * Ruta (relativa) a la que aterriza el dueño invitado por el backstage tras
 * aceptar su enlace, vía `/auth/confirm` (ver ese route handler).
 *
 * F1 (login sin contraseña, 2026-09) retiró `/activar-cuenta`: ya no hay
 * contraseña que definir, así que no queda ninguna acción del usuario entre
 * "aceptó el enlace" y "puede entrar" — `/auth/confirm` activa el perfil
 * (`activarPerfilDueno`) y manda derecho al panel. `/dashboard` y no `/`
 * porque el enlace lo abre específicamente EL DUEÑO (el único perfil que
 * `crearTenantConDueno` crea) y ese es su destino fijo; la raíz igual lo
 * mandaría ahí, pero un salto de menos es un salto de menos.
 *
 * Renombrada de `RUTA_ACTIVACION_CUENTA` (F1): el nombre viejo ya mentía en
 * cuanto el valor pasó a ser `/dashboard` — no hay "activación de cuenta" que
 * mostrar, solo un destino tras el enlace.
 */
export const RUTA_DESTINO_INVITACION_DUENO = "/dashboard";

/**
 * `redirectTo` para `auth.admin.inviteUserByEmail`.
 *
 * Sin este parámetro, el enlace del correo depende POR COMPLETO de que la
 * plantilla de invitación de Supabase esté personalizada (con
 * `{{ .TokenHash }}` + `{{ .RedirectTo }}` apuntando a `/auth/confirm`, que lee
 * `token_hash` del QUERY STRING — ver `src/app/auth/confirm/route.ts`). Si
 * alguien resetea las plantillas al default de Supabase
 * (`{{ .ConfirmationURL }}`, flujo implícito con los tokens en el FRAGMENTO de
 * la URL), el dueño aterriza en la raíz del sitio en vez de en su panel y el
 * alta se rompe en silencio.
 *
 * Reutiliza `resolverUrlBaseApp()` — la misma fuente de verdad que ya usa el
 * correo de invitaciones de equipo/seller/conductor (ver `enlace-invitacion.ts`
 * y su precedencia `APP_PUBLIC_URL` → `APP_BASE_URL` → `NEXT_PUBLIC_APP_URL` →
 * `VERCEL_URL`), para no inventar una segunda forma de construir la URL
 * pública. Devuelve `undefined` (no `null`, no `""`) cuando el entorno no
 * declara ninguna URL — así el SDK simplemente omite el parámetro en vez de
 * recibir un enlace muerto.
 */
export function resolverRedirectToActivacionCuenta(): string | undefined {
  const urlBase = resolverUrlBaseApp();
  return urlBase ? `${urlBase}${RUTA_DESTINO_INVITACION_DUENO}` : undefined;
}

export interface DatosTenant {
  nombreFantasia: string;
  /**
   * Razón social. OPCIONAL desde 2026-08-30: el alta por correo del backstage
   * no la conoce y la deja en NULL; el dueño la completa en su puesta en marcha.
   * Desde el rediseño de onboarding (doc §6, 2026-09) el autoservicio de
   * `/registro` TAMPOCO la pide — arranque mínimo (nombre de fantasía + RUT) y
   * la razón social se difiere al hub de onboarding, igual que el backstage.
   */
  razonSocial?: string;
  /**
   * RUT del courier — formato `NNNNNNNN-DV`; se normaliza y valida (módulo 11)
   * antes de persistir. OPCIONAL, misma razón que `razonSocial`.
   */
  rut?: string;
  /** Default `America/Santiago` — Localización Chile (CLAUDE.md). Casi nunca debería variar en el MVP. */
  zonaHoraria?: string;
}

export interface DatosDueno {
  email: string;
  nombreCompleto: string;
}

export interface CrearTenantConDuenoInput {
  tenant: DatosTenant;
  dueno: DatosDueno;
  /**
   * Quién ejecuta el alta, para la bitácora. `null` cuando es autoservicio
   * (el propio interesado se da de alta) — en ese caso `actorTipo` debe ser
   * `'sistema'` o, si lo opera el fundador, `'super_admin'` con su uuid.
   */
  actor: { usuarioId: string | null; tipo: "super_admin" | "sistema" };
}

export interface CrearTenantConDuenoResultado {
  tenantId: string;
  duenoUsuarioId: string;
}

/**
 * Forma mínima del cliente service_role que esta función necesita — facilita
 * pruebas con dobles.
 *
 * ⚠️ Se enumeran los métodos en vez de escribir `SupabaseClient` a secas. No es
 * estilo: tiparlo como `SupabaseClient` hace que `ClienteServicio` deje de
 * calzar con lo que devuelve `crearClienteServiceRole()` y **tumba el build de
 * producción sin que el typecheck ni las pruebas lo noten** (mordió el
 * 2026-08-25, commit `5f5044f`). `schema` se sumó para encender las áreas de
 * producto, que viven en `plataforma`.
 *
 * Exportado (F1): `/auth/callback` (Google) y `registro/actions.ts` (código
 * OTP) también provisionan tenants — con el mismo cliente `service_role` y el
 * mismo molde de tipo, para no reintroducir el bug de arriba en un caller nuevo.
 */
export type ClienteServicio = Pick<SupabaseClient, "auth" | "from" | "schema">;

function validarEntrada(input: CrearTenantConDuenoInput): { rutNormalizado: string | null } {
  const { tenant, dueno } = input;

  if (!tenant.nombreFantasia.trim()) {
    throw new ErrorValidacion("El nombre de fantasía del courier es obligatorio.");
  }

  // Razón social y RUT son OPCIONALES (alta por correo del backstage: los pone
  // el dueño después). PERO si vienen, se validan igual que siempre: aceptar un
  // RUT inválido «porque es opcional» dejaría pasar basura por la puerta que sí
  // los trae (el autoservicio de `/registro`).
  if (tenant.razonSocial !== undefined && !tenant.razonSocial.trim()) {
    // Distinto de «no vino»: vino vacío, que es un error del formulario que sí
    // lo pide.
    throw new ErrorValidacion("La razón social del courier no puede ir en blanco.");
  }

  let rutNormalizado: string | null = null;
  if (tenant.rut !== undefined && tenant.rut.trim() !== "") {
    rutNormalizado = normalizarYValidarRut(tenant.rut);
    if (!rutNormalizado) {
      throw new ErrorValidacion(
        "El RUT del courier no es válido (formato esperado NNNNNNNN-DV con dígito verificador correcto).",
      );
    }
  }

  if (!dueno.email.trim() || !dueno.email.includes("@")) {
    throw new ErrorValidacion("El email del dueño es obligatorio y debe ser un correo válido.");
  }
  if (!dueno.nombreCompleto.trim()) {
    throw new ErrorValidacion("El nombre completo del dueño es obligatorio.");
  }

  return { rutNormalizado };
}

/**
 * Opciones de {@link provisionarTenantParaAuthUser} — lo que distingue AL MISMO
 * paso de provisión entre las dos puertas de entrada que existen hoy (F1):
 *
 *   - **Backstage** (`crearTenantConDueno`, invitación por Auth): el usuario
 *     Auth lo creamos NOSOTROS un instante antes (`inviteUserByEmail`), así
 *     que es "nuestro" — si algo falla después, lo compensamos borrándolo.
 *     Nace `estado: 'invitado'`: falta que acepte el enlace y actives el
 *     perfil (`activarPerfilDueno`, en `/auth/confirm`).
 *   - **Autoservicio** (`/registro`, vía Google o código OTP): el usuario Auth
 *     YA EXISTE cuando se llega aquí — lo resolvió Google o `verifyOtp` antes
 *     de que este módulo se entere. Esa identidad es del usuario (o de
 *     Google), nunca la borramos si la provisión falla; la política de
 *     compensación de un auth user recién creado por ESE canje vive en el
 *     LLAMADOR (`/auth/callback`, `registro/actions.ts`), que es quien sabe
 *     si lo acaba de crear. Nace `estado: 'activo'`: no hay paso de activación
 *     pendiente porque no hay contraseña que definir.
 */
export interface ProvisionarTenantOpciones {
  estado: "invitado" | "activo";
  /**
   * Si la provisión falla a medio camino, ¿hay que borrar también el usuario
   * Auth como parte de la compensación? `true` únicamente cuando ESTA MISMA
   * función lo creó indirectamente a través de un flujo que es dueño de esa
   * identidad (el backstage, vía `inviteUserByEmail`). En autoservicio va
   * `false` siempre — ver nota de arriba.
   */
  compensarAuthUser: boolean;
}

/**
 * Provisiona tenant + perfil `dueno` + áreas de producto + bitácora para un
 * usuario Auth QUE YA EXISTE (`authUserId`) — la mitad de `crearTenantConDueno`
 * que no depende de CÓMO se resolvió esa identidad (invitación por correo,
 * Google, o código OTP). Ver `ProvisionarTenantOpciones` para las dos
 * variantes de hoy.
 *
 * Pasos, con compensación best-effort si algo falla a medio camino (no hay
 * transacción cross-resource entre Auth y Postgres):
 *   1. Valida datos (incluye RUT con dígito verificador).
 *   2. Inserta la fila en `tenants` (`estado = 'onboarding'`).
 *   3. Inserta el perfil en `usuarios_perfil` (`tipo_usuario = 'interno'`,
 *      `rol = 'dueno'`, `estado` según `opciones.estado`).
 *   4. Enciende las cinco áreas de producto.
 *   5. Registra `tenant.alta` en la bitácora (tenant_id ya conocido).
 *
 * Lanza `ErrorValidacion`/`ErrorConflicto` para fallas esperables (datos
 * inválidos, RUT duplicado) y `Error` genérico para fallas de infraestructura.
 */
export async function provisionarTenantParaAuthUser(
  cliente: ClienteServicio,
  authUserId: string,
  input: CrearTenantConDuenoInput,
  opciones: ProvisionarTenantOpciones,
): Promise<CrearTenantConDuenoResultado> {
  const { rutNormalizado } = validarEntrada(input);
  const zonaHoraria = input.tenant.zonaHoraria?.trim() || "America/Santiago";

  // --- 1. Fila en tenants -----------------------------------------------------
  const { data: tenantRow, error: tenantError } = await cliente
    .from("tenants")
    .insert({
      nombre_fantasia: input.tenant.nombreFantasia.trim(),
      // `null` cuando el alta por correo no los trae — el dueño los completa en
      // su puesta en marcha. Nunca cadena vacía: la columna distingue «no puesto
      // todavía» (NULL, y el bloqueo operativo lo exige) de un dato real.
      razon_social: input.tenant.razonSocial?.trim() || null,
      rut: rutNormalizado,
      estado: "onboarding",
      zona_horaria: zonaHoraria,
    })
    .select("id")
    .single();

  if (tenantError || !tenantRow) {
    if (opciones.compensarAuthUser) await deshacerUsuarioAuth(cliente, authUserId);
    if (esErrorDeRutDuplicado(tenantError)) {
      throw new ErrorConflicto(`Ya existe un courier registrado con el RUT ${rutNormalizado}.`);
    }
    throw new Error(`No se pudo crear el tenant: ${tenantError?.message ?? "desconocido"}`);
  }

  const tenantId = tenantRow.id as string;

  // --- 2. Perfil de dominio (usuarios_perfil) ---------------------------------
  // tipo_usuario='interno' + rol='dueno': consistente con el constraint
  // usuarios_perfil_rol_coherente_con_tipo. `estado` viene de `opciones` —
  // 'invitado' en el backstage (falta activar), 'activo' en autoservicio (no
  // hay paso de activación: no hay contraseña que definir).
  const { error: perfilError } = await cliente.from("usuarios_perfil").insert({
    id: authUserId,
    tenant_id: tenantId,
    nombre_completo: input.dueno.nombreCompleto.trim(),
    tipo_usuario: "interno",
    rol: "dueno",
    estado: opciones.estado,
  });

  if (perfilError) {
    await deshacerTenant(cliente, tenantId);
    if (opciones.compensarAuthUser) await deshacerUsuarioAuth(cliente, authUserId);
    throw new Error(`No se pudo crear el perfil del dueño: ${perfilError.message}`);
  }

  // --- 3. Áreas de producto: el courier nace con las cinco ENCENDIDAS ----------
  // 🔴 Decisión del usuario (2026-08-28): «que nazcan encendidos, yo apago
  // cuando esté listo». El modelo de `plataforma.areas_habilitadas` es «la fila
  // significa encendida, la ausencia es apagada», así que un tenant sin filas
  // no tiene NADA encendido — que es exactamente lo contrario.
  //
  // No es cosmético: `folios_caf` gatea `gestionar_configuracion_dte`, y el
  // paso DTE es uno de los CUATRO que bloquean operar (`resolverBloqueoOperativo`).
  // Un courier nacido sin áreas no puede terminar su puesta en marcha, y la
  // única salida es que alguien de Rutax se lo encienda a mano.
  //
  // ⚠️ Va acá dentro y no en el llamador. El alta tiene hoy TRES puertas —el
  // backstage y, desde F1, Google/código en `/registro`— y encender las áreas
  // fuera obligaría a las tres a acordarse: la que se olvidara crearía couriers
  // inoperables en silencio. Esta función ya es el ÚNICO punto que crea un
  // tenant nuevo; que también sea el único que lo deja utilizable.
  //
  // ⚠️ La lista sale de `AREAS_PRODUCTO`, que es el catálogo del código. No se
  // escribe a mano acá: el CHECK de la base ya es la segunda mitad de esa lista
  // y una tercera copia terminaría discrepando de las otras dos.
  const { error: areasError } = await cliente
    .schema("plataforma")
    .from("areas_habilitadas")
    .insert(
      AREAS_PRODUCTO.map((area) => ({
        tenant_id: tenantId,
        area,
        habilitada_por: input.actor.usuarioId,
        nota: "Encendida al dar de alta el courier.",
      })),
    );

  if (areasError) {
    // Se deshace el alta entera. Un tenant a medias es peor que un alta
    // fallida: reintentar limpio es mejor que dejar un courier que no puede
    // terminar su puesta en marcha.
    //
    // ⚠️ ORDEN: primero el PERFIL (siempre — a esta altura ya existe y apunta
    // al tenant con `on delete restrict`, así que borrar el tenant antes
    // fallaría por la FK), y sobre el usuario Auth: solo si `compensarAuthUser`
    // — cuando sí, `deshacerUsuarioAuth` arrastra el perfil por cascada y el
    // `deshacerPerfil` explícito de abajo es un no-op (ya no hay fila); cuando
    // no, el perfil hay que borrarlo a mano porque el usuario Auth se queda.
    if (opciones.compensarAuthUser) {
      await deshacerUsuarioAuth(cliente, authUserId);
    } else {
      await deshacerPerfil(cliente, authUserId);
    }
    await deshacerTenant(cliente, tenantId);
    throw new Error(`No se pudieron encender las áreas del courier: ${areasError.message}`);
  }

  // --- 4. Bitácora -------------------------------------------------------------
  // Sin secretos: solo nombres, email (dato de contacto, no credencial) e ids.
  await registrarEnBitacora(cliente as unknown as SupabaseClient, {
    tenantId,
    actorUsuarioId: input.actor.usuarioId,
    actorTipo: input.actor.tipo,
    accion: "tenant.alta",
    entidadTipo: "tenant",
    entidadId: tenantId,
    detalle: {
      nombre_fantasia: input.tenant.nombreFantasia.trim(),
      rut: rutNormalizado,
      dueno_email: input.dueno.email.trim().toLowerCase(),
      dueno_usuario_id: authUserId,
    },
  });

  return { tenantId, duenoUsuarioId: authUserId };
}

/**
 * Crea un tenant nuevo junto con su primer usuario `dueno` — la puerta del
 * BACKSTAGE (invitación por correo de Supabase Auth). Sigue siendo "la ÚNICA
 * puerta para crear un tenant" en el sentido de que es la única que TAMBIÉN
 * crea el usuario Auth; el autoservicio de `/registro` (F1) resuelve su
 * usuario Auth por su cuenta (Google/código) y llama directo a
 * `provisionarTenantParaAuthUser`.
 *
 * Comportamiento sin cambios respecto de antes de F1 — este es el llamador de
 * `src/app/admin/couriers/alta-actions.ts`, que no se tocó.
 */
export async function crearTenantConDueno(
  cliente: ClienteServicio,
  input: CrearTenantConDuenoInput,
): Promise<CrearTenantConDuenoResultado> {
  // Validar ANTES de tocar Auth: un RUT/nombre inválido no debe ni siquiera
  // haber invitado al dueño.
  validarEntrada(input);

  // --- Usuario en Supabase Auth (identidad técnica) ---------------------------
  // `inviteUserByEmail` crea el usuario en `auth.users` y dispara el correo de
  // invitación — evita manejar contraseñas provisorias, que terminarían siendo
  // un secreto más que cuidar.
  const { data: authData, error: authError } = await cliente.auth.admin.inviteUserByEmail(
    input.dueno.email.trim().toLowerCase(),
    {
      data: { nombre_completo: input.dueno.nombreCompleto.trim() },
      redirectTo: resolverRedirectToActivacionCuenta(),
    },
  );

  if (authError || !authData?.user) {
    if (esErrorDeEmailDuplicado(authError)) {
      throw new ErrorConflicto(`Ya existe una cuenta con el email ${input.dueno.email}.`);
    }
    throw new Error(`No se pudo crear el usuario de autenticación del dueño: ${authError?.message ?? "desconocido"}`);
  }

  const duenoUsuarioId = authData.user.id;

  return provisionarTenantParaAuthUser(cliente, duenoUsuarioId, input, {
    estado: "invitado",
    compensarAuthUser: true,
  });
}

/**
 * ¿Ya existe un perfil de dominio para esta identidad Auth, y qué es?
 *
 * Usada por los DOS caminos de autoservicio de F1 (`/auth/callback` y
 * `registro/actions.ts`) para resolver, en un solo lugar:
 *   - **H5 (idempotencia):** si el perfil ya es `interno`+`dueno`, es un
 *     reintento del mismo registro (doble pestaña, doble clic) — no hay que
 *     provisionar de nuevo.
 *   - **H2 (un correo, una cuenta):** si el perfil es de otro tipo (seller,
 *     conductor, u otro miembro de equipo), este correo YA es otra cosa en
 *     Rutax y no se crea un segundo perfil encima.
 *
 * ⚠️ Deliberadamente NO se usa `buscarCuentaPorEmail` aquí (aunque el
 * documento de arquitectura la nombra para este chequeo): esa función busca
 * por EMAIL vía `listUsers`, y en el instante en que se llama —justo después
 * de `verifyOtp`/`exchangeCodeForSession`— el usuario Auth de ESTE email YA
 * EXISTE (Supabase acaba de crearlo o de resolverlo), así que
 * `buscarCuentaPorEmail` diría `existe:true` para TODO primer registro
 * legítimo y lo rechazaría siempre. La señal que de verdad importa es «¿esta
 * identidad AUTH concreta (`authUserId`, que ya tenemos) tiene perfil?», no
 * «¿existe algún Auth con este correo?».
 *
 * También trae `estado`: lo necesita el camino LOGIN de `/auth/callback` y
 * `login/actions.ts` para un caso borde real — un dueño invitado por el
 * backstage que entra por Google/código ANTES de haber aceptado nunca el
 * enlace de correo. Su perfil existe (`interno`+`dueno`) pero sigue
 * `invitado`; sin activarlo ahí mismo, `(tenant)/layout.tsx` lo rebota a
 * `/login`, que —al ver `tenantId` puesto— lo manda de vuelta a `/`, que lo
 * manda a `/dashboard`: un bucle infinito. Confirmar la identidad por
 * Google/código es, como mínimo, tan fuerte como clickear el enlace, así que
 * el llamador activa ahí mismo en vez de dejarlo entrar a medias.
 */
export async function buscarPerfilPorAuthUserId(
  cliente: ClienteServicio,
  authUserId: string,
): Promise<{ tenantId: string | null; tipoUsuario: string; rol: string; estado: string } | null> {
  const { data } = await cliente
    .from("usuarios_perfil")
    .select("tenant_id, tipo_usuario, rol, estado")
    .eq("id", authUserId)
    .maybeSingle();

  if (!data) return null;
  return {
    tenantId: (data.tenant_id as string | null) ?? null,
    tipoUsuario: data.tipo_usuario as string,
    rol: data.rol as string,
    estado: data.estado as string,
  };
}

/**
 * Activa el perfil de un dueño invitado por el backstage: `estado: invitado →
 * activo` + bitácora `usuario.activado`. Es la mitad que sobrevive de la
 * vieja pantalla `/activar-cuenta` (retirada en F1) — antes la disparaba el
 * propio dueño al definir su contraseña; ahora, sin contraseña que definir, la
 * dispara `/auth/confirm` justo después de `verifyOtp` sobre el enlace de
 * invitación.
 *
 * Doble candado (`.eq('estado', 'invitado')`): transiciona SOLO desde
 * invitado — nunca reactiva a alguien suspendido. Idempotente: si ya está
 * `activo` (doble clic en el enlace, pestaña vieja), no hace nada y devuelve
 * `null` — el llamador no debe tratarlo como error.
 */
export async function activarPerfilDueno(
  clienteAdmin: ClienteServicio,
  authUserId: string,
): Promise<{ tenantId: string | null; rol: string } | null> {
  const { data: perfilActualizado, error } = await clienteAdmin
    .from("usuarios_perfil")
    .update({ estado: "activo" })
    .eq("id", authUserId)
    .eq("estado", "invitado")
    .select("tenant_id, rol")
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo activar el perfil: ${error.message}`);
  }
  if (!perfilActualizado) return null;

  const tenantId = (perfilActualizado.tenant_id as string | null) ?? null;
  const rol = perfilActualizado.rol as string;

  await registrarEnBitacora(clienteAdmin as unknown as SupabaseClient, {
    tenantId,
    actorUsuarioId: authUserId,
    actorTipo: "usuario",
    accion: "usuario.activado",
    entidadTipo: "usuario_perfil",
    entidadId: authUserId,
    detalle: { rol, via: "activacion_invitacion_inicial" },
  });

  return { tenantId, rol };
}

// -----------------------------------------------------------------------------
// Helpers de compensación e inspección de errores
// -----------------------------------------------------------------------------

async function deshacerUsuarioAuth(cliente: ClienteServicio, usuarioId: string): Promise<void> {
  try {
    await cliente.auth.admin.deleteUser(usuarioId);
  } catch {
    // Best-effort: si la compensación falla, preferimos no enmascarar el error
    // original — quedará un usuario Auth huérfano que requiere limpieza manual,
    // pero NUNCA un usuario_perfil/tenant a medio crear (eso sí lo evitamos).
  }
}

async function deshacerTenant(cliente: ClienteServicio, tenantId: string): Promise<void> {
  try {
    await cliente.from("tenants").delete().eq("id", tenantId);
  } catch {
    // Best-effort — ver nota de deshacerUsuarioAuth.
  }
}

/**
 * Borra SOLO la fila de `usuarios_perfil` — a diferencia de `deshacerUsuarioAuth`,
 * deja el usuario Auth intacto. Es la compensación que corresponde cuando
 * `opciones.compensarAuthUser === false` (autoservicio): esa identidad no es
 * nuestra para borrarla, pero el perfil a medio crear sí hay que deshacerlo
 * para poder borrar el tenant después (FK `usuarios_perfil.tenant_id →
 * tenants(id) on delete restrict`).
 */
async function deshacerPerfil(cliente: ClienteServicio, authUserId: string): Promise<void> {
  try {
    await cliente.from("usuarios_perfil").delete().eq("id", authUserId);
  } catch {
    // Best-effort — ver nota de deshacerUsuarioAuth.
  }
}

function esErrorDeEmailDuplicado(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const mensaje = (error.message ?? "").toLowerCase();
  return (
    error.code === "email_exists" ||
    mensaje.includes("already been registered") ||
    mensaje.includes("already registered") ||
    mensaje.includes("duplicate")
  );
}

function esErrorDeRutDuplicado(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  // Postgres unique_violation = 23505; el índice único es `tenants_rut_uk`.
  return error.code === "23505" || (error.message ?? "").toLowerCase().includes("tenants_rut_uk");
}
