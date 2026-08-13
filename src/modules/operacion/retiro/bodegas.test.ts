/**
 * Pruebas de `bodegas.ts`. El doble FILTRA de verdad por los `.eq()`
 * recibidos — nunca un no-op — para que las pruebas de aislamiento signifiquen
 * algo.
 */
import { describe, expect, it, vi } from "vitest";
import { ErrorNoEncontrado } from "@/modules/identidad/errores";
import { abrirVisitaBodega, listarBodegasParaConductor } from "./bodegas";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const CONDUCTOR_1 = "20000000-0000-0000-0000-000000000001";
const SELLER_1 = "60000000-0000-0000-0000-000000000001";
const BODEGA_1 = "70000000-0000-0000-0000-000000000001";
const BODEGA_AJENA = "70000000-0000-0000-0000-000000000099";

interface FilaFixture {
  [clave: string]: unknown;
}

// =============================================================================
// listarBodegasParaConductor
// =============================================================================

function crearClienteListado(fixtures: { seller_bodegas: FilaFixture[]; sellers: FilaFixture[] }) {
  const llamadasEq: { tabla: string; columna: string; valor: unknown }[] = [];

  function builder(tabla: "seller_bodegas" | "sellers") {
    const filas = fixtures[tabla];
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
    b.then = (resolve: (r: { data: FilaFixture[]; error: null }) => void) => {
      let resultado = filas.filter((f) => filtrosEq.every((flt) => f[flt.columna] === flt.valor));
      if (filtroIn) resultado = resultado.filter((f) => filtroIn!.valores.includes(f[filtroIn!.columna]));
      resolve({ data: resultado, error: null });
    };
    return b;
  }

  const from = vi.fn((tabla: string) => builder(tabla as "seller_bodegas" | "sellers"));
  return { cliente: { from } as never, from, llamadasEq };
}

describe("listarBodegasParaConductor", () => {
  it("solo bodegas ACTIVAS del tenant, sin direccion/contacto en la forma devuelta", async () => {
    const { cliente, llamadasEq } = crearClienteListado({
      seller_bodegas: [
        {
          id: BODEGA_1,
          nombre: "Bodega Quilicura",
          comuna: "Quilicura",
          seller_id: SELLER_1,
          tenant_id: TENANT_A,
          activa: true,
          direccion: "Calle Secreta 123",
          contacto_telefono: "+56911111111",
        },
      ],
      sellers: [{ id: SELLER_1, razon_social: "Tienda Uno SpA", tenant_id: TENANT_A }],
    });

    const bodegas = await listarBodegasParaConductor(cliente, TENANT_A);

    expect(bodegas).toEqual([
      { id: BODEGA_1, nombre: "Bodega Quilicura", comuna: "Quilicura", sellerId: SELLER_1, sellerNombre: "Tienda Uno SpA" },
    ]);
    // La forma devuelta NUNCA trae dirección ni contacto.
    expect(Object.keys(bodegas[0])).not.toContain("direccion");
    expect(Object.keys(bodegas[0])).not.toContain("contactoTelefono");
    expect(llamadasEq).toContainEqual({ tabla: "seller_bodegas", columna: "tenant_id", valor: TENANT_A });
    expect(llamadasEq).toContainEqual({ tabla: "seller_bodegas", columna: "activa", valor: true });
  });

  it("AISLAMIENTO: una bodega de OTRO tenant no aparece", async () => {
    const { cliente } = crearClienteListado({
      seller_bodegas: [
        { id: BODEGA_AJENA, nombre: "Bodega ajena", comuna: "X", seller_id: SELLER_1, tenant_id: OTRO_TENANT, activa: true },
      ],
      sellers: [],
    });

    const bodegas = await listarBodegasParaConductor(cliente, TENANT_A);
    expect(bodegas).toEqual([]);
  });
});

// =============================================================================
// abrirVisitaBodega
// =============================================================================

function crearClienteApertura(params: {
  bodega: FilaFixture | null;
  sellerNombre?: string;
  insertResultado: "ok" | "conflicto" | "error_generico";
  sesionExistenteTrasConflicto?: FilaFixture | null;
}) {
  const llamadasInsert: { tabla: string; payload: FilaFixture }[] = [];
  const llamadasEq: { tabla: string; columna: string; valor: unknown }[] = [];

  const from = vi.fn((tabla: string) => {
    if (tabla === "seller_bodegas") {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (columna: string, valor: unknown) => {
        llamadasEq.push({ tabla, columna, valor });
        return b;
      };
      b.maybeSingle = async () => ({ data: params.bodega, error: null });
      return b;
    }
    if (tabla === "sellers") {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.in = () => b;
      b.then = (resolve: (r: { data: FilaFixture[]; error: null }) => void) =>
        resolve({
          data: params.bodega ? [{ id: params.bodega.seller_id, razon_social: params.sellerNombre ?? "Seller" }] : [],
          error: null,
        });
      return b;
    }
    if (tabla === "sesiones_retiro") {
      const b: Record<string, unknown> = {};
      const filtrosEq: { columna: string; valor: unknown }[] = [];
      b.insert = (payload: FilaFixture) => {
        llamadasInsert.push({ tabla, payload });
        return b;
      };
      b.select = () => b;
      b.eq = (columna: string, valor: unknown) => {
        filtrosEq.push({ columna, valor });
        llamadasEq.push({ tabla, columna, valor });
        return b;
      };
      b.maybeSingle = async () => {
        if (llamadasInsert.length > 0 && filtrosEq.length === 0) {
          // Es el .maybeSingle() encadenado tras el INSERT.
          if (params.insertResultado === "ok") {
            return {
              data: {
                id: "nueva-sesion",
                estado: "abierta",
                bodega_id: llamadasInsert[0].payload.bodega_id,
                seller_id: llamadasInsert[0].payload.seller_id,
                fecha_operacion: llamadasInsert[0].payload.fecha_operacion,
                abierta_en: "2026-08-13T13:00:00.000Z",
                cerrada_en: null,
                bultos_total: null,
                bultos_resueltos: null,
                bultos_sin_resolver: null,
              },
              error: null,
            };
          }
          if (params.insertResultado === "conflicto") {
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          return { data: null, error: { code: "22023", message: "algo raro" } };
        }
        // Es el re-SELECT tras el conflicto.
        return { data: params.sesionExistenteTrasConflicto ?? null, error: null };
      };
      return b;
    }
    throw new Error(`Tabla no soportada en el doble: ${tabla}`);
  });

  return { cliente: { from } as never, from, llamadasInsert, llamadasEq };
}

const BODEGA_FIXTURE: FilaFixture = {
  id: BODEGA_1,
  nombre: "Bodega Quilicura",
  direccion: "Camino a Melipilla 1234",
  comuna: "Quilicura",
  instrucciones_acceso: "Portón verde, tocar timbre",
  contacto_nombre: "Pedro",
  contacto_telefono: "+56922222222",
  seller_id: SELLER_1,
};

describe("abrirVisitaBodega", () => {
  it("bodega inexistente/inactiva/de otro tenant -> ErrorNoEncontrado, SIN insertar sesión", async () => {
    const { cliente, llamadasInsert } = crearClienteApertura({ bodega: null, insertResultado: "ok" });

    await expect(
      abrirVisitaBodega(cliente, { tenantId: TENANT_A, conductorId: CONDUCTOR_1, bodegaId: BODEGA_AJENA }),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(llamadasInsert).toHaveLength(0);
  });

  it("apertura normal: devuelve dirección Y contacto de ESA bodega, reutilizada=false", async () => {
    const { cliente, llamadasInsert } = crearClienteApertura({
      bodega: BODEGA_FIXTURE,
      sellerNombre: "Tienda Uno SpA",
      insertResultado: "ok",
    });

    const resultado = await abrirVisitaBodega(cliente, {
      tenantId: TENANT_A,
      conductorId: CONDUCTOR_1,
      bodegaId: BODEGA_1,
    });

    expect(resultado.reutilizada).toBe(false);
    expect(resultado.bodega).toEqual({
      id: BODEGA_1,
      nombre: "Bodega Quilicura",
      direccion: "Camino a Melipilla 1234",
      comuna: "Quilicura",
      instruccionesAcceso: "Portón verde, tocar timbre",
      contactoNombre: "Pedro",
      contactoTelefono: "+56922222222",
      sellerId: SELLER_1,
      sellerNombre: "Tienda Uno SpA",
    });
    expect(resultado.sesion.estado).toBe("abierta");
    expect(llamadasInsert).toHaveLength(1);
    expect(llamadasInsert[0].payload).toMatchObject({
      tenant_id: TENANT_A,
      bodega_id: BODEGA_1,
      seller_id: SELLER_1,
      conductor_id: CONDUCTOR_1,
    });
  });

  it("reintento (23505 sobre sesiones_retiro_abierta_uk): reutiliza la sesión ya abierta, no crea una segunda", async () => {
    const sesionExistente: FilaFixture = {
      id: "sesion-existente",
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
    const { cliente } = crearClienteApertura({
      bodega: BODEGA_FIXTURE,
      insertResultado: "conflicto",
      sesionExistenteTrasConflicto: sesionExistente,
    });

    const resultado = await abrirVisitaBodega(cliente, {
      tenantId: TENANT_A,
      conductorId: CONDUCTOR_1,
      bodegaId: BODEGA_1,
    });

    expect(resultado.reutilizada).toBe(true);
    expect(resultado.sesion.id).toBe("sesion-existente");
  });

  it("un error de Postgres que NO es 23505 se relanza (no se confunde con idempotencia)", async () => {
    const { cliente } = crearClienteApertura({ bodega: BODEGA_FIXTURE, insertResultado: "error_generico" });

    await expect(
      abrirVisitaBodega(cliente, { tenantId: TENANT_A, conductorId: CONDUCTOR_1, bodegaId: BODEGA_1 }),
    ).rejects.toThrow(/Error al abrir la visita de retiro/);
  });
});
