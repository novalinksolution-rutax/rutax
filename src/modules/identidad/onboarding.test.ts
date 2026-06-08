import { beforeEach, describe, expect, it, vi } from "vitest";
import { crearTenantConDueno } from "./onboarding";
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
}

function crearClienteFalso(opciones?: {
  fallarEnPerfil?: boolean;
  fallarEnInsertTenant?: { code?: string; message?: string };
  emailYaExiste?: boolean;
}) {
  const estado: EstadoFalso = { usuariosAuth: [], tenants: [], perfiles: [], bitacora: [] };
  let contadorId = 0;
  const nuevoId = (prefijo: string) => `${prefijo}-${++contadorId}`;

  const auth = {
    admin: {
      inviteUserByEmail: vi.fn(async (email: string) => {
        if (opciones?.emailYaExiste || estado.usuariosAuth.some((u) => u.email === email)) {
          return {
            data: { user: null },
            error: { message: "A user with this email address has already been registered", code: "email_exists" },
          };
        }
        const user = { id: nuevoId("auth-user"), email };
        estado.usuariosAuth.push(user);
        return { data: { user }, error: null };
      }),
      deleteUser: vi.fn(async (id: string) => {
        estado.usuariosAuth = estado.usuariosAuth.filter((u) => u.id !== id);
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

    throw new Error(`Tabla no soportada en el doble de prueba: ${tabla}`);
  }

  return { cliente: { auth, from } as never, estado };
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
});
