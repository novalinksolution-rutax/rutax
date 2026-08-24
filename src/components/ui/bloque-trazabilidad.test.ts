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

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ACTO } from "./bloque-trazabilidad";

/**
 * Se barre `src/` entero y no un archivo.
 *
 * La primera versión leía solo `modules/dinero/acciones.ts`, porque las únicas
 * etiquetas eran de dinero. Al aparecer las de manifiesto —que se escriben desde
 * las Server Actions de la pantalla— ese barrido las declaraba inventadas, y la
 * salida fácil habría sido agregar el archivo a mano: la lista se queda atrás en
 * cuanto alguien registre en bitácora desde un sitio nuevo, y la prueba empieza
 * a rechazar etiquetas correctas.
 *
 * También acepta comillas dobles: el repo usa las dos.
 */
function accionesQueElDominioEmite(): Set<string> {
  const encontradas = new Set<string>();

  function recorrer(directorio: string) {
    for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
      const ruta = join(directorio, entrada.name);
      if (entrada.isDirectory()) {
        recorrer(ruta);
        continue;
      }
      if (!/\.tsx?$/.test(entrada.name) || /\.test\.tsx?$/.test(entrada.name)) continue;
      for (const m of readFileSync(ruta, "utf-8").matchAll(/accion:\s*["']([a-z_.]+)["']/g)) {
        encontradas.add(m[1]);
      }
    }
  }

  recorrer(join(process.cwd(), "src"));
  return encontradas;
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
    expect(reales.has("manifiesto.cancelado")).toBe(true);
  });

  it("las acciones de dinero con motivo obligatorio tienen etiqueta", () => {
    // Son las que van a aparecer en una tarjeta de trazabilidad: si una no
    // tiene nombre, la pantalla muestra el identificador crudo.
    for (const accion of [
      "dinero.periodo_reabierto",
      "dinero.liquidacion_ajustada",
      "dinero.linea_cobro_anulada_manual",
      "dinero.linea_liquidacion_anulada_manual",
      // Las de manifiesto son las que ve el coordinador en la bitácora de la
      // ruta, al lado de las acciones que las escriben.
      "manifiesto.cancelado",
      "manifiesto.parada_quitada",
      "operacion.conductor_caido",
      "operacion.redistribucion_completada",
    ]) {
      expect(ACTO[accion], `falta la etiqueta de ${accion}`).toBeTruthy();
    }
  });
});
