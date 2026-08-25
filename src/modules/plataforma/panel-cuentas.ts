/**
 * Backstage — todas las cuentas de Rutax, y las que están mal.
 * =============================================================================
 * Cross-tenant a propósito, como el resto de `plataforma`. Quien lo llama ya
 * comprobó la sesión de super-admin.
 *
 * -----------------------------------------------------------------------------
 * QUÉ SE MARCA, Y QUÉ NO HACE FALTA MARCAR
 * -----------------------------------------------------------------------------
 * La incoherencia obvia —un perfil `seller` sin `seller_id`, un `conductor` sin
 * `driver_id`, un rol que no calza con su tipo— **es imposible**: la base la
 * impide con cuatro CHECK (`usuarios_perfil_*_coherente*`). Buscarla sería
 * teatro. Lo que sí ocurre es esto:
 *
 *  · **Cuenta sin perfil.** Existe en Auth, ocupa el correo, puede iniciar
 *    sesión — y no ve nada, porque el hook de claims no tiene de dónde sacar su
 *    tenant. Nadie se entera hasta que la persona llama.
 *  · **Conductor o seller sin cuenta.** La ficha existe, la persona no puede
 *    entrar. Un seller así **tampoco recibe avisos de WhatsApp**, porque el
 *    número lo pone él desde su portal y nunca llegó a entrar.
 *  · **Invitación pendiente que va a pisar una cuenta.** El correo ya tiene
 *    cuenta de OTRO tipo: al canjearse, `aceptarInvitacion` hace upsert por id y
 *    le sobrescribe el perfil. Así se destruyó una cuenta de seller el
 *    2026-08-25. Desde entonces `crearInvitacion` lo impide, pero **las
 *    invitaciones creadas ANTES siguen vivas y siguen siendo peligrosas** —
 *    por eso se listan.
 *  · **Invitado que nunca activó.** No es un error; es una cuenta que no
 *    existe todavía aunque el listado del courier diga «Invitado».
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";

export type MarcaCuenta =
  | "sin_perfil"
  | "invitado_sin_activar"
  | "invitacion_en_conflicto"
  | "entidad_compartida";

export interface CuentaListada {
  usuarioId: string;
  email: string;
  nombreCompleto: string | null;
  tipoUsuario: string | null;
  rol: string | null;
  estado: string | null;
  courierNombre: string | null;
  /** El seller o el conductor al que representa. `null` para internos. */
  representaA: string | null;
  creadaEn: string;
  ultimoIngresoEn: string | null;
  marcas: MarcaCuenta[];
}

export interface EntidadSinCuenta {
  tipo: "conductor" | "seller";
  id: string;
  nombre: string;
  courierNombre: string;
  estado: string;
}

export interface PanelCuentas {
  cuentas: CuentaListada[];
  /** Fichas que existen sin nadie que pueda entrar por ellas. */
  sinCuenta: EntidadSinCuenta[];
  resumen: {
    total: number;
    conMarca: number;
    sinPerfil: number;
    invitadosSinActivar: number;
    invitacionesEnConflicto: number;
    entidadesCompartidas: number;
  };
}

interface FilaPerfil {
  id: string;
  tenant_id: string | null;
  tipo_usuario: string;
  rol: string;
  estado: string;
  seller_id: string | null;
  driver_id: string | null;
  nombre_completo: string | null;
}

/**
 * Los usuarios de Auth, paginados.
 *
 * `listUsers` es la única vía: `auth.users` no está expuesta a PostgREST. El
 * tope de páginas es defensivo — sin él, un cambio de forma de la API convierte
 * esto en un bucle que cuelga la pantalla.
 */
async function listarUsuariosAuth(
  cliente: ReturnType<typeof crearClienteServiceRole>,
): Promise<Array<{ id: string; email: string; created_at: string; last_sign_in_at: string | null }>> {
  const porPagina = 200;
  const todos: Array<{ id: string; email: string; created_at: string; last_sign_in_at: string | null }> = [];

  for (let pagina = 1; pagina <= 50; pagina += 1) {
    const { data, error } = await cliente.auth.admin.listUsers({ page: pagina, perPage: porPagina });
    if (error || !data) break;
    for (const u of data.users) {
      todos.push({
        id: u.id,
        email: u.email ?? "(sin correo)",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
      });
    }
    if (data.users.length < porPagina) break;
  }
  return todos;
}

export async function obtenerPanelCuentas(): Promise<PanelCuentas> {
  const cliente = crearClienteServiceRole();

  const [usuarios, perfiles, tenants, conductores, sellers, invitaciones] = await Promise.all([
    listarUsuariosAuth(cliente),
    // `leerTodasLasFilas` y no un `select` pelado: PostgREST corta en 1000 filas
    // EN SILENCIO, y una pantalla de auditoría que muestra 1000 de 1400 miente
    // exactamente donde no puede.
    leerTodasLasFilas<FilaPerfil>("perfiles de usuario", (desde, hasta) =>
      cliente
        .schema("identidad")
        .from("usuarios_perfil")
        .select("id, tenant_id, tipo_usuario, rol, estado, seller_id, driver_id, nombre_completo")
        .range(desde, hasta),
    ),
    leerTodasLasFilas<{ id: string; nombre_fantasia: string }>("couriers", (desde, hasta) =>
      cliente.schema("identidad").from("tenants").select("id, nombre_fantasia").range(desde, hasta),
    ),
    leerTodasLasFilas<{ id: string; tenant_id: string; nombre_completo: string; estado: string }>(
      "conductores",
      (desde, hasta) =>
        cliente
          .schema("identidad")
          .from("conductores")
          .select("id, tenant_id, nombre_completo, estado")
          .range(desde, hasta),
    ),
    leerTodasLasFilas<{ id: string; tenant_id: string; razon_social: string; estado: string }>(
      "sellers",
      (desde, hasta) =>
        cliente
          .schema("identidad")
          .from("sellers")
          .select("id, tenant_id, razon_social, estado")
          .range(desde, hasta),
    ),
    leerTodasLasFilas<{ email: string; tipo_usuario: string }>("invitaciones pendientes", (desde, hasta) =>
      cliente
        .schema("identidad")
        .from("invitaciones")
        .select("email, tipo_usuario")
        .eq("estado", "pendiente")
        .range(desde, hasta),
    ),
  ]);

  const perfilPorId = new Map(perfiles.map((p) => [p.id, p]));
  const nombreCourier = new Map(tenants.map((t) => [t.id, t.nombre_fantasia]));
  const nombreConductor = new Map(conductores.map((c) => [c.id, c.nombre_completo]));
  const nombreSeller = new Map(sellers.map((s) => [s.id, s.razon_social]));

  // Las invitaciones pendientes, por correo. Se usa para detectar la que va a
  // pisar una cuenta existente de otro tipo.
  const invitacionPorEmail = new Map(
    invitaciones.map((i) => [i.email.trim().toLowerCase(), i.tipo_usuario]),
  );

  // Cuantas cuentas apuntan a la MISMA ficha. Encontrado al mirar la salida
  // real: dos correos distintos representaban al mismo conductor. Es de la
  // misma familia que el bug del upsert -- una invitacion a un correo nuevo
  // para una ficha que ya tenia cuenta crea la segunda, y la primera queda
  // viva sin que nadie lo note. El conductor entra con cualquiera de las dos.
  const cuentasPorEntidad = new Map<string, number>();
  for (const perfil of perfiles) {
    const entidad = perfil.seller_id ?? perfil.driver_id;
    if (entidad) cuentasPorEntidad.set(entidad, (cuentasPorEntidad.get(entidad) ?? 0) + 1);
  }

  const cuentas: CuentaListada[] = usuarios.map((u) => {
    const perfil = perfilPorId.get(u.id);
    const marcas: MarcaCuenta[] = [];

    if (!perfil) {
      marcas.push("sin_perfil");
    } else if (perfil.estado === "invitado") {
      marcas.push("invitado_sin_activar");
    }

    // ⚠️ La marca que importa: una invitación pendiente a este correo, de un
    // tipo distinto al que la cuenta ya tiene. Si se canjea, el perfil se
    // sobrescribe y la cuenta actual deja de ser lo que era.
    const tipoInvitado = invitacionPorEmail.get(u.email.trim().toLowerCase());
    if (perfil && tipoInvitado && tipoInvitado !== perfil.tipo_usuario) {
      marcas.push("invitacion_en_conflicto");
    }

    const entidad = perfil?.seller_id ?? perfil?.driver_id;
    if (entidad && (cuentasPorEntidad.get(entidad) ?? 0) > 1) {
      marcas.push("entidad_compartida");
    }

    return {
      usuarioId: u.id,
      email: u.email,
      nombreCompleto: perfil?.nombre_completo ?? null,
      tipoUsuario: perfil?.tipo_usuario ?? null,
      rol: perfil?.rol ?? null,
      estado: perfil?.estado ?? null,
      courierNombre: perfil?.tenant_id ? (nombreCourier.get(perfil.tenant_id) ?? null) : null,
      representaA: perfil?.seller_id
        ? (nombreSeller.get(perfil.seller_id) ?? null)
        : perfil?.driver_id
          ? (nombreConductor.get(perfil.driver_id) ?? null)
          : null,
      creadaEn: u.created_at,
      ultimoIngresoEn: u.last_sign_in_at,
      marcas,
    };
  });

  // Fichas sin nadie que pueda entrar por ellas.
  const conductoresConCuenta = new Set(
    perfiles.map((p) => p.driver_id).filter((v): v is string => !!v),
  );
  const sellersConCuenta = new Set(
    perfiles.map((p) => p.seller_id).filter((v): v is string => !!v),
  );

  const sinCuenta: EntidadSinCuenta[] = [
    ...conductores
      .filter((c) => !conductoresConCuenta.has(c.id))
      .map((c) => ({
        tipo: "conductor" as const,
        id: c.id,
        nombre: c.nombre_completo,
        courierNombre: nombreCourier.get(c.tenant_id) ?? "Courier sin nombre",
        estado: c.estado,
      })),
    ...sellers
      .filter((s) => !sellersConCuenta.has(s.id))
      .map((s) => ({
        tipo: "seller" as const,
        id: s.id,
        nombre: s.razon_social,
        courierNombre: nombreCourier.get(s.tenant_id) ?? "Courier sin nombre",
        estado: s.estado,
      })),
  ];

  return {
    cuentas,
    sinCuenta,
    resumen: {
      total: cuentas.length,
      conMarca: cuentas.filter((c) => c.marcas.length > 0).length,
      sinPerfil: cuentas.filter((c) => c.marcas.includes("sin_perfil")).length,
      invitadosSinActivar: cuentas.filter((c) => c.marcas.includes("invitado_sin_activar")).length,
      invitacionesEnConflicto: cuentas.filter((c) => c.marcas.includes("invitacion_en_conflicto"))
        .length,
      entidadesCompartidas: cuentas.filter((c) => c.marcas.includes("entidad_compartida")).length,
    },
  };
}
