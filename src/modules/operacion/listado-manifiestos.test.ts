import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

describe("una sola regla de «parada cerrada», para las dos pantallas", () => {
  /**
   * 🔴 **Ésta es la red del defecto del 26-08-2026, y es de código fuente
   * a propósito.**
   *
   * `cargarContextoManifiestos` (columna «Avance» de Manifiestos) y
   * `obtenerHoyDeConductores` (columna «Ruta de hoy» de Conductores) cuentan lo
   * mismo: cuántas paradas de una ruta están cerradas. Cada una tenía su propia
   * lista de estados terminales y medía solo contra `pedidos.estado`.
   *
   * En Flex ese estado lo escribe Mercado Libre y llega con la sincronización,
   * así que la misma ruta salía **100 % (3/3)** en Manifiestos y **«0 de 3»** en
   * Conductores. Dos pantallas contradiciéndose sobre el mismo conductor, con
   * las dos cifras a un clic de distancia.
   *
   * No hay forma de atrapar esto con una prueba de comportamiento sin montar la
   * base: las dos son lectoras. Lo que sí se puede fijar es que **compartan la
   * función**, que es lo que impide que vuelvan a divergir.
   */
  const RAIZ = fileURLToPath(new URL(".", import.meta.url));

  it.each([
    ["listado-manifiestos.ts", "cerradasPorElConductor("],
    ["conductores-nomina.ts", "cerradasPorElConductor("],
  ])("%s cuenta las paradas cerradas con el predicado compartido", (archivo, aguja) => {
    const fuente = readFileSync(join(RAIZ, archivo), "utf8");
    expect(fuente).toContain(aguja);
  });

  it("la nómina IMPORTA el predicado en vez de tener su propia copia", () => {
    // La contraprueba de la de arriba: `toContain` pasaría igual si alguien
    // declarara una función local con el mismo nombre. Lo que se exige es el
    // import — o sea, que sea LA misma.
    const fuente = readFileSync(join(RAIZ, "conductores-nomina.ts"), "utf8");
    expect(fuente).toMatch(
      /import\s*\{[^}]*cerradasPorElConductor[^}]*\}\s*from\s*["']\.\/listado-manifiestos["']/,
    );
  });
});
