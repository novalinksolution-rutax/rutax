/**
 * QA — Server Actions de la puesta en marcha, llamadas de verdad.
 *
 * Nada de la lógica se reimplementa acá: se importan las acciones reales y solo
 * se sustituye lo que está AL BORDE (sesión, clientes Supabase, bitácora). Lo
 * que se demuestra:
 *
 *   1. Solo el DUEÑO ACTIVO ejecuta cualquier acción. Supervisor, coordinador,
 *      administración, seller, conductor, cuenta suspendida y sin sesión:
 *      rechazados SIN tocar la base, la bitácora ni el RPC.
 *   2. El tenant sale SIEMPRE de la sesión. Un `tenantId` / `p_tenant_id` que
 *      llegue metido en la entrada del cliente se ignora.
 *   3. Paso 4: la entrada inválida (monto 0, plataforma no ofrecida, comuna
 *      repetida, nombres iguales, basura) no llega al RPC ni a la bitácora;
 *      la válida deja la bitácora ANTES del RPC, con autor, y la fecha del RPC
 *      es la de Santiago (no la UTC).
 *   4. Completar: exige los cuatro pasos, bitácora antes de marcar, y la marca
 *      se escribe con la SESIÓN del usuario (no service_role: el trigger que
 *      solo deja completar al dueño quedaría saltado).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const orden: string[] = [];

const mocks = vi.hoisted(() => ({
  sesion: null as unknown,
  configServicio: null as unknown as { data: unknown; error: unknown },
  rpcResultado: { error: null as null | { code: string; message: string } },
  rpcLlamadas: [] as { nombre: string; args: Record<string, unknown> }[],
  updatesSesion: [] as { tabla: string; valores: Record<string, unknown>; filtros: string[] }[],
  updatesServicio: [] as { tabla: string; valores: Record<string, unknown> }[],
  insertsSesion: [] as { tabla: string; valores: Record<string, unknown> }[],
  filaSesion: null as unknown,
  estadoServicio: null as unknown,
  bitacora: [] as Record<string, unknown>[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  obtenerSesionActual: vi.fn(async () => mocks.sesion),
}));

vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: vi.fn(async (_c: unknown, entrada: Record<string, unknown>) => {
    orden.push(`bitacora:${entrada.accion}`);
    mocks.bitacora.push(entrada);
  }),
}));

vi.mock("@/modules/identidad/tarifas-legadas", () => ({
  registrarLegadasPorCerrar: vi.fn(async () => {
    orden.push("bitacora:tarifa.legadas_cerradas");
    return [];
  }),
}));

vi.mock("@/modules/integraciones/geocoding", () => ({
  resolverCoordenadaConCache: vi.fn(async () => ({ resuelto: false })),
  TIMEOUT_GEOCODING_SINCRONO_MS: 1000,
}));

vi.mock("@/app/(tenant)/configuracion/bodegas/actions", () => ({
  accionCrearBodegaCourier: vi.fn(async () => ({ ok: true })),
  accionEditarBodegaCourier: vi.fn(async () => ({ ok: true })),
}));

// Lectura de estado (completarPuestaEnMarcha). Se controla entera.
vi.mock("@/modules/identidad/puesta-en-marcha", () => ({
  leerEstadoPuestaEnMarcha: vi.fn(async () => mocks.estadoServicio),
}));

function constructorSesion(tabla: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {};
  const filtros: string[] = [];
  c.select = vi.fn(() => c);
  c.eq = vi.fn((col: string, v: unknown) => {
    filtros.push(`eq:${col}=${String(v)}`);
    return c;
  });
  c.is = vi.fn((col: string, v: unknown) => {
    filtros.push(`is:${col}=${String(v)}`);
    return c;
  });
  c.maybeSingle = vi.fn(async () => ({ data: mocks.filaSesion, error: null }));
  c.update = vi.fn((valores: Record<string, unknown>) => {
    orden.push(`update-sesion:${tabla}`);
    mocks.updatesSesion.push({ tabla, valores, filtros });
    const u = {
      eq: (col: string, v: unknown) => {
        filtros.push(`eq:${col}=${String(v)}`);
        return u;
      },
      is: (col: string, v: unknown) => {
        filtros.push(`is:${col}=${String(v)}`);
        return u;
      },
      select: async () => ({ data: [{ tenant_id: "t" }], error: null }),
      then: (res: (r: { error: null }) => void) => res({ error: null }),
    };
    return u;
  });
  c.insert = vi.fn(async (valores: Record<string, unknown>) => {
    orden.push(`insert-sesion:${tabla}`);
    mocks.insertsSesion.push({ tabla, valores });
    return { error: null };
  });
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    schema: () => ({ from: (tabla: string) => constructorSesion(tabla) }),
  })),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(() => ({
    schema: () => ({
      from: (tabla: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.limit = () => c;
        c.maybeSingle = async () =>
          tabla === "courier_config_operacion"
            ? mocks.configServicio
            : { data: null, error: null };
        c.update = (valores: Record<string, unknown>) => {
          mocks.updatesServicio.push({ tabla, valores });
          return { eq: () => ({ error: null }) };
        };
        return c;
      },
      rpc: vi.fn(async (nombre: string, args: Record<string, unknown>) => {
        orden.push(`rpc:${nombre}`);
        mocks.rpcLlamadas.push({ nombre, args });
        return mocks.rpcResultado;
      }),
    }),
  })),
}));

import {
  completarPuestaEnMarcha,
  guardarPasoBodega,
  guardarPasoEmpresa,
  guardarPasoOperacion,
  guardarPasoTarifas,
  previsualizarUbicacion,
} from "./actions";
import type { EntradaGuardarPaso4 } from "./zonas-tarifas";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTRO_TENANT = "22222222-2222-2222-2222-222222222222";
const USUARIO = "99999999-9999-9999-9999-999999999999";

function sesion(sobre: Record<string, unknown> = {}) {
  return {
    usuarioId: USUARIO,
    email: "dueno@courier.test",
    usuario: {
      tenantId: TENANT,
      tipoUsuario: "interno",
      estado: "activo",
      rol: "dueno",
      ...sobre,
    },
  };
}

function entradaValida(sobre: Partial<EntradaGuardarPaso4> = {}): EntradaGuardarPaso4 {
  return {
    zona1: {
      id: null,
      nombre: "Gran Santiago urbano",
      comunas: ["Providencia", "Ñuñoa"],
      cobro: 3500,
      pago: 2400,
      excepciones: [],
    },
    zona2: {
      id: null,
      nombre: "Periferia",
      comunas: ["Buin", "Pirque"],
      cobro: 4000,
      pago: 2900,
      excepciones: [],
    },
    ...sobre,
  };
}

const ROLES_NO_DUENO: [string, Record<string, unknown>][] = [
  ["supervisor", { rol: "supervisor" }],
  ["coordinador", { rol: "coordinador" }],
  ["administracion", { rol: "administracion" }],
  ["seller", { tipoUsuario: "seller", rol: null }],
  ["conductor", { tipoUsuario: "conductor", rol: null }],
  ["dueño suspendido", { estado: "suspendido" }],
  ["dueño invitado (no activado)", { estado: "invitado" }],
];

function nadaSeToco() {
  expect(mocks.rpcLlamadas).toHaveLength(0);
  expect(mocks.updatesSesion).toHaveLength(0);
  expect(mocks.insertsSesion).toHaveLength(0);
  expect(mocks.updatesServicio).toHaveLength(0);
  expect(mocks.bitacora).toHaveLength(0);
}

beforeEach(() => {
  orden.length = 0;
  mocks.sesion = sesion();
  mocks.configServicio = { data: { ofrece_flex: true, ofrece_shopify: false }, error: null };
  mocks.rpcResultado = { error: null };
  mocks.rpcLlamadas.length = 0;
  mocks.updatesSesion.length = 0;
  mocks.updatesServicio.length = 0;
  mocks.insertsSesion.length = 0;
  mocks.bitacora.length = 0;
  mocks.filaSesion = null;
  mocks.estadoServicio = {
    leido: true,
    completada: false,
    todosLosPasosCompletos: true,
    primerPasoIncompleto: null,
    pasos: [true, true, true, true],
    pasoGuardado: 4,
  };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("puesta en marcha — solo el dueño activo escribe", () => {
  for (const [nombre, sobre] of ROLES_NO_DUENO) {
    it(`${nombre}: ninguna acción toca la base, la bitácora ni el RPC`, async () => {
      mocks.sesion = sesion(sobre);

      const r = await Promise.all([
        guardarPasoEmpresa(
          Object.assign(new FormData(), {}) as FormData,
        ).catch(() => ({ ok: false })),
        guardarPasoBodega({ direccion: "Av. X 1", comuna: "Providencia", lat: -33.4, long: -70.6 }),
        guardarPasoOperacion({
          ofreceFlex: true,
          ofreceShopify: false,
          horaSalida: "16:00",
          horaCorte: "21:00",
        }),
        guardarPasoTarifas(entradaValida()),
        completarPuestaEnMarcha(),
        previsualizarUbicacion("Av. X 1", "Providencia"),
      ]);

      // Cada una responde rechazo (ok:false o estado:error), ninguna ok:true.
      expect(r[0]).toMatchObject({ ok: false });
      expect(r[1]).toMatchObject({ ok: false });
      expect(r[2]).toMatchObject({ ok: false });
      expect(r[3]).toMatchObject({ ok: false });
      expect(r[4]).toMatchObject({ ok: false });
      expect(r[5]).toMatchObject({ estado: "error" });
      nadaSeToco();
    });
  }

  it("sin sesión: rechaza todo", async () => {
    mocks.sesion = null;
    expect(await guardarPasoTarifas(entradaValida())).toMatchObject({ ok: false });
    expect(await completarPuestaEnMarcha()).toMatchObject({ ok: false });
    nadaSeToco();
  });

  it("sesión sin tenant: rechaza", async () => {
    mocks.sesion = sesion({ tenantId: null });
    expect(await guardarPasoTarifas(entradaValida())).toMatchObject({ ok: false });
    nadaSeToco();
  });
});

describe("guardarPasoTarifas (paso 4)", () => {
  it("el tenant sale de la sesión: un tenant metido por el cliente se ignora", async () => {
    // El cliente miente: cuela `tenantId` y `p_tenant_id` en la entrada y en cada zona.
    const sucia = {
      ...entradaValida(),
      tenantId: OTRO_TENANT,
      p_tenant_id: OTRO_TENANT,
    } as unknown as EntradaGuardarPaso4;
    (sucia.zona1 as unknown as Record<string, unknown>).tenant_id = OTRO_TENANT;

    const r = await guardarPasoTarifas(sucia);

    expect(r).toEqual({ ok: true });
    expect(mocks.rpcLlamadas).toHaveLength(1);
    const { args } = mocks.rpcLlamadas[0];
    expect(args.p_tenant_id).toBe(TENANT);
    expect(JSON.stringify(args)).not.toContain(OTRO_TENANT);
    expect(mocks.bitacora[0].tenantId).toBe(TENANT);
  });

  it("bitácora con autor ANTES del RPC", async () => {
    await guardarPasoTarifas(entradaValida());
    expect(orden).toEqual([
      "bitacora:identidad.zonas_y_tarifas_configuradas",
      "bitacora:tarifa.legadas_cerradas",
      "rpc:guardar_zonas_y_tarifas_puesta_en_marcha",
    ]);
    expect(mocks.bitacora[0]).toMatchObject({
      actorUsuarioId: USUARIO,
      actorTipo: "usuario",
    });
  });

  it("zona 2 es SIEMPRE la de respaldo y zona 1 nunca, sin importar lo que mande el cliente", async () => {
    const entrada = entradaValida();
    (entrada.zona1 as unknown as Record<string, unknown>).esRespaldo = true;
    (entrada.zona2 as unknown as Record<string, unknown>).esRespaldo = false;
    await guardarPasoTarifas(entrada);
    const zonas = mocks.rpcLlamadas[0].args.p_zonas as { es_respaldo: boolean }[];
    expect(zonas.map((z) => z.es_respaldo)).toEqual([false, true]);
  });

  it("la fecha del RPC es la de Santiago, no la UTC (23:30 del 28 en Santiago = 02:30Z del 29)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T02:30:00Z"));
    await guardarPasoTarifas(entradaValida());
    expect(mocks.rpcLlamadas[0].args.p_hoy).toBe("2026-09-28");
    expect(mocks.bitacora[0].detalle).toMatchObject({ vigente_desde: "2026-09-28" });
  });

  const invalidas: [string, (e: EntradaGuardarPaso4) => void][] = [
    ["cobro en 0", (e) => (e.zona1.cobro = 0)],
    ["pago al conductor en 0", (e) => (e.zona2.pago = 0)],
    ["monto negativo", (e) => (e.zona1.cobro = -3500)],
    ["monto con decimales", (e) => (e.zona1.cobro = 3500.5)],
    ["monto NaN", (e) => (e.zona1.pago = Number.NaN)],
    ["monto como texto", (e) => ((e.zona1 as unknown as Record<string, unknown>).cobro = "3500")],
    ["monto sobre el tope", (e) => (e.zona1.cobro = 10_000_001)],
    ["zona sin comunas", (e) => (e.zona1.comunas = [])],
    ["comuna repetida entre zonas", (e) => (e.zona2.comunas = ["Providencia"])],
    ["comuna repetida dentro de la zona", (e) => (e.zona1.comunas = ["Providencia", "Providencia"])],
    ["comuna inexistente", (e) => (e.zona1.comunas = ["Narnia"])],
    ["nombres iguales (mayúsculas distintas)", (e) => (e.zona2.nombre = "  GRAN SANTIAGO urbano ")],
    ["nombre vacío", (e) => (e.zona1.nombre = "   ")],
    [
      "plataforma que el courier no ofrece (shopify)",
      (e) => e.zona1.excepciones.push({ fuente: "shopify", cobro: 3000, pago: 2000 }),
    ],
    [
      "plataforma inventada",
      (e) =>
        e.zona1.excepciones.push({ fuente: "ebay" as never, cobro: 3000, pago: 2000 }),
    ],
    [
      "plataforma duplicada en la zona",
      (e) => {
        e.zona1.excepciones.push({ fuente: "ml_flex", cobro: 3000, pago: 2000 });
        e.zona1.excepciones.push({ fuente: "ml_flex", cobro: 3100, pago: 2000 });
      },
    ],
    [
      "excepción con monto 0",
      (e) => e.zona1.excepciones.push({ fuente: "ml_flex", cobro: 0, pago: 2000 }),
    ],
  ];
  for (const [nombre, mutar] of invalidas) {
    it(`rechaza en el servidor sin escribir nada: ${nombre}`, async () => {
      const e = entradaValida();
      mutar(e);
      const r = await guardarPasoTarifas(e);
      expect(r.ok).toBe(false);
      nadaSeToco();
    });
  }

  it("basura total (zonas ausentes o null) no lanza y no escribe", async () => {
    for (const basura of [
      {},
      { zona1: null, zona2: null },
      null,
      { zona1: "x", zona2: 3 },
      { zona1: entradaValida().zona1 },
    ]) {
      const r = await guardarPasoTarifas(basura as unknown as EntradaGuardarPaso4);
      expect(r.ok).toBe(false);
    }
    nadaSeToco();
  });

  it("excepciones ausentes en la zona (undefined) no revienta ni escribe", async () => {
    const e = entradaValida();
    delete (e.zona1 as unknown as Record<string, unknown>).excepciones;
    const r = await guardarPasoTarifas(e);
    // O bien se trata como sin excepciones (ok) o bien se rechaza: lo que NO puede
    // pasar es una excepción no controlada ni una bitácora sin RPC.
    if (r.ok) expect(mocks.rpcLlamadas).toHaveLength(1);
    else nadaSeToco();
  });

  it("plataforma ofrecida (Flex) SÍ pasa; y viaja con la zona", async () => {
    const e = entradaValida();
    e.zona1.excepciones.push({ fuente: "ml_flex", cobro: 3800, pago: 2500 });
    const r = await guardarPasoTarifas(e);
    expect(r).toEqual({ ok: true });
    const zonas = mocks.rpcLlamadas[0].args.p_zonas as { excepciones: { fuente: string }[] }[];
    expect(zonas[0].excepciones.map((x) => x.fuente)).toEqual(["ml_flex"]);
  });

  it("sin fila de configuración (paso 3 no ocurrió): no escribe", async () => {
    mocks.configServicio = { data: null, error: null };
    const r = await guardarPasoTarifas(entradaValida());
    expect(r.ok).toBe(false);
    nadaSeToco();
  });

  it("error de lectura de la configuración: no escribe", async () => {
    mocks.configServicio = { data: null, error: { message: "boom" } };
    const r = await guardarPasoTarifas(entradaValida());
    expect(r.ok).toBe(false);
    nadaSeToco();
  });

  it("si el RPC falla devuelve error genérico (sin filtrar el mensaje de la base) y la bitácora ya quedó", async () => {
    mocks.rpcResultado = { error: { code: "23505", message: "duplicate key ... tenant ..." } };
    const r = await guardarPasoTarifas(entradaValida());
    expect(r).toEqual({ ok: false, mensaje: "No pudimos guardar. Reintenta." });
    expect(orden[0]).toBe("bitacora:identidad.zonas_y_tarifas_configuradas");
  });
});

describe("guardarPasoOperacion (paso 3)", () => {
  it("horario invertido o igual: no escribe", async () => {
    for (const [s, c] of [
      ["21:00", "16:00"],
      ["16:00", "16:00"],
      ["", "21:00"],
      ["25:00", "26:00"],
    ]) {
      const r = await guardarPasoOperacion({
        ofreceFlex: false,
        ofreceShopify: false,
        horaSalida: s,
        horaCorte: c,
      });
      expect(r.ok).toBe(false);
    }
    nadaSeToco();
  });

  it("escribe con la SESIÓN del usuario (RLS es la segunda pared), no con service_role", async () => {
    const r = await guardarPasoOperacion({
      ofreceFlex: true,
      ofreceShopify: false,
      horaSalida: "16:00",
      horaCorte: "21:00",
    });
    expect(r).toEqual({ ok: true });
    expect(mocks.insertsSesion).toHaveLength(1);
    expect(mocks.insertsSesion[0].valores).toMatchObject({ tenant_id: TENANT, puesta_en_marcha_paso: 3 });
    expect(mocks.updatesServicio).toHaveLength(0);
  });

  it("nunca retrocede el paso guardado (volver al 3 desde el 4)", async () => {
    mocks.filaSesion = { puesta_en_marcha_paso: 4 };
    await guardarPasoOperacion({
      ofreceFlex: true,
      ofreceShopify: true,
      horaSalida: "15:30",
      horaCorte: "22:00",
    });
    expect(mocks.updatesSesion[0].valores).toMatchObject({ puesta_en_marcha_paso: 4 });
    // y el UPDATE va acotado al tenant de la sesión
    expect(mocks.updatesSesion[0].filtros).toContain(`eq:tenant_id=${TENANT}`);
  });

  it("un `tenantId` mandado por el cliente no cambia a quién se le escribe", async () => {
    await guardarPasoOperacion({
      ofreceFlex: true,
      ofreceShopify: false,
      horaSalida: "16:00",
      horaCorte: "21:00",
      tenantId: OTRO_TENANT,
    } as never);
    expect(JSON.stringify(mocks.insertsSesion)).not.toContain(OTRO_TENANT);
    expect(mocks.insertsSesion[0].valores.tenant_id).toBe(TENANT);
  });
});

describe("completarPuestaEnMarcha", () => {
  it("con un paso incompleto no marca nada ni escribe bitácora", async () => {
    mocks.estadoServicio = {
      leido: true,
      completada: false,
      todosLosPasosCompletos: false,
      primerPasoIncompleto: 4,
      pasos: [true, true, true, false],
      pasoGuardado: 3,
    };
    const r = await completarPuestaEnMarcha();
    expect(r).toMatchObject({ ok: false, paso: 4 });
    nadaSeToco();
  });

  it("si la lectura del estado falló (fail-closed) no marca nada", async () => {
    mocks.estadoServicio = {
      leido: false,
      completada: false,
      todosLosPasosCompletos: false,
      primerPasoIncompleto: 1,
      pasos: [false, false, false, false],
      pasoGuardado: null,
    };
    const r = await completarPuestaEnMarcha();
    expect(r.ok).toBe(false);
    nadaSeToco();
  });

  it("ya completada: idempotente, no reescribe la marca ni duplica bitácora", async () => {
    mocks.estadoServicio = { ...(mocks.estadoServicio as object), completada: true };
    expect(await completarPuestaEnMarcha()).toEqual({ ok: true });
    nadaSeToco();
  });

  it("completa: bitácora con autor ANTES del UPDATE, y el UPDATE va por la sesión y solo si aún no estaba marcada", async () => {
    const r = await completarPuestaEnMarcha();
    expect(r).toEqual({ ok: true });
    expect(orden).toEqual([
      "bitacora:identidad.puesta_en_marcha_completada",
      "update-sesion:courier_config_operacion",
    ]);
    expect(mocks.bitacora[0]).toMatchObject({ actorUsuarioId: USUARIO, tenantId: TENANT });
    expect(mocks.updatesSesion[0].filtros).toEqual(
      expect.arrayContaining([
        `eq:tenant_id=${TENANT}`,
        "is:puesta_en_marcha_completada_en=null",
      ]),
    );
    expect(mocks.updatesServicio).toHaveLength(0);
  });
});
