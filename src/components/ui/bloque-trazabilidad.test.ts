/**
 * Red mecánica del vocabulario de actos.
 *
 * Una etiqueta para una acción que el dominio nunca emite es código muerto que
 * se ve perfectamente bien: nadie la ve fallar porque nunca se ejecuta. La
 * primera versión de `ACTO` tenía **seis** llaves inventadas —
 * `dinero.pago_emitido`, `dinero.liquidacion_pagada`,
 * `dinero.nota_credito_solicitada`… — que se parecían a las reales lo
 * suficiente como para no notarse leyendo.
 *
 * Esto lee el módulo de acciones y compara contra lo que de verdad se escribe
 * en bitácora.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ACTO } from "./bloque-trazabilidad";

function accionesQueElDominioEmite(): Set<string> {
  const fuente = readFileSync(
    join(process.cwd(), "src/modules/dinero/acciones.ts"),
    "utf-8",
  );
  const encontradas = fuente.matchAll(/accion:\s*'([a-z_.]+)'/g);
  return new Set([...encontradas].map((m) => m[1]));
}

describe("vocabulario de actos de la trazabilidad", () => {
  it("toda etiqueta corresponde a una acción que el dominio emite", () => {
    const reales = accionesQueElDominioEmite();
    const inventadas = Object.keys(ACTO).filter((a) => !reales.has(a));
    expect(inventadas).toEqual([]);
  });

  it("el módulo de acciones sí emite acciones (la lectura no está vacía)", () => {
    // Contraprueba: sin esto, un cambio de formato en el módulo dejaría el
    // conjunto vacío y la prueba de arriba pasaría en verde sin probar nada.
    const reales = accionesQueElDominioEmite();
    expect(reales.size).toBeGreaterThan(10);
    expect(reales.has("dinero.periodo_reabierto")).toBe(true);
  });

  it("las acciones de dinero con motivo obligatorio tienen etiqueta", () => {
    // Son las que van a aparecer en una tarjeta de trazabilidad: si una no
    // tiene nombre, la pantalla muestra el identificador crudo.
    for (const accion of [
      "dinero.periodo_reabierto",
      "dinero.liquidacion_ajustada",
      "dinero.linea_cobro_anulada_manual",
      "dinero.linea_liquidacion_anulada_manual",
    ]) {
      expect(ACTO[accion], `falta la etiqueta de ${accion}`).toBeTruthy();
    }
  });
});
