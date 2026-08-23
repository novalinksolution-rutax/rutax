import { describe, expect, it } from "vitest";
import { comunaDelCatalogo, esMovilChileno, superaHoraDeCorte } from "./reglas-alta";

describe("esMovilChileno", () => {
  it("acepta las formas en que la gente escribe un móvil", () => {
    for (const v of [
      "+56 9 1234 5678",
      "+56912345678",
      "56 9 1234 5678",
      "9 1234 5678",
      "912345678",
    ]) {
      expect(esMovilChileno(v), v).toBe(true);
    }
  });

  it("acepta el vacío: el teléfono es opcional", () => {
    // Un campo opcional que se pinta de rojo por estar vacío acusa a alguien de
    // un error que no cometió.
    expect(esMovilChileno("")).toBe(true);
    expect(esMovilChileno("   ")).toBe(true);
  });

  it("rechaza un fijo, un número corto y uno largo", () => {
    // El campo existe para avisarle al destinatario que el conductor va en
    // camino, y eso es un mensaje al móvil.
    expect(esMovilChileno("+56 2 2345 6789")).toBe(false);
    expect(esMovilChileno("12345")).toBe(false);
    expect(esMovilChileno("+56 9 1234 56789")).toBe(false);
    expect(esMovilChileno("no es un teléfono")).toBe(false);
  });
});

describe("comunaDelCatalogo", () => {
  it("reconoce la comuna venga como venga del proveedor", () => {
    expect(comunaDelCatalogo("Ñuñoa")).toBe("Ñuñoa");
    expect(comunaDelCatalogo("nunoa")).toBe("Ñuñoa");
    expect(comunaDelCatalogo("NUÑOA")).toBe("Ñuñoa");
    expect(comunaDelCatalogo("Comuna de Ñuñoa")).toBe("Ñuñoa");
    expect(comunaDelCatalogo("estacion central")).toBe("Estación Central");
  });

  it("devuelve null en vez de inventar una comuna", () => {
    // Si no calza, elige la persona: una comuna inventada rompe la tarifa y el
    // reparto por zona sin que nadie lo note.
    expect(comunaDelCatalogo("Valparaíso")).toBeNull();
    expect(comunaDelCatalogo(null)).toBeNull();
    expect(comunaDelCatalogo("")).toBeNull();
  });
});

describe("superaHoraDeCorte", () => {
  it("compara en minutos, no como texto", () => {
    // ⚠️ El bug que esta prueba existe para impedir: `"9:30" > "16:00"` es
    // VERDADERO comparando cadenas, así que el aviso de «se va mañana»
    // aparecería a las nueve y media de la mañana.
    expect(superaHoraDeCorte("09:30", "16:00")).toBe(false);
    expect(superaHoraDeCorte("9:30", "16:00")).toBe(false);
    expect(superaHoraDeCorte("16:01", "16:00")).toBe(true);
    expect(superaHoraDeCorte("23:59", "16:00")).toBe(true);
  });

  it("la hora exacta del corte todavía alcanza", () => {
    expect(superaHoraDeCorte("16:00", "16:00")).toBe(false);
  });

  it("ante una hora ilegible no avisa", () => {
    // Un aviso falso empuja a reagendar un pedido que sí alcanzaba a salir hoy.
    expect(superaHoraDeCorte("", "16:00")).toBe(false);
    expect(superaHoraDeCorte("16:30", "sin hora")).toBe(false);
  });
});
