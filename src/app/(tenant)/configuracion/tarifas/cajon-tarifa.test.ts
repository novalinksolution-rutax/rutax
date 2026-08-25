import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  clasificarTarifa,
  contarPorCajon,
  pagasMasDeLoQueCobras,
  type TarifaClasificable,
} from "./cajon-tarifa";

/**
 * La clasificación de tarifas.
 *
 * No se prueba el estilo: se prueba que **la pantalla no mienta sobre qué
 * tarifa está cobrando hoy**. La mitad de esto la ejecuta el motor
 * entrega→dinero, y si las dos se separan el courier ve una cifra plausible que
 * no es la que se le está aplicando a sus entregas.
 */

const HOY = "2026-08-24";

function tarifa(p: Partial<TarifaClasificable> = {}): TarifaClasificable {
  return {
    estado: "activa",
    vigenteDesdeFecha: "2026-08-01",
    vigenteHasta: null,
    ...p,
  };
}

describe("clasificarTarifa", () => {
  it("activa, empezada y sin término: vigente", () => {
    expect(clasificarTarifa(tarifa(), HOY)).toBe("vigente");
  });

  it("el día exacto en que empieza YA es vigente", () => {
    // El motor usa `lte`, no `lt`: una tarifa que arranca hoy cobra hoy.
    expect(clasificarTarifa(tarifa({ vigenteDesdeFecha: HOY }), HOY)).toBe("vigente");
  });

  it("el día exacto en que termina TODAVÍA es vigente", () => {
    // El motor usa `gte`: el último día de la ventana sigue adentro.
    expect(clasificarTarifa(tarifa({ vigenteHasta: HOY }), HOY)).toBe("vigente");
  });

  it("empieza mañana: programada", () => {
    expect(clasificarTarifa(tarifa({ vigenteDesdeFecha: "2026-09-01" }), HOY)).toBe("programada");
  });

  it("terminó ayer: vencida, y NO vigente", () => {
    // El caso que el tablero no dibuja. Ponerla en «Vigentes» afirmaría que
    // gobierna cuando el motor la descarta.
    expect(clasificarTarifa(tarifa({ vigenteHasta: "2026-08-23" }), HOY)).toBe("vencida");
  });

  it("🔴 `estado` manda sobre la ventana", () => {
    // Una tarifa inactivada no vuelve a cobrar aunque su ventana la incluya.
    expect(clasificarTarifa(tarifa({ estado: "inactiva" }), HOY)).toBe("inactiva");
    // Ni siquiera si además está programada o vencida: sigue siendo inactiva,
    // porque su salida es «Reactivar» y no «editar la fecha».
    expect(
      clasificarTarifa({ estado: "inactiva", vigenteDesdeFecha: "2026-09-01", vigenteHasta: null }, HOY),
    ).toBe("inactiva");
    expect(
      clasificarTarifa({ estado: "inactiva", vigenteDesdeFecha: "2026-01-01", vigenteHasta: "2026-02-01" }, HOY),
    ).toBe("inactiva");
  });

  it("una programada con término futuro sigue siendo programada", () => {
    // El orden importa: primero «todavía no empieza», después «ya terminó».
    expect(
      clasificarTarifa({ estado: "activa", vigenteDesdeFecha: "2026-09-01", vigenteHasta: "2026-12-31" }, HOY),
    ).toBe("programada");
  });
});

describe("🔴 el predicado no puede separarse del motor", () => {
  it("`resolverTarifaVigente` sigue usando estado=activa + lte(desde) + (hasta null o gte)", () => {
    // Esta prueba es un candado, no una comprobación de comportamiento. Si
    // alguien cambia el predicado del motor —por ejemplo, para que una tarifa
    // vencida siga cobrando— esta prueba falla y obliga a mirar ESTE archivo,
    // que es la mitad que se le muestra al courier.
    const fuente = readFileSync("src/modules/operacion/tarifas.ts", "utf8");
    expect(fuente).toContain('.eq("estado", "activa")');
    expect(fuente).toContain('.lte("vigente_desde", entrada.fecha)');
    expect(fuente).toContain("vigente_hasta.is.null,vigente_hasta.gte.");
  });
});

describe("contarPorCajon", () => {
  it("devuelve los cuatro cajones aunque estén en cero", () => {
    // Un cajón que desaparece al vaciarse obliga a recordar que existía.
    expect(contarPorCajon([], HOY)).toEqual({
      vigente: 0,
      programada: 0,
      vencida: 0,
      inactiva: 0,
    });
  });

  it("la suma de los cuatro es el total: ninguna tarifa se pierde", () => {
    const lista = [
      tarifa(),
      tarifa(),
      tarifa({ vigenteDesdeFecha: "2026-09-01" }),
      tarifa({ vigenteHasta: "2026-01-01" }),
      tarifa({ estado: "inactiva" }),
    ];
    const c = contarPorCajon(lista, HOY);
    expect(c).toEqual({ vigente: 2, programada: 1, vencida: 1, inactiva: 1 });
    expect(c.vigente + c.programada + c.vencida + c.inactiva).toBe(lista.length);
  });
});

describe("pagasMasDeLoQueCobras", () => {
  it("avisa cuando la resta va en contra", () => {
    expect(pagasMasDeLoQueCobras(2900, 3400)).toBe(true);
  });

  it("no avisa cuando son iguales", () => {
    // Margen cero es raro pero no es un error de tecla: puede ser un tramo que
    // se pasa a costo. El aviso es para la resta negativa.
    expect(pagasMasDeLoQueCobras(2900, 2900)).toBe(false);
  });

  it("no avisa con lo normal", () => {
    expect(pagasMasDeLoQueCobras(2900, 1450)).toBe(false);
  });

  it("con un campo a medio escribir se calla", () => {
    // El aviso corre mientras se teclea: `Number("")` es 0 y `Number("2.9")`
    // puede ser NaN según cómo lo parsee el llamador. Un aviso que parpadea
    // mientras escribes deja de leerse.
    expect(pagasMasDeLoQueCobras(NaN, 1450)).toBe(false);
    expect(pagasMasDeLoQueCobras(2900, NaN)).toBe(false);
  });
});
