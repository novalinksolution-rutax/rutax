/**
 * Pruebas del job ejecutar-backfill.
 *
 * REGLA DE ESTE ARCHIVO: las pruebas ejercen el CÓDIGO REAL. Nada de copias
 * espejo de la lógica que se quiere verificar.
 *
 * La versión anterior tenía un espejo que leía `shipping.shipment_id` —campo
 * que no existe en la API de ML— y mockeaba ese mismo campo: validaba el
 * supuesto contra sí mismo y dejó pasar un backfill que ingería cero pedidos.
 * Después el mismo vicio dejó pasar el segundo bug: el mock devolvía un array
 * como si `GET /shipments?ids=` existiera. No existe — es 404, y así murió en
 * producción. Si vuelve el espejo, vuelve el bug.
 *
 * Cobertura:
 *  A. Parsers puros del shipment (logistic_type plano/anidado, dirección,
 *     fecha de entrega, fecha civil de Santiago).
 *  B. Capa HTTP real (`obtenerDatosPorShipment` → `peticionMl` → fetch):
 *     URL singular, cabecera obligatoria, tolerancia al fallo individual,
 *     backoff ante 429 y concurrencia acotada.
 *  C. Handler completo del job con `step.run` ejecutando el callback y un
 *     doble de Supabase: ingesta, filtro Flex, `fecha_compromiso`, marcado
 *     `fallido`, error de upsert y corte de paginación.
 *  D. Seguridad: ni token ni datos del destinatario salen en logs/eventos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// -----------------------------------------------------------------------------
// Mocks de infraestructura — se declaran antes de importar el módulo bajo prueba
// (vi.mock se iza). El handler real se captura desde `createFunction`.
// -----------------------------------------------------------------------------

vi.mock("@/lib/inngest/cliente", () => ({
  inngest: {
    createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("../../secretos", () => ({
  descifrarSecreto: vi.fn().mockResolvedValue({ valor: "tok-secreto-de-prueba" }),
}));

vi.mock("@/modules/operacion/zonas", () => ({
  resolverZona: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/modules/operacion/ventanas-corte", () => ({
  resolverVentanaCorte: vi.fn().mockResolvedValue(null),
}));

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  calleDeDireccion,
  coordenadasDeReceiver,
  derivarFechaCompromiso,
  ENCABEZADO_FORMATO_NUEVO_ML,
  extraerShipmentId,
  interpretarShipment,
  jobEjecutarBackfill,
  leerDireccionShipment,
  leerFechaEntregaMl,
  leerLogisticType,
  LOGISTIC_TYPE_FLEX,
  mapearConConcurrencia,
  obtenerDatosPorShipment,
  obtenerLogisticTypePorShipment,
  type OrderMl,
  type ShipmentMl,
} from "./ejecutar-backfill";

// -----------------------------------------------------------------------------
// Utilidades de dobles HTTP
// -----------------------------------------------------------------------------

interface OpcionesRespuesta {
  ok?: boolean;
  status?: number;
  json?: unknown;
  headers?: Record<string, string>;
}

/** El `init` que `cliente-http.ts` le pasa a `fetch`. */
interface PeticionFalsa {
  method?: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** Doble mínimo de `Response` con lo que consume `cliente-http.ts`. */
function respuestaFalsa(opciones: OpcionesRespuesta = {}) {
  const status = opciones.status ?? 200;
  const ok = opciones.ok ?? (status >= 200 && status < 300);
  const cabeceras = new Map(
    Object.entries(opciones.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const cuerpo = opciones.json ?? {};
  const respuesta = {
    ok,
    status,
    headers: { get: (nombre: string) => cabeceras.get(nombre.toLowerCase()) ?? null },
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
    clone: () => respuesta,
  };
  return respuesta;
}

/** Shipment Flex con la forma NUEVA (`x-format-new`). Con PII de fixture. */
const NOMBRE_FIXTURE = "María Fernanda Rojas";
const CALLE_FIXTURE = "Avenida Apoquindo 4501, depto 1203";

function shipmentFlexNuevo(overrides: Partial<ShipmentMl> = {}): ShipmentMl {
  return {
    id: 44012345678,
    status: "ready_to_ship",
    substatus: "printed",
    date_created: "2026-08-10T14:00:00.000Z",
    logistic: { mode: "me2", type: "self_service", direction: "forward" },
    destination: {
      receiver_name: NOMBRE_FIXTURE,
      shipping_address: {
        address_line: CALLE_FIXTURE,
        city: { name: "Las Condes" },
        state: { name: "Región Metropolitana" },
        latitude: -33.4089,
        longitude: -70.5678,
      },
    },
    lead_time: {
      // 01:30 UTC del 13 = 21:30 del 12 en Santiago (invierno, UTC-4).
      estimated_delivery_time: { date: "2026-08-13T01:30:00.000Z" },
      estimated_delivery_limit: { date: "2026-08-20T03:00:00.000Z" },
      estimated_delivery_final: { date: "2026-08-15T03:00:00.000Z" },
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// =============================================================================
// A · Parsers puros del shipment
// =============================================================================

describe("extraerShipmentId — lee shipping.id (el campo que existe en ML)", () => {
  function ordenConEnvio(id: number | string): OrderMl {
    return { id: 999, shipping: { id } };
  }

  it("shipping.id numérico → lo devuelve como string", () => {
    expect(extraerShipmentId(ordenConEnvio(44012345678))).toBe("44012345678");
  });

  it("shipping.id string → lo devuelve tal cual", () => {
    expect(extraerShipmentId(ordenConEnvio("44012345678"))).toBe("44012345678");
  });

  it("shipping.id null → null (envío aún no creado; se reintenta después)", () => {
    expect(extraerShipmentId({ id: 1, shipping: { id: null } })).toBeNull();
  });

  it("orden sin shipping (undefined o null) → null", () => {
    expect(extraerShipmentId({ id: 1 })).toBeNull();
    expect(extraerShipmentId({ id: 1, shipping: undefined })).toBeNull();
    expect(extraerShipmentId({ id: 1, shipping: null })).toBeNull();
  });

  it("shipping vacío o con id en blanco → null", () => {
    expect(extraerShipmentId({ id: 1, shipping: {} })).toBeNull();
    expect(extraerShipmentId({ id: 1, shipping: { id: "" } })).toBeNull();
    expect(extraerShipmentId({ id: 1, shipping: { id: "   " } })).toBeNull();
  });

  it("REGRESIÓN: una orden con SOLO `shipping.shipment_id` no aporta id", () => {
    const ordenFalsa = { id: 1, shipping: { shipment_id: 44012345678 } } as unknown as OrderMl;
    expect(extraerShipmentId(ordenFalsa)).toBeNull();
  });

  it("una página de órdenes reales rinde sus ids (el bug daba lista vacía)", () => {
    const pagina: OrderMl[] = [
      { id: 1, shipping: { id: 111 } },
      { id: 2, shipping: undefined },
      { id: 3, shipping: { id: 333 } },
      { id: 4, shipping: { id: null } },
      { id: 5, shipping: { id: "555" } },
    ];
    const ids = pagina.map(extraerShipmentId).filter((v): v is string => v !== null);
    expect(ids).toEqual(["111", "333", "555"]);
  });
});

describe("leerLogisticType — la doc de ML se contradice, así que se leen AMBAS", () => {
  it("formato nuevo: `logistic.type` anidado", () => {
    expect(leerLogisticType({ logistic: { type: "self_service" } })).toEqual({
      valor: "self_service",
      ubicacion: "anidado",
    });
  });

  it("legacy: `logistic_type` plano", () => {
    expect(leerLogisticType({ logistic_type: "self_service" })).toEqual({
      valor: "self_service",
      ubicacion: "plano",
    });
  });

  it("si vienen los dos, gana el anidado (es la forma del header obligatorio)", () => {
    expect(
      leerLogisticType({ logistic: { type: "fulfillment" }, logistic_type: "self_service" }),
    ).toEqual({ valor: "fulfillment", ubicacion: "anidado" });
  });

  it("ausente en ambas → null y NO se asume Flex", () => {
    expect(leerLogisticType({})).toEqual({ valor: null, ubicacion: "ausente" });
    expect(leerLogisticType({ logistic: {} })).toEqual({ valor: null, ubicacion: "ausente" });
    expect(leerLogisticType(null)).toEqual({ valor: null, ubicacion: "ausente" });
  });

  it("no se rompe si una rama viene nula y la otra sirve", () => {
    expect(leerLogisticType({ logistic: null, logistic_type: "cross_docking" })).toEqual({
      valor: "cross_docking",
      ubicacion: "plano",
    });
  });
});

describe("leerDireccionShipment / calleDeDireccion", () => {
  it("formato nuevo: destination.shipping_address", () => {
    const { ubicacion, direccion } = leerDireccionShipment(shipmentFlexNuevo());
    expect(ubicacion).toBe("destination");
    expect(calleDeDireccion(direccion)).toBe(CALLE_FIXTURE);
  });

  it("legacy: receiver_address", () => {
    const { ubicacion, direccion } = leerDireccionShipment({
      receiver_address: { address_line: "Los Militares 5620", city: { name: "Las Condes" } },
    });
    expect(ubicacion).toBe("receiver_address");
    expect(calleDeDireccion(direccion)).toBe("Los Militares 5620");
  });

  it("sin dirección (el domicilio se oculta hasta confirmar el pago) → ausente", () => {
    expect(leerDireccionShipment({}).ubicacion).toBe("ausente");
    expect(calleDeDireccion(null)).toBeNull();
  });

  it("sin address_line arma la calle con street_name + street_number", () => {
    expect(calleDeDireccion({ street_name: "Manquehue Norte", street_number: 1234 })).toBe(
      "Manquehue Norte 1234",
    );
    expect(calleDeDireccion({ street_name: "Manquehue Norte" })).toBe("Manquehue Norte");
  });
});

describe("leerFechaEntregaMl — qué campo de plazos se usa y cuál NO", () => {
  it("prefiere lead_time.estimated_delivery_time.date (la promesa al comprador)", () => {
    expect(leerFechaEntregaMl(shipmentFlexNuevo())).toEqual({
      iso: "2026-08-13T01:30:00.000Z",
      campo: "lead_time.estimated_delivery_time.date",
    });
  });

  it("sin promesa cae a estimated_delivery_final (el plazo duro documentado)", () => {
    const shipment = shipmentFlexNuevo({
      lead_time: {
        estimated_delivery_limit: { date: "2026-08-20T03:00:00.000Z" },
        estimated_delivery_final: { date: "2026-08-15T03:00:00.000Z" },
      },
    });
    expect(leerFechaEntregaMl(shipment).campo).toBe("lead_time.estimated_delivery_final.date");
  });

  it("NUNCA usa estimated_delivery_limit: es el plazo de reembolso, no de entrega", () => {
    // La doc oficial lo define como «fecha límite para que el comprador pueda
    // cancelar la compra y pedir la devolución de dinero». Suele caer días
    // después: escribirlo en fecha_compromiso manda el pedido a otro día.
    const shipment = shipmentFlexNuevo({
      lead_time: { estimated_delivery_limit: { date: "2026-08-20T03:00:00.000Z" } },
    });
    expect(leerFechaEntregaMl(shipment)).toEqual({ iso: null, campo: null });
  });

  it("acepta el nodo legacy shipping_option cuando no hay lead_time", () => {
    const shipment: ShipmentMl = {
      shipping_option: { estimated_delivery_time: { date: "2026-08-12T18:00:00.000Z" } },
    };
    expect(leerFechaEntregaMl(shipment).campo).toBe(
      "shipping_option.estimated_delivery_time.date",
    );
  });

  it("descarta una fecha impresentable en vez de propagar Invalid Date", () => {
    const shipment: ShipmentMl = {
      lead_time: { estimated_delivery_time: { date: "no-es-una-fecha" } },
    };
    expect(leerFechaEntregaMl(shipment)).toEqual({ iso: null, campo: null });
  });

  it("sin nodo de plazos → null", () => {
    expect(leerFechaEntregaMl({})).toEqual({ iso: null, campo: null });
    expect(leerFechaEntregaMl(null)).toEqual({ iso: null, campo: null });
  });
});

describe("derivarFechaCompromiso — fecha CIVIL de Santiago, nunca UTC", () => {
  it("21:30 de Santiago es el día 12, aunque en UTC ya sea 13", () => {
    // El bug clásico: truncar el ISO daría '2026-08-13' y el pedido
    // desaparecería del panel del día, que filtra fecha_compromiso = hoy.
    expect(derivarFechaCompromiso("2026-08-13T01:30:00.000Z", null)).toBe("2026-08-12");
  });

  it("respeta el horario de verano (enero es UTC-3)", () => {
    // 02:30 UTC del 6 de enero = 23:30 del 5 en Santiago.
    expect(derivarFechaCompromiso("2026-01-06T02:30:00.000Z", null)).toBe("2026-01-05");
  });

  it("sin fecha de ML cae a la fecha de creación de la orden", () => {
    expect(derivarFechaCompromiso(null, "2026-08-10T14:00:00.000Z")).toBe("2026-08-10");
  });

  it("sin ninguna de las dos → null (la columna admite nulo)", () => {
    expect(derivarFechaCompromiso(null, null)).toBeNull();
    expect(derivarFechaCompromiso("", undefined)).toBeNull();
  });

  it("una fecha basura no se escribe: se pasa al respaldo", () => {
    expect(derivarFechaCompromiso("bla", "2026-08-10T14:00:00.000Z")).toBe("2026-08-10");
  });
});

describe("coordenadasDeReceiver", () => {
  it("acepta una coordenada válida de Santiago", () => {
    expect(coordenadasDeReceiver({ latitude: -33.4489, longitude: -70.6693 })).toEqual({
      lat: -33.4489,
      long: -70.6693,
    });
  });

  it("acepta números que ML manda como string", () => {
    expect(coordenadasDeReceiver({ latitude: "-33.45", longitude: "-70.66" })).toEqual({
      lat: -33.45,
      long: -70.66,
    });
  });

  it("rechaza null, undefined y el objeto ausente", () => {
    const vacio = { lat: null, long: null };
    expect(coordenadasDeReceiver({ latitude: null, longitude: null })).toEqual(vacio);
    expect(coordenadasDeReceiver({})).toEqual(vacio);
    expect(coordenadasDeReceiver(null)).toEqual(vacio);
    expect(coordenadasDeReceiver(undefined)).toEqual(vacio);
  });

  it("rechaza (0,0): es el Golfo de Guinea, no un domicilio", () => {
    expect(coordenadasDeReceiver({ latitude: 0, longitude: 0 })).toEqual({
      lat: null,
      long: null,
    });
  });

  it("rechaza coordenadas fuera de rango", () => {
    expect(coordenadasDeReceiver({ latitude: 95, longitude: -70 })).toEqual({
      lat: null,
      long: null,
    });
    expect(coordenadasDeReceiver({ latitude: -33, longitude: 200 })).toEqual({
      lat: null,
      long: null,
    });
  });

  it("rechaza texto que no es número", () => {
    expect(coordenadasDeReceiver({ latitude: "sin dato", longitude: "sin dato" })).toEqual({
      lat: null,
      long: null,
    });
  });

  it("una sola coordenada presente no basta: se descartan las dos", () => {
    expect(coordenadasDeReceiver({ latitude: -33.45, longitude: null })).toEqual({
      lat: null,
      long: null,
    });
  });
});

describe("interpretarShipment — normaliza el shipment y NO filtra datos", () => {
  it("extrae todo lo que el backfill necesita del formato nuevo", () => {
    const { datos } = interpretarShipment(shipmentFlexNuevo());
    expect(datos).toEqual({
      logisticType: "self_service",
      lat: -33.4089,
      long: -70.5678,
      estadoMl: "ready_to_ship",
      subestadoMl: "printed",
      fechaEntregaIso: "2026-08-13T01:30:00.000Z",
      destinatarioNombre: NOMBRE_FIXTURE,
      destinatarioDireccion: CALLE_FIXTURE,
      destinatarioComuna: "Las Condes",
    });
  });

  it("comuna desde municipality cuando no hay city", () => {
    const { datos } = interpretarShipment({
      destination: { shipping_address: { municipality: { name: "Puente Alto" } } },
    });
    expect(datos.destinatarioComuna).toBe("Puente Alto");
  });

  it("el DIAGNÓSTICO solo lleva nombres de campo — ni un valor del shipment", () => {
    const { diagnostico } = interpretarShipment(shipmentFlexNuevo());

    expect(diagnostico.ubicacionLogisticType).toBe("anidado");
    expect(diagnostico.ubicacionDireccion).toBe("destination");
    expect(diagnostico.campoFechaEntrega).toBe("lead_time.estimated_delivery_time.date");
    expect(diagnostico.claves).toContain("destination");
    expect(diagnostico.clavesPlazos).toContain("estimated_delivery_time");

    // Prohibido loguear el JSON crudo o cualquier valor: nombre, dirección,
    // comuna y coordenadas NO pueden aparecer en el diagnóstico.
    const serializado = JSON.stringify(diagnostico);
    expect(serializado).not.toContain(NOMBRE_FIXTURE);
    expect(serializado).not.toContain(CALLE_FIXTURE);
    expect(serializado).not.toContain("Las Condes");
    expect(serializado).not.toContain("-33.4089");
    expect(serializado).not.toContain("ready_to_ship");
  });

  it("un shipment vacío no revienta: todo null y ubicaciones 'ausente'", () => {
    const { datos, diagnostico } = interpretarShipment({});
    expect(datos.logisticType).toBeNull();
    expect(datos.destinatarioDireccion).toBeNull();
    expect(diagnostico.ubicacionDireccion).toBe("ausente");
    expect(diagnostico.claves).toEqual([]);
  });
});

// =============================================================================
// B · Capa HTTP real — obtenerDatosPorShipment → peticionMl → fetch
// =============================================================================

describe("obtenerDatosPorShipment — el detalle de envío es SINGULAR", () => {
  it("REGRESIÓN: una llamada por id a /shipments/{id}, jamás el batch ?ids=", async () => {
    // `GET /shipments?ids=` NO EXISTE en la API de ML (el batch de 50 ids
    // pertenece a /shipment_labels). Pedirlo devuelve 404 y mató el job en
    // producción tres veces. Este test cae si alguien lo reintroduce.
    const fetchMock = vi.fn(async (url: string) => {
      const id = String(url).split("/").pop();
      return respuestaFalsa({ json: { id, logistic: { type: "self_service" } } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { datos, fallidos } = await obtenerDatosPorShipment(["111", "222", "333"], "tok-secreto");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      "https://api.mercadolibre.com/shipments/111",
      "https://api.mercadolibre.com/shipments/222",
      "https://api.mercadolibre.com/shipments/333",
    ]);
    for (const url of urls) {
      expect(url).not.toContain("ids=");
      expect(url).not.toContain("shipment_labels");
      expect(url).not.toContain("tok-secreto");
    }
    expect(datos.get("222")?.logisticType).toBe("self_service");
    expect(fallidos).toEqual([]);
  });

  it("REGRESIÓN: toda llamada a shipments lleva `x-format-new: true`", async () => {
    // Cita de la doc oficial: «A partir del 12 de octubre de 2025 […] el envío
    // del header x-format-new: true pasará a ser obligatorio en todas las
    // solicitudes». Sin él, ML puede responder el formato legacy.
    const fetchMock = vi.fn(async (_url: string, _init?: PeticionFalsa) =>
      respuestaFalsa({ json: { id: 1 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await obtenerDatosPorShipment(["111", "222"], "tok-secreto");

    expect(ENCABEZADO_FORMATO_NUEVO_ML).toEqual({ "x-format-new": "true" });
    for (const llamada of fetchMock.mock.calls) {
      const init = llamada[1] as PeticionFalsa;
      expect(init.headers["x-format-new"]).toBe("true");
      // El token viaja en Authorization, nunca en la URL ni en otro header.
      expect(init.headers.authorization).toBe("Bearer tok-secreto");
    }
  });

  it("un 404 individual no tumba la página: se registra y los demás siguen", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/222")) {
        return respuestaFalsa({ status: 404, json: { message: "shipment not found" } });
      }
      return respuestaFalsa({ json: { id: 1, logistic: { type: "self_service" } } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { datos, fallidos } = await obtenerDatosPorShipment(["111", "222", "333"], "tok");

    expect(datos.size).toBe(2);
    expect(datos.has("111")).toBe(true);
    expect(datos.has("333")).toBe(true);
    // `status` se conserva a propósito: el 404 tiene tratamiento propio (jamás
    // se interpreta como cancelación) y hay que poder distinguirlo del resto.
    expect(fallidos).toEqual([{ shipmentId: "222", motivo: "HTTP 404", status: 404 }]);
  });

  it("un 429 con Retry-After se reintenta solo (backoff de peticionMl)", async () => {
    let intentos = 0;
    const fetchMock = vi.fn(async () => {
      intentos += 1;
      if (intentos === 1) {
        return respuestaFalsa({ status: 429, headers: { "retry-after": "0" }, json: {} });
      }
      return respuestaFalsa({ json: { id: 111, logistic: { type: "self_service" } } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { datos, fallidos } = await obtenerDatosPorShipment(["111"], "tok");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fallidos).toEqual([]);
    expect(datos.get("111")?.logisticType).toBe("self_service");
  });

  it("no dispara 50 llamadas de golpe: la concurrencia está acotada", async () => {
    let enVuelo = 0;
    let pico = 0;
    const fetchMock = vi.fn(async () => {
      enVuelo += 1;
      pico = Math.max(pico, enVuelo);
      await new Promise((r) => setTimeout(r, 1));
      enVuelo -= 1;
      return respuestaFalsa({ json: { id: 1, logistic: { type: "self_service" } } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ids = Array.from({ length: 50 }, (_, i) => String(i));
    await obtenerDatosPorShipment(ids, "tok", { concurrencia: 4 });

    expect(fetchMock).toHaveBeenCalledTimes(50);
    expect(pico).toBeLessThanOrEqual(4);
    expect(pico).toBeGreaterThan(1);
  });

  it("lista vacía → no llama a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { datos } = await obtenerDatosPorShipment([], "tok");
    expect(datos.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("el envoltorio de compatibilidad sigue devolviendo solo el logistic_type", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/222")) return respuestaFalsa({ json: { logistic_type: "fulfillment" } });
      if (String(url).endsWith("/333")) return respuestaFalsa({ json: {} });
      return respuestaFalsa({ json: { logistic: { type: "self_service" } } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const mapa = await obtenerLogisticTypePorShipment(["111", "222", "333"], "tok");
    expect(mapa.get("111")).toBe(LOGISTIC_TYPE_FLEX);
    expect(mapa.get("222")).toBe("fulfillment");
    expect(mapa.get("333")).toBeNull();
  });
});

describe("mapearConConcurrencia", () => {
  it("preserva el orden de entrada aunque terminen desordenados", async () => {
    const salida = await mapearConConcurrencia([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms / 10));
      return ms;
    });
    expect(salida).toEqual([30, 10, 20]);
  });

  it("lista vacía → sin trabajo", async () => {
    const fn = vi.fn();
    expect(await mapearConConcurrencia([], 4, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

// =============================================================================
// C · Handler completo del job
// =============================================================================

interface ConfigCliente {
  estadoIntento?: string;
  conexion?: Record<string, unknown> | null;
  errorConexion?: { message: string } | null;
  /** Hace fallar el INSERT del pedido (antes era el upsert). */
  errorUpsertPedido?: { message: string; code?: string } | null;
  /** Pedidos que YA existen en BD, indexados por `ml_shipment_id`. */
  pedidosExistentes?: Array<Record<string, unknown>>;
}

/**
 * Doble de Supabase con memoria mínima de `operacion.pedidos`.
 *
 * Tiene que distinguir INSERT de UPDATE porque la ingesta ya no hace un `upsert`
 * ciego: lee la fila por `(tenant_id, ml_shipment_id)` y decide. Ese cambio no es
 * cosmético — el upsert anterior mandaba `estado: 'pendiente_asignacion'` en cada
 * pasada y devolvía a la bandeja cualquier pedido ya asignado o en ruta que la
 * ventana volviera a cubrir.
 */
function crearClienteFalso(config: ConfigCliente = {}) {
  const registro = {
    intentoUpsert: [] as Record<string, unknown>[],
    intentoUpdate: [] as Record<string, unknown>[],
    pedidoInsert: [] as Record<string, unknown>[],
    pedidoUpdate: [] as Record<string, unknown>[],
  };

  const pedidosExistentes = new Map<string, Record<string, unknown>>(
    (config.pedidosExistentes ?? []).map((p) => [String(p.ml_shipment_id), p]),
  );

  function builder(schema: string, tabla: string) {
    const clave = `${schema}.${tabla}`;
    const filtros: Record<string, unknown> = {};
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const cadena: any = {};
    const self = () => cadena;
    cadena.select = vi.fn(self);
    cadena.eq = vi.fn((columna: string, valor: unknown) => {
      filtros[columna] = valor;
      return cadena;
    });
    cadena.in = vi.fn(self);

    cadena.single = vi.fn(async () => {
      if (clave === "identidad.conexiones_seller_ml") {
        return {
          data: config.errorConexion
            ? null
            : (config.conexion ?? {
                id: "conn-1",
                seller_id: "seller-1",
                tenant_id: "tenant-1",
                ml_user_id: "ml-user-99",
                access_token_ref: "ref-token",
              }),
          error: config.errorConexion ?? null,
        };
      }
      return { data: null, error: null };
    });

    // Lectura previa de la ingesta: ¿ya existe este pedido en este tenant?
    cadena.maybeSingle = vi.fn(async () => {
      if (clave === "operacion.pedidos") {
        const shipmentId = String(filtros["ml_shipment_id"] ?? "");
        return { data: pedidosExistentes.get(shipmentId) ?? null, error: null };
      }
      return { data: null, error: null };
    });

    cadena.upsert = vi.fn((valores: Record<string, unknown>) => {
      if (clave === "operacion.intentos_backfill") registro.intentoUpsert.push(valores);

      const cadenaUpsert: any = {};
      cadenaUpsert.select = vi.fn(() => cadenaUpsert);
      cadenaUpsert.single = vi.fn(async () => ({
        data: {
          id: "intento-1",
          desde: "2026-08-05T12:00:00.000Z",
          hasta: "2026-08-12T12:00:00.000Z",
          estado: config.estadoIntento ?? "en_progreso",
        },
        error: null,
      }));
      return cadenaUpsert;
    });

    cadena.insert = vi.fn((valores: Record<string, unknown>) => {
      if (clave === "operacion.pedidos") registro.pedidoInsert.push(valores);

      const cadenaInsert: any = {};
      cadenaInsert.select = vi.fn(() => cadenaInsert);
      cadenaInsert.maybeSingle = vi.fn(async () => ({
        data: config.errorUpsertPedido
          ? null
          : {
              id: `pedido-${registro.pedidoInsert.length}`,
              destinatario_direccion: valores.destinatario_direccion,
              destinatario_comuna: valores.destinatario_comuna,
            },
        error: config.errorUpsertPedido ?? null,
      }));
      cadenaInsert.single = cadenaInsert.maybeSingle;
      return cadenaInsert;
    });

    cadena.update = vi.fn((valores: Record<string, unknown>) => {
      if (clave === "operacion.intentos_backfill") registro.intentoUpdate.push(valores);
      if (clave === "operacion.pedidos") registro.pedidoUpdate.push(valores);
      return { eq: vi.fn(async () => ({ error: null })) };
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    return cadena;
  }

  const cliente = {
    schema: vi.fn((schema: string) => ({ from: vi.fn((tabla: string) => builder(schema, tabla)) })),
  };

  return { cliente, registro };
}

// El handler REAL, capturado por el mock de `createFunction`.
const handler = (
  jobEjecutarBackfill as unknown as {
    handler: (ctx: {
      event: { data: Record<string, unknown> };
      step: { run: <T>(label: string, fn: () => Promise<T>) => Promise<T> };
      logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
    }) => Promise<Record<string, unknown>>;
  }
).handler;

const stepFalso = { run: <T>(_l: string, fn: () => Promise<T>): Promise<T> => fn() };

function crearLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const EVENTO = {
  conexionId: "conn-1",
  sellerId: "seller-1",
  tenantId: "tenant-1",
  desconectadaDesde: "2026-08-11T12:00:00.000Z",
};

/** Doble de `/orders/search` + `/shipments/{id}` en un solo fetch. */
function stubMl(paginas: Array<{ results: unknown[]; total: number }>, shipments: Record<string, unknown>) {
  let indicePagina = 0;
  const fetchMock = vi.fn(async (url: string, _init?: PeticionFalsa) => {
    const texto = String(url);
    if (texto.includes("/orders/search")) {
      const pagina = paginas[Math.min(indicePagina, paginas.length - 1)];
      indicePagina += 1;
      return respuestaFalsa({
        json: { results: pagina.results, paging: { total: pagina.total, offset: 0, limit: 50 } },
      });
    }
    const id = texto.split("/").pop() as string;
    const shipment = shipments[id];
    if (!shipment) return respuestaFalsa({ status: 404, json: { message: "not found" } });
    return respuestaFalsa({ json: shipment });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("jobEjecutarBackfill — handler real", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ingiere el pedido Flex con su fecha_compromiso, dirección y estado de ENVÍO", async () => {
    const { cliente, registro } = crearClienteFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    stubMl(
      [{ results: [{ id: 2000001, shipping: { id: 44012345678 }, date_created: "2026-08-10T14:00:00.000Z", status: "paid" }], total: 1 }],
      { "44012345678": shipmentFlexNuevo() },
    );

    const logger = crearLogger();
    const resultado = await handler({ event: { data: EVENTO }, step: stepFalso, logger });

    expect(resultado.resultado).toBe("completado");
    expect(resultado.pedidosRecuperados).toBe(1);
    expect(registro.pedidoInsert).toHaveLength(1);

    const pedido = registro.pedidoInsert[0];
    expect(pedido.ml_shipment_id).toBe("44012345678");
    expect(pedido.tipo_pedido).toBe("flex");
    expect(pedido.ml_user_id).toBe("ml-user-99");
    // fecha_compromiso: sin ella el pedido es invisible en /operaciones.
    expect(pedido.fecha_compromiso).toBe("2026-08-12");
    // Estado del ENVÍO, no de la orden (`paid` no sirve para operar).
    expect(pedido.estado_ml).toBe("ready_to_ship");
    expect(pedido.subestado_ml).toBe("printed");
    // Domicilio real desde el shipment — la orden ya no lo trae.
    expect(pedido.destinatario_direccion).toBe(CALLE_FIXTURE);
    expect(pedido.destinatario_comuna).toBe("Las Condes");
    expect(pedido.destinatario_nombre).toBe(NOMBRE_FIXTURE);
    // Coordenada gratis de ML → no pasa por geocoding pagado.
    expect(pedido.lat).toBe(-33.4089);
    expect(pedido.geo_estado).toBe("resuelto");

    expect(registro.intentoUpdate.at(-1)).toMatchObject({
      estado: "completado",
      pedidos_recuperados: 1,
    });
  });

  it("descarta lo que no es Flex y lo deja contabilizado en el log", async () => {
    const { cliente, registro } = crearClienteFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    stubMl(
      [
        {
          results: [
            { id: 1, shipping: { id: 111 }, date_created: "2026-08-10T14:00:00.000Z" },
            { id: 2, shipping: { id: 222 }, date_created: "2026-08-10T14:00:00.000Z" },
            { id: 3, shipping: { id: null } },
          ],
          total: 3,
        },
      ],
      {
        "111": shipmentFlexNuevo(),
        "222": shipmentFlexNuevo({ logistic: { type: "fulfillment" } }),
      },
    );

    const logger = crearLogger();
    const resultado = await handler({ event: { data: EVENTO }, step: stepFalso, logger });

    expect(resultado.pedidosRecuperados).toBe(1);
    expect(resultado.omitidosNoFlex).toBe(1);
    expect(resultado.sinEnvio).toBe(1);
    expect(registro.pedidoInsert).toHaveLength(1);
    expect(logger.info.mock.calls.flat().join(" ")).toContain("no ser Flex");
  });

  it("el diagnóstico de forma se loguea SIN un solo valor del shipment", async () => {
    const { cliente } = crearClienteFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    stubMl(
      [{ results: [{ id: 1, shipping: { id: 111 }, date_created: "2026-08-10T14:00:00.000Z" }], total: 1 }],
      { "111": shipmentFlexNuevo() },
    );

    const logger = crearLogger();
    await handler({ event: { data: EVENTO }, step: stepFalso, logger });

    const todo = [
      ...logger.info.mock.calls.flat(),
      ...logger.warn.mock.calls.flat(),
      ...logger.error.mock.calls.flat(),
    ].join("\n");

    expect(todo).toContain("forma del shipment");
    expect(todo).toContain("logistic_type=anidado");
    expect(todo).toContain("direccion=destination");
    expect(todo).toContain("fecha_entrega=lead_time.estimated_delivery_time.date");
    // Ni PII ni token, en ningún nivel de log.
    expect(todo).not.toContain(NOMBRE_FIXTURE);
    expect(todo).not.toContain(CALLE_FIXTURE);
    expect(todo).not.toContain("Las Condes");
    expect(todo).not.toContain("tok-secreto-de-prueba");
    expect(todo).not.toContain("Bearer");
  });

  it("cuando ML falla, el intento queda `fallido` con su mensaje (no en_progreso)", async () => {
    const { cliente, registro } = crearClienteFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    // 404 en /orders/search — el error definitivo que no se reintenta.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaFalsa({ status: 404, json: { message: "not found" } })),
    );

    const logger = crearLogger();
    await expect(
      handler({ event: { data: EVENTO }, step: stepFalso, logger }),
    ).rejects.toThrow(/404/);

    const ultimo = registro.intentoUpdate.at(-1);
    expect(ultimo?.estado).toBe("fallido");
    expect(String(ultimo?.error)).toContain("404");
    expect(String(ultimo?.error)).not.toContain("tok-secreto");
  });

  it("un upsert que falla NO se cuenta como procesado y hace fallar el intento", async () => {
    const { cliente, registro } = crearClienteFalso({
      errorUpsertPedido: { message: 'column "fecha_compromiso" does not exist' },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    stubMl(
      [{ results: [{ id: 1, shipping: { id: 111 }, date_created: "2026-08-10T14:00:00.000Z" }], total: 1 }],
      { "111": shipmentFlexNuevo() },
    );

    const logger = crearLogger();
    await expect(
      handler({ event: { data: EVENTO }, step: stepFalso, logger }),
    ).rejects.toThrow(/no se pudieron guardar/);

    // El contador NO miente: cero procesados, y el intento queda fallido.
    const ultimo = registro.intentoUpdate.at(-1);
    expect(ultimo?.estado).toBe("fallido");
    expect(String(ultimo?.error)).toContain("1 pedidos no se pudieron guardar");
    expect(registro.intentoUpdate.some((u) => u.estado === "completado")).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it("una página vacía con total>0 corta el recorrido en vez de girar hasta el timeout", async () => {
    const { cliente, registro } = crearClienteFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    // `results: []` con `total: 500`: si el offset no avanzara, bucle infinito.
    const fetchMock = stubMl([{ results: [], total: 500 }], {});

    const logger = crearLogger();
    const resultado = await handler({ event: { data: EVENTO }, step: stepFalso, logger });

    expect(resultado.resultado).toBe("completado");
    expect(resultado.pedidosRecuperados).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls.flat().join(" ")).toContain("página vacía");
    expect(registro.intentoUpdate.at(-1)?.estado).toBe("completado");
  });

  it("conexión sin ml_user_id → intento `fallido`, sin llamar a ML", async () => {
    const { cliente, registro } = crearClienteFalso({
      conexion: {
        id: "conn-1",
        seller_id: "seller-1",
        tenant_id: "tenant-1",
        ml_user_id: null,
        access_token_ref: null,
      },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await handler({ event: { data: EVENTO }, step: stepFalso, logger: crearLogger() });

    expect(resultado).toEqual({ resultado: "fallido", razon: "conexion_incompleta" });
    expect(registro.intentoUpdate.at(-1)?.estado).toBe("fallido");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("intento ya completado → no-op idempotente, sin tocar ML", async () => {
    const { cliente, registro } = crearClienteFalso({ estadoIntento: "completado" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await handler({ event: { data: EVENTO }, step: stepFalso, logger: crearLogger() });

    expect(resultado).toEqual({ resultado: "ya_completado", intentoId: "intento-1" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registro.pedidoInsert).toHaveLength(0);
    expect(registro.intentoUpdate).toHaveLength(0);
  });

  it("recorta la ventana a 7 días cuando desconectada_desde es null", async () => {
    const { cliente, registro } = crearClienteFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    stubMl([{ results: [], total: 0 }], {});

    const resultado = await handler({
      event: { data: { ...EVENTO, desconectadaDesde: null } },
      step: stepFalso,
      logger: crearLogger(),
    });

    expect(resultado.ventanaRecortada).toBe(true);
    const intento = registro.intentoUpsert[0];
    const dias =
      (new Date(String(intento.hasta)).getTime() - new Date(String(intento.desde)).getTime()) /
      86_400_000;
    expect(dias).toBeCloseTo(7, 3);
  });

  it("NO le manda `x-format-new` a /orders/search, y sí a cada shipment", async () => {
    const { cliente } = crearClienteFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const fetchMock = stubMl(
      [{ results: [{ id: 1, shipping: { id: 111 }, date_created: "2026-08-10T14:00:00.000Z" }], total: 1 }],
      { "111": shipmentFlexNuevo() },
    );

    await handler({ event: { data: EVENTO }, step: stepFalso, logger: crearLogger() });

    const [urlOrdenes, initOrdenes] = fetchMock.mock.calls[0] as [string, PeticionFalsa];
    expect(urlOrdenes).toContain("/orders/search");
    expect(initOrdenes.headers["x-format-new"]).toBeUndefined();

    const [urlEnvio, initEnvio] = fetchMock.mock.calls[1] as [string, PeticionFalsa];
    expect(urlEnvio).toBe("https://api.mercadolibre.com/shipments/111");
    expect(initEnvio.headers["x-format-new"]).toBe("true");
  });
});

// =============================================================================
// D · Seguridad — el token no aparece en payloads externos
// =============================================================================

describe("ejecutarBackfill — seguridad: token nunca en estructuras externas", () => {
  it("el evento ml/conexion.reconectada no incluye access_token", () => {
    const eventoReconectada = {
      name: "ml/conexion.reconectada" as const,
      data: {
        conexionId: "conn-abc123",
        sellerId: "seller-xyz",
        tenantId: "tenant-123",
        desconectadaDesde: "2026-06-01T00:00:00.000Z",
      },
    };

    const serializado = JSON.stringify(eventoReconectada);
    expect(serializado).not.toContain("access_token");
    expect(serializado).not.toContain("refresh_token");
    expect(serializado).not.toContain("Bearer");
    expect(eventoReconectada.data).not.toHaveProperty("access_token");
    expect(eventoReconectada.data).not.toHaveProperty("access_token_ref");
    expect(eventoReconectada.data).not.toHaveProperty("refresh_token_ref");
  });

  it("el resultado devuelto por el job no incluye el access_token", async () => {
    const { cliente } = crearClienteFalso();
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    stubMl(
      [{ results: [{ id: 1, shipping: { id: 111 }, date_created: "2026-08-10T14:00:00.000Z" }], total: 1 }],
      { "111": shipmentFlexNuevo() },
    );

    const resultado = await handler({ event: { data: EVENTO }, step: stepFalso, logger: crearLogger() });

    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain("token");
    expect(serializado).not.toContain(NOMBRE_FIXTURE);
    expect(serializado).not.toContain(CALLE_FIXTURE);
    expect(resultado).not.toHaveProperty("accessToken");
  });
});
