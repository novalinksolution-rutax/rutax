import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * El ORDEN de los pasos del motor entrega→dinero.
 * =============================================================================
 *
 * 🔴 Nace de un fallo en producción (2026-08-27). `asignar-periodo-cobro` vivía
 * ANTES de la liquidación, y ese paso puede fallar de forma legítima: si el
 * período del seller está cerrado, se niega a archivar y lanza —a propósito,
 * para que Inngest reintente y un humano lo abra—.
 *
 * Pero los pasos de Inngest son SECUENCIALES: el fallo se llevó por delante
 * todo lo que venía después. `RX-8HCZ-0PPB` quedó con su línea de cobro y **sin
 * línea de liquidación**, mientras las cinco entregas anteriores tenían las dos.
 * El conductor hizo el viaje igual; que el seller tenga el mes cerrado no es
 * asunto suyo.
 *
 * Esta prueba lee el ORDEN literal del archivo. Es tosca a propósito: la
 * alternativa es ejecutar el job entero con Inngest simulado, y lo que hay que
 * proteger no es una rama de lógica sino una decisión de secuencia — que se
 * pierde con un corta-y-pega inocente.
 */
const FUENTE = readFileSync(
  join(process.cwd(), "src/modules/dinero/jobs/generar-lineas.ts"),
  "utf8",
);

/** Los pasos en el orden en que el archivo los declara. */
const pasos = [...FUENTE.matchAll(/step\.run\('([^']+)'/g)].map((m) => m[1]);

describe("orden de los pasos de generarLineas", () => {
  it("archivar el cobro en su período va DESPUÉS de pagarle al conductor", () => {
    const periodo = pasos.indexOf("asignar-periodo-cobro");
    const liquidacion = pasos.indexOf("generar-linea-liquidacion");

    expect(periodo).toBeGreaterThan(-1);
    expect(liquidacion).toBeGreaterThan(-1);
    expect(periodo).toBeGreaterThan(liquidacion);
  });

  it("y también después de los flags y de la bitácora", () => {
    // Los flags alimentan a la conciliación: si no se escriben, el detector
    // levanta excepciones por hechos que sí ocurrieron.
    const periodo = pasos.indexOf("asignar-periodo-cobro");
    expect(periodo).toBeGreaterThan(pasos.indexOf("actualizar-flags-pedido"));
    expect(periodo).toBeGreaterThan(pasos.indexOf("registrar-bitacora"));
  });

  it("es el ÚLTIMO paso: nada puede quedar detrás de un archivo que falla", () => {
    expect(pasos[pasos.length - 1]).toBe("asignar-periodo-cobro");
  });

  it("la línea de cobro se genera antes que la de liquidación", () => {
    expect(pasos.indexOf("generar-linea-cobro")).toBeLessThan(
      pasos.indexOf("generar-linea-liquidacion"),
    );
  });
});
