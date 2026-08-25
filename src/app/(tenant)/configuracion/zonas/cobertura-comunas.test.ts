import { describe, expect, it } from "vitest";

import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import {
  contarCobertura,
  estadoDeComunas,
  textoCobertura,
  type AsignacionComuna,
} from "./cobertura-comunas";

const NOMBRES = new Map([
  ["z-norte", "Norte"],
  ["z-sur", "Sur"],
]);

/** Tres comunas reales del catálogo, para no inventar nombres. */
const [A, B, C] = COMUNAS_RM;

function estados(asignaciones: AsignacionComuna[], seleccionadas: string[] = []) {
  return estadoDeComunas(asignaciones, NOMBRES, "z-norte", seleccionadas);
}

describe("estadoDeComunas", () => {
  it("cubre las 52 comunas del catálogo, asignadas o no", () => {
    // El listado no se filtra: quien busca «Maipú» tiene que encontrarla aunque
    // sea de otra zona.
    expect(estados([])).toHaveLength(COMUNAS_RM.length);
  });

  it("una comuna de OTRA zona se marca como tal y trae el nombre de su dueña", () => {
    const e = estados([{ comuna: B, zonaId: "z-sur" }]);
    const fila = e.find((x) => x.comuna === B)!;
    expect(fila.esDeOtraZona).toBe(true);
    expect(fila.esDeEstaZona).toBe(false);
    expect(fila.nombreZonaDuena).toBe("Sur");
  });

  it("una comuna de una zona borrada no se cae: dice «otra zona»", () => {
    // El nombre puede no estar en el mapa —zona inactiva que no se cargó— y la
    // fila igual tiene que decir que está ocupada.
    const e = estadoDeComunas([{ comuna: B, zonaId: "z-fantasma" }], NOMBRES, "z-norte", []);
    const fila = e.find((x) => x.comuna === B)!;
    expect(fila.esDeOtraZona).toBe(true);
    expect(fila.nombreZonaDuena).toBe("otra zona");
  });

  it("🔴 lo marcado en esta sesión manda sobre lo guardado", () => {
    // Acabo de destildar una que en la base sigue siendo mía: se ve destildada.
    const e = estados([{ comuna: A, zonaId: "z-norte" }], []);
    expect(e.find((x) => x.comuna === A)!.esDeEstaZona).toBe(false);
    // Y al revés: marco una libre y ya cuenta como mía antes de guardar.
    const e2 = estados([], [C]);
    expect(e2.find((x) => x.comuna === C)!.esDeEstaZona).toBe(true);
  });

  it("una de otra zona NO se puede marcar, aunque venga en la selección", () => {
    // Defensa contra un estado inconsistente: si por lo que sea el id se coló
    // en `seleccionadas`, sigue siendo de la otra zona y no se dibuja como mía.
    const e = estados([{ comuna: B, zonaId: "z-sur" }], [B]);
    const fila = e.find((x) => x.comuna === B)!;
    expect(fila.esDeEstaZona).toBe(false);
    expect(fila.esDeOtraZona).toBe(true);
  });
});

describe("contarCobertura", () => {
  it("🔴 «sin zona» cuenta sobre TODAS las zonas, no sobre la que se edita", () => {
    // Una comuna que está en Sur no es huérfana. Contarla como tal desde la
    // pantalla de Norte diría «51 sin zona» con el mapa medio cubierto.
    const c = contarCobertura(estados([{ comuna: B, zonaId: "z-sur" }], [A]));
    expect(c.deEstaZona).toBe(1);
    expect(c.total).toBe(COMUNAS_RM.length);
    expect(c.sinZona).toBe(COMUNAS_RM.length - 2);
  });

  it("con todo el mapa cubierto, no queda ninguna huérfana", () => {
    const todas = COMUNAS_RM.map((comuna) => ({ comuna, zonaId: "z-sur" }));
    expect(contarCobertura(estados(todas)).sinZona).toBe(0);
  });

  it("una destildada sin guardar YA cuenta como huérfana", () => {
    // Es lo que va a quedar si se guarda así, y decirlo antes es el punto.
    const c = contarCobertura(estados([{ comuna: A, zonaId: "z-norte" }], []));
    expect(c.deEstaZona).toBe(0);
    expect(c.sinZona).toBe(COMUNAS_RM.length);
  });
});

describe("textoCobertura", () => {
  it("la alerta solo aparece cuando hay huérfanas", () => {
    // «9 de 52 · 0 sin zona» es ruido, y entrena a no leer el número cuando
    // deja de ser cero.
    expect(textoCobertura({ deEstaZona: 9, total: 52, sinZona: 0 })).toEqual({
      principal: "9 de 52",
      alerta: null,
    });
    expect(textoCobertura({ deEstaZona: 9, total: 52, sinZona: 6 })).toEqual({
      principal: "9 de 52",
      alerta: "6 sin zona",
    });
  });
});
