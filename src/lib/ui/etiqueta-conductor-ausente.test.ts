import { describe, expect, it } from "vitest";
import { etiquetaConductorAusente } from "./etiqueta-conductor-ausente";
import { ESTADOS_PEDIDO, ESTADOS_TERMINALES } from "@/modules/operacion/tipos";

describe("etiquetaConductorAusente", () => {
  it("BUG REAL (2026-08-15): un Flex ENTREGADO sin conductor decía 'Sin asignar'", () => {
    // El paquete llegó. La columna afirmaba que faltaba asignarlo, en ámbar,
    // sobre un pedido que nadie iba a tocar nunca más.
    const r = etiquetaConductorAusente("entregado");

    expect(r.texto).toBe("Fuera de Rutax");
    expect(r.tono).toBe("neutro");
    expect(r.detalle).not.toBeNull();
  });

  it("'entregado_manual' se lee igual que 'entregado' — la entrega ocurrió igual", () => {
    expect(etiquetaConductorAusente("entregado_manual").texto).toBe("Fuera de Rutax");
  });

  it.each(["cancelado", "devuelto"] as const)(
    "%s sin conductor NO dice 'Fuera de Rutax': afirmaría una entrega que no ocurrió",
    (estado) => {
      const r = etiquetaConductorAusente(estado);
      expect(r.texto).toBe("—");
      expect(r.tono).toBe("neutro");
    },
  );

  it.each(["pendiente_asignacion", "asignado", "en_ruta"] as const)(
    "%s conserva 'Sin asignar' en ámbar: todavía hay acción",
    (estado) => {
      const r = etiquetaConductorAusente(estado);
      expect(r.texto).toBe("Sin asignar");
      expect(r.tono).toBe("pendiente");
    },
  );

  it.each(["fallido", "fallido_manual"] as const)(
    "%s sigue en ámbar — NO es terminal, se puede reintentar",
    (estado) => {
      // Se prueba explícitamente porque `fallido` está en la lista de terminales
      // de `metricas.ts` (ESTADOS_TERMINALES_PEDIDO) pero NO en la de `tipos.ts`
      // (ESTADOS_TERMINALES). Importar la equivocada apagaría el aviso sobre
      // pedidos que todavía hay que reasignar.
      const r = etiquetaConductorAusente(estado);
      expect(r.texto).toBe("Sin asignar");
      expect(r.tono).toBe("pendiente");
    },
  );

  it("cubre TODOS los estados del enum, sin excepción ni valor vacío", () => {
    // Red contra un estado nuevo: si mañana se agrega uno al enum, este caso lo
    // obliga a pasar por acá en vez de caer en una rama por descarte.
    for (const estado of ESTADOS_PEDIDO) {
      const r = etiquetaConductorAusente(estado);
      expect(r.texto.length, `estado ${estado}`).toBeGreaterThan(0);
      expect(["pendiente", "neutro"]).toContain(r.tono);
    }
  });

  it("ningún estado terminal queda en ámbar — es la regla que motivó todo esto", () => {
    for (const estado of ESTADOS_TERMINALES) {
      expect(etiquetaConductorAusente(estado).tono, `estado ${estado}`).toBe("neutro");
    }
  });
});
