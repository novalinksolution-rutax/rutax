/**
 * Pruebas de `sesiones.ts`. El doble de Supabase FILTRA de verdad por los
 * `.eq()` recibidos (nunca un no-op). `cerrarSesionRetiro` mockea `./rpc` y
 * la bitácora para probar el ORDEN (bitácora ANTES del RPC) sin tocar la BD.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./rpc", () => ({
  cerrarSesionRetiroRpc: vi.fn(),
}));

import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { cerrarSesionRetiroRpc } from "./rpc";
import { cerrarSesionRetiro, listarSesionesDeHoyDelConductor, obtenerSesionRetiro } from "./sesiones";

// Este repo opera en America/Santiago: `listarSesionesDeHoyDelConductor` usa
// `fechaLocalEnSantiago`, así que el fixture debe calzar con ESE cálculo, no
// con un truncamiento UTC (`toISOString().slice(0,10)` da el día equivocado
// cerca de medianoche en Chile — guard: fecha-santiago.guard.test.ts).
const HOY = fechaLocalEnSantiago(new Date());

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const CONDUCTOR_1 = "20000000-0000-0000-0000-000000000001";
const OTRO_CONDUCTOR = "20000000-0000-0000-0000-000000000099";
const SESION_1 = "30000000-0000-0000-0000-000000000001";
const SELLER_1 = "60000000-0000-0000-0000-000000000001";
const BODEGA_1 = "70000000-0000-0000-0000-000000000001";
const PEDIDO_1 = "40000000-0000-0000-0000-000000000001";
const USUARIO_AUTH_1 = "80000000-0000-0000-0000-000000000001";

interface FilaFixture {
  [clave: string]: unknown;
}

function crearCliente(fixtures: {
  sesiones_retiro: FilaFixture[];
  seller_bodegas?: FilaFixture[];
  bultos_retiro?: FilaFixture[];
  pedidos?: FilaFixture[];
  sellers?: FilaFixture[];
}) {
  const tablas: Record<string, FilaFixture[]> = {
    sesiones_retiro: fixtures.sesiones_retiro,
    seller_bodegas: fixtures.seller_bodegas ?? [],
    bultos_retiro: fixtures.bultos_retiro ?? [],
    pedidos: fixtures.pedidos ?? [],
    sellers: fixtures.sellers ?? [],
  };
  const llamadasEq: { tabla: string; columna: string; valor: unknown }[] = [];

  function builder(tabla: string) {
    const filas = tablas[tabla] ?? [];
    const filtrosEq: { columna: string; valor: unknown }[] = [];
    let filtroIn: { columna: string; valores: unknown[] } | null = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (columna: string, valor: unknown) => {
      filtrosEq.push({ columna, valor });
      llamadasEq.push({ tabla, columna, valor });
      return b;
    };
    b.in = (columna: string, valores: unknown[]) => {
      filtroIn = { columna, valores };
      return b;
    };
    b.order = () => b;
    const ejecutar = () => {
      let resultado = filas.filter((f) => filtrosEq.every((flt) => f[flt.columna] === flt.valor));
      if (filtroIn) resultado = resultado.filter((f) => filtroIn!.valores.includes(f[filtroIn!.columna]));
      return resultado;
    };
    b.maybeSingle = async () => ({ data: ejecutar()[0] ?? null, error: null });
    b.then = (resolve: (r: { data: FilaFixture[]; error: null }) => void) => resolve({ data: ejecutar(), error: null });
    return b;
  }

  const from = vi.fn((tabla: string) => builder(tabla));
  return { cliente: { from } as never, from, llamadasEq };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listarSesionesDeHoyDelConductor", () => {
  it("filtra por tenant + conductor + fecha de HOY", async () => {
    const { cliente, llamadasEq } = crearCliente({
      sesiones_retiro: [
        {
          id: SESION_1,
          tenant_id: TENANT_A,
          conductor_id: CONDUCTOR_1,
          estado: "abierta",
          bodega_id: BODEGA_1,
          seller_id: SELLER_1,
          fecha_operacion: HOY,
          abierta_en: "2026-08-13T12:00:00.000Z",
          cerrada_en: null,
          bultos_total: null,
          bultos_resueltos: null,
          bultos_sin_resolver: null,
        },
      ],
    });

    const resultado = await listarSesionesDeHoyDelConductor(cliente, { tenantId: TENANT_A, conductorId: CONDUCTOR_1 });

    expect(resultado).toHaveLength(1);
    expect(resultado[0].id).toBe(SESION_1);
    expect(llamadasEq).toContainEqual({ tabla: "sesiones_retiro", columna: "tenant_id", valor: TENANT_A });
    expect(llamadasEq).toContainEqual({ tabla: "sesiones_retiro", columna: "conductor_id", valor: CONDUCTOR_1 });
  });

  it("AISLAMIENTO: sesiones de OTRO conductor no aparecen aunque sean del mismo tenant", async () => {
    const { cliente } = crearCliente({
      sesiones_retiro: [
        {
          id: SESION_1,
          tenant_id: TENANT_A,
          conductor_id: OTRO_CONDUCTOR,
          estado: "abierta",
          bodega_id: BODEGA_1,
          seller_id: SELLER_1,
          fecha_operacion: HOY,
          abierta_en: "2026-08-13T12:00:00.000Z",
          cerrada_en: null,
          bultos_total: null,
          bultos_resueltos: null,
          bultos_sin_resolver: null,
        },
      ],
    });

    const resultado = await listarSesionesDeHoyDelConductor(cliente, { tenantId: TENANT_A, conductorId: CONDUCTOR_1 });
    expect(resultado).toEqual([]);
  });
});

describe("obtenerSesionRetiro", () => {
  const sesionFixture: FilaFixture = {
    id: SESION_1,
    tenant_id: TENANT_A,
    conductor_id: CONDUCTOR_1,
    estado: "abierta",
    bodega_id: BODEGA_1,
    seller_id: SELLER_1,
    fecha_operacion: "2026-08-13",
    abierta_en: "2026-08-13T12:00:00.000Z",
    cerrada_en: null,
    bultos_total: null,
    bultos_resueltos: null,
    bultos_sin_resolver: null,
  };

  it("null si la sesión no existe para (tenant, conductor) — AISLAMIENTO cruzado", async () => {
    const { cliente } = crearCliente({ sesiones_retiro: [{ ...sesionFixture, tenant_id: OTRO_TENANT }] });

    const resultado = await obtenerSesionRetiro(cliente, {
      tenantId: TENANT_A,
      conductorId: CONDUCTOR_1,
      sesionId: SESION_1,
    });
    expect(resultado).toBeNull();
  });

  it("arma el detalle con bultos, código visible y resolución derivada", async () => {
    const { cliente } = crearCliente({
      sesiones_retiro: [sesionFixture],
      seller_bodegas: [{ id: BODEGA_1, tenant_id: TENANT_A, nombre: "Bodega Quilicura", comuna: "Quilicura" }],
      bultos_retiro: [
        {
          id: "bulto-1",
          tenant_id: TENANT_A,
          sesion_retiro_id: SESION_1,
          escaneo_id: "esc-1",
          codigo_formato: "flex_qr",
          codigo_normalizado: "44760788897",
          muestra_codigo: null,
          ml_shipment_id: "44760788897",
          pedido_id: PEDIDO_1,
          posterior_al_cierre: false,
          escaneado_en: "2026-08-13T12:05:00.000Z",
        },
        {
          id: "bulto-2",
          tenant_id: TENANT_A,
          sesion_retiro_id: SESION_1,
          escaneo_id: "esc-2",
          codigo_formato: "desconocido",
          codigo_normalizado: "sha256:aaa",
          muestra_codigo: "garabato",
          ml_shipment_id: null,
          pedido_id: null,
          posterior_al_cierre: false,
          escaneado_en: "2026-08-13T12:06:00.000Z",
        },
      ],
      pedidos: [
        {
          id: PEDIDO_1,
          tenant_id: TENANT_A,
          ml_shipment_id: "44760788897",
          codigo_interno: null,
          seller_id: SELLER_1,
          estado: "pendiente_asignacion",
          situacion_retiro: "retirado",
          destinatario_comuna: "Maipú",
        },
      ],
      sellers: [{ id: SELLER_1, tenant_id: TENANT_A, razon_social: "Tienda Uno SpA" }],
    });

    const detalle = await obtenerSesionRetiro(cliente, {
      tenantId: TENANT_A,
      conductorId: CONDUCTOR_1,
      sesionId: SESION_1,
    });

    expect(detalle).not.toBeNull();
    expect(detalle!.bodega).toEqual({ id: BODEGA_1, nombre: "Bodega Quilicura", comuna: "Quilicura" });
    expect(detalle!.bultos).toHaveLength(2);

    const resuelto = detalle!.bultos.find((b) => b.id === "bulto-1")!;
    expect(resuelto.codigoVisible).toBe("44760788897");
    expect(resuelto.resolucion).toBe("resuelto");
    expect(resuelto.pedido).toMatchObject({ pedidoId: PEDIDO_1, sellerNombre: "Tienda Uno SpA", comuna: "Maipú" });
    // El pedido ya estaba `retirado` antes de este detalle -> se refleja como alerta.
    expect(resuelto.pedido!.alerta).toBe("ya_retirado");

    const ilegible = detalle!.bultos.find((b) => b.id === "bulto-2")!;
    expect(ilegible.codigoVisible).toBe("garabato");
    expect(ilegible.resolucion).toBe("ilegible");
    expect(ilegible.pedido).toBeNull();
  });
});

describe("cerrarSesionRetiro", () => {
  it("escribe bitácora ANTES de llamar al RPC, con actorUsuarioId (id de AUTH, no driverId)", async () => {
    const orden: string[] = [];
    vi.mocked(registrarEnBitacora).mockImplementation(async () => {
      orden.push("bitacora");
    });
    vi.mocked(cerrarSesionRetiroRpc).mockImplementation(async () => {
      orden.push("rpc");
      return {
        sesionId: SESION_1,
        estado: "cerrada",
        bultosTotal: 3,
        bultosResueltos: 2,
        bultosSinResolver: 1,
        cerradaEn: "2026-08-13T20:00:00.000Z",
        yaEstabaCerrada: false,
        pedidosMarcados: 2,
      };
    });

    const cliente = {} as never;
    const resultado = await cerrarSesionRetiro(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_AUTH_1,
    });

    expect(orden).toEqual(["bitacora", "rpc"]);
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      cliente,
      expect.objectContaining({
        tenantId: TENANT_A,
        actorUsuarioId: USUARIO_AUTH_1,
        actorTipo: "usuario",
        accion: "retiro.sesion_cerrada",
        entidadTipo: "sesion_retiro",
        entidadId: SESION_1,
      }),
    );
    expect(cerrarSesionRetiroRpc).toHaveBeenCalledWith(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: CONDUCTOR_1,
    });
    expect(resultado.estado).toBe("cerrada");
  });

  it("si la bitácora falla, el RPC NUNCA se llama (la auditoría manda primero)", async () => {
    vi.mocked(registrarEnBitacora).mockRejectedValue(new Error("bitacora caída"));

    await expect(
      cerrarSesionRetiro({} as never, {
        tenantId: TENANT_A,
        sesionId: SESION_1,
        conductorId: CONDUCTOR_1,
        actorUsuarioId: USUARIO_AUTH_1,
      }),
    ).rejects.toThrow(/bitacora caída/);
    expect(cerrarSesionRetiroRpc).not.toHaveBeenCalled();
  });
});
