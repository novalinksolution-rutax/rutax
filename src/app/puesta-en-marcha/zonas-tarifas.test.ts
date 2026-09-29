import { describe, expect, it } from "vitest";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import {
  alternarZona,
  asignarZona,
  filtrarComunas,
  normalizarBusqueda,
  zonaOpuesta,
  asignacionSugerida,
  calcularMargen,
  comunasDe,
  construirEntrada,
  COMUNAS_ZONA_1_SUGERIDAS,
  estadoSugerido,
  hidratarPaso4,
  miles,
  montosDeExcepcion,
  parsearMonto,
  pesos,
  plataformasEncendidas,
  validarEntradaServidor,
  validarPaso4,
  ZONAS_SUGERIDAS,
} from "./zonas-tarifas";

describe("preset del paso 4", () => {
  it("34 comunas en Gran Santiago urbano y 18 en Periferia, sin sobrar ni faltar", () => {
    const a = asignacionSugerida();
    expect(COMUNAS_ZONA_1_SUGERIDAS).toHaveLength(34);
    expect(comunasDe(a, 1)).toHaveLength(34);
    expect(comunasDe(a, 2)).toHaveLength(18);
    expect(Object.keys(a)).toHaveLength(COMUNAS_RM.length);
    expect(a["Puente Alto"]).toBe(1);
    expect(a["San Bernardo"]).toBe(1);
    expect(a["Melipilla"]).toBe(2);
  });

  it("los sugeridos son los netos de §14", () => {
    expect(ZONAS_SUGERIDAS.zona1).toMatchObject({ cobro: 3500, pago: 2400 });
    expect(ZONAS_SUGERIDAS.zona2).toMatchObject({ cobro: 4000, pago: 2900 });
  });
});

describe("dinero", () => {
  it("formatea con miles y sin espacio", () => {
    expect(pesos(3500)).toBe("$3.500");
    expect(pesos(1234567)).toBe("$1.234.567");
    expect(miles(null)).toBe("");
  });

  it("parsea enteros y descarta decimales y letras", () => {
    expect(parsearMonto("3.500")).toBe(3500);
    expect(parsearMonto("3500,90")).toBe(350090);
    expect(parsearMonto("abc")).toBeNull();
    expect(parsearMonto("")).toBeNull();
  });

  it("margen: monto y porcentaje; negativo cuando se paga más de lo que se cobra", () => {
    expect(calcularMargen(3500, 2400)).toEqual({ monto: 1100, porcentaje: 31 });
    expect(calcularMargen(2000, 2400)).toEqual({ monto: -400, porcentaje: -20 });
    expect(calcularMargen(null, 2400)).toBeNull();
  });
});

describe("plataformas", () => {
  it("Pedidos propios siempre; Flex y Shopify solo si el paso 3 las encendió", () => {
    expect(plataformasEncendidas({ ofreceFlex: false, ofreceShopify: false })).toEqual(["rutax_manual"]);
    expect(plataformasEncendidas({ ofreceFlex: true, ofreceShopify: true })).toEqual([
      "rutax_manual",
      "ml_flex",
      "shopify",
    ]);
  });
});

describe("validación", () => {
  const plataformas = ["rutax_manual", "ml_flex"] as const;

  it("el estado sugerido es válido", () => {
    expect(validarPaso4(estadoSugerido(), plataformas).ok).toBe(true);
  });

  it("cobro o pago vacío o en 0 → «Ingresa un monto.»", () => {
    const e = estadoSugerido();
    e.zona1.cobro = null;
    e.zona2.pago = 0;
    const { ok, errores } = validarPaso4(e, plataformas);
    expect(ok).toBe(false);
    expect(errores.cobro[1]).toBe("Ingresa un monto.");
    expect(errores.pago[2]).toBe("Ingresa un monto.");
  });

  it("un margen negativo NO bloquea", () => {
    const e = estadoSugerido();
    e.zona1.cobro = 2000;
    expect(validarPaso4(e, plataformas).ok).toBe(true);
  });

  it("una zona sin comunas → «Asigna al menos una comuna.»", () => {
    const e = estadoSugerido();
    const todas = Object.fromEntries(COMUNAS_RM.map((c) => [c, 1 as const]));
    const { errores, ok } = validarPaso4({ ...e, asignacion: todas }, plataformas);
    expect(ok).toBe(false);
    expect(errores.comunas[2]).toBe("Asigna al menos una comuna.");
  });

  it("nombres repetidos se rechazan", () => {
    const e = estadoSugerido();
    e.zona2.nombre = " gran santiago urbano ";
    expect(validarPaso4(e, plataformas).errores.nombre[2]).toBeDefined();
  });

  it("con «Diferenciar», una excepción vacía bloquea; sin él, no importa", () => {
    const e = estadoSugerido();
    e.excepciones = { "1:ml_flex": { cobro: null, pago: 2400 } };
    expect(validarPaso4(e, plataformas).ok).toBe(true);
    const { ok, errores } = validarPaso4({ ...e, diferenciar: true }, plataformas);
    expect(ok).toBe(false);
    expect(errores.excepciones["1:ml_flex"]?.cobro).toBe("Ingresa un monto.");
  });
});

describe("entrada al servidor", () => {
  const plataformas = ["rutax_manual", "ml_flex"] as const;

  it("sin «Diferenciar» no viaja ninguna excepción", () => {
    const entrada = construirEntrada(estadoSugerido(), plataformas);
    expect(entrada.zona1.excepciones).toEqual([]);
    expect(entrada.zona2.comunas).toHaveLength(18);
  });

  it("con «Diferenciar», cada plataforma encendida sale prellenada con el valor de la zona", () => {
    const e = { ...estadoSugerido(), diferenciar: true };
    e.excepciones = { "2:ml_flex": { cobro: 4500, pago: 3100 } };
    const entrada = construirEntrada(e, plataformas);
    expect(entrada.zona1.excepciones).toEqual([
      { fuente: "rutax_manual", cobro: 3500, pago: 2400 },
      { fuente: "ml_flex", cobro: 3500, pago: 2400 },
    ]);
    expect(entrada.zona2.excepciones[1]).toEqual({ fuente: "ml_flex", cobro: 4500, pago: 3100 });
    expect(montosDeExcepcion(e, 2, "rutax_manual")).toEqual({ cobro: 4000, pago: 2900 });
  });

  it("el servidor rechaza una plataforma que el paso 3 no encendió, una comuna inventada y una repetida", () => {
    const base = () => construirEntrada({ ...estadoSugerido(), diferenciar: true }, plataformas);
    expect(validarEntradaServidor(base(), plataformas)).toBeNull();
    expect(validarEntradaServidor(base(), ["rutax_manual"])).not.toBeNull();

    const inventada = base();
    inventada.zona1.comunas = ["Narnia"];
    expect(validarEntradaServidor(inventada, plataformas)).not.toBeNull();

    const repetida = base();
    repetida.zona2.comunas = [repetida.zona1.comunas[0]];
    expect(validarEntradaServidor(repetida, plataformas)).not.toBeNull();

    const sinMonto = base();
    sinMonto.zona2.pago = 0;
    expect(validarEntradaServidor(sinMonto, plataformas)?.mensaje).toBe("Ingresa un monto.");
  });
});

describe("reentrada", () => {
  const plataformas = ["rutax_manual", "ml_flex"] as const;

  it("sin nada guardado, los sugeridos", () => {
    const e = hidratarPaso4({ zonas: [], comunas: [], tarifas: [] }, plataformas);
    expect(e.zona1.cobro).toBe(3500);
    expect(e.diferenciar).toBe(false);
  });

  it("muestra lo guardado, marca «Diferenciar» y solo tiene por editadas las excepciones distintas", () => {
    const e = hidratarPaso4(
      {
        zonas: [
          { id: "z1", nombre: "Centro", esRespaldo: false, creadoEn: "2026-09-28T10:00:00Z" },
          { id: "z2", nombre: "Afuera", esRespaldo: true, creadoEn: "2026-09-28T10:00:01Z" },
        ],
        comunas: [
          { zonaId: "z1", comuna: "Providencia" },
          { zonaId: "z2", comuna: "Buin" },
        ],
        tarifas: [
          { zonaId: "z1", fuente: null, cobro: 3000, pago: 2000 },
          { zonaId: "z2", fuente: null, cobro: 5000, pago: 3000 },
          { zonaId: "z1", fuente: "ml_flex", cobro: 3000, pago: 2000 },
          { zonaId: "z2", fuente: "ml_flex", cobro: 5200, pago: 3000 },
          { zonaId: null, fuente: null, cobro: 5000, pago: 3000 },
        ],
      },
      plataformas,
    );
    expect(e.zona1).toMatchObject({ id: "z1", nombre: "Centro", cobro: 3000, pago: 2000 });
    expect(e.zona2).toMatchObject({ id: "z2", cobro: 5000 });
    expect(e.diferenciar).toBe(true);
    expect(e.excepciones).toEqual({ "2:ml_flex": { cobro: 5200, pago: 3000 } });
    // Providencia en la 1; todo lo demás cae en la de respaldo.
    expect(comunasDe(e.asignacion, 1)).toEqual(["Providencia"]);
    expect(comunasDe(e.asignacion, 2)).toHaveLength(COMUNAS_RM.length - 1);
  });
});

describe("alternar y buscar comunas", () => {
  it("alternarZona pasa la comuna a la otra zona y es reversible, sin mutar", () => {
    const a = asignacionSugerida();
    const b = alternarZona(a, "Providencia");
    expect(a["Providencia"]).toBe(1);
    expect(b["Providencia"]).toBe(2);
    expect(alternarZona(b, "Providencia")).toEqual(a);
    expect(comunasDe(b, 1)).toHaveLength(33);
    expect(comunasDe(b, 2)).toHaveLength(19);
  });

  it("ignora una comuna que no está en la asignación", () => {
    const a = asignacionSugerida();
    expect(alternarZona(a, "Narnia")).toBe(a);
    expect(asignarZona(a, "Narnia", 2)).toBe(a);
  });

  it("asignarZona es idempotente", () => {
    const a = asignacionSugerida();
    expect(asignarZona(a, "Providencia", 1)).toBe(a);
    expect(asignarZona(a, "Providencia", 2)["Providencia"]).toBe(2);
    expect(zonaOpuesta(1)).toBe(2);
    expect(zonaOpuesta(2)).toBe(1);
  });

  it("la búsqueda ignora tildes y mayúsculas y conserva el orden alfabético", () => {
    expect(normalizarBusqueda("  ÑUÑOA ")).toBe("nunoa");
    expect(filtrarComunas("nunoa")).toEqual(["Ñuñoa"]);
    expect(filtrarComunas("PENA")).toEqual(expect.arrayContaining(["Peñalolén", "Peñaflor"]));
    expect(filtrarComunas("zzzz")).toEqual([]);
    const todas = filtrarComunas("");
    expect(todas).toHaveLength(COMUNAS_RM.length);
    expect(todas).toEqual([...todas].sort((x, y) => x.localeCompare(y, "es")));
  });
});
