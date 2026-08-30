import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearTenantConDueno, resolverRedirectToActivacionCuenta } from "./onboarding";
import { ErrorConflicto, ErrorValidacion } from "./errores";

// -----------------------------------------------------------------------------
// Doble de prueba del cliente service_role.
//
// `crearTenantConDueno` recibe el cliente por parámetro (inyección de
// dependencias) precisamente para poder probarlo sin tocar Supabase real —
// "procesos pesados van como jobs", pero esto es una operación puntual de
// onboarding cuya CORRECCIÓN (no duplicar usuarios/tenants, no perder la
// bitácora, compensar al fallar) es justamente lo que hay que probar.
// -----------------------------------------------------------------------------

interface EstadoFalso {
  usuariosAuth: Array<{ id: string; email: string }>;
  tenants: Array<Record<string, unknown>>;
  perfiles: Array<Record<string, unknown>>;
  bitacora: Array<Record<string, unknown>>;
  /** Filas escritas en `plataforma.areas_habilitadas` — una por área encendida. */
  areas: Array<Record<string, unknown>>;
  /** Opciones con las que se llamó a `inviteUserByEmail` — para poder afirmar sobre `redirectTo`. */
  opcionesInvitacion: Array<{ redirectTo?: string; data?: Record<string, unknown> } | undefined>;
}

function crearClienteFalso(opciones?: {
  fallarEnPerfil?: boolean;
  fallarEnInsertTenant?: { code?: string; message?: string };
  fallarEnAreas?: { code?: string; message?: string };
  emailYaExiste?: boolean;
}) {
  const estado: EstadoFalso = { usuariosAuth: [], tenants: [], perfiles: [], bitacora: [], areas: [], opcionesInvitacion: [] };
  let contadorId = 0;
  const nuevoId = (prefijo: string) => `${prefijo}-${++contadorId}`;

  const auth = {
    admin: {
      inviteUserByEmail: vi.fn(
        async (email: string, invitacionOpciones?: { redirectTo?: string; data?: Record<string, unknown> }) => {
          estado.opcionesInvitacion.push(invitacionOpciones);
          if (opciones?.emailYaExiste || estado.usuariosAuth.some((u) => u.email === email)) {
            return {
              data: { user: null },
              error: { message: "A user with this email address has already been registered", code: "email_exists" },
            };
          }
          const user = { id: nuevoId("auth-user"), email };
          estado.usuariosAuth.push(user);
          return { data: { user }, error: null };
        },
      ),
      deleteUser: vi.fn(async (id: string) => {
        estado.usuariosAuth = estado.usuariosAuth.filter((u) => u.id !== id);
        // Espeja `usuarios_perfil.id → auth.users(id) ON DELETE CASCADE`: borrar
        // el usuario Auth arrastra su perfil. Sin esto el doble no reproduce la
        // razón por la que la compensación debe borrar el usuario ANTES que el
        // tenant, y el test no protegería ese orden.
        estado.perfiles = estado.perfiles.filter((p) => p.id !== id);
        return { data: {}, error: null };
      }),
    },
  };

  function from(tabla: string) {
    if (tabla === "tenants") {
      return {
        insert: (fila: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              if (opciones?.fallarEnInsertTenant) {
                return { data: null, error: opciones.fallarEnInsertTenant };
              }
              const yaExiste = estado.tenants.some((t) => t.rut === fila.rut);
              if (yaExiste) {
                return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "tenants_rut_uk"' } };
              }
              const id = nuevoId("tenant");
              estado.tenants.push({ id, ...fila });
              return { data: { id }, error: null };
            },
          }),
        }),
        delete: () => ({
          eq: async (_col: string, valor: string) => {
            // Espeja `usuarios_perfil.tenant_id → tenants(id) ON DELETE RESTRICT`:
            // si un perfil todavía apunta a este tenant, la base rechaza el
            // borrado. Así el doble castiga el orden equivocado de compensación
            // (borrar el tenant antes que el usuario Auth que arrastra el perfil).
            if (estado.perfiles.some((p) => p.tenant_id === valor)) {
              return { data: null, error: { code: "23503", message: 'update or delete on table "tenants" violates foreign key constraint on table "usuarios_perfil"' } };
            }
            estado.tenants = estado.tenants.filter((t) => t.id !== valor);
            return { data: null, error: null };
          },
        }),
      };
    }

    if (tabla === "usuarios_perfil") {
      return {
        insert: async (fila: Record<string, unknown>) => {
          if (opciones?.fallarEnPerfil) {
            return { data: null, error: { message: "violación simulada de constraint" } };
          }
          estado.perfiles.push(fila);
          return { data: null, error: null };
        },
      };
    }

    if (tabla === "bitacora_auditoria") {
      return {
        insert: async (fila: Record<string, unknown>) => {
          estado.bitacora.push(fila);
          return { data: null, error: null };
        },
      };
    }

    if (tabla === "areas_habilitadas") {
      return {
        insert: async (filas: Array<Record<string, unknown>>) => {
          if (opciones?.fallarEnAreas) {
            return { data: null, error: opciones.fallarEnAreas };
          }
          estado.areas.push(...filas);
          return { data: null, error: null };
        },
      };
    }

    throw new Error(`Tabla no soportada en el doble de prueba: ${tabla}`);
  }

  // `crearTenantConDueno` alcanza `plataforma.areas_habilitadas` vía
  // `cliente.schema("plataforma").from(...)`; el resto de las tablas van por
  // `from(...)` directo (esquema `identidad`, el default del cliente). El doble
  // ignora QUÉ esquema se pide y enruta por nombre de tabla, que en este alta
  // no colisiona.
  const schema = (_nombre: string) => ({ from });

  return { cliente: { auth, from, schema } as never, estado };
}

const ENTRADA_VALIDA = {
  tenant: {
    nombreFantasia: "Despachos Rápidos SpA",
    razonSocial: "Despachos Rápidos Sociedad por Acciones",
    rut: "76.543.210-3", // cuerpo 76543210 → DV módulo 11 = 3
  },
  dueno: {
    email: "Dueno@DespachosRapidos.cl",
    nombreCompleto: "María Pérez",
  },
  actor: { usuarioId: null, tipo: "sistema" as const },
};

describe("crearTenantConDueno — validación previa", () => {
  it("rechaza un RUT con dígito verificador inválido sin tocar el cliente", async () => {
    const { cliente, estado } = crearClienteFalso();
    await expect(
      crearTenantConDueno(cliente, { ...ENTRADA_VALIDA, tenant: { ...ENTRADA_VALIDA.tenant, rut: "76543210-9" } }),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    expect(estado.usuariosAuth).toHaveLength(0);
    expect(estado.tenants).toHaveLength(0);
  });

  it("rechaza nombre de fantasía vacío", async () => {
    await expect(
      crearTenantConDueno(crearClienteFalso().cliente, {
        ...ENTRADA_VALIDA,
        tenant: { ...ENTRADA_VALIDA.tenant, nombreFantasia: "   " },
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("rechaza un email de dueño con formato inválido", async () => {
    await expect(
      crearTenantConDueno(crearClienteFalso().cliente, {
        ...ENTRADA_VALIDA,
        dueno: { ...ENTRADA_VALIDA.dueno, email: "no-es-un-correo" },
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe("crearTenantConDueno — camino feliz", () => {
  let cliente: ReturnType<typeof crearClienteFalso>["cliente"];
  let estado: EstadoFalso;

  beforeEach(() => {
    ({ cliente, estado } = crearClienteFalso());
  });

  it("crea usuario Auth, tenant y perfil dueno consistentes entre sí", async () => {
    const resultado = await crearTenantConDueno(cliente, ENTRADA_VALIDA);

    expect(resultado.tenantId).toBeTruthy();
    expect(resultado.duenoUsuarioId).toBeTruthy();

    expect(estado.usuariosAuth).toHaveLength(1);
    expect(estado.usuariosAuth[0].id).toBe(resultado.duenoUsuarioId);

    expect(estado.tenants).toHaveLength(1);
    expect(estado.tenants[0]).toMatchObject({
      id: resultado.tenantId,
      estado: "onboarding",
      zona_horaria: "America/Santiago",
      rut: "76543210-3",
    });

    expect(estado.perfiles).toHaveLength(1);
    const perfil = estado.perfiles[0];
    // Consistencia con el constraint usuarios_perfil_rol_coherente_con_tipo y
    // con lo que el custom_access_token_hook necesita para resolver claims:
    // tipo_usuario='interno' exige rol ∈ {dueno, supervisor, coordinador, administracion}
    // y NO debe llevar seller_id/driver_id.
    expect(perfil).toMatchObject({
      id: resultado.duenoUsuarioId,
      tenant_id: resultado.tenantId,
      tipo_usuario: "interno",
      rol: "dueno",
      estado: "invitado",
    });
    expect(perfil.seller_id).toBeUndefined();
    expect(perfil.driver_id).toBeUndefined();
  });

  it("🔴 el courier nace con las CINCO áreas de producto encendidas", async () => {
    // Decisión del usuario: «que nazcan encendidos». La ausencia de fila es
    // «apagada», así que un alta que no escriba las cinco deja al courier sin
    // poder terminar su puesta en marcha (folios_caf gatea el paso DTE, uno de
    // los bloqueantes). Se afirma el conjunto exacto, no un conteo: un conteo
    // pasaría aunque se encendiera cinco veces la misma área.
    const resultado = await crearTenantConDueno(cliente, ENTRADA_VALIDA);
    const areasEncendidas = new Set(estado.areas.map((f) => f.area));
    expect(areasEncendidas).toEqual(
      new Set([
        "emision_facturas",
        "folios_caf",
        "pago_conductores",
        "conciliacion_cobranza",
        "suscripcion_rutax",
      ]),
    );
    for (const fila of estado.areas) {
      expect(fila.tenant_id).toBe(resultado.tenantId);
    }
  });

  it("normaliza el RUT a forma canónica antes de persistir", async () => {
    await crearTenantConDueno(cliente, ENTRADA_VALIDA);
    expect(estado.tenants[0].rut).toBe("76543210-3");
  });

  it("normaliza el email del dueño a minúsculas antes de invitar y auditar", async () => {
    await crearTenantConDueno(cliente, ENTRADA_VALIDA);
    expect(estado.usuariosAuth[0].email).toBe("dueno@despachosrapidos.cl");
  });

  it("registra exactamente una entrada en la bitácora, con tenant_id y sin secretos", async () => {
    const resultado = await crearTenantConDueno(cliente, ENTRADA_VALIDA);

    expect(estado.bitacora).toHaveLength(1);
    const entrada = estado.bitacora[0];
    expect(entrada).toMatchObject({
      tenant_id: resultado.tenantId,
      actor_tipo: "sistema",
      accion: "tenant.alta",
      entidad_tipo: "tenant",
      entidad_id: resultado.tenantId,
    });

    const detalle = entrada.detalle as Record<string, unknown>;
    expect(detalle).not.toHaveProperty("token");
    expect(detalle).not.toHaveProperty("password");
    expect(detalle).not.toHaveProperty("certificado");
    expect(JSON.stringify(detalle).toLowerCase()).not.toContain("token");
  });
});

// -----------------------------------------------------------------------------
// Regresión (deuda detectada al provisionar producción, 2026-08-07):
// `inviteUserByEmail` SIN `redirectTo` hace que el alta del dueño dependa por
// completo de que la plantilla de correo de Supabase esté personalizada. El
// default de Supabase usa `{{ .ConfirmationURL }}` (flujo implícito, tokens en
// el FRAGMENTO de la URL); `/auth/confirm` lee `token_hash` del QUERY STRING —
// nunca se encuentran, y el dueño aterriza en la raíz del sitio en vez de en
// `/activar-cuenta`. Estas pruebas fallan si alguien vuelve a quitar el
// `redirectTo` de la llamada, en cualquiera de los dos módulos que invitan
// (`crearTenantConDueno` y `reenviarCorreoActivacion` en `app/registro/actions.ts`).
// -----------------------------------------------------------------------------
describe("crearTenantConDueno — redirectTo de activación (no depender de la plantilla de Supabase)", () => {
  const CLAVES = ["APP_PUBLIC_URL", "APP_BASE_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_URL"] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const clave of CLAVES) {
      original[clave] = process.env[clave];
      delete process.env[clave];
    }
  });

  afterEach(() => {
    for (const clave of CLAVES) {
      if (original[clave] === undefined) delete process.env[clave];
      else process.env[clave] = original[clave];
    }
  });

  it("resolverRedirectToActivacionCuenta arma la URL sobre APP_PUBLIC_URL + /activar-cuenta", () => {
    process.env.APP_PUBLIC_URL = "https://rutax.io";
    expect(resolverRedirectToActivacionCuenta()).toBe("https://rutax.io/activar-cuenta");
  });

  it("resolverRedirectToActivacionCuenta es undefined si el entorno no declara ninguna URL", () => {
    expect(resolverRedirectToActivacionCuenta()).toBeUndefined();
  });

  it("pasa redirectTo, no vacío, a inviteUserByEmail cuando hay URL pública declarada", async () => {
    process.env.APP_PUBLIC_URL = "https://rutax.io";
    const { cliente, estado } = crearClienteFalso();

    await crearTenantConDueno(cliente, ENTRADA_VALIDA);

    expect(estado.opcionesInvitacion).toHaveLength(1);
    expect(estado.opcionesInvitacion[0]?.redirectTo).toBe("https://rutax.io/activar-cuenta");
  });

  it("no manda un redirectTo vacío ni la ruta relativa sola — siempre absoluto sobre /activar-cuenta", async () => {
    process.env.APP_PUBLIC_URL = "https://rutax.io/";
    const { cliente, estado } = crearClienteFalso();

    await crearTenantConDueno(cliente, ENTRADA_VALIDA);

    const redirectTo = estado.opcionesInvitacion[0]?.redirectTo;
    expect(redirectTo).toBeTruthy();
    expect(redirectTo).not.toBe("");
    expect(redirectTo).not.toBe("/activar-cuenta");
    expect(redirectTo).toMatch(/^https?:\/\/.+\/activar-cuenta$/);
  });
});

describe("crearTenantConDueno — conflictos esperables", () => {
  it("lanza ErrorConflicto si el email ya está registrado en Auth", async () => {
    const { cliente } = crearClienteFalso({ emailYaExiste: true });
    await expect(crearTenantConDueno(cliente, ENTRADA_VALIDA)).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it("lanza ErrorConflicto si el RUT ya pertenece a otro tenant, y compensa el usuario Auth creado", async () => {
    const { cliente, estado } = crearClienteFalso();
    // Primera alta exitosa.
    await crearTenantConDueno(cliente, ENTRADA_VALIDA);
    expect(estado.tenants).toHaveLength(1);
    expect(estado.usuariosAuth).toHaveLength(1);

    // Segunda alta con el mismo RUT pero otro dueño → debe fallar con conflicto
    // Y deshacer el usuario Auth recién creado para esa segunda solicitud
    // (no debe quedar un usuario Auth huérfano sin tenant ni perfil).
    await expect(
      crearTenantConDueno(cliente, {
        ...ENTRADA_VALIDA,
        dueno: { email: "otro.dueno@example.com", nombreCompleto: "Otro Dueño" },
      }),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Sigue habiendo solo 1 tenant y 1 usuario Auth (el de la primera alta;
    // el de la segunda intentona fue compensado).
    expect(estado.tenants).toHaveLength(1);
    expect(estado.usuariosAuth).toHaveLength(1);
    expect(estado.usuariosAuth[0].email).toBe("dueno@despachosrapidos.cl");
  });
});

describe("crearTenantConDueno — falla a medio camino: compensación", () => {
  it("si falla el INSERT de usuarios_perfil, deshace el tenant y el usuario Auth (no deja residuos)", async () => {
    const { cliente, estado } = crearClienteFalso({ fallarEnPerfil: true });

    await expect(crearTenantConDueno(cliente, ENTRADA_VALIDA)).rejects.toThrow();

    expect(estado.tenants).toHaveLength(0);
    expect(estado.usuariosAuth).toHaveLength(0);
    expect(estado.perfiles).toHaveLength(0);
    // Y no se debe haber escrito en bitácora una operación que no se completó.
    expect(estado.bitacora).toHaveLength(0);
  });

  it("si falla el INSERT de tenants por una causa NO relacionada al RUT, deshace el usuario Auth", async () => {
    const { cliente, estado } = crearClienteFalso({ fallarEnInsertTenant: { code: "XX000", message: "fallo de infraestructura" } });

    await expect(crearTenantConDueno(cliente, ENTRADA_VALIDA)).rejects.toThrow();

    expect(estado.usuariosAuth).toHaveLength(0);
    expect(estado.tenants).toHaveLength(0);
    expect(estado.bitacora).toHaveLength(0);
  });

  it("🔴 si falla el INSERT de áreas, deshace el tenant y el usuario Auth (no deja un courier inoperable)", async () => {
    // Un tenant con dueño invitado pero sin áreas es peor que un alta fallida:
    // el correo de invitación ya salió y la persona entraría a un producto que
    // no la deja avanzar. El alta se deshace entera para poder reintentar limpio.
    const { cliente, estado } = crearClienteFalso({
      fallarEnAreas: { code: "XX000", message: "fallo al encender áreas" },
    });

    await expect(crearTenantConDueno(cliente, ENTRADA_VALIDA)).rejects.toThrow();

    // Nada queda en pie. El perfil se va por la cascada al borrar el usuario
    // Auth; el tenant, después, ya sin referencias. Si la compensación borrara
    // en el orden inverso, el `delete` del tenant chocaría con la FK restrict y
    // este test fallaría — que es justo lo que debe custodiar.
    expect(estado.tenants).toHaveLength(0);
    expect(estado.usuariosAuth).toHaveLength(0);
    expect(estado.perfiles).toHaveLength(0);
    expect(estado.areas).toHaveLength(0);
    // Y la bitácora no registra un alta que no se completó.
    expect(estado.bitacora).toHaveLength(0);
  });
});
