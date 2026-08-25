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

  it("🔴 en `handling` SÍ — verificado contra producción", () => {
    // El bug que costó el 62% del despacho del 25-ago: 5 de los 8 pedidos Flex
    // pendientes estaban en `handling`, la lista blanca los dejaba fuera, y al
    // pedirle la etiqueta a ML por la ruta directa ML LA ENTREGÓ. Si esto se
    // pone en rojo porque alguien volvió a excluir `handling`, es ese bug otra
    // vez.
    expect(puedeImprimirEtiqueta(flex({ estadoMl: "handling" }))).toBe(true);
  });

  it("🔴 un estado de ML desconocido se OFRECE, no se esconde", () => {
    // Al revés de como estaba. Los dos errores no cuestan lo mismo: esconder un
    // botón que funciona bloquea el despacho sin salida; ofrecer uno que falla
    // cuesta un clic y un mensaje que el botón ya muestra en línea.
    expect(puedeImprimirEtiqueta(flex({ estadoMl: "algo_nuevo_de_ml" }))).toBe(true);
    expect(puedeImprimirEtiqueta(flex({ estadoMl: null }))).toBe(true);
    expect(puedeImprimirEtiqueta(flex({ estadoMl: "pending" }))).toBe(true);
  });

  it("los cuatro estados en que ML deja de darla", () => {
    for (const estadoMl of ["shipped", "delivered", "not_delivered", "cancelled"]) {
      const r = disponibilidadEtiqueta(flex({ estadoMl }));
      expect(r.disponible).toBe(false);
      expect(r.disponible === false && r.motivo).toBe("ya_salio");
    }
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
