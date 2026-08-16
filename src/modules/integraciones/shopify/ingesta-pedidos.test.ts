/**
 * Pruebas de la ingesta de Shopify (`ingesta-pedidos.ts`).
 *
 * REGLA DE ESTE ARCHIVO (heredada de `../ml/ingesta-pedidos.test.ts`): se ejerce
 * el CÓDIGO REAL. Nada de copias espejo de la lógica bajo prueba — ese vicio ya
 * dejó pasar dos bugs de ingesta a producción.
 *
 * El foco está en lo que puede romper plata u operación:
 *  1. INSERT vs UPDATE explícitos, y que el UPDATE **no** lleve `estado` ni
 *     `corte_riesgo`. Es la prueba de no-regresión del bug de PostgREST que
 *     devolvía a la bandeja pedidos ya asignados (ver `../ml/ingesta-pedidos.ts:793`).
 *  2. Idempotencia real: segunda pasada actualiza, no duplica — incluida la
 *     carrera que choca contra `pedidos_fuente_id_externo_uk` (23505).
 *  3. Un pedido SIN TARIFA no se ingesta. Si entrara, no fallaría al crearse:
 *     fallaría al entregarse, tumbando el job que genera las líneas de dinero.
 *  4. Un pedido FUERA DE COBERTURA no se ingesta. Una tienda vende a todo Chile.
 *  5. Nada de PII en el evento de geocodificación.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inngest/cliente", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@/modules/operacion/zonas", () => ({
  resolverZona: vi.fn(),
}));

vi.mock("@/modules/operacion/tarifas", () => ({
  resolverTarifaVigente: vi.fn(),
}));

vi.mock("@/modules/operacion/ventanas-corte", () => ({
  evaluarVentanaCorte: vi.fn(),
}));

vi.mock("./cliente-http", () => ({
  peticionShopify: vi.fn(),
}));

import { inngest } from "@/lib/inngest/cliente";
import { resolverZona } from "@/modules/operacion/zonas";
import { resolverTarifaVigente } from "@/modules/operacion/tarifas";
import { evaluarVentanaCorte } from "@/modules/operacion/ventanas-corte";
import { peticionShopify } from "./cliente-http";
import {
  CONSULTA_ORDENES,
  construirFiltroOrdenes,
  crearResolutorAlta,
  guardarPedidoShopify,
  ingestarOrdenesShopify,
  ingestarVentanaShopify,
  type ContextoIngestaShopify,
  type DatosAltaShopify,
} from "./ingesta-pedidos";
import { interpretarOrden } from "./interpretacion";
import type { OrdenShopify } from "./tipos";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const NOMBRE_FIXTURE = "María Fernanda Rojas";
const TELEFONO_FIXTURE = "+56911112222";
const CALLE_FIXTURE = "Avenida Apoquindo 4501";
const TOKEN_FIXTURE = "shpat-token-secretisimo-de-prueba";

const CTX: ContextoIngestaShopify = {
  tenantId: "tenant-1",
  sellerId: "seller-1",
  conexionId: "conexion-1",
  shopDomain: "mi-tienda.myshopify.com",
  filtroEtiqueta: null,
};

const AHORA = { fecha: "2026-08-16", hora: "10:00" };

function ordenShopify(overrides: Partial<OrdenShopify> = {}): OrdenShopify {
  return {
    id: "gid://shopify/Order/5001",
    name: "#1001",
    createdAt: "2026-08-16T12:00:00.000Z",
    cancelledAt: null,
    displayFulfillmentStatus: "UNFULFILLED",
    tags: [],
    note: "Dejar en conserjería",
    phone: null,
    shippingAddress: {
      name: NOMBRE_FIXTURE,
      address1: CALLE_FIXTURE,
      address2: "depto 1203",
      city: "Las Condes",
      province: "Región Metropolitana",
      phone: TELEFONO_FIXTURE,
      latitude: null,
      longitude: null,
    },
    ...overrides,
  };
}

/** Los datos ya interpretados de la orden fixture — se obtienen del código real. */
function datosDe(orden: OrdenShopify, filtro: string | null = null) {
  const r = interpretarOrden(orden, filtro);
  if (!r.entra) throw new Error(`la orden de prueba no entra: ${r.motivo}`);
  return r.datos;
}

const ALTA: DatosAltaShopify = {
  tarifaAplicableId: "tarifa-1",
  corte: {
    ventana: null,
    fechaCompromisoHora: null,
    corteRiesgo: false,
    horaEvaluada: "10:00",
  },
  fechaCompromiso: "2026-08-16",
};

// -----------------------------------------------------------------------------
// Doble de Supabase (service_role)
// -----------------------------------------------------------------------------

interface ConfigDoble {
  /** Filas ya existentes en `operacion.pedidos`, indexadas por `id_externo`. */
  existentes?: Array<Record<string, unknown>>;
  /** Errores a devolver por el n-ésimo INSERT (índice 0 = primer INSERT). */
  erroresInsert?: Array<{ message: string; code?: string } | null>;
  /** Si el INSERT falla con 23505, ¿la relectura encuentra la fila? (carrera real) */
  materializarTrasConflicto?: string | null;
  errorLectura?: { message: string } | null;
  errorUpdate?: { message: string } | null;
}

function crearSupabaseFalso(config: ConfigDoble = {}) {
  const registro = {
    insert: [] as Record<string, unknown>[],
    update: [] as Record<string, unknown>[],
    tablas: [] as string[],
  };

  const existentes = new Map<string, Record<string, unknown>>(
    (config.existentes ?? []).map((f) => [String(f.id_externo), f]),
  );
  let contadorInsert = 0;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function builder() {
    const filtros: Record<string, unknown> = {};
    const cadena: any = {};
    cadena.select = vi.fn(() => cadena);
    cadena.eq = vi.fn((c: string, v: unknown) => {
      filtros[c] = v;
      return cadena;
    });
    cadena.neq = vi.fn(() => cadena);
    cadena.not = vi.fn(() => cadena);
    cadena.in = vi.fn(() => cadena);
    cadena.gte = vi.fn(() => cadena);
    cadena.order = vi.fn(() => cadena);
    cadena.limit = vi.fn(() => cadena);

    cadena.maybeSingle = vi.fn(async () => {
      if (config.errorLectura) return { data: null, error: config.errorLectura };
      const fila = existentes.get(String(filtros["id_externo"] ?? "")) ?? null;
      return { data: fila, error: null };
    });

    cadena.insert = vi.fn((valores: Record<string, unknown>) => {
      registro.insert.push(valores);
      const indice = contadorInsert;
      contadorInsert += 1;
      const error = config.erroresInsert?.[indice] ?? null;

      const c: any = {};
      c.select = vi.fn(() => c);
      c.maybeSingle = vi.fn(async () => {
        if (error) {
          if (config.materializarTrasConflicto) {
            existentes.set(String(valores.id_externo), {
              id: config.materializarTrasConflicto,
              id_externo: valores.id_externo,
              geo_estado: "pendiente",
              destinatario_direccion: valores.destinatario_direccion,
              destinatario_comuna: valores.destinatario_comuna,
            });
          }
          return { data: null, error };
        }
        const id = `pedido-${registro.insert.length}`;
        existentes.set(String(valores.id_externo), {
          id,
          id_externo: valores.id_externo,
          geo_estado: valores.geo_estado ?? "pendiente",
          destinatario_direccion: valores.destinatario_direccion,
          destinatario_comuna: valores.destinatario_comuna,
        });
        return { data: { id }, error: null };
      });
      return c;
    });

    cadena.update = vi.fn((valores: Record<string, unknown>) => {
      registro.update.push(valores);
      const u: any = {};
      u.eq = vi.fn(() => u);
      u.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({ error: config.errorUpdate ?? null }).then(res, rej);
      return u;
    });

    return cadena;
  }

  const cliente: any = {
    schema: vi.fn((s: string) => ({
      from: vi.fn((t: string) => {
        registro.tablas.push(`${s}.${t}`);
        return builder();
      }),
    })),
    from: vi.fn(() => builder()),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { cliente, registro };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const comoSupabase = (c: unknown) => c as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function resolutorDe(cliente: unknown, ctx: ContextoIngestaShopify = CTX) {
  return crearResolutorAlta(comoSupabase(cliente), ctx, AHORA);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolverZona).mockResolvedValue("zona-1");
  vi.mocked(resolverTarifaVigente).mockResolvedValue("tarifa-1");
  vi.mocked(evaluarVentanaCorte).mockResolvedValue({
    ventana: null,
    fechaCompromisoHora: null,
    corteRiesgo: false,
    horaEvaluada: "10:00",
  });
});

// =============================================================================
// Contrato con la API (lo que se verificó contra la doc oficial)
// =============================================================================

describe("contrato con la Admin API", () => {
  it("ordena por CREATED_AT explícitamente (el default de Shopify es PROCESSED_AT)", () => {
    // Si alguien quita el sortKey, el cursor se movería por `created_at` mientras
    // la API pagina por `processed_at`: quedan huecos.
    expect(CONSULTA_ORDENES).toContain("sortKey: CREATED_AT");
    expect(CONSULTA_ORDENES).toContain("first: 50");
    expect(CONSULTA_ORDENES).toContain("pageInfo");
  });

  it("no pide un solo campo de más (cuota de puntos + datos personales)", () => {
    expect(CONSULTA_ORDENES).not.toContain("customer");
    expect(CONSULTA_ORDENES).not.toContain("email");
    expect(CONSULTA_ORDENES).not.toContain("lineItems");
    expect(CONSULTA_ORDENES).not.toContain("billingAddress");
  });

  it("el filtro acota por los DOS extremos de created_at y por unfulfilled", () => {
    const filtro = construirFiltroOrdenes(
      new Date("2026-08-16T09:00:00.000Z"),
      new Date("2026-08-16T14:00:00.000Z"),
    );
    expect(filtro).toContain("created_at:>='2026-08-16T09:00:00.000Z'");
    // El techo importa tanto como el piso: el cursor se guarda como "tenemos
    // los pedidos hasta T" y sin techo entrarían órdenes posteriores a T.
    expect(filtro).toContain("created_at:<='2026-08-16T14:00:00.000Z'");
    expect(filtro).toContain("fulfillment_status:unfulfilled");
  });
});

// =============================================================================
// INSERT
// =============================================================================

describe("guardarPedidoShopify — INSERT de un pedido nuevo", () => {
  it("escribe fuente/origen/régimen, la tarifa, el código interno y el tracking", async () => {
    const { cliente, registro } = crearSupabaseFalso();

    const resultado = await guardarPedidoShopify(
      comoSupabase(cliente),
      CTX,
      datosDe(ordenShopify()),
      ALTA,
    );

    expect(resultado).toEqual({ estado: "insertado", pedidoId: "pedido-1" });
    expect(registro.insert).toHaveLength(1);

    const fila = registro.insert[0];
    expect(fila.tenant_id).toBe("tenant-1");
    expect(fila.seller_id).toBe("seller-1");
    // Régimen y procedencia son EJES DISTINTOS: same_day + shopify.
    expect(fila.tipo_pedido).toBe("same_day");
    expect(fila.fuente).toBe("shopify");
    expect(fila.origen).toBe("shopify_ingesta");
    expect(fila.id_externo).toBe("gid://shopify/Order/5001");
    expect(fila.referencia_externa).toBe("#1001");
    expect(fila.destinatario_nombre).toBe(NOMBRE_FIXTURE);
    expect(fila.destinatario_direccion).toBe(`${CALLE_FIXTURE}, depto 1203`);
    expect(fila.destinatario_comuna).toBe("Las Condes");
    expect(fila.destinatario_telefono).toBe(TELEFONO_FIXTURE);
    expect(fila.instrucciones_entrega).toBe("Dejar en conserjería");
    // Shopify no trae fecha de entrega: la de ingesta en Santiago. Sin ella el
    // pedido es invisible en /operaciones, que filtra por esta columna.
    expect(fila.fecha_compromiso).toBe("2026-08-16");
    expect(fila.tarifa_aplicable_id).toBe("tarifa-1");
    // Shopify no da etiqueta: la imprime Rutax.
    expect(fila.codigo_interno).toMatch(/^RX-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(String(fila.tracking_token)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("NO manda `estado` en el INSERT: lo pone el default de la columna", async () => {
    const { cliente, registro } = crearSupabaseFalso();
    await guardarPedidoShopify(comoSupabase(cliente), CTX, datosDe(ordenShopify()), ALTA);
    expect(Object.keys(registro.insert[0])).not.toContain("estado");
  });

  it("sin coordenada de Shopify no toca las columnas geo", async () => {
    const { cliente, registro } = crearSupabaseFalso();
    await guardarPedidoShopify(comoSupabase(cliente), CTX, datosDe(ordenShopify()), ALTA);
    const claves = Object.keys(registro.insert[0]);
    expect(claves).not.toContain("lat");
    expect(claves).not.toContain("geo_estado");
  });

  it("con coordenada de Shopify la adopta como resuelta con confianza 1", async () => {
    const { cliente, registro } = crearSupabaseFalso();
    const orden = ordenShopify({
      shippingAddress: {
        ...ordenShopify().shippingAddress,
        latitude: -33.4089,
        longitude: -70.5678,
      },
    });

    await guardarPedidoShopify(comoSupabase(cliente), CTX, datosDe(orden), ALTA);

    const fila = registro.insert[0];
    expect(fila.lat).toBe(-33.4089);
    expect(fila.long).toBe(-70.5678);
    expect(fila.geo_estado).toBe("resuelto");
    expect(fila.geo_confianza).toBe(1);
  });

  it("publica el gatillo de geocodificación SIN nombre ni teléfono del destinatario", async () => {
    const { cliente } = crearSupabaseFalso();
    await guardarPedidoShopify(comoSupabase(cliente), CTX, datosDe(ordenShopify()), ALTA);

    expect(inngest.send).toHaveBeenCalledTimes(1);
    const evento = vi.mocked(inngest.send).mock.calls[0][0] as {
      name: string;
      id?: string;
      data: Record<string, unknown>;
    };
    expect(evento.name).toBe("operacion/pedido.ingestado");
    expect(evento.id).toBe("pedido-ingestado-pedido-1");
    expect(evento.data.tipoPedido).toBe("same_day");
    expect(evento.data.fuente).toBe("shopify");

    const serializado = JSON.stringify(evento.data);
    expect(serializado).not.toContain(NOMBRE_FIXTURE);
    expect(serializado).not.toContain(TELEFONO_FIXTURE);
  });
});

// =============================================================================
// UPDATE — la prueba de no-regresión que más importa
// =============================================================================

describe("guardarPedidoShopify — UPDATE de un pedido ya conocido", () => {
  const EXISTENTE = {
    id: "pedido-existente",
    id_externo: "gid://shopify/Order/5001",
    geo_estado: "resuelto",
    destinatario_direccion: "Avenida Apoquindo 4501, depto 1203",
    destinatario_comuna: "Las Condes",
  };

  it("actualiza en vez de duplicar (segunda pasada de la misma orden)", async () => {
    const { cliente, registro } = crearSupabaseFalso({ existentes: [EXISTENTE] });

    const resultado = await guardarPedidoShopify(
      comoSupabase(cliente),
      CTX,
      datosDe(ordenShopify()),
      ALTA,
    );

    expect(resultado).toEqual({ estado: "actualizado", pedidoId: "pedido-existente" });
    expect(registro.insert).toHaveLength(0);
    expect(registro.update).toHaveLength(1);
  });

  it("el UPDATE NO lleva `estado` ni `corte_riesgo` (regresión del bug de PostgREST)", async () => {
    // Es el bug que mordió a la ingesta de ML: un upsert escribe TODAS las
    // columnas del payload también en el UPDATE, así que `estado` y
    // `corte_riesgo` devolvían a la bandeja pedidos ya asignados/en ruta.
    const { cliente, registro } = crearSupabaseFalso({ existentes: [EXISTENTE] });
    await guardarPedidoShopify(comoSupabase(cliente), CTX, datosDe(ordenShopify()), ALTA);

    const claves = Object.keys(registro.update[0]);
    expect(claves).not.toContain("estado");
    expect(claves).not.toContain("corte_riesgo");
  });

  it("el UPDATE tampoco toca fuente, origen, tarifa, código interno ni tracking", async () => {
    const { cliente, registro } = crearSupabaseFalso({ existentes: [EXISTENTE] });
    await guardarPedidoShopify(comoSupabase(cliente), CTX, datosDe(ordenShopify()), ALTA);

    const claves = Object.keys(registro.update[0]);
    for (const prohibida of [
      "fuente",
      "origen",
      "tarifa_aplicable_id",
      "codigo_interno",
      "tracking_token",
      "id_externo",
      "tenant_id",
      "seller_id",
      "tipo_pedido",
      "fecha_compromiso",
      "fecha_compromiso_hora",
      "sla_cumplido",
    ]) {
      expect(claves).not.toContain(prohibida);
    }
  });

  it("solo escribe lo que Shopify posee", async () => {
    const { cliente, registro } = crearSupabaseFalso({ existentes: [EXISTENTE] });
    await guardarPedidoShopify(comoSupabase(cliente), CTX, datosDe(ordenShopify()), ALTA);

    expect(Object.keys(registro.update[0]).sort()).toEqual(
      [
        "destinatario_comuna",
        "destinatario_direccion",
        "destinatario_nombre",
        "destinatario_telefono",
        "instrucciones_entrega",
        "referencia_externa",
      ].sort(),
    );
  });

  it("un reformateo de la dirección NO dispara re-geocodificación", async () => {
    // "AVENIDA APOQUINDO 4501, DEPTO 1203" es el mismo destino para una persona
    // y para el caché de geocoding. Sin comparación normalizada, cada barrido
    // borraría la coordenada y pagaría una llamada al proveedor.
    const { cliente, registro } = crearSupabaseFalso({ existentes: [EXISTENTE] });
    const orden = ordenShopify({
      shippingAddress: {
        ...ordenShopify().shippingAddress,
        address1: "AVENIDA  APOQUINDO 4501",
        address2: "DEPTO 1203",
      },
    });

    await guardarPedidoShopify(comoSupabase(cliente), CTX, datosDe(orden), ALTA);

    expect(Object.keys(registro.update[0])).not.toContain("geo_estado");
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("un destino distinto sin coordenada borra la vieja y re-encola el geocoding", async () => {
    const { cliente, registro } = crearSupabaseFalso({ existentes: [EXISTENTE] });
    const orden = ordenShopify({
      shippingAddress: { ...ordenShopify().shippingAddress, address1: "Los Militares 5620", address2: null },
    });

    await guardarPedidoShopify(comoSupabase(cliente), CTX, datosDe(orden), ALTA);

    const cambios = registro.update[0];
    expect(cambios.lat).toBeNull();
    expect(cambios.geo_estado).toBe("pendiente");
    expect(cambios.geocodificado_en).toBeNull();

    // Sin `id` de dedupe: reusar el del alta haría que Inngest lo descartara
    // durante 24 h y el pedido se quedaría con la coordenada del domicilio viejo.
    const evento = vi.mocked(inngest.send).mock.calls[0][0] as { id?: string };
    expect(evento.id).toBeUndefined();
  });
});

// =============================================================================
// Idempotencia dura — la carrera contra el índice único
// =============================================================================

describe("idempotencia ante 23505", () => {
  it("un choque contra la llave (tenant, fuente, id_externo) cae al UPDATE, no duplica", async () => {
    const { cliente, registro } = crearSupabaseFalso({
      erroresInsert: [{ message: 'duplicate key value violates unique constraint', code: "23505" }],
      materializarTrasConflicto: "pedido-de-la-otra-corrida",
    });

    const resultado = await guardarPedidoShopify(
      comoSupabase(cliente),
      CTX,
      datosDe(ordenShopify()),
      ALTA,
    );

    expect(resultado).toEqual({ estado: "actualizado", pedidoId: "pedido-de-la-otra-corrida" });
    expect(registro.insert).toHaveLength(1);
    expect(registro.update).toHaveLength(1);
  });

  it("un choque de `codigo_interno` reintenta con otro código y sí inserta", async () => {
    // Se distingue del caso anterior SIN leer el texto del error: se relee la
    // fila, y como no existe, el 23505 solo pudo ser del código interno.
    const { cliente, registro } = crearSupabaseFalso({
      erroresInsert: [{ message: "duplicate key", code: "23505" }],
      materializarTrasConflicto: null,
    });

    const resultado = await guardarPedidoShopify(
      comoSupabase(cliente),
      CTX,
      datosDe(ordenShopify()),
      ALTA,
    );

    expect(resultado.estado).toBe("insertado");
    expect(registro.insert).toHaveLength(2);
    expect(registro.insert[0].codigo_interno).not.toBe(registro.insert[1].codigo_interno);
  });

  it("un error que NO es 23505 no reintenta y se reporta", async () => {
    const { cliente, registro } = crearSupabaseFalso({
      erroresInsert: [{ message: "null value in column violates not-null", code: "23502" }],
    });

    const resultado = await guardarPedidoShopify(
      comoSupabase(cliente),
      CTX,
      datosDe(ordenShopify()),
      ALTA,
    );

    expect(resultado.estado).toBe("error");
    expect(registro.insert).toHaveLength(1);
  });
});

// =============================================================================
// Filtros de entrada — cobertura y tarifa
// =============================================================================

describe("ingestarOrdenesShopify — qué NO entra", () => {
  it("un pedido SIN TARIFA vigente no se ingesta", async () => {
    // Si entrara, no fallaría al crearse: fallaría al ENTREGARSE, cuando
    // `dinero/jobs/generar-lineas.ts` inserte `tarifa_id` en una columna NOT NULL.
    vi.mocked(resolverTarifaVigente).mockResolvedValue(null);
    const { cliente, registro } = crearSupabaseFalso();

    const resumen = await ingestarOrdenesShopify(comoSupabase(cliente), [ordenShopify()], CTX, {
      resolutor: resolutorDe(cliente),
      fechaCompromiso: "2026-08-16",
    });

    expect(registro.insert).toHaveLength(0);
    expect(resumen.totalSinTarifa).toBe(1);
    expect(resumen.totalInsertados).toBe(0);
  });

  it("una comuna sin zona del tenant no se ingesta (fuera de cobertura)", async () => {
    vi.mocked(resolverZona).mockResolvedValue(null);
    const { cliente, registro } = crearSupabaseFalso();

    const resumen = await ingestarOrdenesShopify(comoSupabase(cliente), [ordenShopify()], CTX, {
      resolutor: resolutorDe(cliente),
      fechaCompromiso: "2026-08-16",
    });

    expect(registro.insert).toHaveLength(0);
    expect(resumen.totalOmitidos).toBe(1);
    expect(resumen.totalFueraDeCobertura).toBe(1);
    // Y no se gastó una consulta de tarifa en algo que no iba a entrar.
    expect(resolverTarifaVigente).not.toHaveBeenCalled();
  });

  it("una comuna fuera del catálogo RM no se ingesta y ni siquiera consulta la zona", async () => {
    // `resolver_zona` compara por igualdad exacta contra la forma canónica: con
    // una comuna que el catálogo no reconoce, preguntarle no puede acertar.
    const { cliente, registro } = crearSupabaseFalso();
    const orden = ordenShopify({
      shippingAddress: { ...ordenShopify().shippingAddress, city: "Valparaíso" },
    });

    const resumen = await ingestarOrdenesShopify(comoSupabase(cliente), [orden], CTX, {
      resolutor: resolutorDe(cliente),
      fechaCompromiso: "2026-08-16",
    });

    expect(registro.insert).toHaveLength(0);
    expect(resumen.totalFueraDeCobertura).toBe(1);
    expect(resolverZona).not.toHaveBeenCalled();
  });

  it("cuenta los descartes de la interpretación por motivo", async () => {
    const { cliente, registro } = crearSupabaseFalso();

    const resumen = await ingestarOrdenesShopify(
      comoSupabase(cliente),
      [
        ordenShopify({ id: "gid://shopify/Order/1", cancelledAt: "2026-08-16T13:00:00.000Z" }),
        ordenShopify({ id: "gid://shopify/Order/2", displayFulfillmentStatus: "FULFILLED" }),
        // Con el tag puesto para que llegue al chequeo de dirección: el filtro
        // por etiqueta se evalúa ANTES en `interpretarOrden`.
        ordenShopify({ id: "gid://shopify/Order/3", tags: ["rutax"], shippingAddress: null }),
        ordenShopify({ id: "gid://shopify/Order/4" }),
      ],
      { ...CTX, filtroEtiqueta: "rutax" },
      { resolutor: resolutorDe(cliente), fechaCompromiso: "2026-08-16" },
    );

    expect(resumen.totalLeidos).toBe(4);
    expect(resumen.motivos.cancelada_en_tienda).toBe(1);
    expect(resumen.motivos.ya_cumplida).toBe(1);
    expect(resumen.motivos.sin_direccion).toBe(1);
    expect(resumen.motivos.sin_etiqueta_requerida).toBe(1);
    expect(resumen.totalSinDireccion).toBe(1);
    expect(registro.insert).toHaveLength(0);
  });

  it("resuelve tarifa, zona y corte UNA sola vez para muchas órdenes de la misma comuna", async () => {
    // 300 órdenes no pueden costar 900 consultas cada 15 minutos.
    const { cliente, registro } = crearSupabaseFalso();
    const ordenes = Array.from({ length: 5 }, (_, i) =>
      ordenShopify({ id: `gid://shopify/Order/90${i}`, name: `#90${i}` }),
    );

    await ingestarOrdenesShopify(comoSupabase(cliente), ordenes, CTX, {
      resolutor: resolutorDe(cliente),
      fechaCompromiso: "2026-08-16",
    });

    expect(registro.insert).toHaveLength(5);
    expect(resolverTarifaVigente).toHaveBeenCalledTimes(1);
    expect(resolverZona).toHaveBeenCalledTimes(1);
    expect(evaluarVentanaCorte).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Paginación
// =============================================================================

describe("ingestarVentanaShopify — paginación", () => {
  it("recorre páginas hasta que Shopify dice que no hay más", async () => {
    const { cliente, registro } = crearSupabaseFalso();
    vi.mocked(peticionShopify)
      .mockResolvedValueOnce({
        orders: {
          nodes: [ordenShopify({ id: "gid://shopify/Order/1", name: "#1" })],
          pageInfo: { hasNextPage: true, endCursor: "cur-1" },
        },
      })
      .mockResolvedValueOnce({
        orders: {
          nodes: [ordenShopify({ id: "gid://shopify/Order/2", name: "#2" })],
          pageInfo: { hasNextPage: false, endCursor: "cur-2" },
        },
      });

    const resumen = await ingestarVentanaShopify(comoSupabase(cliente), CTX, TOKEN_FIXTURE, {
      desde: new Date("2026-08-16T09:00:00.000Z"),
      hasta: new Date("2026-08-16T14:00:00.000Z"),
      maxPaginas: 10,
      ahora: AHORA,
    });

    expect(resumen.paginasRecorridas).toBe(2);
    expect(resumen.totalInsertados).toBe(2);
    expect(resumen.cortadoPorTopeDePaginas).toBe(false);
    expect(registro.insert).toHaveLength(2);

    // El cursor de la segunda llamada es el `endCursor` de la primera.
    const segunda = vi.mocked(peticionShopify).mock.calls[1][0];
    expect(segunda.variables?.cursor).toBe("cur-1");
  });

  it("corta por tope de páginas y lo deja anotado", async () => {
    const { cliente } = crearSupabaseFalso();
    vi.mocked(peticionShopify).mockResolvedValue({
      orders: {
        nodes: [ordenShopify()],
        pageInfo: { hasNextPage: true, endCursor: "cur" },
      },
    });

    const resumen = await ingestarVentanaShopify(comoSupabase(cliente), CTX, TOKEN_FIXTURE, {
      desde: new Date("2026-08-16T09:00:00.000Z"),
      hasta: new Date("2026-08-16T14:00:00.000Z"),
      maxPaginas: 3,
      ahora: AHORA,
    });

    expect(resumen.paginasRecorridas).toBe(3);
    expect(resumen.cortadoPorTopeDePaginas).toBe(true);
  });

  it("no mete el token en ninguna variable de la consulta", async () => {
    const { cliente } = crearSupabaseFalso();
    vi.mocked(peticionShopify).mockResolvedValue({
      orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });

    await ingestarVentanaShopify(comoSupabase(cliente), CTX, TOKEN_FIXTURE, {
      desde: new Date("2026-08-16T09:00:00.000Z"),
      hasta: new Date("2026-08-16T14:00:00.000Z"),
      maxPaginas: 5,
      ahora: AHORA,
    });

    const peticion = vi.mocked(peticionShopify).mock.calls[0][0];
    // Va en su campo propio (de ahí sale el header) y en ningún otro lado.
    expect(peticion.accessToken).toBe(TOKEN_FIXTURE);
    expect(JSON.stringify(peticion.variables)).not.toContain(TOKEN_FIXTURE);
    expect(peticion.consulta).not.toContain(TOKEN_FIXTURE);
  });
});
