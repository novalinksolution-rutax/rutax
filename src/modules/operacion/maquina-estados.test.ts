/**
 * Pruebas de la máquina de estados del pedido.
 *
 * Función pura — no requiere mocks ni acceso a BD.
 * Cubre TODAS las transiciones de §3 del documento de arquitectura Fase B,
 * tanto las válidas como las inválidas.
 */

import { describe, expect, it } from "vitest";
import { validarTransicion, esTransicionValida } from "./maquina-estados";
import { ErrorTransicionInvalida } from "./errores";
import type { EstadoPedido, EjecutorTransicion } from "./tipos";
import { ESTADOS_TERMINALES } from "./tipos";

// =============================================================================
// Transiciones VÁLIDAS — todas las de §3 del doc de arquitectura
// =============================================================================

describe("validarTransicion — transiciones válidas", () => {
  // pendiente_asignacion → asignado (sistema)
  it("pendiente_asignacion → asignado por sistema", () => {
    expect(validarTransicion("pendiente_asignacion", "asignado", "sistema")).toBe(true);
  });

  // asignado → en_ruta (sistema)
  it("asignado → en_ruta por sistema", () => {
    expect(validarTransicion("asignado", "en_ruta", "sistema")).toBe(true);
  });

  // asignado → pendiente_asignacion (interno — reasignación)
  it("asignado → pendiente_asignacion por interno (reasignación)", () => {
    expect(validarTransicion("asignado", "pendiente_asignacion", "interno")).toBe(true);
  });

  // asignado → cancelado (sistema)
  it("asignado → cancelado por sistema", () => {
    expect(validarTransicion("asignado", "cancelado", "sistema")).toBe(true);
  });

  // asignado → entregado_manual (interno)
  it("asignado → entregado_manual por interno (corrección manual RF-029)", () => {
    expect(validarTransicion("asignado", "entregado_manual", "interno")).toBe(true);
  });

  // asignado → fallido_manual (interno)
  it("asignado → fallido_manual por interno (corrección manual)", () => {
    expect(validarTransicion("asignado", "fallido_manual", "interno")).toBe(true);
  });

  // en_ruta → entregado (sistema)
  it("en_ruta → entregado por sistema (ML reporta delivered)", () => {
    expect(validarTransicion("en_ruta", "entregado", "sistema")).toBe(true);
  });

  // en_ruta → fallido (sistema)
  it("en_ruta → fallido por sistema (ML reporta not_delivered)", () => {
    expect(validarTransicion("en_ruta", "fallido", "sistema")).toBe(true);
  });

  // en_ruta → cancelado (sistema — cancelación tardía)
  it("en_ruta → cancelado por sistema (cancelación tardía)", () => {
    expect(validarTransicion("en_ruta", "cancelado", "sistema")).toBe(true);
  });

  // en_ruta → entregado_manual (interno)
  it("en_ruta → entregado_manual por interno (corrección manual)", () => {
    expect(validarTransicion("en_ruta", "entregado_manual", "interno")).toBe(true);
  });

  // en_ruta → fallido_manual (interno)
  it("en_ruta → fallido_manual por interno (corrección manual)", () => {
    expect(validarTransicion("en_ruta", "fallido_manual", "interno")).toBe(true);
  });

  // en_ruta → devuelto (sistema)
  it("en_ruta → devuelto por sistema (ML reporta devolución)", () => {
    expect(validarTransicion("en_ruta", "devuelto", "sistema")).toBe(true);
  });

  // fallido → asignado (interno — reintento)
  it("fallido → asignado por interno (reintento)", () => {
    expect(validarTransicion("fallido", "asignado", "interno")).toBe(true);
  });

  // fallido → cancelado (interno)
  it("fallido → cancelado por interno (sin reintento posible)", () => {
    expect(validarTransicion("fallido", "cancelado", "interno")).toBe(true);
  });

  // fallido_manual → asignado (interno)
  it("fallido_manual → asignado por interno (igual que fallido)", () => {
    expect(validarTransicion("fallido_manual", "asignado", "interno")).toBe(true);
  });

  // fallido → devuelto (sistema — ML evoluciona subestado receiver_absent→returning_to_sender)
  it("fallido → devuelto por sistema (ML reporta returning_to_sender)", () => {
    expect(validarTransicion("fallido", "devuelto", "sistema")).toBe(true);
  });

  // fallido → devuelto (interno — usuario registra la devolución manual)
  it("fallido → devuelto por interno (usuario registra devolución)", () => {
    expect(validarTransicion("fallido", "devuelto", "interno")).toBe(true);
  });

  // fallido_manual → devuelto (sistema)
  it("fallido_manual → devuelto por sistema (devolución desde fallo manual)", () => {
    expect(validarTransicion("fallido_manual", "devuelto", "sistema")).toBe(true);
  });

  // fallido_manual → devuelto (interno)
  it("fallido_manual → devuelto por interno (devolución desde fallo manual)", () => {
    expect(validarTransicion("fallido_manual", "devuelto", "interno")).toBe(true);
  });
});

// =============================================================================
// Estados terminales — ninguna transición válida desde ellos
// =============================================================================

describe("validarTransicion — estados terminales no admiten transiciones", () => {
  const estadosNoTerminales: EstadoPedido[] = [
    "pendiente_asignacion",
    "asignado",
    "en_ruta",
    "fallido",
    "fallido_manual",
  ];

  for (const terminal of ESTADOS_TERMINALES) {
    for (const ejecutor of ["sistema", "interno"] as EjecutorTransicion[]) {
      for (const destino of estadosNoTerminales) {
        it(`${terminal} → ${destino} por ${ejecutor} lanza ErrorTransicionInvalida`, () => {
          expect(() => validarTransicion(terminal, destino, ejecutor)).toThrow(ErrorTransicionInvalida);
        });
      }
    }
  }

  // Verificación específica del mensaje de terminal.
  it("el error de terminal menciona que el estado es terminal", () => {
    try {
      validarTransicion("entregado", "en_ruta", "sistema");
      expect.fail("debería haber lanzado");
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorTransicionInvalida);
      const err = e as ErrorTransicionInvalida;
      expect(err.message).toContain("terminal");
      expect(err.estadoActual).toBe("entregado");
      expect(err.estadoNuevo).toBe("en_ruta");
    }
  });
});

// =============================================================================
// Transiciones INVÁLIDAS — pares que no existen en la tabla de §3
// =============================================================================

describe("validarTransicion — transiciones inválidas lanza ErrorTransicionInvalida", () => {
  const casosInvalidos: Array<{
    origen: EstadoPedido;
    destino: EstadoPedido;
    ejecutor: EjecutorTransicion;
    desc: string;
  }> = [
    // pendiente_asignacion no puede ir a en_ruta directamente
    {
      origen: "pendiente_asignacion",
      destino: "en_ruta",
      ejecutor: "sistema",
      desc: "pendiente_asignacion → en_ruta (saltarse asignado)",
    },
    // pendiente_asignacion no puede ir a entregado
    {
      origen: "pendiente_asignacion",
      destino: "entregado",
      ejecutor: "sistema",
      desc: "pendiente_asignacion → entregado (sin pasar por asignado/en_ruta)",
    },
    // El sistema no puede hacer correcciones manuales
    {
      origen: "asignado",
      destino: "entregado_manual",
      ejecutor: "sistema",
      desc: "asignado → entregado_manual por sistema (solo interno puede)",
    },
    {
      origen: "asignado",
      destino: "fallido_manual",
      ejecutor: "sistema",
      desc: "asignado → fallido_manual por sistema (solo interno puede)",
    },
    {
      origen: "en_ruta",
      destino: "entregado_manual",
      ejecutor: "sistema",
      desc: "en_ruta → entregado_manual por sistema",
    },
    {
      origen: "en_ruta",
      destino: "fallido_manual",
      ejecutor: "sistema",
      desc: "en_ruta → fallido_manual por sistema",
    },
    // Un interno no puede hacer transiciones de ML
    {
      origen: "asignado",
      destino: "en_ruta",
      ejecutor: "interno",
      desc: "asignado → en_ruta por interno (es transición de sistema)",
    },
    {
      origen: "asignado",
      destino: "cancelado",
      ejecutor: "interno",
      desc: "asignado → cancelado por interno (solo sistema puede)",
    },
    {
      origen: "en_ruta",
      destino: "entregado",
      ejecutor: "interno",
      desc: "en_ruta → entregado por interno (solo sistema puede)",
    },
    {
      origen: "en_ruta",
      destino: "fallido",
      ejecutor: "interno",
      desc: "en_ruta → fallido por interno (solo sistema puede)",
    },
    {
      origen: "en_ruta",
      destino: "cancelado",
      ejecutor: "interno",
      desc: "en_ruta → cancelado por interno (solo sistema puede)",
    },
    {
      origen: "en_ruta",
      destino: "devuelto",
      ejecutor: "interno",
      desc: "en_ruta → devuelto por interno (solo sistema puede)",
    },
    // pendiente_asignacion no puede volver a sí misma
    {
      origen: "pendiente_asignacion",
      destino: "pendiente_asignacion",
      ejecutor: "sistema",
      desc: "pendiente_asignacion → pendiente_asignacion (estado igual)",
    },
    // fallido no puede ir a en_ruta (debe volver a asignado primero)
    {
      origen: "fallido",
      destino: "en_ruta",
      ejecutor: "interno",
      desc: "fallido → en_ruta (saltarse pendiente_asignacion/asignado)",
    },
    // fallido_manual no puede ir a cancelado
    {
      origen: "fallido_manual",
      destino: "cancelado",
      ejecutor: "interno",
      desc: "fallido_manual → cancelado (no está en la tabla de §3)",
    },
  ];

  for (const caso of casosInvalidos) {
    it(caso.desc, () => {
      expect(() => validarTransicion(caso.origen, caso.destino, caso.ejecutor)).toThrow(
        ErrorTransicionInvalida,
      );
    });
  }
});

// =============================================================================
// Nuevas transiciones fallido/fallido_manual → devuelto — casos específicos
// =============================================================================

describe("validarTransicion — fallido → devuelto (nuevo en §3)", () => {
  it("fallido → devuelto por sistema: válida", () => {
    expect(validarTransicion("fallido", "devuelto", "sistema")).toBe(true);
  });

  it("fallido → devuelto por interno: válida", () => {
    expect(validarTransicion("fallido", "devuelto", "interno")).toBe(true);
  });

  it("fallido_manual → devuelto por sistema: válida", () => {
    expect(validarTransicion("fallido_manual", "devuelto", "sistema")).toBe(true);
  });

  it("fallido_manual → devuelto por interno: válida", () => {
    expect(validarTransicion("fallido_manual", "devuelto", "interno")).toBe(true);
  });

  // devuelto sigue siendo un estado terminal — no admite transiciones de salida.
  it("devuelto → asignado por sistema: rechazada (terminal)", () => {
    expect(() => validarTransicion("devuelto", "asignado", "sistema")).toThrow(ErrorTransicionInvalida);
  });

  it("devuelto → fallido por sistema: rechazada (terminal)", () => {
    expect(() => validarTransicion("devuelto", "fallido", "sistema")).toThrow(ErrorTransicionInvalida);
  });

  it("devuelto → cancelado por interno: rechazada (terminal)", () => {
    expect(() => validarTransicion("devuelto", "cancelado", "interno")).toThrow(ErrorTransicionInvalida);
  });

  // esTransicionValida para los casos nuevos.
  it("esTransicionValida: fallido → devuelto por sistema = true", () => {
    expect(esTransicionValida("fallido", "devuelto", "sistema")).toBe(true);
  });

  it("esTransicionValida: devuelto → cualquier_cosa = false", () => {
    expect(esTransicionValida("devuelto", "asignado", "sistema")).toBe(false);
    expect(esTransicionValida("devuelto", "fallido", "interno")).toBe(false);
  });
});

// =============================================================================
// Propiedades del ErrorTransicionInvalida
// =============================================================================

describe("ErrorTransicionInvalida — propiedades del error", () => {
  it("contiene estadoActual y estadoNuevo", () => {
    try {
      validarTransicion("pendiente_asignacion", "entregado", "sistema");
      expect.fail("debería haber lanzado");
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorTransicionInvalida);
      const err = e as ErrorTransicionInvalida;
      expect(err.estadoActual).toBe("pendiente_asignacion");
      expect(err.estadoNuevo).toBe("entregado");
      expect(err.codigo).toBe("transicion_invalida");
    }
  });
});

// =============================================================================
// esTransicionValida — variante booleana (no lanza)
// =============================================================================

describe("esTransicionValida — variante booleana", () => {
  it("devuelve true para transición válida", () => {
    expect(esTransicionValida("asignado", "en_ruta", "sistema")).toBe(true);
  });

  it("devuelve false para transición inválida (no lanza)", () => {
    expect(esTransicionValida("entregado", "en_ruta", "sistema")).toBe(false);
  });

  it("devuelve false para estado terminal", () => {
    expect(esTransicionValida("cancelado", "asignado", "interno")).toBe(false);
  });
});

// =============================================================================
// Ejecutor 'conductor' — Bloque 2 same-day
// Nota: la función pura valida el par (origen, destino, ejecutor) pero NO
// la restricción tipo_pedido='same_day'; esa barrera la impone actualizarEstadoPedido.
// =============================================================================

describe("validarTransicion — ejecutor 'conductor' (Bloque 2 same-day)", () => {
  // Las 3 transiciones que el conductor puede ejecutar en same-day.
  it("asignado → en_ruta por conductor: válida", () => {
    expect(validarTransicion("asignado", "en_ruta", "conductor")).toBe(true);
  });

  it("en_ruta → entregado por conductor: válida", () => {
    expect(validarTransicion("en_ruta", "entregado", "conductor")).toBe(true);
  });

  it("en_ruta → fallido por conductor: válida", () => {
    expect(validarTransicion("en_ruta", "fallido", "conductor")).toBe(true);
  });

  // El conductor NO puede hacer correcciones manuales (eso es 'interno').
  it("asignado → entregado_manual por conductor: rechazada", () => {
    expect(() => validarTransicion("asignado", "entregado_manual", "conductor")).toThrow(
      ErrorTransicionInvalida,
    );
  });

  it("en_ruta → entregado_manual por conductor: rechazada", () => {
    expect(() => validarTransicion("en_ruta", "entregado_manual", "conductor")).toThrow(
      ErrorTransicionInvalida,
    );
  });

  it("en_ruta → cancelado por conductor: rechazada", () => {
    expect(() => validarTransicion("en_ruta", "cancelado", "conductor")).toThrow(
      ErrorTransicionInvalida,
    );
  });

  it("en_ruta → devuelto por conductor: rechazada", () => {
    expect(() => validarTransicion("en_ruta", "devuelto", "conductor")).toThrow(
      ErrorTransicionInvalida,
    );
  });

  it("pendiente_asignacion → asignado por conductor: rechazada", () => {
    expect(() => validarTransicion("pendiente_asignacion", "asignado", "conductor")).toThrow(
      ErrorTransicionInvalida,
    );
  });

  // Los estados terminales siguen siendo terminales para el conductor también.
  it("entregado → en_ruta por conductor: rechazada (terminal)", () => {
    expect(() => validarTransicion("entregado", "en_ruta", "conductor")).toThrow(
      ErrorTransicionInvalida,
    );
  });

  it("fallido → asignado por conductor: rechazada (no está en la tabla del conductor)", () => {
    expect(() => validarTransicion("fallido", "asignado", "conductor")).toThrow(
      ErrorTransicionInvalida,
    );
  });

  // esTransicionValida para 'conductor'
  it("esTransicionValida: asignado → en_ruta por conductor = true", () => {
    expect(esTransicionValida("asignado", "en_ruta", "conductor")).toBe(true);
  });

  it("esTransicionValida: en_ruta → entregado por conductor = true", () => {
    expect(esTransicionValida("en_ruta", "entregado", "conductor")).toBe(true);
  });

  it("esTransicionValida: en_ruta → fallido por conductor = true", () => {
    expect(esTransicionValida("en_ruta", "fallido", "conductor")).toBe(true);
  });

  it("esTransicionValida: en_ruta → cancelado por conductor = false", () => {
    expect(esTransicionValida("en_ruta", "cancelado", "conductor")).toBe(false);
  });
});
