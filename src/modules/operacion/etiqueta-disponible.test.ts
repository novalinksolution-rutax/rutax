import { describe, expect, it } from "vitest";

import {
  disponibilidadEtiqueta,
  puedeImprimirEtiqueta,
  type PedidoParaEtiqueta,
} from "./etiqueta-disponible";

function flex(p: Partial<PedidoParaEtiqueta> = {}): PedidoParaEtiqueta {
  return {
    tipoPedido: "flex",
    mlShipmentId: "44881234567",
    estadoMl: "ready_to_ship",
    estado: "pendiente_asignacion",
    ...p,
  };
}

describe("etiqueta de Flex", () => {
  it("en `ready_to_ship` y `ready_to_print` sí", () => {
    expect(puedeImprimirEtiqueta(flex())).toBe(true);
    expect(puedeImprimirEtiqueta(flex({ estadoMl: "ready_to_print" }))).toBe(true);
  });

  it("🔴 en `shipped` NO, y dice que ya salió", () => {
    // Era el caso que rompía: el botón se mostraba, ML respondía error y la
    // pantalla lo traducía a «no pudimos generar la etiqueta» — un fallo que no
    // era un fallo, sino el estado normal de un pedido en ruta.
    const r = disponibilidadEtiqueta(flex({ estadoMl: "shipped", estado: "en_ruta" }));
    expect(r.disponible).toBe(false);
    expect(r.disponible === false && r.motivo).toBe("ya_salio");
    expect(r.disponible === false && r.frase).toContain("ya salió");
  });

  it("distingue «ya salió» de «todavía no está lista»", () => {
    // La salida es distinta: en uno no hay nada que hacer, en el otro hay que
    // esperar. Decir solo «no disponible» deja sin saber cuál de las dos es.
    const r = disponibilidadEtiqueta(flex({ estadoMl: "handling" }));
    expect(r.disponible === false && r.motivo).toBe("todavia_no_esta_lista");
    expect(r.disponible === false && r.frase).toContain("Vuelve a intentar");
  });

  it("🔴 un estado de ML desconocido cae en NO disponible", () => {
    // Lista blanca, no lista negra. Si ML agrega un estado mañana, ofrecer el
    // botón y fallar es peor que no ofrecerlo: el segundo caso se entiende.
    expect(puedeImprimirEtiqueta(flex({ estadoMl: "algo_nuevo_de_ml" }))).toBe(false);
    expect(puedeImprimirEtiqueta(flex({ estadoMl: null }))).toBe(false);
  });

  it("sin `ml_shipment_id` no hay qué imprimir", () => {
    const r = disponibilidadEtiqueta(flex({ mlShipmentId: null }));
    expect(r.disponible === false && r.motivo).toBe("sin_envio_ml");
  });

  it("en estado terminal nunca, aunque ML la sirviera", () => {
    for (const estado of ["entregado", "cancelado", "devuelto", "no_procesado"]) {
      expect(puedeImprimirEtiqueta(flex({ estado, estadoMl: "ready_to_ship" }))).toBe(false);
    }
  });
});

describe("etiqueta de same-day", () => {
  const sameDay = (p: Partial<PedidoParaEtiqueta> = {}): PedidoParaEtiqueta => ({
    tipoPedido: "same_day",
    mlShipmentId: null,
    estadoMl: null,
    estado: "en_ruta",
    ...p,
  });

  it("siempre se puede regenerar mientras el pedido siga vivo", () => {
    // La etiqueta la genera Rutax con su propio QR: no depende de nadie.
    expect(puedeImprimirEtiqueta(sameDay())).toBe(true);
    expect(puedeImprimirEtiqueta(sameDay({ estado: "asignado" }))).toBe(true);
  });

  it("pero no en estado terminal, y eso es por sentido, no por fallo", () => {
    expect(puedeImprimirEtiqueta(sameDay({ estado: "entregado" }))).toBe(false);
    expect(puedeImprimirEtiqueta(sameDay({ estado: "cancelado" }))).toBe(false);
  });
});
