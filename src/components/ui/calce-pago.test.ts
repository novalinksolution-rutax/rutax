import { describe, expect, it } from "vitest";

/**
 * La aritmética del calce, aislada del render.
 *
 * Importa porque de estos tres números salen los dos casos raros que hoy la
 * pantalla no nombra —«pago parcial» y «pagó de más»— y porque el resto que
 * queda **sigue disponible** para otro período: si el número está mal, alguien
 * cree que perdió plata o que le pagaron de menos.
 */

function calce(montoMovimiento: number, montoPeriodo: number) {
  const imputado = Math.min(montoMovimiento, montoPeriodo);
  return {
    imputado,
    resto: montoMovimiento - imputado,
    falta: montoPeriodo - imputado,
  };
}

describe("calce de un movimiento contra un período", () => {
  it("calce exacto: no queda resto ni falta", () => {
    const r = calce(812600, 812600);
    expect(r).toEqual({ imputado: 812600, resto: 0, falta: 0 });
  });

  it("pagó de menos: el período queda con saldo y el movimiento se consume entero", () => {
    const r = calce(300000, 864100);
    expect(r.imputado).toBe(300000);
    expect(r.resto).toBe(0); // nada sobra del movimiento
    expect(r.falta).toBe(564100); // al período le falta esto
  });

  it("pagó de más: sobra del movimiento y el período queda cubierto", () => {
    const r = calce(310000, 96400);
    expect(r.imputado).toBe(96400);
    expect(r.resto).toBe(213600); // sigue a favor del seller
    expect(r.falta).toBe(0);
  });

  it("lo imputado nunca supera ni al movimiento ni al período", () => {
    for (const [mov, per] of [
      [100, 50],
      [50, 100],
      [0, 100],
      [100, 0],
    ]) {
      const r = calce(mov, per);
      expect(r.imputado).toBeLessThanOrEqual(mov);
      expect(r.imputado).toBeLessThanOrEqual(per);
    }
  });

  it("las tres cifras siempre cuadran contra el movimiento", () => {
    for (const [mov, per] of [
      [812600, 812600],
      [300000, 864100],
      [310000, 96400],
      [1, 999999],
    ]) {
      const r = calce(mov, per);
      expect(r.imputado + r.resto).toBe(mov);
    }
  });

  it("resto y falta nunca son ambos mayores que cero", () => {
    // Serían contradictorios: no se puede sobrar plata Y deber al mismo tiempo.
    for (const [mov, per] of [
      [812600, 812600],
      [300000, 864100],
      [310000, 96400],
    ]) {
      const r = calce(mov, per);
      expect(r.resto > 0 && r.falta > 0).toBe(false);
    }
  });
});
