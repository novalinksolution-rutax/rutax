import { describe, it, expect } from "vitest";
import {
  ESTADOS_PEDIDO,
  ESTADOS_INCIDENCIA,
  TIPOS_INCIDENCIA,
} from "@/modules/operacion/tipos";
import {
  estadoPedidoParaSeller,
  estadoIncidenciaParaSeller,
  tipoIncidenciaParaSeller,
  textoLlegada,
  GRUPOS_PEDIDO_PORTAL,
  grupoDePedido,
  normalizarGrupoPortal,
} from "./vocabulario-portal";

describe("estadoPedidoParaSeller", () => {
  it("traduce los nueve estados, sin devolver el identificador crudo", () => {
    for (const e of ESTADOS_PEDIDO) {
      const t = estadoPedidoParaSeller(e);
      expect(t, e).not.toBe(e);
      expect(t.length, e).toBeGreaterThan(3);
    }
  });

  it("funde los pares manual/automático: para el seller es el mismo hecho", () => {
    // «entregado» y «entregado_manual» se distinguen por quién los escribió.
    // Exponer esa diferencia al seller no le sirve a nadie de afuera.
    expect(estadoPedidoParaSeller("entregado")).toBe(estadoPedidoParaSeller("entregado_manual"));
    expect(estadoPedidoParaSeller("fallido")).toBe(estadoPedidoParaSeller("fallido_manual"));
    expect(estadoPedidoParaSeller("pendiente_asignacion")).toBe(estadoPedidoParaSeller("asignado"));
  });

  it("«fallido» se dice como lo que pasó, no como un rótulo de sistema", () => {
    expect(estadoPedidoParaSeller("fallido")).toBe("Nadie recibió");
  });
});

describe("estadoIncidenciaParaSeller", () => {
  it("cubre los cuatro estados", () => {
    for (const e of ESTADOS_INCIDENCIA) {
      expect(estadoIncidenciaParaSeller(e, "Andes Express").length, e).toBeGreaterThan(5);
    }
  });

  it("dice de quién es la pelota, con el nombre del courier", () => {
    // «En gestión» suena a que el trámite avanza solo. La pregunta del seller es
    // quién la tiene ahora.
    expect(estadoIncidenciaParaSeller("en_gestion", "Andes Express")).toBe(
      "Andes Express la está viendo",
    );
  });
});

describe("tipoIncidenciaParaSeller", () => {
  it("cubre los SIETE tipos del sistema, sin inventar ni omitir ninguno", () => {
    // Decisión del usuario: los mismos siete. Si el courier y el seller
    // clasificaran distinto, la misma incidencia se contaría de dos formas.
    expect(TIPOS_INCIDENCIA.length).toBe(7);
    for (const t of TIPOS_INCIDENCIA) {
      expect(tipoIncidenciaParaSeller(t), t).not.toBe(t);
    }
  });
});

describe("textoLlegada", () => {
  const HOY = "2026-08-24";

  it("dice «Hoy» cuando llega hoy y todavía no llegó", () => {
    expect(textoLlegada("2026-08-24", HOY, "en_ruta")).toBe("Hoy");
  });

  it("cambia a pasado cuando ya se entregó", () => {
    expect(textoLlegada("2026-08-24", HOY, "entregado")).toBe("Llegó hoy");
    expect(textoLlegada("2026-08-20", HOY, "entregado")).toBe("Llegó el 20 ago");
  });

  it("una fecha pasada sin entregar dice que se pasó", () => {
    // «Era el 20 ago» es lo que hay que leer: el compromiso venció.
    expect(textoLlegada("2026-08-20", HOY, "en_ruta")).toBe("Era el 20 ago");
  });

  it("el estado manda sobre la fecha en los terminales", () => {
    expect(textoLlegada("2026-08-24", HOY, "cancelado")).toBe("Cancelado");
    expect(textoLlegada("2026-08-24", HOY, "devuelto")).toBe("Volvió a tu bodega");
    expect(textoLlegada("2026-08-24", HOY, "fallido")).toBe("Se reagenda");
  });

  it("sin fecha comprometida lo dice, no inventa una", () => {
    expect(textoLlegada(null, HOY, "en_ruta")).toBe("Sin fecha comprometida");
  });

  it("compara fechas civiles como cadenas, sin correrlas un día", () => {
    // Pasar por `Date` interpretaría '2026-08-25' como medianoche UTC, que en
    // Santiago es el 24 por la tarde — y un pedido de mañana se leería como hoy.
    expect(textoLlegada("2026-08-25", HOY, "en_ruta")).toBe("25 ago");
  });

  it("tolera un timestamp completo quedándose con el día", () => {
    expect(textoLlegada("2026-08-24T03:00:00.000Z", HOY, "en_ruta")).toBe("Hoy");
  });
});

describe("los cuatro cajones del portal", () => {
  it("cada estado del motor cae en exactamente un grupo", () => {
    // Si un estado nuevo del motor no entrara en ninguno, desaparecería de la
    // lista del seller sin que nada fallara. Y si entrara en dos, se contaría
    // dos veces y la barra no cuadraría con la tabla.
    for (const e of ESTADOS_PEDIDO) {
      const grupos = Object.entries(GRUPOS_PEDIDO_PORTAL).filter(([, xs]) =>
        (xs as readonly string[]).includes(e),
      );
      expect(grupos.length, e).toBe(1);
    }
  });

  it("los tres grupos que suman cubren todo salvo cancelado", () => {
    const suman = [
      ...GRUPOS_PEDIDO_PORTAL.en_camino,
      ...GRUPOS_PEDIDO_PORTAL.entregado,
      ...GRUPOS_PEDIDO_PORTAL.problema,
    ];
    expect(new Set(suman)).toEqual(new Set(ESTADOS_PEDIDO.filter((e) => e !== "cancelado")));
  });

  it("grupoDePedido dice el grupo de cada estado", () => {
    expect(grupoDePedido("asignado")).toBe("en_camino");
    expect(grupoDePedido("entregado_manual")).toBe("entregado");
    expect(grupoDePedido("devuelto")).toBe("problema");
  });

  it("un enlace viejo con un estado crudo sigue llevando a su cajón", () => {
    // El inicio del portal enlazaba `?estado=en_ruta` y `?estado=fallido`.
    expect(normalizarGrupoPortal("en_ruta")).toBe("en_camino");
    expect(normalizarGrupoPortal("fallido")).toBe("problema");
    expect(normalizarGrupoPortal("problema")).toBe("problema");
    expect(normalizarGrupoPortal("cualquier_cosa")).toBeNull();
    expect(normalizarGrupoPortal(undefined)).toBeNull();
  });
});
