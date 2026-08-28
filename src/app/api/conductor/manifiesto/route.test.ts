import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de GET /api/conductor/manifiesto.
 *
 * ANTES de esta ronda de QA, esta ruta no tenía NINGUNA prueba, ni módulo ni
 * ruta API completa. El foco es la defensa en profundidad agregada en
 * `7b2dac2` (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md §5 fila 1):
 * la ruta filtra `asignaciones_pedido.activa = true` sin mirar el estado del
 * pedido, así que si por lo que sea una asignación queda activa sobre un
 * pedido ya terminal (cancelado/devuelto/entregado*) — p. ej. una carrera
 * entre `cancelarPedido` y la lectura del manifiesto, o un bug futuro que
 * omita desactivar la asignación — la parada NO debe aparecer en la app del
 * conductor de todas formas.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/autenticar-bearer", () => ({
  autenticarBearer: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { GET } from "./route";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const DRIVER_1 = "20000000-0000-0000-0000-000000000001";
const OTRO_DRIVER = "20000000-0000-0000-0000-000000000099";
const MANIFIESTO_1 = "30000000-0000-0000-0000-000000000001";
const PEDIDO_VIVO = "40000000-0000-0000-0000-000000000001";
const PEDIDO_CANCELADO_CON_ASIGNACION_VIVA = "40000000-0000-0000-0000-000000000002";

function pedidoFila(id: string, estado: string) {
  return {
    id,
    seller_id: "seller-1",
    tipo_pedido: "same_day",
    origen: "same_day_manual",
    ml_order_id: null,
    ml_shipment_id: null,
    estado,
    estado_ml: null,
    subestado_ml: null,
    driver_id_asignado: DRIVER_1,
    destinatario_nombre: "Cliente Test",
    destinatario_direccion: "Calle 123",
    destinatario_comuna: "Maipú",
    destinatario_telefono: null,
    instrucciones_entrega: null,
    fecha_compromiso: null,
    lat: null,
    long: null,
    geo_estado: "pendiente",
  };
}

/**
 * Cliente falso mínimo: `asignaciones` es la lista de filas que la query real
 * de `asignaciones_pedido.activa = true` devolvería — incluye a propósito una
 * fila cuyo pedido embebido ya está en estado terminal, simulando la carrera
 * que la defensa en profundidad debe absorber.
 */
function crearClienteManifiesto(opts: {
  manifiesto: Record<string, unknown> | null;
  asignaciones: Array<{ pedidos: Record<string, unknown> | null }>;
  incidencias?: Array<Record<string, unknown>>;
  cierres?: Array<Record<string, unknown>>;
}) {
  function builder(tabla: string) {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = vi.fn(self);
    b.eq = vi.fn(self);
    b.in = vi.fn(self);
    b.order = vi.fn(self);
    // `manifiestos` ya NO se lee con `.limit(1)`: pasa por
    // `obtenerManifiestoVigenteDelConductor`, que trae TODOS los del día para
    // poder detectar el caso de dos manifiestos vivos (que antes escondía
    // paradas en silencio). Si alguien reintroduce el `.limit()`, esto revienta
    // en vez de devolver un resultado plausible.
    b.limit = vi.fn(() => {
      throw new Error("La lectura de manifiestos ya no usa .limit(): ver manifiesto-vigente.ts");
    });
    // Todas las tablas resuelven vía `then` (el código real hace
    // `const { data } = await cliente.from(...).select().eq()...` sin `.limit()`).
    (b as unknown as { then: (resolve: (r: { data: unknown; error: null }) => void) => void }).then = (
      resolve,
    ) => {
      if (tabla === "manifiestos") {
        resolve({ data: opts.manifiesto ? [opts.manifiesto] : [], error: null });
      } else if (tabla === "asignaciones_pedido") {
        resolve({ data: opts.asignaciones, error: null });
      } else if (tabla === "incidencias") {
        resolve({ data: opts.incidencias ?? [], error: null });
      } else if (tabla === "cierres_conductor") {
        resolve({ data: opts.cierres ?? [], error: null });
      } else {
        resolve({ data: [], error: null });
      }
    };
    return b;
  }

  return { from: vi.fn(builder) } as unknown as ReturnType<typeof crearClienteServiceRole>;
}

const usuarioConductor = {
  areasHabilitadas: [...AREAS_PRODUCTO],
  usuarioId: "usuario-conductor-1",
  tipoUsuario: "conductor" as const,
  driverId: DRIVER_1,
  tenantId: TENANT_A,
  sellerId: null,
  estado: "activo" as const,
  rol: "conductor" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

function req() {
  return new Request("http://localhost/api/conductor/manifiesto", {
    headers: { authorization: "Bearer token-conductor" },
  }) as unknown as import("next/server").NextRequest;
}

describe("GET /api/conductor/manifiesto — autenticación", () => {
  it("sin usuario autenticado → 401, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("conductor con cuenta inactiva → 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "suspendido" });

    const res = await GET(req());

    expect(res.status).toBe(403);
  });
});

describe("GET /api/conductor/manifiesto — RECHAZO CRUZADO (aislamiento, QA)", () => {
  /**
   * Esta ruta NO recibe ningún id de recurso del cliente (no hay
   * `manifiestoId` en la URL ni en el body): el manifiesto "del día" se
   * calcula enteramente a partir de `driverId`/`tenantId` que
   * `autenticarBearer` extrae del JWT ya verificado (route.ts:30-32,40-42).
   * Por eso el molde clásico de "id sintácticamente válido pero ajeno → 404"
   * (usado en `api/operaciones/[pedidoId]/etiqueta` y
   * `api/courier/plataforma/comprobantes/[periodoId]`) no aplica tal cual acá:
   * no hay parámetro que un atacante pueda manipular para apuntar a OTRO
   * tenant o a OTRO conductor.
   *
   * Lo que SÍ se puede — y se debe — probar es la línea que sustituye a RLS:
   * que el filtro de `manifiestos` esté anclado SIEMPRE a los valores del
   * token (driver_id + tenant_id) y jamás a ningún otro. Se reutiliza el
   * mismo spy sobre `.eq` que ya trae `crearClienteManifiesto` (el "molde"
   * adaptado: en vez de `data: null` para un id ajeno, se verifica CON QUÉ
   * argumentos se llamó al filtro real).
   */
  it("el filtro de 'manifiestos' usa driver_id/tenant_id del TOKEN, nunca otro conductor u otro tenant", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearClienteManifiesto({ manifiesto: null, asignaciones: [] });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);
    const fromSpy = cliente.from as unknown as ReturnType<typeof vi.fn>;

    await GET(req());

    expect(fromSpy).toHaveBeenCalledWith("manifiestos");
    const llamadaManifiestos = fromSpy.mock.results[0].value as { eq: ReturnType<typeof vi.fn> };
    expect(llamadaManifiestos.eq).toHaveBeenCalledWith("driver_id", DRIVER_1);
    expect(llamadaManifiestos.eq).toHaveBeenCalledWith("tenant_id", TENANT_A);
    expect(llamadaManifiestos.eq).not.toHaveBeenCalledWith("driver_id", OTRO_DRIVER);
    expect(llamadaManifiestos.eq).not.toHaveBeenCalledWith("tenant_id", OTRO_TENANT);
  });

  it("las asignaciones del manifiesto se leen filtradas por tenant_id del TOKEN (defensa en profundidad, aunque el manifiesto_id ya viene acotado)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearClienteManifiesto({
      manifiesto: {
        id: MANIFIESTO_1,
        nombre: "Ruta del día",
        fecha_operacion: "2026-08-11",
        estado: "en_ruta",
      },
      asignaciones: [{ pedidos: pedidoFila(PEDIDO_VIVO, "asignado") }],
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);
    const fromSpy = cliente.from as unknown as ReturnType<typeof vi.fn>;

    const res = await GET(req());
    expect(res.status).toBe(200);

    const llamadaAsignaciones = fromSpy.mock.results.find(
      (_r, i) => fromSpy.mock.calls[i][0] === "asignaciones_pedido",
    );
    expect(llamadaAsignaciones).toBeDefined();
    const eqAsignaciones = (llamadaAsignaciones!.value as { eq: ReturnType<typeof vi.fn> }).eq;
    expect(eqAsignaciones).toHaveBeenCalledWith("tenant_id", TENANT_A);
    expect(eqAsignaciones).not.toHaveBeenCalledWith("tenant_id", OTRO_TENANT);
  });
});

describe("GET /api/conductor/manifiesto — defensa en profundidad (§5 fila 1)", () => {
  it("una parada CANCELADA con la asignación todavía activa (carrera/regresión) NO aparece en la respuesta", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearClienteManifiesto({
        manifiesto: {
          id: MANIFIESTO_1,
          nombre: "Ruta del día",
          fecha_operacion: "2026-08-11",
          estado: "en_ruta",
        },
        asignaciones: [
          { pedidos: pedidoFila(PEDIDO_VIVO, "asignado") },
          // Esta fila NUNCA debería existir en producción una vez que
          // cancelarPedido corre — pero si algo falla, esto es lo que la
          // defensa en profundidad debe absorber.
          { pedidos: pedidoFila(PEDIDO_CANCELADO_CON_ASIGNACION_VIVA, "cancelado") },
        ],
      }),
    );

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    const idsEnRespuesta = body.manifiesto.paradas.map((p: { pedido: { id: string } }) => p.pedido.id);
    expect(idsEnRespuesta).toEqual([PEDIDO_VIVO]);
    expect(idsEnRespuesta).not.toContain(PEDIDO_CANCELADO_CON_ASIGNACION_VIVA);
  });

  it("un manifiesto con TODAS sus paradas canceladas devuelve paradas: [] (no null, no error)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearClienteManifiesto({
        manifiesto: {
          id: MANIFIESTO_1,
          nombre: "Ruta del día",
          fecha_operacion: "2026-08-11",
          estado: "en_ruta",
        },
        asignaciones: [
          { pedidos: pedidoFila(PEDIDO_VIVO, "cancelado") },
          { pedidos: pedidoFila(PEDIDO_CANCELADO_CON_ASIGNACION_VIVA, "devuelto") },
        ],
      }),
    );

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.manifiesto).not.toBeNull();
    expect(body.manifiesto.paradas).toEqual([]);
  });

  it("caso normal: una parada 'asignado' aparece con su orden e incidencia si tiene una abierta", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearClienteManifiesto({
        manifiesto: {
          id: MANIFIESTO_1,
          nombre: "Ruta del día",
          fecha_operacion: "2026-08-11",
          estado: "en_ruta",
        },
        asignaciones: [{ pedidos: pedidoFila(PEDIDO_VIVO, "asignado") }],
        incidencias: [{ id: "inc-1", pedido_id: PEDIDO_VIVO, tipo: "direccion_erronea", estado: "abierta" }],
      }),
    );

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.manifiesto.paradas).toHaveLength(1);
    expect(body.manifiesto.paradas[0].pedido.id).toBe(PEDIDO_VIVO);
    expect(body.manifiesto.paradas[0].incidenciaAbierta?.id).toBe("inc-1");
  });

  it("sin manifiesto para hoy → { manifiesto: null }, sin tocar asignaciones", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearClienteManifiesto({ manifiesto: null, asignaciones: [] });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ manifiesto: null });
  });
});
