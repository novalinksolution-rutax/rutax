/**
 * `ESTADOS_DE_CARGA` — invariante puntual (encargo QA, "busca lo que nadie
 * miró"): la Torre cuenta "cuántos paquetes faltan por entregar", y sumar
 * cancelados/devueltos al denominador de "38 de 120" inflaría el total con
 * paquetes que nadie está esperando (docs/arquitectura/edicion-y-cancelacion-
 * de-pedidos.md §5 fila 3). Este archivo (`consultas.ts`) no tenía ninguna
 * prueba — es 100% I/O contra Supabase — pero esta constante SÍ es pura y
 * merece quedar fijada con una prueba, no solo con un comentario.
 */

import { describe, expect, it } from "vitest";
import { ESTADOS_DE_CARGA } from "./consultas";

describe("ESTADOS_DE_CARGA — la Torre no cuenta pedidos cancelados ni devueltos", () => {
  it("NO incluye 'cancelado'", () => {
    expect(ESTADOS_DE_CARGA).not.toContain("cancelado");
  });

  it("NO incluye 'devuelto'", () => {
    expect(ESTADOS_DE_CARGA).not.toContain("devuelto");
  });

  it("SÍ incluye los estados de carga real (control positivo — no es una lista vacía por accidente)", () => {
    expect(ESTADOS_DE_CARGA).toEqual(
      expect.arrayContaining([
        "pendiente_asignacion",
        "asignado",
        "en_ruta",
        "entregado",
        "entregado_manual",
        "fallido",
        "fallido_manual",
      ]),
    );
    expect(ESTADOS_DE_CARGA).toHaveLength(7);
  });
});
