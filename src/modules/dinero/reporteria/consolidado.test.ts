import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { codigoVisible, obtenerReporteConsolidado } from "./consolidado";

const TENANT = "11111111-1111-4111-8111-111111111111";

const pedidoBase = {
  id: "uuid-que-no-debe-salir-nunca",
  fuente: null as string | null,
  tipo_pedido: "same_day",
  referencia_externa: null as string | null,
  codigo_interno: null as string | null,
  ml_order_id: null as string | null,
  ml_shipment_id: null as string | null,
  destinatario_nombre: null,
  destinatario_comuna: null,
};

describe("codigoVisible — el número que la contraparte reconoce", () => {
  it("🔴 una fuente que HOY NO EXISTE en el código se nombra sola", () => {
    // Este es el test que importa. Falabella está en construcción y detrás
    // vienen más. Si esta función tuviera un `switch` por fuente, esta prueba
    // fallaría — y esa falla es la que hay que impedir de antemano, porque en
    // producción no se vería como un error sino como un código que el seller no
    // reconoce en un reporte con el que se le cobra.
    expect(
      codigoVisible({
        ...pedidoBase,
        fuente: "falabella",
        referencia_externa: "FAL-99887766",
        codigo_interno: "RX-AAAA-BBBB",
      }),
    ).toBe("FAL-99887766");
  });

  it("en Shopify manda el nombre del pedido en la tienda, no el RX", () => {
    // El seller busca «#1001» en su admin de Shopify. El RX es de Rutax y a él
    // no le sirve para cuadrar nada.
    expect(
      codigoVisible({
        ...pedidoBase,
        fuente: "shopify",
        referencia_externa: "#1001",
        codigo_interno: "RX-AAAA-BBBB",
      }),
    ).toBe("#1001");
  });

  it("en Flex manda el número de VENTA de Mercado Libre", () => {
    // La excepción con motivo: Flex es anterior a `referencia_externa` y la
    // tiene en NULL. El número de venta es el que el seller ve en su panel; el
    // del envío no le dice nada.
    expect(
      codigoVisible({
        ...pedidoBase,
        fuente: "ml_flex",
        tipo_pedido: "flex",
        ml_order_id: "2000012345678",
        ml_shipment_id: "44556677",
      }),
    ).toBe("2000012345678");
  });

  it("si la venta no vino, cae al envío antes que dejar la fila muda", () => {
    expect(
      codigoVisible({ ...pedidoBase, fuente: "ml_flex", tipo_pedido: "flex", ml_shipment_id: "44556677" }),
    ).toBe("44556677");
  });

  it("en el same-day propio manda el código RX", () => {
    expect(
      codigoVisible({ ...pedidoBase, fuente: "rutax_manual", codigo_interno: "RX-8HCZ-0PPB" }),
    ).toBe("RX-8HCZ-0PPB");
  });

  it("una fuente nueva cuyo adaptador aún no puebla su referencia cae al RX", () => {
    // Degrada a algo utilizable en vez de a un hueco: el courier al menos puede
    // buscar ese pedido dentro de Rutax.
    expect(
      codigoVisible({ ...pedidoBase, fuente: "falabella", codigo_interno: "RX-CCCC-DDDD" }),
    ).toBe("RX-CCCC-DDDD");
  });

  it("🔴 sin pedido devuelve un guion, JAMÁS un identificador interno", () => {
    expect(codigoVisible(undefined)).toBe("—");
  });

  it("🔴 el UUID no sale por ninguna de las ramas", () => {
    // Barrido: con TODAS las columnas de código vacías, lo único que hay a mano
    // es el `id`. Tiene que preferir el guion antes que filtrarlo.
    expect(codigoVisible({ ...pedidoBase, fuente: "loquesea" })).toBe("—");
  });
});

// =============================================================================
// El cruce de los dos lados
// =============================================================================

interface Semilla {
  cobros?: Record<string, unknown>[];
  liquidaciones?: Record<string, unknown>[];
  pedidos?: Record<string, unknown>[];
}

/**
 * Falso de las cinco lecturas. Devuelve lo que se le da: si inventara filas, la
 * prueba dejaría de decir algo del código real.
 */
function clienteFalso(s: Semilla): SupabaseClient {
  const tabla = (filas: Record<string, unknown>[]) => {
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      gte: () => c,
      lte: () => c,
      in: () => Promise.resolve({ data: filas, error: null }),
      range: () => Promise.resolve({ data: filas, error: null }),
    };
    return c;
  };
  return {
    schema: (esquema: string) => ({
      from: (nombre: string) => {
        if (esquema === "dinero" && nombre === "lineas_cobro") return tabla(s.cobros ?? []);
        if (esquema === "dinero" && nombre === "lineas_liquidacion")
          return tabla(s.liquidaciones ?? []);
        if (esquema === "operacion" && nombre === "pedidos") return tabla(s.pedidos ?? []);
        if (nombre === "sellers")
          return tabla([{ id: "s1", razon_social: "NovalinkShop", rut: "78060175-2" }]);
        if (nombre === "conductores")
          return tabla([{ id: "d1", nombre_completo: "Jorge Conductor", rut: "27137700-2" }]);
        throw new Error(`tabla inesperada: ${esquema}.${nombre}`);
      },
    }),
  } as unknown as SupabaseClient;
}

const pedido = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  fuente: "rutax_manual",
  tipo_pedido: "same_day",
  referencia_externa: null,
  codigo_interno: `RX-${id}`,
  ml_order_id: null,
  ml_shipment_id: null,
  destinatario_nombre: "Camila Rojas",
  destinatario_comuna: "Las Condes",
  ...extra,
});

const cobro = (pedidoId: string, extra: Record<string, unknown> = {}) => ({
  pedido_id: pedidoId,
  seller_id: "s1",
  monto_base_clp: 3000,
  ajuste_incidencia_clp: 0,
  monto_final_clp: 3000,
  fecha_hecho: "2026-08-27",
  origen_generacion: "motor_automatico",
  concepto: "Entrega same-day",
  anulada: false,
  ...extra,
});

const liquidacion = (pedidoId: string | null, extra: Record<string, unknown> = {}) => ({
  pedido_id: pedidoId,
  driver_id: "d1",
  monto_base_clp: 2300,
  ajuste_incidencia_clp: 0,
  monto_final_clp: 2300,
  fecha_hecho: "2026-08-27",
  origen_generacion: "motor_automatico",
  concepto: "Entrega same-day",
  tipo_hecho: "entrega",
  anulada: false,
  ...extra,
});

const rango = { tenantId: TENANT, desde: "2026-08-01", hasta: "2026-08-31" };

describe("obtenerReporteConsolidado", () => {
  it("cruza cobro y pago del mismo pedido en UNA fila, con su margen", async () => {
    const r = await obtenerReporteConsolidado(
      clienteFalso({ cobros: [cobro("p1")], liquidaciones: [liquidacion("p1")], pedidos: [pedido("p1")] }),
      rango,
    );

    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({
      codigo: "RX-p1",
      sellerNombre: "NovalinkShop",
      sellerRut: "78060175-2",
      conductorNombre: "Jorge Conductor",
      cobroFinal: 3000,
      pagoFinal: 2300,
      margen: 700,
      discrepancia: null,
    });
  });

  it("🔴 un pedido cobrado y NO pagado se marca, no se esconde", async () => {
    // Es el caso que pasó en producción el 2026-08-27: la entrega generó su
    // línea de cobro y la del conductor nunca se escribió. Separado en dos
    // reportes, nadie lo habría visto.
    const r = await obtenerReporteConsolidado(
      clienteFalso({ cobros: [cobro("p1")], liquidaciones: [], pedidos: [pedido("p1")] }),
      rango,
    );

    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].discrepancia).toBe("sin_pago");
    expect(r.conDiscrepancia).toBe(1);
  });

  it("🔴 y el margen queda NULO, no en el valor del cobro", async () => {
    // Restar contra cero diría «ganamos $3.000» cuando lo cierto es que falta
    // pagarle a alguien. Un total inventado en un reporte de pagos es peor que
    // un hueco visible.
    const r = await obtenerReporteConsolidado(
      clienteFalso({ cobros: [cobro("p1")], liquidaciones: [], pedidos: [pedido("p1")] }),
      rango,
    );
    expect(r.filas[0].margen).toBeNull();
  });

  it("🔴 una línea ANULADA no es «falta»: son cosas distintas y piden lo opuesto", async () => {
    // Encontrado en producción el 2026-08-28. Seis entregas salían como «Falta
    // el pago» y sus líneas de liquidación EXISTÍAN, anuladas a mano. Se leyó
    // como «el motor no las escribió» y por poco se re-dispara el motor sobre
    // seis decisiones que alguien tomó con su nombre.
    const r = await obtenerReporteConsolidado(
      clienteFalso({
        cobros: [cobro("p1")],
        liquidaciones: [liquidacion("p1", { anulada: true })],
        pedidos: [pedido("p1")],
      }),
      rango,
    );

    expect(r.filas[0].discrepancia).toBe("pago_anulado");
    // Y NO cuenta como hueco: el contador de arriba es la lista de lo que hay
    // que arreglar, y esto ya está decidido.
    expect(r.conDiscrepancia).toBe(0);
    expect(r.conAnulacion).toBe(1);
    // La plata anulada tampoco entra a los totales.
    expect(r.totalPago).toBe(0);
  });

  it("un cobro anulado se distingue igual", async () => {
    const r = await obtenerReporteConsolidado(
      clienteFalso({
        cobros: [cobro("p1", { anulada: true })],
        liquidaciones: [liquidacion("p1")],
        pedidos: [pedido("p1")],
      }),
      rango,
    );
    expect(r.filas[0].discrepancia).toBe("cobro_anulado");
    expect(r.conDiscrepancia).toBe(0);
  });

  it("🔴 sin ninguna línea sí es «falta», y ahí sí hay que actuar", async () => {
    // La contraprueba: si no hay línea anulada de por medio, el hueco es real.
    const r = await obtenerReporteConsolidado(
      clienteFalso({ cobros: [cobro("p1")], liquidaciones: [], pedidos: [pedido("p1")] }),
      rango,
    );
    expect(r.filas[0].discrepancia).toBe("sin_pago");
    expect(r.conDiscrepancia).toBe(1);
    expect(r.conAnulacion).toBe(0);
  });

  it("un pedido pagado y no cobrado también se marca", async () => {
    const r = await obtenerReporteConsolidado(
      clienteFalso({ cobros: [], liquidaciones: [liquidacion("p1")], pedidos: [pedido("p1")] }),
      rango,
    );
    expect(r.filas[0].discrepancia).toBe("sin_cobro");
  });

  it("🔴 las líneas ANULADAS no entran: sumarlas cobraría dos veces", async () => {
    const r = await obtenerReporteConsolidado(
      clienteFalso({
        cobros: [cobro("p1", { anulada: true })],
        liquidaciones: [liquidacion("p1", { anulada: true })],
        pedidos: [pedido("p1")],
      }),
      rango,
    );
    expect(r.filas).toHaveLength(0);
    expect(r.totalCobro).toBe(0);
    expect(r.totalPago).toBe(0);
  });

  it("las visitas a bodega van aparte y SUMAN al pago del conductor", async () => {
    // Una visita no cuelga de ningún pedido: mezclarla entre las entregas
    // inventaría una fila de entrega que no existe. Pero es plata que se le
    // debe igual.
    const r = await obtenerReporteConsolidado(
      clienteFalso({
        cobros: [cobro("p1")],
        liquidaciones: [
          liquidacion("p1"),
          liquidacion(null, {
            tipo_hecho: "retiro_bodega",
            monto_final_clp: 1500,
            concepto: "Visita a bodega",
          }),
        ],
        pedidos: [pedido("p1")],
      }),
      rango,
    );

    expect(r.filas).toHaveLength(1);
    expect(r.visitas).toHaveLength(1);
    expect(r.porConductor[0]).toMatchObject({
      conductorNombre: "Jorge Conductor",
      entregas: 1,
      visitas: 1,
      totalEntregas: 2300,
      totalVisitas: 1500,
      totalAPagar: 3800,
    });
    expect(r.totalPago).toBe(3800);
  });

  it("🔴 el id viaja en los datos para enlazar, y NO en ninguna columna visible", async () => {
    // El usuario fue explícito: nada de UUID en el reporte. Pero el documento
    // por seller y la liquidación por conductor se abren con su id, así que
    // tiene que estar en la estructura. La regla es dónde NO puede aparecer: en
    // pantalla y en el CSV, cuyas columnas son una lista explícita.
    const r = await obtenerReporteConsolidado(
      clienteFalso({
        cobros: [cobro("p1")],
        liquidaciones: [liquidacion("p1")],
        pedidos: [pedido("p1")],
      }),
      rango,
    );
    expect(r.filas[0].sellerId).toBe("s1");
    expect(r.filas[0].conductorId).toBe("d1");
    expect(r.porConductor[0].conductorId).toBe("d1");
    // Y el código visible sigue sin ser un identificador interno.
    expect(r.filas[0].codigo).toBe("RX-p1");
  });

  it("los totales por seller son con lo que se emite el documento", async () => {
    const r = await obtenerReporteConsolidado(
      clienteFalso({
        cobros: [cobro("p1"), cobro("p2")],
        liquidaciones: [liquidacion("p1"), liquidacion("p2")],
        pedidos: [pedido("p1"), pedido("p2")],
      }),
      rango,
    );
    expect(r.porSeller).toEqual([
      { sellerId: "s1", sellerNombre: "NovalinkShop", entregas: 2, totalCobro: 6000 },
    ]);
    expect(r.totalCobro).toBe(6000);
  });

  // ===========================================================================
  // Escalabilidad a fuentes futuras
  // ===========================================================================

  it("🔴 una fuente NUEVA entra al reporte y a los totales sin tocar código", async () => {
    // El día que entre Falabella nadie va a acordarse de este archivo. Si el
    // desglose se armara desde una lista fija de fuentes, esa fuente no daría
    // error: simplemente **no se sumaría**, y el total del reporte sería menor
    // que la plata que de verdad se movió. Eso no se detecta mirando.
    const r = await obtenerReporteConsolidado(
      clienteFalso({
        cobros: [cobro("p1"), cobro("p2")],
        liquidaciones: [liquidacion("p1"), liquidacion("p2")],
        pedidos: [
          pedido("p1"),
          pedido("p2", { fuente: "falabella", referencia_externa: "FAL-99887766" }),
        ],
      }),
      rango,
    );

    const falabella = r.porFuente.find((f) => f.fuente === "falabella");
    expect(falabella).toMatchObject({ entregas: 1, totalCobro: 3000, totalPago: 2300 });

    // Y su fila se nombra con lo que Falabella le muestra al seller.
    expect(r.filas.map((f) => f.codigo)).toContain("FAL-99887766");

    // El total general la incluye: es la comprobación de que no se cayó por el
    // costado sin que nada avisara.
    expect(r.totalCobro).toBe(6000);
    expect(r.porFuente.reduce((s, f) => s + f.totalCobro, 0)).toBe(r.totalCobro);
  });

  it("una fuente sin traducción se muestra CRUDA, no como «desconocida»", async () => {
    // El helper delata en vez de disimular: quien lea el reporte ve «falabella»
    // y sabe que falta ponerle nombre. Un «Otra fuente» genérico escondería
    // exactamente eso.
    const r = await obtenerReporteConsolidado(
      clienteFalso({
        cobros: [cobro("p1")],
        liquidaciones: [liquidacion("p1")],
        pedidos: [pedido("p1", { fuente: "falabella" })],
      }),
      rango,
    );
    expect(r.porFuente[0].etiqueta).toBe("falabella");
  });

  it("las fuentes de hoy conviven y se separan bien", async () => {
    const r = await obtenerReporteConsolidado(
      clienteFalso({
        cobros: [cobro("p1"), cobro("p2"), cobro("p3")],
        liquidaciones: [liquidacion("p1"), liquidacion("p2"), liquidacion("p3")],
        pedidos: [
          pedido("p1", { fuente: "ml_flex", tipo_pedido: "flex", ml_order_id: "2000012345678" }),
          pedido("p2", { fuente: "shopify", referencia_externa: "#1001" }),
          pedido("p3"),
        ],
      }),
      rango,
    );

    expect(r.porFuente.map((f) => f.etiqueta).sort()).toEqual([
      "Mercado Libre Flex",
      "Same-day",
      "Shopify",
    ]);
    expect(r.filas.map((f) => f.codigo).sort()).toEqual(["#1001", "2000012345678", "RX-p3"]);
  });
});
