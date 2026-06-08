import { beforeEach, describe, expect, it } from "vitest";
import { aceptarInvitacion, crearInvitacion, revocarInvitacion } from "./invitaciones";
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from "./errores";
import type { UsuarioActual } from "./usuario-actual";

// -----------------------------------------------------------------------------
// Doble de prueba del cliente service_role — modela `invitaciones`,
// `usuarios_perfil` y `bitacora_auditoria` como tablas en memoria, suficiente
// para probar las reglas de negocio (coherencia, expiración, un solo uso,
// aislamiento por tenant, no-secretos-en-bitácora) sin tocar Supabase real.
// -----------------------------------------------------------------------------

interface FilaInvitacion {
  id: string;
  tenant_id: string;
  email: string;
  tipo_usuario: string;
  rol: string;
  seller_id: string | null;
  driver_id: string | null;
  token: string;
  estado: string;
  expira_en: string;
}

interface EstadoFalso {
  invitaciones: FilaInvitacion[];
  perfiles: Array<Record<string, unknown>>;
  bitacora: Array<Record<string, unknown>>;
}

function crearClienteFalso(seed?: { invitaciones?: FilaInvitacion[] }) {
  const estado: EstadoFalso = {
    invitaciones: seed?.invitaciones ? [...seed.invitaciones] : [],
    perfiles: [],
    bitacora: [],
  };
  let contador = 0;
  const nuevoId = () => `inv-${++contador}`;

  function from(tabla: string) {
    if (tabla === "invitaciones") {
      return {
        insert: (fila: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const id = nuevoId();
              const completa = { id, ...fila } as FilaInvitacion;
              estado.invitaciones.push(completa);
              return { data: { id, token: completa.token, expira_en: completa.expira_en }, error: null };
            },
          }),
        }),
        select: () => ({
          eq: (campo: string, valor: string) => ({
            maybeSingle: async () => {
              const fila = estado.invitaciones.find((i) => (i as never as Record<string, unknown>)[campo] === valor);
              return { data: fila ?? null, error: null };
            },
          }),
        }),
        // Doble simplificado de `.update(cambios).eq(a, x)[.eq(b, y)]`: cada
        // `.eq` agrega un filtro; el builder es "thenable" para que `await`
        // lo resuelva sin necesitar un `.then()` explícito en el código de
        // producción (que solo hace `await cliente.from(...).update(...).eq(...)`).
        update: (cambios: Record<string, unknown>) => {
          function builder(filtros: Array<[string, string]>) {
            return {
              eq(campo: string, valor: string) {
                return builder([...filtros, [campo, valor]]);
              },
              then(resolve: (v: { data: null; error: null }) => void) {
                const idx = estado.invitaciones.findIndex((fila) =>
                  filtros.every(([campo, valor]) => (fila as never as Record<string, unknown>)[campo] === valor),
                );
                if (idx >= 0) {
                  estado.invitaciones[idx] = { ...estado.invitaciones[idx], ...cambios } as FilaInvitacion;
                }
                resolve({ data: null, error: null });
              },
            };
          }
          return builder([]);
        },
      };
    }

    if (tabla === "usuarios_perfil") {
      return {
        upsert: async (fila: Record<string, unknown>) => {
          const idx = estado.perfiles.findIndex((p) => p.id === fila.id);
          if (idx >= 0) estado.perfiles[idx] = fila;
          else estado.perfiles.push(fila);
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

  return { cliente: { auth: {}, from } as never, estado };
}

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "99999999-9999-9999-9999-999999999999";
const SELLER_A = "22222222-2222-2222-2222-222222222222";
const DRIVER_A = "33333333-3333-3333-3333-333333333333";
const ACTOR_USUARIO_ID = "actor-usuario-1";

function dueno(overrides?: Partial<UsuarioActual>): UsuarioActual {
  return {
    tenantId: TENANT_A,
    tipoUsuario: "interno",
    sellerId: null,
    driverId: null,
    rol: "dueno",
    estado: "activo",
    ...overrides,
  };
}

function coordinador(): UsuarioActual {
  return { ...dueno(), rol: "coordinador" };
}

// =============================================================================
// crearInvitacion
// =============================================================================
describe("crearInvitacion", () => {
  let cliente: ReturnType<typeof crearClienteFalso>["cliente"];
  let estado: EstadoFalso;

  beforeEach(() => {
    ({ cliente, estado } = crearClienteFalso());
  });

  it("rechaza si el actor no tiene capacidad de invitar (p. ej. coordinador)", async () => {
    await expect(
      crearInvitacion(cliente, coordinador(), ACTOR_USUARIO_ID, {
        email: "nuevo@example.com",
        tipoUsuario: "interno",
        rol: "supervisor",
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    expect(estado.invitaciones).toHaveLength(0);
  });

  it("crea una invitación interna válida, con token de un solo uso y vigencia futura", async () => {
    const resultado = await crearInvitacion(cliente, dueno(), ACTOR_USUARIO_ID, {
      email: "Supervisor.Nuevo@Example.com",
      tipoUsuario: "interno",
      rol: "supervisor",
    });

    expect(resultado.token).toBeTruthy();
    expect(resultado.token.length).toBeGreaterThanOrEqual(32);
    expect(new Date(resultado.expiraEn).getTime()).toBeGreaterThan(Date.now());

    expect(estado.invitaciones).toHaveLength(1);
    const fila = estado.invitaciones[0];
    expect(fila.tenant_id).toBe(TENANT_A); // del actor, NUNCA del input
    expect(fila.email).toBe("supervisor.nuevo@example.com"); // normalizado
    expect(fila.estado).toBe("pendiente");
    expect(fila.seller_id).toBeNull();
    expect(fila.driver_id).toBeNull();
  });

  it("genera tokens distintos en invitaciones sucesivas (un solo uso real)", async () => {
    const a = await crearInvitacion(cliente, dueno(), ACTOR_USUARIO_ID, {
      email: "uno@example.com",
      tipoUsuario: "interno",
      rol: "supervisor",
    });
    const b = await crearInvitacion(cliente, dueno(), ACTOR_USUARIO_ID, {
      email: "dos@example.com",
      tipoUsuario: "interno",
      rol: "coordinador",
    });
    expect(a.token).not.toBe(b.token);
  });

  it("rechaza invitación 'seller' sin seller_id", async () => {
    await expect(
      crearInvitacion(cliente, dueno(), ACTOR_USUARIO_ID, {
        email: "seller@example.com",
        tipoUsuario: "seller",
        rol: "seller",
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("rechaza invitación 'conductor' sin driver_id", async () => {
    await expect(
      crearInvitacion(cliente, dueno(), ACTOR_USUARIO_ID, {
        email: "conductor@example.com",
        tipoUsuario: "conductor",
        rol: "conductor",
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("rechaza incoherencia tipo_usuario vs. rol (p. ej. seller con rol dueno)", async () => {
    await expect(
      crearInvitacion(cliente, dueno(), ACTOR_USUARIO_ID, {
        email: "raro@example.com",
        tipoUsuario: "seller",
        rol: "dueno",
        sellerId: SELLER_A,
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("rechaza invitación interna con un rol no-interno (p. ej. 'seller')", async () => {
    await expect(
      crearInvitacion(cliente, dueno(), ACTOR_USUARIO_ID, {
        email: "raro2@example.com",
        tipoUsuario: "interno",
        rol: "seller",
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("crea invitación de seller válida y la registra en bitácora SIN el token", async () => {
    await crearInvitacion(cliente, dueno(), ACTOR_USUARIO_ID, {
      email: "seller.nuevo@example.com",
      tipoUsuario: "seller",
      rol: "seller",
      sellerId: SELLER_A,
    });

    expect(estado.bitacora).toHaveLength(1);
    const entrada = estado.bitacora[0];
    expect(entrada).toMatchObject({
      tenant_id: TENANT_A,
      actor_usuario_id: ACTOR_USUARIO_ID,
      actor_tipo: "usuario",
      accion: "invitacion.creada",
      entidad_tipo: "invitacion",
    });
    const detalle = entrada.detalle as Record<string, unknown>;
    expect(detalle).not.toHaveProperty("token");
    expect(JSON.stringify(detalle).toLowerCase()).not.toContain("token");
  });
});

// =============================================================================
// aceptarInvitacion
// =============================================================================
describe("aceptarInvitacion", () => {
  function invitacionBase(overrides?: Partial<FilaInvitacion>): FilaInvitacion {
    return {
      id: "inv-seed-1",
      tenant_id: TENANT_A,
      email: "invitado@example.com",
      tipo_usuario: "interno",
      rol: "supervisor",
      seller_id: null,
      driver_id: null,
      token: "token-valido-123",
      estado: "pendiente",
      expira_en: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // +1h
      ...overrides,
    };
  }

  it("rechaza un token inexistente", async () => {
    const { cliente } = crearClienteFalso({ invitaciones: [] });
    await expect(
      aceptarInvitacion(cliente, { token: "no-existe", usuarioAuthId: "u-1", nombreCompleto: "Juan Pérez" }),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it("rechaza una invitación ya aceptada (no es de un solo uso si se pudiera reusar)", async () => {
    const { cliente } = crearClienteFalso({ invitaciones: [invitacionBase({ estado: "aceptada" })] });
    await expect(
      aceptarInvitacion(cliente, { token: "token-valido-123", usuarioAuthId: "u-1", nombreCompleto: "Juan Pérez" }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it("rechaza una invitación revocada", async () => {
    const { cliente } = crearClienteFalso({ invitaciones: [invitacionBase({ estado: "revocada" })] });
    await expect(
      aceptarInvitacion(cliente, { token: "token-valido-123", usuarioAuthId: "u-1", nombreCompleto: "Juan Pérez" }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it("rechaza y marca como expirada una invitación cuya fecha ya pasó", async () => {
    const { cliente, estado } = crearClienteFalso({
      invitaciones: [invitacionBase({ expira_en: new Date(Date.now() - 60_000).toISOString() })],
    });

    await expect(
      aceptarInvitacion(cliente, { token: "token-valido-123", usuarioAuthId: "u-1", nombreCompleto: "Juan Pérez" }),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    expect(estado.invitaciones[0].estado).toBe("expirada");
    expect(estado.perfiles).toHaveLength(0);
  });

  it("acepta una invitación interna válida: crea el perfil consistente y la marca aceptada", async () => {
    const { cliente, estado } = crearClienteFalso({ invitaciones: [invitacionBase()] });

    const resultado = await aceptarInvitacion(cliente, {
      token: "token-valido-123",
      usuarioAuthId: "auth-user-9",
      nombreCompleto: "Juan Pérez",
    });

    expect(resultado).toEqual({ tenantId: TENANT_A, usuarioId: "auth-user-9", rol: "supervisor" });

    expect(estado.perfiles).toHaveLength(1);
    const perfil = estado.perfiles[0];
    // Coherencia EXACTA con los constraints de usuarios_perfil (migración 0001):
    // tipo_usuario='interno' → seller_id/driver_id deben ser NULL.
    expect(perfil).toMatchObject({
      id: "auth-user-9",
      tenant_id: TENANT_A,
      tipo_usuario: "interno",
      rol: "supervisor",
      estado: "activo",
      seller_id: null,
      driver_id: null,
    });

    expect(estado.invitaciones[0].estado).toBe("aceptada");
  });

  it("acepta una invitación de seller: el perfil queda con seller_id (no null) y driver_id null", async () => {
    const { cliente, estado } = crearClienteFalso({
      invitaciones: [
        invitacionBase({ tipo_usuario: "seller", rol: "seller", seller_id: SELLER_A, driver_id: null }),
      ],
    });

    await aceptarInvitacion(cliente, {
      token: "token-valido-123",
      usuarioAuthId: "auth-user-seller",
      nombreCompleto: "Carlos Seller",
    });

    const perfil = estado.perfiles[0];
    // Constraint usuarios_perfil_seller_id_coherente: tipo_usuario='seller' ⇒ seller_id NOT NULL.
    expect(perfil.tipo_usuario).toBe("seller");
    expect(perfil.seller_id).toBe(SELLER_A);
    expect(perfil.driver_id).toBeNull();
    expect(perfil.rol).toBe("seller");
  });

  it("acepta una invitación de conductor: el perfil queda con driver_id (no null) y seller_id null", async () => {
    const { cliente, estado } = crearClienteFalso({
      invitaciones: [
        invitacionBase({ tipo_usuario: "conductor", rol: "conductor", seller_id: null, driver_id: DRIVER_A }),
      ],
    });

    await aceptarInvitacion(cliente, {
      token: "token-valido-123",
      usuarioAuthId: "auth-user-conductor",
      nombreCompleto: "Pedro Conductor",
    });

    const perfil = estado.perfiles[0];
    // Constraint usuarios_perfil_driver_id_coherente: tipo_usuario='conductor' ⇒ driver_id NOT NULL.
    expect(perfil.tipo_usuario).toBe("conductor");
    expect(perfil.driver_id).toBe(DRIVER_A);
    expect(perfil.seller_id).toBeNull();
    expect(perfil.rol).toBe("conductor");
  });

  it("registra 'invitacion.aceptada' en la bitácora sin secretos", async () => {
    const { cliente, estado } = crearClienteFalso({ invitaciones: [invitacionBase()] });

    await aceptarInvitacion(cliente, {
      token: "token-valido-123",
      usuarioAuthId: "auth-user-9",
      nombreCompleto: "Juan Pérez",
    });

    expect(estado.bitacora).toHaveLength(1);
    expect(estado.bitacora[0]).toMatchObject({
      tenant_id: TENANT_A,
      actor_usuario_id: "auth-user-9",
      accion: "invitacion.aceptada",
      entidad_tipo: "invitacion",
    });
    const detalle = estado.bitacora[0].detalle as Record<string, unknown>;
    expect(JSON.stringify(detalle).toLowerCase()).not.toContain("token");
  });
});

// =============================================================================
// revocarInvitacion
// =============================================================================
describe("revocarInvitacion", () => {
  function invitacionBase(overrides?: Partial<FilaInvitacion>): FilaInvitacion {
    return {
      id: "inv-a-revocar",
      tenant_id: TENANT_A,
      email: "pendiente@example.com",
      tipo_usuario: "interno",
      rol: "coordinador",
      seller_id: null,
      driver_id: null,
      token: "token-x",
      estado: "pendiente",
      expira_en: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ...overrides,
    };
  }

  it("rechaza si el actor no tiene capacidad de revocar (p. ej. coordinador)", async () => {
    const { cliente, estado } = crearClienteFalso({ invitaciones: [invitacionBase()] });

    await expect(
      revocarInvitacion(cliente, coordinador(), ACTOR_USUARIO_ID, { invitacionId: "inv-a-revocar" }),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    expect(estado.invitaciones[0].estado).toBe("pendiente");
  });

  it("rechaza revocar una invitación de OTRO tenant (aislamiento incluso con service_role)", async () => {
    const { cliente, estado } = crearClienteFalso({
      invitaciones: [invitacionBase({ tenant_id: TENANT_B })],
    });

    await expect(
      revocarInvitacion(cliente, dueno(), ACTOR_USUARIO_ID, { invitacionId: "inv-a-revocar" }),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);

    expect(estado.invitaciones[0].estado).toBe("pendiente");
    expect(estado.bitacora).toHaveLength(0);
  });

  it("rechaza revocar una invitación que ya no está pendiente", async () => {
    const { cliente } = crearClienteFalso({ invitaciones: [invitacionBase({ estado: "aceptada" })] });

    await expect(
      revocarInvitacion(cliente, dueno(), ACTOR_USUARIO_ID, { invitacionId: "inv-a-revocar" }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it("revoca una invitación pendiente del propio tenant y deja traza en bitácora", async () => {
    const { cliente, estado } = crearClienteFalso({ invitaciones: [invitacionBase()] });

    await revocarInvitacion(cliente, dueno(), ACTOR_USUARIO_ID, { invitacionId: "inv-a-revocar" });

    expect(estado.invitaciones[0].estado).toBe("revocada");
    expect(estado.bitacora).toHaveLength(1);
    expect(estado.bitacora[0]).toMatchObject({
      tenant_id: TENANT_A,
      actor_usuario_id: ACTOR_USUARIO_ID,
      accion: "invitacion.revocada",
      entidad_tipo: "invitacion",
      entidad_id: "inv-a-revocar",
    });
  });

  it("rechaza si el actor interno no tiene tenant_id (defensivo)", async () => {
    const { cliente } = crearClienteFalso({ invitaciones: [invitacionBase()] });
    await expect(
      revocarInvitacion(cliente, dueno({ tenantId: null }), ACTOR_USUARIO_ID, { invitacionId: "inv-a-revocar" }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
