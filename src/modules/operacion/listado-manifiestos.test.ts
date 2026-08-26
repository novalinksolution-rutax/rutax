import { describe, expect, it } from "vitest";
import {
  avanceEnFalla,
  AVANCE_MINIMO_ESPERADO,
  HORA_UMBRAL_AVANCE,
} from "./listado-manifiestos";

describe("avanceEnFalla", () => {
  it("antes de las 18:00 un avance bajo NO es una falla", () => {
    // El despacho salió a las 16:00: a las 16:15 todos van en 5 % y pintar la
    // tabla de rojo ahí la deja sin significar nada a las 20:00, que es cuando
    // importa.
    expect(avanceEnFalla(5, 16)).toBe(false);
    expect(avanceEnFalla(30, 17)).toBe(false);
  });

  it("desde las 18:00 un avance bajo el mínimo sí lo es", () => {
    expect(avanceEnFalla(30, HORA_UMBRAL_AVANCE)).toBe(true);
    expect(avanceEnFalla(10, 20)).toBe(true);
  });

  it("el mínimo esperado NO es falla: el umbral es estricto", () => {
    expect(avanceEnFalla(AVANCE_MINIMO_ESPERADO, 20)).toBe(false);
    expect(avanceEnFalla(AVANCE_MINIMO_ESPERADO - 1, 20)).toBe(true);
  });

  it("sin paradas no hay avance que juzgar", () => {
    // `null` es «nada que medir», no «cero por ciento». Un manifiesto en
    // borrador no está atrasado: está sin armar.
    expect(avanceEnFalla(null, 20)).toBe(false);
  });

  it("una ruta ya cerrada NO está atrasada, por bajo que sea su avance", () => {
    // 🔴 El caso que llegó del uso real: cuatro manifiestos completados en 0 %,
    // en rojo, a las 20:00. «Va atrasado» solo significa algo mientras la ruta
    // todavía puede avanzar. Si quedaron paradas abiertas, eso se cuenta aparte
    // y en tono de atención — es otra afirmación, con otras palabras.
    expect(avanceEnFalla(0, 20, "completado")).toBe(false);
    expect(avanceEnFalla(10, 22, "completado")).toBe(false);
    expect(avanceEnFalla(0, 20, "cancelado")).toBe(false);
    expect(avanceEnFalla(0, 20, "borrador")).toBe(false);
  });

  it("las rutas que SÍ pueden avanzar conservan la alarma", () => {
    // La contraprueba de la de arriba: si excluir estados terminales apagara
    // también las vivas, la columna dejaría de avisar de lo único que avisa.
    expect(avanceEnFalla(10, 20, "en_ruta")).toBe(true);
    expect(avanceEnFalla(10, 20, "confirmado")).toBe(true);
    // Y sin estado se comporta como antes, que es lo que usa cualquier llamador
    // que no lo tenga a mano.
    expect(avanceEnFalla(10, 20)).toBe(true);
  });
});
