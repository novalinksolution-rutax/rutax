/**
 * Tests de `baja-cuentas.ts` — dar de baja / reactivar cuentas de personas
 * desde `/admin/cuentas`.
 *
 * Foco (pedido explícito de la tarea):
 *  - El predicado `tieneRelacionConPedidosODinero` (permisivo: cualquier fila
 *    en cualquier tabla cuenta).
 *  - El borde "último dueño activo" de un tenant (se bloquea / no se bloquea).
 *  - El flujo multi-courier: bloquear la membresía mostrada + repuntar
 *    `usuarios_perfil` a otra membresía activa, SIN tocar la sesión.
 *  - La degradación `23503` → desactivación cuando el borrado duro de la
 *    ficha choca con una FK que el predicado no vio venir.
 *
 * `bloquearSellerMembresia`/`desbloquearSellerMembresia`/`cambiarCourierActivo`
 * se mockean enteros: son de `identidad/seller-membresias.ts`, ya cubiertos
 * por sus propios tests — acá solo importa que se los llame con los
 * argumentos correctos, no re-probar su lógica interna.
 *
 * Mismo patrón de mocks que `acciones.test.ts`/`soporte.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/identidad/seller-membresias", () => ({
  bloquearSellerMembresia: vi.fn().mockResolvedValue(undefined),
  desbloquearSellerMembresia: vi.fn().mockResolvedValue(undefined),
  cambiarCourierActivo: vi.fn().mockResolvedValue({ tenantId: "otro", sellerId: "otro-seller" }),
}));

vi.mock("@/modules/integraciones/ml/puerto", () => ({
  obtenerConexionesPorSeller: vi.fn().mockResolvedValue([]),
  revocarConexionMlPorAdministrador: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/integraciones/shopify/puerto", () => ({
  obtenerConexionesPorSeller: vi.fn().mockResolvedValue([]),
  desconectarTienda: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./whatsapp-destinatarios", () => ({
  revocarDestinatario: vi.fn().mockResolvedValue({ ok: true }),
}));

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  bloquearSellerMembresia,
  cambiarCourierActivo,
} from "@/modules/identidad/seller-membresias";
import { tieneRelacionConPedidosODinero, darDeBajaCuenta, previsualizarBajaCuenta } from "./baja-cuentas";
import { RpcEliminarCuentaNoDisponibleError } from "./eliminar-cuenta-persona-rpc";

const ACTOR = "ad000000-0000-0000-0000-000000000001";

// =============================================================================
// Mock de cliente para el PREDICADO — chain mínimo `.select().eq().eq()`
// =============================================================================
function clientePredicado(conteos: Record<string, number>): SupabaseClient {
  function terminal(clave: string): unknown {
    const nodo: Record<string, unknown> = {
      eq: () => terminal(clave),
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve({ count: conteos[clave] ?? 0, error: null }).then(resolve),
    };
    return nodo;
  }
  function base(clave: string) {
    return { select: () => terminal(clave) };
  }
  return {
    schema: (s: string) => ({ from: (t: string) => base(`${s}.${t}`) }),
  } as unknown as SupabaseClient;
}

describe("tieneRelacionConPedidosODinero", () => {
  it("sin ninguna fila en ninguna tabla → false", async () => {
    const cliente = clientePredicado({});
    const resultado = await tieneRelacionConPedidosODinero(cliente, {
      tipo: "seller",
      tenantId: "t1",
      entidadId: "s1",
    });
    expect(resultado).toBe(false);
  });

  it("una fila en CUALQUIER tabla de la lista → true (permisivo)", async () => {
    // dinero.pagos_recibidos no es la primera tabla de la lista — prueba que
    // no se corta prematuro ni se necesita que sea operacion.pedidos.
    const cliente = clientePredicado({ "dinero.pagos_recibidos": 1 });
    const resultado = await tieneRelacionConPedidosODinero(cliente, {
      tipo: "seller",
      tenantId: "t1",
      entidadId: "s1",
    });
    expect(resultado).toBe(true);
  });

  it("conductor: una fila en pruebas_entrega (columna conductor_id, no driver_id) → true", async () => {
    const cliente = clientePredicado({ "operacion.pruebas_entrega": 1 });
    const resultado = await tieneRelacionConPedidosODinero(cliente, {
      tipo: "conductor",
      tenantId: "t1",
      entidadId: "d1",
    });
    expect(resultado).toBe(true);
  });
});

// =============================================================================
// Mock de cliente para las ORQUESTACIONES (darDeBajaCuenta) — colas por tabla,
// separadas entre terminal `.maybeSingle()`/`.single()` ("single") y `await`
// directo ("bare", usado tanto por conteos como por update/delete sin select).
// Sin entrada configurada, responde con el default más inofensivo posible.
// =============================================================================
type Resp = { data?: unknown; error?: unknown; count?: number };

function crearClienteOrquestacion(
  colas: Record<string, Resp[]> = {},
  opciones: { rpcError?: unknown } = {},
): SupabaseClient {
  const copia = new Map<string, Resp[]>(
    Object.entries(colas).map(([k, v]) => [k, [...v]]),
  );

  function tomar(clave: string): Resp {
    const cola = copia.get(clave);
    if (cola && cola.length > 0) return cola.shift() as Resp;
    return { data: null, error: null, count: 0 };
  }

  function builder(clave: string): Record<string, unknown> {
    const nodo: Record<string, unknown> = {
      select: () => nodo,
      eq: () => nodo,
      neq: () => nodo,
      update: () => nodo,
      delete: () => nodo,
      maybeSingle: () => Promise.resolve(tomar(`${clave}#single`)),
      single: () => Promise.resolve(tomar(`${clave}#single`)),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(tomar(`${clave}#bare`)).then(resolve, reject),
    };
    return nodo;
  }

  // `eliminar_cuenta_persona` (la RPC atómica de `eliminar-cuenta-persona-rpc.ts`):
  // por defecto "éxito" (sin error) — los tests que necesitan la degradación
  // pasan `opciones.rpcError`.
  const rpc = vi.fn().mockResolvedValue({ data: null, error: opciones.rpcError ?? null });

  return {
    schema: (s: string) => ({ from: (t: string) => builder(`${s}.${t}`), rpc }),
    from: (t: string) => builder(`public.${t}`),
    rpc,
    auth: {
      admin: {
        updateUserById: vi.fn().mockResolvedValue({ data: {}, error: null }),
        deleteUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    },
  } as unknown as SupabaseClient;
}

function filaPerfil(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: {
      id: "usuario-1",
      tenant_id: "tenant-1",
      tipo_usuario: "interno",
      rol: "supervisor",
      estado: "activo",
      seller_id: null,
      driver_id: null,
      ...overrides,
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("darDeBajaCuenta — borde del último dueño activo", () => {
  it("bloquea la baja si es el ÚNICO dueño activo del tenant", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({ tipo_usuario: "interno", rol: "dueno", estado: "activo" }),
      ],
      // esUltimoDuenoActivo: cero OTROS dueños activos.
      "identidad.usuarios_perfil#bare": [{ count: 0, error: null }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({ actorUsuarioId: ACTOR, usuarioId: "usuario-1" });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.motivo).toMatch(/único dueño activo/i);
    }
    // No se llegó a tocar Auth: ni ban ni delete.
    expect(cliente.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(cliente.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("NO bloquea si hay otro dueño activo — suspende y revoca la sesión", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({ tipo_usuario: "interno", rol: "dueno", estado: "activo" }),
      ],
      // esUltimoDuenoActivo: hay 1 OTRO dueño activo.
      // El siguiente #bare es el UPDATE final de darDeBajaInterno.
      "identidad.usuarios_perfil#bare": [
        { count: 1, error: null },
        { error: null },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({ actorUsuarioId: ACTOR, usuarioId: "usuario-1" });

    expect(resultado).toEqual({ ok: true, accion: "desactivada" });
    expect(cliente.auth.admin.updateUserById).toHaveBeenCalledWith(
      "usuario-1",
      expect.objectContaining({ ban_duration: expect.any(String) }),
    );
  });
});

describe("darDeBajaCuenta — interno invitado (nunca activó)", () => {
  it("se ELIMINA (borra auth.users), no se desactiva", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({ tipo_usuario: "interno", rol: "dueno", estado: "invitado" }),
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({ actorUsuarioId: ACTOR, usuarioId: "usuario-1" });

    expect(resultado).toEqual({ ok: true, accion: "eliminada" });
    expect(cliente.auth.admin.deleteUser).toHaveBeenCalledWith("usuario-1");
  });

  it("interno ACTIVO se desactiva, nunca se elimina", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({ tipo_usuario: "interno", rol: "supervisor", estado: "activo" }),
      ],
      // esUltimoDuenoActivo no aplica (no es dueño); el #bare es el UPDATE.
      "identidad.usuarios_perfil#bare": [{ error: null }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({ actorUsuarioId: ACTOR, usuarioId: "usuario-1" });

    expect(resultado).toEqual({ ok: true, accion: "desactivada" });
    expect(cliente.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
});

describe("darDeBajaCuenta — seller multi-courier", () => {
  it("bloquea SOLO la membresía mostrada y repunta a la otra membresía activa (sin tocar la sesión)", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({
          tipo_usuario: "seller",
          rol: "seller",
          estado: "activo",
          seller_id: "seller-tenant1",
          tenant_id: "tenant-1",
        }),
      ],
      // leerMembresias: dos membresías, la mostrada (tenant-1) y otra activa
      // en tenant-2.
      "identidad.seller_membresias#bare": [
        {
          data: [
            { id: "m1", tenant_id: "tenant-1", seller_id: "seller-tenant1", estado: "activa" },
            { id: "m2", tenant_id: "tenant-2", seller_id: "seller-tenant2", estado: "activa" },
          ],
          error: null,
        },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({ actorUsuarioId: ACTOR, usuarioId: "usuario-1" });

    expect(resultado).toEqual({ ok: true, accion: "desactivada" });

    expect(bloquearSellerMembresia).toHaveBeenCalledWith(
      cliente,
      expect.objectContaining({ tenantId: "tenant-1", sellerId: "seller-tenant1", actorUsuarioId: ACTOR }),
    );
    expect(cambiarCourierActivo).toHaveBeenCalledWith(
      cliente,
      expect.objectContaining({ authUserId: "usuario-1", tenantId: "tenant-2" }),
    );

    // Sigue operando con el otro courier: la sesión NO se revoca.
    expect(cliente.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(cliente.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("última membresía + sin relación financiera → purga la identidad completa", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({
          tipo_usuario: "seller",
          rol: "seller",
          estado: "activo",
          seller_id: "seller-unico",
          tenant_id: "tenant-1",
        }),
      ],
      "identidad.seller_membresias#bare": [
        {
          data: [{ id: "m1", tenant_id: "tenant-1", seller_id: "seller-unico", estado: "activa" }],
          error: null,
        },
      ],
      // otraCuentaReferenciaFicha (cuenta compartida): nadie más referencia la
      // ficha. La RPC (eliminar_cuenta_persona) se mockea con éxito por
      // defecto — ver `crearClienteOrquestacion`.
      "identidad.usuarios_perfil#bare": [{ count: 0, error: null }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({ actorUsuarioId: ACTOR, usuarioId: "usuario-1" });

    expect(resultado).toEqual({ ok: true, accion: "eliminada" });
    expect(cliente.rpc).toHaveBeenCalledWith(
      "eliminar_cuenta_persona",
      expect.objectContaining({
        p_usuario_id: "usuario-1",
        p_tipo: "seller",
        p_tenant_id: "tenant-1",
        p_entidad_id: "seller-unico",
      }),
    );
    expect(cliente.auth.admin.deleteUser).toHaveBeenCalledWith("usuario-1");
  });

  it("última membresía pero la RPC falla (rollback): degrada a desactivación, NUNCA borra auth.users", async () => {
    const cliente = crearClienteOrquestacion(
      {
        "identidad.usuarios_perfil#single": [
          filaPerfil({
            tipo_usuario: "seller",
            rol: "seller",
            estado: "activo",
            seller_id: "seller-unico",
            tenant_id: "tenant-1",
          }),
        ],
        "identidad.seller_membresias#bare": [
          {
            data: [{ id: "m1", tenant_id: "tenant-1", seller_id: "seller-unico", estado: "activa" }],
            error: null,
          },
        ],
        "identidad.usuarios_perfil#bare": [{ count: 0, error: null }],
      },
      { rpcError: { code: "23503", message: "update or delete violates foreign key constraint" } },
    );
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({ actorUsuarioId: ACTOR, usuarioId: "usuario-1" });

    expect(resultado).toEqual({ ok: true, accion: "desactivada" });
    // La RPC falló → rollback completo → jamás se llega a borrar auth.users.
    expect(cliente.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(cliente.auth.admin.updateUserById).toHaveBeenCalledWith(
      "usuario-1",
      expect.objectContaining({ ban_duration: expect.any(String) }),
    );
  });
});

describe("darDeBajaCuenta — degradación (RPC falla) → desactivación", () => {
  it("conductor sin relación financiera, pero la RPC atómica falla (FK inesperada): cae a desactivación, sin huérfanos", async () => {
    const cliente = crearClienteOrquestacion(
      {
        "identidad.usuarios_perfil#single": [
          filaPerfil({
            tipo_usuario: "conductor",
            rol: "conductor",
            estado: "activo",
            driver_id: "conductor-1",
          }),
        ],
        // otraCuentaReferenciaFicha: nadie más referencia esta ficha.
        "identidad.usuarios_perfil#bare": [{ count: 0, error: null }],
      },
      // La RPC (eliminar_cuenta_persona) choca con una FK que el predicado no
      // enumeraba — hace ROLLBACK completo (nada se borró, ni el perfil).
      { rpcError: { code: "23503", message: "update or delete violates foreign key constraint" } },
    );
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({ actorUsuarioId: ACTOR, usuarioId: "usuario-1" });

    expect(resultado).toEqual({ ok: true, accion: "desactivada" });
    // La RPC falló → rollback completo → el perfil NUNCA se borró → sigue
    // vivo y se suspende. auth.users jamás se toca.
    expect(cliente.auth.admin.updateUserById).toHaveBeenCalledWith(
      "usuario-1",
      expect.objectContaining({ ban_duration: expect.any(String) }),
    );
    expect(cliente.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
});

describe("darDeBajaCuenta — PGRST202 (RPC fuera del caché) NO degrada en silencio", () => {
  // El bug del 17-sep: la RPC no estaba en el caché de esquema de PostgREST →
  // PGRST202 → el envoltorio lo trataba como "falló" → degradaba a desactivación
  // → la ficha sobrevivía como huérfano invisible (choque de RUT al re-registrar).
  // Ahora PGRST202 LANZA en vez de degradar, para que el admin reintente.
  it("seller: la RPC devuelve PGRST202 → LANZA, y jamás toca auth.users", async () => {
    const cliente = crearClienteOrquestacion(
      {
        "identidad.usuarios_perfil#single": [
          filaPerfil({
            tipo_usuario: "seller",
            rol: "seller",
            estado: "activo",
            seller_id: "seller-unico",
            tenant_id: "tenant-1",
          }),
        ],
        "identidad.seller_membresias#bare": [
          {
            data: [{ id: "m1", tenant_id: "tenant-1", seller_id: "seller-unico", estado: "activa" }],
            error: null,
          },
        ],
        "identidad.usuarios_perfil#bare": [{ count: 0, error: null }],
      },
      {
        rpcError: {
          code: "PGRST202",
          message: "Could not find the function identidad.eliminar_cuenta_persona in the schema cache",
        },
      },
    );
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    await expect(darDeBajaCuenta({ actorUsuarioId: ACTOR, usuarioId: "usuario-1" })).rejects.toBeInstanceOf(
      RpcEliminarCuentaNoDisponibleError,
    );
    // Nunca se borró la cuenta de Auth: NO hay desactivación falsa con huérfano.
    expect(cliente.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
});

describe("darDeBajaCuenta — sin_perfil", () => {
  it("una cuenta sin fila en usuarios_perfil siempre se elimina", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [{ data: null, error: null }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({ actorUsuarioId: ACTOR, usuarioId: "huerfano-1" });

    expect(resultado).toEqual({ ok: true, accion: "eliminada" });
    expect(cliente.auth.admin.deleteUser).toHaveBeenCalledWith("huerfano-1");
  });
});

// =============================================================================
// previsualizarBajaCuenta — DEBE espejar exactamente la decisión de
// darDeBajaCuenta (sin mutar nada). Los cuatro casos clave que el veredicto no
// puede fallar: interno → desactivada, conductor sin relación → eliminada,
// seller multi-courier con otra membresía activa → desactivada, y el borde del
// último dueño activo → bloqueada (ok:false). Si algún día alguien toca una de
// las dos funciones y no la otra, esta suite es la que detecta el drift.
// =============================================================================
describe("previsualizarBajaCuenta — espeja darDeBajaCuenta sin mutar", () => {
  it("interno activo (no último dueño) → desactivada, sin tocar Auth ni escribir nada", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({ tipo_usuario: "interno", rol: "supervisor", estado: "activo" }),
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await previsualizarBajaCuenta("usuario-1");

    expect(resultado).toEqual({
      ok: true,
      accionPrevista: "desactivada",
      tipoUsuario: "interno",
      otrosCouriersActivos: 0,
    });
    // Es SOLO lectura: nunca se llega a mutar auth ni la base.
    expect(cliente.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(cliente.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("interno invitado (nunca activó) → eliminada", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({ tipo_usuario: "interno", rol: "dueno", estado: "invitado" }),
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await previsualizarBajaCuenta("usuario-1");

    expect(resultado).toEqual({
      ok: true,
      accionPrevista: "eliminada",
      tipoUsuario: "interno",
      otrosCouriersActivos: 0,
    });
    expect(cliente.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("conductor sin relación financiera → eliminada (coincide con darDeBajaCuenta cuando no hay FK sorpresa)", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({
          tipo_usuario: "conductor",
          rol: "conductor",
          estado: "activo",
          driver_id: "conductor-1",
        }),
      ],
      // tieneRelacionConPedidosODinero: ninguna tabla configurada → todas en 0
      // (default de crearClienteOrquestacion) → sin relación.
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await previsualizarBajaCuenta("usuario-1");

    expect(resultado).toEqual({
      ok: true,
      accionPrevista: "eliminada",
      tipoUsuario: "conductor",
      otrosCouriersActivos: 0,
    });
  });

  it("conductor CON relación financiera → desactivada, nunca eliminada", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({
          tipo_usuario: "conductor",
          rol: "conductor",
          estado: "activo",
          driver_id: "conductor-1",
        }),
      ],
      // Una fila en cualquier tabla del predicado ya basta (permisivo).
      "dinero.liquidaciones#bare": [{ count: 1, error: null }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await previsualizarBajaCuenta("usuario-1");

    expect(resultado).toEqual({
      ok: true,
      accionPrevista: "desactivada",
      tipoUsuario: "conductor",
      otrosCouriersActivos: 0,
    });
  });

  it("seller multi-courier con otra membresía ACTIVA en otro tenant → desactivada (nunca purga la identidad)", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({
          tipo_usuario: "seller",
          rol: "seller",
          estado: "activo",
          seller_id: "seller-tenant1",
          tenant_id: "tenant-1",
        }),
      ],
      "identidad.seller_membresias#bare": [
        {
          data: [
            { id: "m1", tenant_id: "tenant-1", seller_id: "seller-tenant1", estado: "activa" },
            { id: "m2", tenant_id: "tenant-2", seller_id: "seller-tenant2", estado: "activa" },
          ],
          error: null,
        },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await previsualizarBajaCuenta("usuario-1");

    expect(resultado).toEqual({
      ok: true,
      accionPrevista: "desactivada",
      tipoUsuario: "seller",
      otrosCouriersActivos: 1,
    });
  });

  it("seller: única membresía + sin relación → eliminada (coincide con la purga completa de darDeBajaCuenta)", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({
          tipo_usuario: "seller",
          rol: "seller",
          estado: "activo",
          seller_id: "seller-unico",
          tenant_id: "tenant-1",
        }),
      ],
      "identidad.seller_membresias#bare": [
        {
          data: [{ id: "m1", tenant_id: "tenant-1", seller_id: "seller-unico", estado: "activa" }],
          error: null,
        },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await previsualizarBajaCuenta("usuario-1");

    expect(resultado).toEqual({
      ok: true,
      accionPrevista: "eliminada",
      tipoUsuario: "seller",
      otrosCouriersActivos: 0,
    });
  });

  it("último dueño activo del tenant → bloqueada (ok:false), igual que darDeBajaCuenta", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({ tipo_usuario: "interno", rol: "dueno", estado: "activo" }),
      ],
      // esUltimoDuenoActivo: cero OTROS dueños activos del tenant.
      "identidad.usuarios_perfil#bare": [{ count: 0, error: null }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await previsualizarBajaCuenta("usuario-1");

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.motivo).toMatch(/único dueño activo/i);
    }
    expect(cliente.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("cuenta sin perfil (huérfana en Auth) → siempre eliminada, igual que darDeBajaCuenta", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [{ data: null, error: null }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await previsualizarBajaCuenta("huerfano-1");

    expect(resultado).toEqual({
      ok: true,
      accionPrevista: "eliminada",
      tipoUsuario: null,
      otrosCouriersActivos: 0,
    });
  });
});

// =============================================================================
// accionEsperada — la guarda TOCTOU (MUST-FIX #5)
// =============================================================================
describe("darDeBajaCuenta — accionEsperada (TOCTOU)", () => {
  it("el admin confirmó 'desactivada' pero la evaluación fresca da 'eliminada' → aborta SIN escribir nada", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({
          tipo_usuario: "conductor",
          rol: "conductor",
          estado: "activo",
          driver_id: "conductor-1",
        }),
      ],
      // Sin relación financiera configurada → tieneRelacionConPedidosODinero
      // da false → la evaluación fresca es "eliminada".
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({
      actorUsuarioId: ACTOR,
      usuarioId: "usuario-1",
      accionEsperada: "desactivada",
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.motivo).toMatch(/situación de la cuenta cambió/i);
    }
    // Abortó ANTES de escribir: nada de Auth, ni bitácora (mock ya limpio),
    // ni RPC.
    expect(cliente.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(cliente.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(cliente.rpc).not.toHaveBeenCalled();
  });

  it("el admin confirmó 'eliminada' pero la evaluación fresca degrada a 'desactivada' → NO se bloquea (dirección segura)", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({
          tipo_usuario: "conductor",
          rol: "conductor",
          estado: "activo",
          driver_id: "conductor-1",
        }),
      ],
      // CON relación financiera → la evaluación fresca es "desactivada".
      "dinero.liquidaciones#bare": [{ count: 1, error: null }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({
      actorUsuarioId: ACTOR,
      usuarioId: "usuario-1",
      accionEsperada: "eliminada",
    });

    // Nunca se bloquea ir de "eliminada" (lo esperado) a "desactivada" (lo
    // real): es más seguro que lo confirmado, no menos.
    expect(resultado).toEqual({ ok: true, accion: "desactivada" });
  });

  it("sin accionEsperada (retrocompatible): nunca aborta por TOCTOU", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({
          tipo_usuario: "conductor",
          rol: "conductor",
          estado: "activo",
          driver_id: "conductor-1",
        }),
      ],
      "identidad.usuarios_perfil#bare": [{ count: 0, error: null }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({ actorUsuarioId: ACTOR, usuarioId: "usuario-1" });

    expect(resultado).toEqual({ ok: true, accion: "eliminada" });
  });
});

// =============================================================================
// entidad_compartida — la RPC de borrado duro NUNCA se llama sobre una ficha
// compartida (MUST-FIX #1: antes de la RPC, esta rama ya existía; se confirma
// que sigue viva tras el refactor).
// =============================================================================
describe("darDeBajaCuenta — entidad_compartida nunca llama a la RPC de borrado duro", () => {
  it("conductor: ficha referenciada por otra cuenta → borra solo el perfil, la RPC NUNCA se llama", async () => {
    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({
          tipo_usuario: "conductor",
          rol: "conductor",
          estado: "activo",
          driver_id: "conductor-compartido",
        }),
      ],
      "identidad.usuarios_perfil#bare": [
        { count: 1, error: null }, // otraCuentaReferenciaFicha: SÍ hay otra cuenta.
        { error: null }, // delete usuarios_perfil (esta cuenta, no la ficha).
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({ actorUsuarioId: ACTOR, usuarioId: "usuario-1" });

    expect(resultado).toEqual({ ok: true, accion: "eliminada" });
    expect(cliente.rpc).not.toHaveBeenCalled();
    expect(cliente.auth.admin.deleteUser).toHaveBeenCalledWith("usuario-1");
  });
});

// =============================================================================
// bloquearSellerMembresia lanza (carrera estrecha) — SHOULD-FIX #7
// =============================================================================
describe("darDeBajaCuenta — bloquearSellerMembresia lanza en vez de tumbar la función", () => {
  it("si bloquearSellerMembresia lanza, darDeBajaCuenta devuelve {ok:false} en vez de propagar", async () => {
    vi.mocked(bloquearSellerMembresia).mockRejectedValueOnce(
      new Error("Ese seller no tiene una membresía por autoservicio en tu courier."),
    );

    const cliente = crearClienteOrquestacion({
      "identidad.usuarios_perfil#single": [
        filaPerfil({
          tipo_usuario: "seller",
          rol: "seller",
          estado: "activo",
          seller_id: "seller-tenant1",
          tenant_id: "tenant-1",
        }),
      ],
      "identidad.seller_membresias#bare": [
        {
          data: [
            { id: "m1", tenant_id: "tenant-1", seller_id: "seller-tenant1", estado: "activa" },
            { id: "m2", tenant_id: "tenant-2", seller_id: "seller-tenant2", estado: "activa" },
          ],
          error: null,
        },
      ],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const resultado = await darDeBajaCuenta({ actorUsuarioId: ACTOR, usuarioId: "usuario-1" });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.motivo).toMatch(/membresía/i);
    }
    expect(cambiarCourierActivo).not.toHaveBeenCalled();
  });
});

// =============================================================================
// El predicado ampliado (MUST-FIX #2) — las dos tablas que faltaban
// =============================================================================
describe("tieneRelacionConPedidosODinero — tablas agregadas (MUST-FIX #2)", () => {
  it("seller: una fila en dinero.eventos_conciliacion (seller_id) → true", async () => {
    const cliente = clientePredicado({ "dinero.eventos_conciliacion": 1 });
    const resultado = await tieneRelacionConPedidosODinero(cliente, {
      tipo: "seller",
      tenantId: "t1",
      entidadId: "s1",
    });
    expect(resultado).toBe(true);
  });

  it("conductor: una fila en dinero.lineas_liquidacion (driver_id) → true", async () => {
    const cliente = clientePredicado({ "dinero.lineas_liquidacion": 1 });
    const resultado = await tieneRelacionConPedidosODinero(cliente, {
      tipo: "conductor",
      tenantId: "t1",
      entidadId: "d1",
    });
    expect(resultado).toBe(true);
  });
});
