import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de las Server Actions de invitación de conductor (ficha
 * `/conductores/[id]`): `invitarConductor` y `obtenerInvitacionPendienteConductor`.
 *
 * Foco (encargo): estas dos funciones son la capa de aplicación que
 * ENSAMBLA el guard de negocio ("¿ya tiene cuenta o invitación pendiente?")
 * alrededor de `crearInvitacion` — que ya está probada en
 * `src/modules/identidad/invitaciones.test.ts` y NO se retesta aquí (se
 * mockea como caja negra, igual que `operacion/index` en
 * `actions-cancelacion.test.ts`). Lo que SÍ se prueba, porque es enteramente
 * nuevo:
 *   1. RBAC en la propia Server Action — `puedeInvitarUsuarios`, no una
 *      capacidad de operación ni una inventada.
 *   2. Aislamiento de TENANT: un `driverId` de otro courier nunca resuelve
 *      un conductor, aunque `service_role` saltee RLS (el filtro va en
 *      código, no en la base).
 *   3. El guard anti-duplicado: no se puede invitar dos veces a quien ya
 *      tiene cuenta o invitación pendiente vigente — SIN llamar a
 *      `crearInvitacion` en esos casos (la fricción que el encargo pide
 *      eliminar no debe ni siquiera intentar crear una segunda invitación).
 *   4. Una invitación pendiente pero VENCIDA no bloquea reinvitar.
 *   5. `obtenerInvitacionPendienteConductor` registra bitácora con el UUID
 *      de auth de la sesión como actor (RNF-04), nunca el token.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  obtenerSesionActual: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/identidad/invitaciones", () => ({
  crearInvitacion: vi.fn(),
}));

vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: vi.fn(),
}));

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { crearInvitacion } from "@/modules/identidad/invitaciones";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { ErrorConflicto, ErrorValidacion } from "@/modules/identidad/errores";
import { invitarConductor, obtenerInvitacionPendienteConductor } from "./actions";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import {
  crearClienteInvitacionesFalso,
  type FilaInvitacionFalsa,
} from "@/modules/identidad/invitaciones-postgrest-falso";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "20000000-0000-0000-0000-000000000002";
const DRIVER_A = "30000000-0000-0000-0000-000000000001";
const USUARIO_ID = "40000000-0000-0000-0000-000000000001";

function crearUsuario(overrides: Partial<UsuarioActual> = {}): UsuarioActual {
  return {
    tenantId: TENANT_A,
    tipoUsuario: "interno",
    sellerId: null,
    driverId: null,
    rol: "dueno",
    estado: "activo",
    ...overrides,
    areasHabilitadas: overrides.areasHabilitadas ?? [...AREAS_PRODUCTO],
  };
}

function crearSesion(overrides: Partial<UsuarioActual> = {}): SesionActual {
  return {
    usuarioId: USUARIO_ID,
    email: "dueno@example.com",
    nombreCompleto: "Dueño de Prueba",
    usuario: crearUsuario(overrides),
  };
}

// -----------------------------------------------------------------------------
// Doble de prueba del cliente service_role — tres tablas en memoria
// (`conductores`, `usuarios_perfil`, `invitaciones`), suficiente para probar
// las reglas de esta capa sin tocar Supabase real.
//
// `invitaciones` usa `crearClienteInvitacionesFalso` (NO un mock ingenuo):
// modela la diferencia real entre `public.invitaciones` (sin `token`) e
// `identidad.invitaciones` (con `token`) — migración 20260807000001.
// `obtenerInvitacionPendienteConductor` (abajo) SÍ pide `token`, así que debe
// usar `.schema("identidad")`; si alguna vez dejara de hacerlo, estos tests
// fallan con el mismo 42703 que rompió producción del 07-ago al 13-ago.
// -----------------------------------------------------------------------------

interface FilaConductor {
  id: string;
  tenant_id: string;
  nombre_completo: string;
}

interface FilaPerfil {
  driver_id: string;
  tenant_id: string;
  tipo_usuario: string;
  estado: string;
}

interface FilaInvitacion {
  id: string;
  driver_id: string;
  tenant_id: string;
  tipo_usuario: string;
  estado: string;
  expira_en: string;
  email: string;
  token: string;
}

interface SeedFalso {
  conductores?: FilaConductor[];
  perfiles?: FilaPerfil[];
  invitaciones?: FilaInvitacion[];
}

/**
 * `FilaInvitacionFalsa` (el doble schema-aware) exige `rol`/`seller_id` — son
 * columnas reales de `invitaciones`. Estos tests de conductor no varían esos
 * campos, así que se completan con el valor típico de una invitación de
 * conductor en vez de repetirlos en cada literal de prueba.
 */
function conCamposCompletos(filas: FilaInvitacion[]): FilaInvitacionFalsa[] {
  return filas.map((fila) => ({ rol: "conductor", seller_id: null, ...fila }));
}

function crearClienteFalso(seed: SeedFalso = {}) {
  const conductores = seed.conductores ?? [];
  const perfiles = seed.perfiles ?? [];

  function tablaGenerica<T extends object>(filas: T[]) {
    function builder(filtros: Array<[string, unknown]>) {
      return {
        eq(campo: string, valor: unknown) {
          return builder([...filtros, [campo, valor]]);
        },
        order() {
          return builder(filtros);
        },
        limit() {
          return builder(filtros);
        },
        async maybeSingle() {
          const encontrada = filas.find((fila) =>
            filtros.every(([campo, valor]) => (fila as Record<string, unknown>)[campo] === valor),
          );
          return { data: encontrada ?? null, error: null };
        },
      };
    }
    return { select: () => builder([]) };
  }

  const { cliente, estado: estadoInvitaciones } = crearClienteInvitacionesFalso({
    invitaciones: seed.invitaciones ? conCamposCompletos(seed.invitaciones) : undefined,
    otrasTablas: (tabla) => {
      if (tabla === "conductores") return tablaGenerica(conductores);
      if (tabla === "usuarios_perfil") return tablaGenerica(perfiles);
      throw new Error(`Tabla no soportada en el doble de prueba: ${tabla}`);
    },
  });

  const estado = { conductores, perfiles, invitaciones: estadoInvitaciones.invitaciones };

  return { cliente: cliente as unknown as ReturnType<typeof crearClienteServiceRole>, estado };
}

function conductorFalso(overrides: Partial<FilaConductor> = {}): FilaConductor {
  return {
    id: DRIVER_A,
    tenant_id: TENANT_A,
    nombre_completo: "Juan Pérez",
    ...overrides,
  };
}

const EN_UNA_HORA = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const HACE_UNA_HORA = new Date(Date.now() - 60 * 60 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion());
});

// =============================================================================
// invitarConductor
// =============================================================================
describe("invitarConductor", () => {
  it("rechaza sin sesión activa", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(null);

    const resultado = await invitarConductor(DRIVER_A, "conductor@example.com");

    expect(resultado).toEqual({ ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." });
    expect(crearInvitacion).not.toHaveBeenCalled();
  });

  it("rechaza por capacidad insuficiente (coordinador no tiene invitar_usuarios_internos)", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ rol: "coordinador" }));
    const { cliente } = crearClienteFalso({ conductores: [conductorFalso()] });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await invitarConductor(DRIVER_A, "conductor@example.com");

    expect(resultado).toMatchObject({ ok: false, tipo: "permiso" });
    expect(crearInvitacion).not.toHaveBeenCalled();
  });

  it("rechaza por capacidad insuficiente (administracion tampoco invita, aunque sí ve la ficha)", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ rol: "administracion" }));
    const { cliente } = crearClienteFalso({ conductores: [conductorFalso()] });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await invitarConductor(DRIVER_A, "conductor@example.com");

    expect(resultado).toMatchObject({ ok: false, tipo: "permiso" });
    expect(crearInvitacion).not.toHaveBeenCalled();
  });

  it("rechaza un correo inválido sin tocar la base de datos", async () => {
    const { cliente } = crearClienteFalso({ conductores: [conductorFalso()] });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await invitarConductor(DRIVER_A, "no-es-un-correo");

    expect(resultado).toEqual({ ok: false, tipo: "validacion", mensaje: "Ingresa un correo válido." });
    expect(crearInvitacion).not.toHaveBeenCalled();
  });

  it("CRUCE DE TENANT: un driverId de otro courier nunca resuelve, aunque exista en la base", async () => {
    const { cliente } = crearClienteFalso({
      // El conductor existe, pero pertenece a OTRO tenant.
      conductores: [conductorFalso({ tenant_id: OTRO_TENANT })],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await invitarConductor(DRIVER_A, "conductor@example.com");

    expect(resultado).toEqual({ ok: false, tipo: "validacion", mensaje: "No encontramos a este conductor." });
    expect(crearInvitacion).not.toHaveBeenCalled();
  });

  it("rechaza si el conductor no existe en absoluto", async () => {
    const { cliente } = crearClienteFalso({ conductores: [] });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await invitarConductor(DRIVER_A, "conductor@example.com");

    expect(resultado).toEqual({ ok: false, tipo: "validacion", mensaje: "No encontramos a este conductor." });
    expect(crearInvitacion).not.toHaveBeenCalled();
  });

  it("GUARD ANTI-DUPLICADO: no invita si el conductor ya tiene una cuenta, y no llama a crearInvitacion", async () => {
    const { cliente } = crearClienteFalso({
      conductores: [conductorFalso()],
      perfiles: [{ driver_id: DRIVER_A, tenant_id: TENANT_A, tipo_usuario: "conductor", estado: "activo" }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await invitarConductor(DRIVER_A, "conductor@example.com");

    expect(resultado).toEqual({
      ok: false,
      tipo: "conflicto",
      mensaje: "Juan Pérez ya tiene una cuenta en la app.",
    });
    expect(crearInvitacion).not.toHaveBeenCalled();
  });

  it("GUARD ANTI-DUPLICADO: no invita si ya hay una invitación pendiente VIGENTE", async () => {
    const { cliente } = crearClienteFalso({
      conductores: [conductorFalso()],
      invitaciones: [
        {
          id: "inv-1",
          driver_id: DRIVER_A,
          tenant_id: TENANT_A,
          tipo_usuario: "conductor",
          estado: "pendiente",
          expira_en: EN_UNA_HORA,
          email: "conductor@example.com",
          token: "token-secreto",
        },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await invitarConductor(DRIVER_A, "otro-correo@example.com");

    expect(resultado).toEqual({
      ok: false,
      tipo: "conflicto",
      mensaje: 'Este conductor ya tiene una invitación pendiente — usa "Copiar enlace" para compartírsela de nuevo.',
    });
    expect(crearInvitacion).not.toHaveBeenCalled();
  });

  it("una invitación pendiente pero VENCIDA no bloquea reinvitar", async () => {
    const { cliente } = crearClienteFalso({
      conductores: [conductorFalso()],
      invitaciones: [
        {
          id: "inv-vieja",
          driver_id: DRIVER_A,
          tenant_id: TENANT_A,
          tipo_usuario: "conductor",
          estado: "pendiente",
          expira_en: HACE_UNA_HORA,
          email: "conductor@example.com",
          token: "token-viejo",
        },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);
    vi.mocked(crearInvitacion).mockResolvedValue({
      id: "inv-nueva",
      token: "token-nuevo",
      expiraEn: EN_UNA_HORA,
      emailEnviado: true,
    });

    const resultado = await invitarConductor(DRIVER_A, "conductor@example.com");

    expect(crearInvitacion).toHaveBeenCalledTimes(1);
    expect(resultado.ok).toBe(true);
  });

  it("invita correctamente: delega a crearInvitacion con tipoUsuario/rol/driverId coherentes", async () => {
    const { cliente } = crearClienteFalso({ conductores: [conductorFalso()] });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);
    vi.mocked(crearInvitacion).mockResolvedValue({
      id: "inv-1",
      token: "token-secreto",
      expiraEn: EN_UNA_HORA,
      emailEnviado: true,
    });

    const resultado = await invitarConductor(DRIVER_A, "  Conductor@Example.com  ");

    expect(crearInvitacion).toHaveBeenCalledTimes(1);
    const [clienteRecibido, actorRecibido, actorUsuarioIdRecibido, inputRecibido] = vi.mocked(crearInvitacion).mock
      .calls[0];
    expect(clienteRecibido).toBe(cliente);
    expect(actorRecibido).toEqual(crearUsuario());
    expect(actorUsuarioIdRecibido).toBe(USUARIO_ID);
    expect(inputRecibido).toEqual({
      email: "conductor@example.com", // normalizado: trim + minúsculas
      tipoUsuario: "conductor",
      rol: "conductor",
      driverId: DRIVER_A,
    });

    expect(resultado).toEqual({
      ok: true,
      invitacion: { email: "conductor@example.com", expiraEn: EN_UNA_HORA, emailEnviado: true },
    });
  });

  it("mapea ErrorValidacion de crearInvitacion a tipo 'validacion'", async () => {
    const { cliente } = crearClienteFalso({ conductores: [conductorFalso()] });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);
    vi.mocked(crearInvitacion).mockRejectedValue(new ErrorValidacion("mensaje de validación de dominio"));

    const resultado = await invitarConductor(DRIVER_A, "conductor@example.com");

    expect(resultado).toEqual({ ok: false, tipo: "validacion", mensaje: "mensaje de validación de dominio" });
  });

  it("mapea ErrorConflicto de crearInvitacion a tipo 'conflicto'", async () => {
    const { cliente } = crearClienteFalso({ conductores: [conductorFalso()] });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);
    vi.mocked(crearInvitacion).mockRejectedValue(new ErrorConflicto("conflicto de dominio"));

    const resultado = await invitarConductor(DRIVER_A, "conductor@example.com");

    expect(resultado).toEqual({ ok: false, tipo: "conflicto", mensaje: "conflicto de dominio" });
  });
});

// =============================================================================
// obtenerInvitacionPendienteConductor
// =============================================================================
describe("obtenerInvitacionPendienteConductor", () => {
  it("rechaza sin sesión activa", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(null);

    const resultado = await obtenerInvitacionPendienteConductor(DRIVER_A);

    expect(resultado).toEqual({ ok: false, mensaje: "No hay una sesión activa." });
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("rechaza por capacidad insuficiente", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesion({ rol: "coordinador" }));
    const { cliente } = crearClienteFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await obtenerInvitacionPendienteConductor(DRIVER_A);

    expect(resultado.ok).toBe(false);
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("CRUCE DE TENANT: no devuelve el token de una invitación de otro courier", async () => {
    const { cliente } = crearClienteFalso({
      invitaciones: [
        {
          id: "inv-otro-tenant",
          driver_id: DRIVER_A,
          tenant_id: OTRO_TENANT,
          tipo_usuario: "conductor",
          estado: "pendiente",
          expira_en: EN_UNA_HORA,
          email: "conductor@example.com",
          token: "token-ajeno",
        },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await obtenerInvitacionPendienteConductor(DRIVER_A);

    expect(resultado).toEqual({
      ok: false,
      mensaje: "Este conductor ya no tiene una invitación pendiente — puede que ya haya entrado.",
    });
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("dice que venció cuando la invitación pendiente ya pasó su fecha", async () => {
    const { cliente } = crearClienteFalso({
      invitaciones: [
        {
          id: "inv-vencida",
          driver_id: DRIVER_A,
          tenant_id: TENANT_A,
          tipo_usuario: "conductor",
          estado: "pendiente",
          expira_en: HACE_UNA_HORA,
          email: "conductor@example.com",
          token: "token-vencido",
        },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await obtenerInvitacionPendienteConductor(DRIVER_A);

    expect(resultado).toEqual({
      ok: false,
      mensaje: "Esta invitación venció. Vuelve a invitarlo para generar una nueva.",
    });
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("entrega el token y audita con el UUID de auth de la sesión como actor — nunca el token", async () => {
    const { cliente } = crearClienteFalso({
      invitaciones: [
        {
          id: "inv-1",
          driver_id: DRIVER_A,
          tenant_id: TENANT_A,
          tipo_usuario: "conductor",
          estado: "pendiente",
          expira_en: EN_UNA_HORA,
          email: "conductor@example.com",
          token: "token-secreto-no-debe-ir-a-bitacora",
        },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await obtenerInvitacionPendienteConductor(DRIVER_A);

    expect(resultado).toEqual({
      ok: true,
      token: "token-secreto-no-debe-ir-a-bitacora",
      email: "conductor@example.com",
      expiraEn: EN_UNA_HORA,
    });

    expect(registrarEnBitacora).toHaveBeenCalledTimes(1);
    const [clienteRecibido, entrada] = vi.mocked(registrarEnBitacora).mock.calls[0];
    expect(clienteRecibido).toBe(cliente);
    expect(entrada).toMatchObject({
      tenantId: TENANT_A,
      actorUsuarioId: USUARIO_ID, // sesion.usuarioId — el UUID de auth, RNF-04
      actorTipo: "usuario",
      accion: "invitacion.enlace_entregado",
      entidadTipo: "invitacion",
      entidadId: "inv-1",
    });
    // El token JAMÁS viaja al detalle de la bitácora.
    expect(JSON.stringify(entrada.detalle)).not.toContain("token-secreto-no-debe-ir-a-bitacora");
  });
});
