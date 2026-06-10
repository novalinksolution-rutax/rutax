/**
 * Pruebas de orden básico de paradas (D-04, RF-025).
 *
 * Cubre:
 * 1. Ordena por comuna alfabéticamente.
 * 2. Dentro de la misma comuna, ordena por dirección alfabéticamente.
 * 3. Comunas iguales con tildes/mayúsculas se comparan correctamente (es, base).
 * 4. Arreglo vacío retorna arreglo vacío.
 * 5. No muta el arreglo original.
 */

import { describe, expect, it } from "vitest";
import { ordenarParadasPorComunaYDireccion } from "./orden-paradas";

interface ParadaDePrueba {
  id: string;
  destinatarioComuna: string;
  destinatarioDireccion: string;
}

describe("ordenarParadasPorComunaYDireccion", () => {
  it("ordena por comuna alfabéticamente", () => {
    const pedidos: ParadaDePrueba[] = [
      { id: "1", destinatarioComuna: "Providencia", destinatarioDireccion: "Calle A 100" },
      { id: "2", destinatarioComuna: "Maipú", destinatarioDireccion: "Calle B 200" },
      { id: "3", destinatarioComuna: "Las Condes", destinatarioDireccion: "Calle C 300" },
    ];

    const resultado = ordenarParadasPorComunaYDireccion(pedidos);

    expect(resultado.map((p) => p.id)).toEqual(["3", "2", "1"]);
  });

  it("dentro de la misma comuna ordena por dirección alfabéticamente", () => {
    const pedidos: ParadaDePrueba[] = [
      { id: "1", destinatarioComuna: "Ñuñoa", destinatarioDireccion: "Zenteno 50" },
      { id: "2", destinatarioComuna: "Ñuñoa", destinatarioDireccion: "Avenida Irarrázaval 100" },
      { id: "3", destinatarioComuna: "Ñuñoa", destinatarioDireccion: "Manuel Montt 20" },
    ];

    const resultado = ordenarParadasPorComunaYDireccion(pedidos);

    expect(resultado.map((p) => p.id)).toEqual(["2", "3", "1"]);
  });

  it("compara comunas sin distinguir mayúsculas ni tildes (es, base)", () => {
    const pedidos: ParadaDePrueba[] = [
      { id: "1", destinatarioComuna: "ñuñoa", destinatarioDireccion: "Calle B 2" },
      { id: "2", destinatarioComuna: "Maipu", destinatarioDireccion: "Calle A 1" },
      { id: "3", destinatarioComuna: "Maipú", destinatarioDireccion: "Calle B 2" },
    ];

    const resultado = ordenarParadasPorComunaYDireccion(pedidos);

    // "Maipu" y "Maipú" se tratan como iguales (sensitivity: base) y se
    // ordenan entre sí por dirección; "Ñuñoa" va después.
    expect(resultado.map((p) => p.id)).toEqual(["2", "3", "1"]);
  });

  it("retorna un arreglo vacío si recibe un arreglo vacío", () => {
    expect(ordenarParadasPorComunaYDireccion([])).toEqual([]);
  });

  it("no muta el arreglo original", () => {
    const pedidos: ParadaDePrueba[] = [
      { id: "1", destinatarioComuna: "Providencia", destinatarioDireccion: "Calle A 100" },
      { id: "2", destinatarioComuna: "Maipú", destinatarioDireccion: "Calle B 200" },
    ];
    const copia = [...pedidos];

    ordenarParadasPorComunaYDireccion(pedidos);

    expect(pedidos).toEqual(copia);
  });
});
