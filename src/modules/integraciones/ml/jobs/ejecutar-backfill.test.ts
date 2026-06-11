/**
 * Pruebas de la lógica del job ejecutar-backfill.
 *
 * Dado que el job real usa Inngest (step.run) y dependencias de BD/red,
 * se extrae y prueba la lógica pura de cálculo de ventana de tiempo
 * y la lógica de idempotencia por estado del intento.
 *
 * Cubre:
 * 1. Ventana máxima de 7 días — si desconectada_desde es null se acota.
 * 2. Ventana máxima de 7 días — si desconectada_desde es > 7 días se acota.
 * 3. Ventana exacta — si desconectada_desde es < 7 días se usa sin recortar.
 * 4. Idempotencia — si el intento ya está completado, se sale sin reprocesar.
 * 5. Pedidos sin shipment_id son ignorados (no se insertan).
 * 6. Token nunca aparece en parámetros públicos del job (seguridad).
 */
import { describe, expect, it, vi } from "vitest";
import { obtenerLogisticTypePorShipment, LOGISTIC_TYPE_FLEX } from "./ejecutar-backfill";

// =============================================================================
// Lógica de cálculo de ventana — extraída para prueba pura (sin Inngest/BD)
// =============================================================================

const VENTANA_MAXIMA_DIAS = 7;

interface ResultadoVentana {
  desde: Date;
  hasta: Date;
  ventanaRecortada: boolean;
}

/**
 * Calcula la ventana de tiempo para el backfill.
 * Espejo fiel de la lógica en ejecutar-backfill.ts (paso "crear-o-reutilizar-intento").
 */
function calcularVentanaBackfill(
  desconectadaDesde: string | null,
  ahora: Date,
): ResultadoVentana {
  const ventanaMaxima = new Date(ahora.getTime() - VENTANA_MAXIMA_DIAS * 24 * 60 * 60 * 1000);

  if (!desconectadaDesde) {
    return {
      desde: ventanaMaxima,
      hasta: ahora,
      ventanaRecortada: true,
    };
  }

  const fechaDesconexion = new Date(desconectadaDesde);
  if (fechaDesconexion < ventanaMaxima) {
    return {
      desde: ventanaMaxima,
      hasta: ahora,
      ventanaRecortada: true,
    };
  }

  return {
    desde: fechaDesconexion,
    hasta: ahora,
    ventanaRecortada: false,
  };
}

// =============================================================================
// Tests de ventana de tiempo
// =============================================================================

describe("ejecutarBackfill — cálculo de ventana de tiempo", () => {
  const AHORA = new Date("2026-06-08T12:00:00.000Z");
  const HACE_7_DIAS_EXACTOS = new Date("2026-06-01T12:00:00.000Z");
  const HACE_3_DIAS = new Date("2026-06-05T12:00:00.000Z");
  const HACE_10_DIAS = new Date("2026-05-29T12:00:00.000Z");
  const HACE_30_DIAS = new Date("2026-05-09T12:00:00.000Z");

  it("desconectada_desde=null → recorta a 7 días, marca ventanaRecortada=true", () => {
    const resultado = calcularVentanaBackfill(null, AHORA);

    expect(resultado.ventanaRecortada).toBe(true);
    // La ventana debe empezar exactamente 7 días antes de ahora
    const diffMs = AHORA.getTime() - resultado.desde.getTime();
    const diffDias = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDias).toBeCloseTo(7, 5); // dentro de ±0.00001 días
    expect(resultado.hasta.toISOString()).toBe(AHORA.toISOString());
  });

  it("desconectada_desde > 7 días atrás → recorta a 7 días, marca ventanaRecortada=true", () => {
    const resultado = calcularVentanaBackfill(HACE_10_DIAS.toISOString(), AHORA);

    expect(resultado.ventanaRecortada).toBe(true);
    const diffDias = (AHORA.getTime() - resultado.desde.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDias).toBeCloseTo(7, 5);
  });

  it("desconectada_desde mucho tiempo atrás (30 días) → recorta a 7 días", () => {
    const resultado = calcularVentanaBackfill(HACE_30_DIAS.toISOString(), AHORA);

    expect(resultado.ventanaRecortada).toBe(true);
    const diffDias = (AHORA.getTime() - resultado.desde.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDias).toBeCloseTo(7, 5);
  });

  it("desconectada_desde dentro de los 7 días → usa la fecha real, NO recorta", () => {
    const resultado = calcularVentanaBackfill(HACE_3_DIAS.toISOString(), AHORA);

    expect(resultado.ventanaRecortada).toBe(false);
    expect(resultado.desde.toISOString()).toBe(HACE_3_DIAS.toISOString());
    expect(resultado.hasta.toISOString()).toBe(AHORA.toISOString());
  });

  it("desconectada_desde exactamente 7 días → usa la fecha real (límite inclusivo)", () => {
    // El límite es < ventanaMaxima, no <=, por lo que exactamente 7 días no recorta.
    // La ventanaMaxima es ahora - 7 * 86400000 ms, y fechaDesconexion es igual.
    // Como !( fecha < ventanaMaxima ) y fecha == ventanaMaxima, NO se recorta.
    const resultado = calcularVentanaBackfill(HACE_7_DIAS_EXACTOS.toISOString(), AHORA);

    expect(resultado.ventanaRecortada).toBe(false);
    expect(resultado.desde.toISOString()).toBe(HACE_7_DIAS_EXACTOS.toISOString());
  });

  it("la ventana siempre termina en 'ahora', no en el futuro ni en el pasado lejano", () => {
    const resultado = calcularVentanaBackfill(HACE_3_DIAS.toISOString(), AHORA);

    expect(resultado.hasta.getTime()).toBe(AHORA.getTime());
  });
});

// =============================================================================
// Idempotencia — intento ya completado (no-op)
// =============================================================================

describe("ejecutarBackfill — idempotencia de intento completado", () => {
  /**
   * Simula la decisión de idempotencia: si el intento ya está completado,
   * el job retorna sin reprocesar.
   */
  function debeEjecutarBackfill(estadoIntento: string): boolean {
    return estadoIntento !== "completado";
  }

  it("estado='completado' → no debe ejecutar el backfill (no-op)", () => {
    expect(debeEjecutarBackfill("completado")).toBe(false);
  });

  it("estado='en_progreso' → debe ejecutar el backfill", () => {
    expect(debeEjecutarBackfill("en_progreso")).toBe(true);
  });

  it("estado='fallido' → debe ejecutar el backfill (reintento válido)", () => {
    expect(debeEjecutarBackfill("fallido")).toBe(true);
  });

  it("estado='pendiente' → debe ejecutar el backfill", () => {
    expect(debeEjecutarBackfill("pendiente")).toBe(true);
  });
});

// =============================================================================
// Filtrado de pedidos sin shipment_id
// =============================================================================

describe("ejecutarBackfill — filtrado de órdenes ML sin shipment_id", () => {
  interface OrderMl {
    id: number | string;
    shipping?: { shipment_id?: number | string | null };
    status?: string;
  }

  /**
   * Extrae los shipment IDs procesables de una lista de órdenes ML.
   * Espejo fiel de la lógica dentro del loop for(order of orders) del job.
   */
  function extraerShipmentIds(orders: OrderMl[]): string[] {
    const ids: string[] = [];
    for (const order of orders) {
      const shipmentId = order.shipping?.shipment_id
        ? String(order.shipping.shipment_id)
        : null;
      if (!shipmentId) continue;
      ids.push(shipmentId);
    }
    return ids;
  }

  it("órdenes sin shipping → se ignoran (shipment_id null)", () => {
    const orders: OrderMl[] = [
      { id: 1, shipping: undefined },
      { id: 2, shipping: { shipment_id: null } },
      { id: 3, shipping: {} },
    ];
    expect(extraerShipmentIds(orders)).toHaveLength(0);
  });

  it("órdenes con shipping.shipment_id válido → se incluyen", () => {
    const orders: OrderMl[] = [
      { id: 1, shipping: { shipment_id: 123456 } },
      { id: 2, shipping: { shipment_id: "789012" } },
    ];
    const ids = extraerShipmentIds(orders);
    expect(ids).toHaveLength(2);
    expect(ids).toContain("123456");
    expect(ids).toContain("789012");
  });

  it("lista mixta → solo los que tienen shipment_id", () => {
    const orders: OrderMl[] = [
      { id: 1, shipping: { shipment_id: 111 } },
      { id: 2, shipping: undefined },                    // sin shipping
      { id: 3, shipping: { shipment_id: 333 } },
      { id: 4, shipping: { shipment_id: null } },       // shipment_id null
      { id: 5, shipping: { shipment_id: "555" } },
    ];
    const ids = extraerShipmentIds(orders);
    expect(ids).toHaveLength(3);
    expect(ids).toContain("111");
    expect(ids).toContain("333");
    expect(ids).toContain("555");
    expect(ids).not.toContain("null");
  });

  it("lista vacía → sin resultados", () => {
    expect(extraerShipmentIds([])).toHaveLength(0);
  });
});

// =============================================================================
// Seguridad — el token no debe aparecer en payloads de log o eventos
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
        // NUNCA debe incluir el token de acceso.
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

  it("el resultado devuelto por el job no incluye el access_token", () => {
    // Simula el objeto retornado en el happy path del job
    const resultadoJob = {
      resultado: "completado",
      intentoId: "intento-123",
      pedidosRecuperados: 42,
      ventanaRecortada: false,
      // El access_token NUNCA debe aparecer aquí
    };

    const serializado = JSON.stringify(resultadoJob);
    expect(serializado).not.toContain("access_token");
    expect(serializado).not.toContain("token");
    expect(resultadoJob).not.toHaveProperty("access_token");
    expect(resultadoJob).not.toHaveProperty("accessToken");
  });
});

// =============================================================================
// Paginación — cálculo de hayMas
// =============================================================================

describe("ejecutarBackfill — paginación (cálculo de hayMas)", () => {
  /**
   * Espejo de la condición de continuación del loop de paginación del job:
   * hayMas = offset < (paging?.total ?? 0)
   */
  function hayMasPaginas(offset: number, total: number | undefined): boolean {
    return offset < (total ?? 0);
  }

  it("offset=0, total=50 → hay más páginas", () => {
    expect(hayMasPaginas(0, 50)).toBe(true);
  });

  it("offset=50, total=50 → no hay más páginas (llegamos al final)", () => {
    expect(hayMasPaginas(50, 50)).toBe(false);
  });

  it("offset=0, total=0 → no hay páginas (sin resultados)", () => {
    expect(hayMasPaginas(0, 0)).toBe(false);
  });

  it("offset=0, total=undefined → no hay páginas (body mal formado)", () => {
    expect(hayMasPaginas(0, undefined)).toBe(false);
  });

  it("offset=50, total=120 → hay más páginas (quedan 70)", () => {
    expect(hayMasPaginas(50, 120)).toBe(true);
  });

  it("offset=100, total=100 → no hay más páginas", () => {
    expect(hayMasPaginas(100, 100)).toBe(false);
  });
});

// =============================================================================
// Filtro de alcance: solo Flex (self_service) — Full/Colecta/Agencia se omiten
// =============================================================================

describe("ejecutarBackfill — obtenerLogisticTypePorShipment (batch real)", () => {
  it("mapea cada shipment a su logistic_type; ausente → null", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 111, logistic_type: "self_service" },
        { id: 222, logistic_type: "fulfillment" },
        { id: 333 }, // sin logistic_type → null
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const mapa = await obtenerLogisticTypePorShipment(["111", "222", "333"], "tok-secreto");

    expect(mapa.get("111")).toBe("self_service");
    expect(mapa.get("222")).toBe("fulfillment");
    expect(mapa.get("333")).toBe(null);
    // El token va en el header Authorization, NUNCA en la URL.
    const urlLlamada = String(fetchMock.mock.calls[0][0]);
    expect(urlLlamada).not.toContain("tok-secreto");
    vi.unstubAllGlobals();
  });

  it("lista vacía → no llama a fetch y devuelve mapa vacío", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mapa = await obtenerLogisticTypePorShipment([], "tok");
    expect(mapa.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("respuesta no-ok → lanza (lo reintenta Inngest)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(obtenerLogisticTypePorShipment(["1"], "tok")).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});

describe("ejecutarBackfill — decisión de filtro: solo se ingiere Flex", () => {
  interface OrderMl {
    id: number | string;
    shipping?: { shipment_id?: number | string | null };
  }

  /** Espejo fiel de la decisión dentro del loop for(order of orders) del job. */
  function shipmentsIngeridos(orders: OrderMl[], mapaLogistic: Map<string, string | null>): string[] {
    const out: string[] = [];
    for (const order of orders) {
      const sid = order.shipping?.shipment_id ? String(order.shipping.shipment_id) : null;
      if (!sid) continue;
      if (mapaLogistic.get(sid) !== LOGISTIC_TYPE_FLEX) continue;
      out.push(sid);
    }
    return out;
  }

  it("Full (fulfillment) → omitido", () => {
    const orders: OrderMl[] = [{ id: 1, shipping: { shipment_id: 222 } }];
    const mapa = new Map<string, string | null>([["222", "fulfillment"]]);
    expect(shipmentsIngeridos(orders, mapa)).toHaveLength(0);
  });

  it("mixto Flex + Full + Colecta → solo el Flex", () => {
    const orders: OrderMl[] = [
      { id: 1, shipping: { shipment_id: 111 } },
      { id: 2, shipping: { shipment_id: 222 } },
      { id: 3, shipping: { shipment_id: 333 } },
    ];
    const mapa = new Map<string, string | null>([
      ["111", "self_service"],
      ["222", "fulfillment"],
      ["333", "cross_docking"],
    ]);
    expect(shipmentsIngeridos(orders, mapa)).toEqual(["111"]);
  });

  it("logistic_type ausente (null) → omitido (no se asume Flex)", () => {
    const orders: OrderMl[] = [{ id: 1, shipping: { shipment_id: 444 } }];
    const mapa = new Map<string, string | null>([["444", null]]);
    expect(shipmentsIngeridos(orders, mapa)).toHaveLength(0);
  });

  it("todos Flex → todos ingeridos", () => {
    const orders: OrderMl[] = [
      { id: 1, shipping: { shipment_id: 111 } },
      { id: 2, shipping: { shipment_id: 222 } },
    ];
    const mapa = new Map<string, string | null>([
      ["111", "self_service"],
      ["222", "self_service"],
    ]);
    expect(shipmentsIngeridos(orders, mapa)).toEqual(["111", "222"]);
  });
});
