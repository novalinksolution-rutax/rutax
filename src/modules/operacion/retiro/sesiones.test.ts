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
// Sin este doble, el publicador sale de verdad a la red durante las pruebas y,
// sobre todo, no hay forma de observar QUÉ evento se publicó — que es
// justamente lo que hay que fijar en el aviso de WhatsApp.
vi.mock("@/lib/inngest/cliente", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { cerrarSesionRetiroRpc } from "./rpc";
import { inngest } from "@/lib/inngest/cliente";
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
  conductores?: FilaFixture[];
}) {
  const tablas: Record<string, FilaFixture[]> = {
    sesiones_retiro: fixtures.sesiones_retiro,
    seller_bodegas: fixtures.seller_bodegas ?? [],
    bultos_retiro: fixtures.bultos_retiro ?? [],
    pedidos: fixtures.pedidos ?? [],
    sellers: fixtures.sellers ?? [],
    conductores: fixtures.conductores ?? [],
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
  // `.schema(...)` devuelve el mismo cliente: en el doble las tablas viven en un
  // solo espacio de nombres, y lo que se prueba acá es el FILTRADO, no el
  // enrutado de esquemas de PostgREST.
  const cliente: Record<string, unknown> = { from };
  cliente.schema = () => cliente;
  return { cliente: cliente as never, from, llamadasEq };
}

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` borra las LLAMADAS pero no las IMPLEMENTACIONES: sin esta
  // línea, el `mockRejectedValue` de la prueba de "si la bitácora falla" se
  // filtra a las que vienen después y las hace fallar por un motivo que no
  // tiene nada que ver con lo que prueban. Mordió al agregar los casos de la
  // visita vacía.
  vi.mocked(registrarEnBitacora).mockResolvedValue(undefined);
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

/**
 * Doble para `cerrarSesionRetiro`. Solo necesita dos cadenas:
 *
 *   · el conteo de bultos — `.from('bultos_retiro').select('id',{count,head}).eq().eq()`
 *   · el borrado de la visita vacía — `.from('sesiones_retiro').delete().eq()×4`
 *
 * Registra los `.eq()` del DELETE para poder afirmar la guarda de carrera
 * (`estado = 'abierta'`), que es lo único que impide borrar una visita que
 * alcanzó a recibir bultos entre el conteo y el borrado.
 */
function clienteCierre(opts: { bultos: number; borrado?: { error: { message: string } | null } }) {
  const filtrosDelete: { columna: string; valor: unknown }[] = [];
  let huboDelete = false;

  function tabla(nombre: string) {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.delete = () => {
      huboDelete = true;
      return b;
    };
    b.eq = (columna: string, valor: unknown) => {
      if (huboDelete && nombre === "sesiones_retiro") filtrosDelete.push({ columna, valor });
      return b;
    };
    b.then = (resolve: (r: Record<string, unknown>) => void) => {
      if (nombre === "bultos_retiro") resolve({ count: opts.bultos, error: null });
      else resolve(opts.borrado ?? { error: null });
    };
    return b;
  }

  return { cliente: { from: (n: string) => tabla(n) } as never, filtrosDelete };
}

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

    // 3 bultos: es una visita con carga, así que se cierra por el camino normal.
    const { cliente } = clienteCierre({ bultos: 3 });
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
    const { cliente } = clienteCierre({ bultos: 3 });

    await expect(
      cerrarSesionRetiro(cliente, {
        tenantId: TENANT_A,
        sesionId: SESION_1,
        conductorId: CONDUCTOR_1,
        actorUsuarioId: USUARIO_AUTH_1,
      }),
    ).rejects.toThrow(/bitacora caída/);
    expect(cerrarSesionRetiroRpc).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Visita SIN un solo bulto: se descarta, no se cierra
  // -------------------------------------------------------------------------
  /**
   * Decisión del usuario (2026-08-15): cerrar una visita vacía dejaba un acta
   * de ceros en la Preparación del coordinador para siempre — ruido puro, sin
   * nada que respaldar. Es el ÚNICO caso en que una sesión se borra, y se puede
   * justo porque no hay escaneos que perder: el invariante "nunca se pierde un
   * escaneo" no se toca.
   */
  it("con 0 bultos la visita se DESCARTA: no se llama al RPC y la fila se borra", async () => {
    const { cliente, filtrosDelete } = clienteCierre({ bultos: 0 });

    const resultado = await cerrarSesionRetiro(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_AUTH_1,
    });

    expect(resultado.descartada).toBe(true);
    expect(resultado.bultosTotal).toBe(0);
    // No se cierra: no hay acta que congelar.
    expect(cerrarSesionRetiroRpc).not.toHaveBeenCalled();
    // Y queda el rastro de que el conductor estuvo ahí sin cargar nada.
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      cliente,
      expect.objectContaining({ accion: "retiro.sesion_descartada_sin_bultos" }),
    );
    // La guarda de carrera: si entre el conteo y el borrado alguien escaneó y
    // cerró, el DELETE no debe casar. Sin este `.eq` se borraría una visita CON
    // bultos, que es justo lo que nunca puede pasar.
    expect(filtrosDelete).toContainEqual({ columna: "estado", valor: "abierta" });
    expect(filtrosDelete).toContainEqual({ columna: "tenant_id", valor: TENANT_A });
  });

  it("con 1 bulto NO se descarta: se cierra por el camino normal", async () => {
    vi.mocked(cerrarSesionRetiroRpc).mockResolvedValue({
      sesionId: SESION_1,
      estado: "cerrada",
      bultosTotal: 1,
      bultosResueltos: 1,
      bultosSinResolver: 0,
      cerradaEn: "2026-08-15T20:00:00.000Z",
      yaEstabaCerrada: false,
      pedidosMarcados: 1,
    });
    const { cliente, filtrosDelete } = clienteCierre({ bultos: 1 });

    const resultado = await cerrarSesionRetiro(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_AUTH_1,
    });

    expect(resultado.descartada).toBeUndefined();
    expect(cerrarSesionRetiroRpc).toHaveBeenCalled();
    expect(filtrosDelete).toEqual([]); // no se borró nada
  });
});

// =============================================================================
// El aviso de WhatsApp al cerrar la visita
// =============================================================================
//
// Es el gatillo que convierte la integración de WhatsApp en algo que corre
// solo. Lo que se fija acá es el ORDEN de las variables —porque Meta las recibe
// por posición y un cambio silencioso manda el nombre del conductor donde va la
// bodega— y las tres condiciones en que NO debe salir nada.
describe("cerrarSesionRetiro — aviso de WhatsApp al seller", () => {
  const SELLER_NOMBRE = "Comercial Aurora SpA";
  const BODEGA_NOMBRE = "Bodega Maipú";
  const CONDUCTOR_NOMBRE = "Juan Pérez";

  function fixturesCompletos() {
    return {
      sesiones_retiro: [
        {
          id: SESION_1,
          tenant_id: TENANT_A,
          conductor_id: CONDUCTOR_1,
          seller_id: SELLER_1,
          bodega_id: BODEGA_1,
          fecha_operacion: HOY,
          estado: "abierta",
        },
      ],
      bultos_retiro: [{ id: "b1", tenant_id: TENANT_A, sesion_retiro_id: SESION_1 }],
      sellers: [{ id: SELLER_1, tenant_id: TENANT_A, razon_social: SELLER_NOMBRE }],
      seller_bodegas: [{ id: BODEGA_1, tenant_id: TENANT_A, nombre: BODEGA_NOMBRE }],
      conductores: [{ id: CONDUCTOR_1, tenant_id: TENANT_A, nombre_completo: CONDUCTOR_NOMBRE }],
    };
  }

  function resultadoRpc(pedidosMarcados: number, yaEstabaCerrada = false) {
    return {
      sesionId: SESION_1,
      estado: "cerrada" as const,
      bultosTotal: 30,
      bultosResueltos: 30,
      bultosSinResolver: 0,
      cerradaEn: new Date().toISOString(),
      yaEstabaCerrada,
      pedidosMarcados,
    };
  }

  function eventoWhatsApp() {
    return vi
      .mocked(inngest.send)
      .mock.calls.map((c) => c[0])
      .find((e) => (e as { name: string }).name === "notificaciones/whatsapp.solicitado") as
      | { name: string; id: string; data: Record<string, unknown> }
      | undefined;
  }

  it("publica el aviso con las CUATRO variables en el orden de la plantilla", async () => {
    const { cliente } = crearCliente(fixturesCompletos());
    vi.mocked(cerrarSesionRetiroRpc).mockResolvedValue(resultadoRpc(87));

    await cerrarSesionRetiro(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_AUTH_1,
    });

    const evento = eventoWhatsApp();
    expect(evento).toBeDefined();
    expect(evento!.data.claveEvento).toBe("retiro_completado");
    // El orden ES el contrato con Meta: {{1}} nombre, {{2}} cantidad,
    // {{3}} bodega, {{4}} conductor.
    expect(evento!.data.variables).toEqual([SELLER_NOMBRE, "87", BODEGA_NOMBRE, CONDUCTOR_NOMBRE]);
    // Solo el seller: desde el 2026-08-25 no hay otro tipo de destinatario.
    // Sus contactos —el suyo propio y los que Rutax le haya sumado— se resuelven
    // dentro del servicio de envío, no acá.
    expect(evento!.data.destino).toEqual({ sellerId: SELLER_1 });
  });

  it("usa la visita como referencia — un aviso por visita, aunque el cierre se reintente", async () => {
    const { cliente } = crearCliente(fixturesCompletos());
    vi.mocked(cerrarSesionRetiroRpc).mockResolvedValue(resultadoRpc(87));

    await cerrarSesionRetiro(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_AUTH_1,
    });

    const evento = eventoWhatsApp();
    expect(evento!.data.referencia).toBe(SESION_1);
    // Id determinístico: dos reintentos del cierre no encolan dos avisos.
    expect(evento!.id).toBe(`whatsapp-retiro-${SESION_1}`);
  });

  it("NO avisa si no se marcó ni un pedido — «retiramos 0 pedidos» es peor que el silencio", async () => {
    const { cliente } = crearCliente(fixturesCompletos());
    vi.mocked(cerrarSesionRetiroRpc).mockResolvedValue(resultadoRpc(0));

    await cerrarSesionRetiro(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_AUTH_1,
    });

    expect(eventoWhatsApp()).toBeUndefined();
  });

  it("NO avisa si falta el nombre del seller — el mensaje abre saludándolo", async () => {
    const fixtures = fixturesCompletos();
    fixtures.sellers = [];
    const { cliente } = crearCliente(fixtures);
    vi.mocked(cerrarSesionRetiroRpc).mockResolvedValue(resultadoRpc(87));

    await cerrarSesionRetiro(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_AUTH_1,
    });

    expect(eventoWhatsApp()).toBeUndefined();
  });

  it("SÍ avisa sin nombre de bodega o de conductor, con un respaldo legible", async () => {
    // Estos dos no bloquean: el aviso sigue siendo útil sin ellos, y callarse
    // por un nombre que falta le costaría al seller su notificación del día.
    const fixtures = fixturesCompletos();
    fixtures.seller_bodegas = [];
    fixtures.conductores = [];
    const { cliente } = crearCliente(fixtures);
    vi.mocked(cerrarSesionRetiroRpc).mockResolvedValue(resultadoRpc(12));

    await cerrarSesionRetiro(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_AUTH_1,
    });

    expect(eventoWhatsApp()!.data.variables).toEqual([
      SELLER_NOMBRE,
      "12",
      "tu bodega",
      "nuestro conductor",
    ]);
  });

  it("NO reavisa si la visita YA estaba cerrada", async () => {
    const { cliente } = crearCliente(fixturesCompletos());
    vi.mocked(cerrarSesionRetiroRpc).mockResolvedValue(resultadoRpc(87, true));

    await cerrarSesionRetiro(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_AUTH_1,
    });

    expect(eventoWhatsApp()).toBeUndefined();
  });

  it("si la publicación falla, el cierre NO se cae — el conductor está en la bodega", async () => {
    const { cliente } = crearCliente(fixturesCompletos());
    vi.mocked(cerrarSesionRetiroRpc).mockResolvedValue(resultadoRpc(87));
    vi.mocked(inngest.send).mockRejectedValue(new Error("Inngest caído"));

    const resultado = await cerrarSesionRetiro(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_AUTH_1,
    });

    expect(resultado.estado).toBe("cerrada");
    expect(resultado.pedidosMarcados).toBe(87);
  });
});
