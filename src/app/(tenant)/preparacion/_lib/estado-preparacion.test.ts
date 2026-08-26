import { describe, expect, it } from "vitest";
import type { VisitaRetiroResumenCourier } from "@/modules/operacion/retiro/preparacion";
import {
  agruparVisitas,
  calcularMagnitudes,
  calcularSubtituloCabecera,
  clasificarEstadoCabecera,
  pluralizar,
  type MagnitudesPreparacion,
} from "./estado-preparacion";

function visita(
  over: Partial<VisitaRetiroResumenCourier> & { sesionId: string },
): VisitaRetiroResumenCourier {
  return {
    estado: "abierta",
    abiertaEn: "2026-08-13T12:00:00.000Z",
    cerradaEn: null,
    bodega: { id: "bodega-1", nombre: "Bodega Andes Norte", comuna: "Renca" },
    seller: { id: "seller-1", nombre: "Comercial Andes" },
    conductor: { id: "conductor-1", nombre: "Pedro Soto" },
    vivos: { total: 0, resueltos: 0, sinResolver: 0 },
    bultosDeOtroSeller: 0,
    ultimoEscaneoEn: null,
    acta: null,
    ...over,
  };
}

describe("pluralizar", () => {
  it("singular exactamente en 1, plural en 0 y en 2+", () => {
    expect(pluralizar(1, "bulto", "bultos")).toBe("bulto");
    expect(pluralizar(0, "bulto", "bultos")).toBe("bultos");
    expect(pluralizar(2, "bulto", "bultos")).toBe("bultos");
  });
});

describe("calcularMagnitudes", () => {
  const ahoraMs = new Date("2026-08-13T12:20:00.000Z").getTime();

  it("cuenta bultos de una visita abierta por 'vivos' y de una cerrada por 'acta'", () => {
    const visitas = [
      visita({ sesionId: "a", estado: "abierta", vivos: { total: 12, resueltos: 10, sinResolver: 2 } }),
      visita({
        sesionId: "b",
        estado: "cerrada",
        cerradaEn: "2026-08-13T11:00:00.000Z",
        vivos: { total: 58, resueltos: 52, sinResolver: 6 },
        acta: { total: 58, resueltos: 52, sinResolver: 6 },
      }),
    ];
    const m = calcularMagnitudes(visitas, ahoraMs);
    expect(m.bultosRetiradosHoy).toBe(70);
    expect(m.bultosSinIdentificar).toBe(8);
    expect(m.enBodegaAhora).toBe(1);
    expect(m.deVuelta).toBe(1);
  });

  it("'sin novedades' solo cuenta abiertas que superaron el umbral", () => {
    const visitas = [
      // Abierta hace 5 min: tranquila.
      visita({ sesionId: "reciente", abiertaEn: "2026-08-13T12:15:00.000Z" }),
      // Sin ningún escaneo hace 20 min: en aviso.
      visita({ sesionId: "estancada", abiertaEn: "2026-08-13T12:00:00.000Z" }),
    ];
    expect(calcularMagnitudes(visitas, ahoraMs).sinNovedades).toBe(1);
  });

  it("una visita CERRADA nunca cuenta para 'sin novedades', aunque su última señal sea vieja", () => {
    const visitas = [
      visita({
        sesionId: "cerrada-vieja",
        estado: "cerrada",
        abiertaEn: "2026-08-13T08:00:00.000Z",
        cerradaEn: "2026-08-13T08:30:00.000Z",
        acta: { total: 5, resueltos: 5, sinResolver: 0 },
      }),
    ];
    expect(calcularMagnitudes(visitas, ahoraMs).sinNovedades).toBe(0);
  });

  it("un escaneo posterior al cierre suma a la franja aunque el acta no lo cuente", () => {
    // El acta se congela al cerrar y respalda un pago: ahí el escaneo tardío NO
    // entra, y eso se muestra en la tarjeta de la visita ("+1 después de
    // cerrar"). Pero la franja responde otra pregunta —cuántos bultos hay en la
    // bodega AHORA— y ese bulto está físicamente arriba de la van.
    //
    // Es además lo que impide que la pantalla se contradiga consigo misma:
    // "Carga por comuna", más abajo en la misma vista, cuenta bultos vivos.
    const visitas = [
      visita({
        sesionId: "tardio",
        estado: "cerrada",
        cerradaEn: "2026-08-13T10:00:00.000Z",
        acta: { total: 20, resueltos: 20, sinResolver: 0 },
        vivos: { total: 21, resueltos: 20, sinResolver: 1 }, // 1 escaneo posterior al cierre
      }),
    ];
    const m = calcularMagnitudes(visitas, ahoraMs);
    expect(m.bultosRetiradosHoy).toBe(21);
    expect(m.bultosSinIdentificar).toBe(1);
  });

  it("sin visitas, todo en cero", () => {
    expect(calcularMagnitudes([], ahoraMs)).toEqual({
      bultosRetiradosHoy: 0,
      enBodegaAhora: 0,
      deVuelta: 0,
      sinNovedades: 0,
      bultosSinIdentificar: 0,
    });
  });
});

describe("clasificarEstadoCabecera", () => {
  it("sin visitas: arranque_vacio", () => {
    expect(clasificarEstadoCabecera([], { enBodegaAhora: 0, sinNovedades: 0 })).toBe("arranque_vacio");
  });

  it("cero abiertas, alguna cerrada: cierre_de_manana", () => {
    const visitas = [
      visita({ sesionId: "x", estado: "cerrada", acta: { total: 1, resueltos: 1, sinResolver: 0 } }),
    ];
    expect(clasificarEstadoCabecera(visitas, { enBodegaAhora: 0, sinNovedades: 0 })).toBe("cierre_de_manana");
  });

  it("con abiertas y ninguna en aviso: en_curso_tranquilo", () => {
    const visitas = [visita({ sesionId: "x" })];
    expect(clasificarEstadoCabecera(visitas, { enBodegaAhora: 1, sinNovedades: 0 })).toBe("en_curso_tranquilo");
  });

  it("con abiertas y 1+ en aviso: en_curso_con_avisos", () => {
    const visitas = [visita({ sesionId: "x" })];
    expect(clasificarEstadoCabecera(visitas, { enBodegaAhora: 1, sinNovedades: 1 })).toBe("en_curso_con_avisos");
  });
});

/**
 * Las cuatro SIN punto final: son un tramo de la línea de estado, no una frase
 * suelta — la cabecera sigue con « · faltan 1 h 54 para el despacho». Ver la
 * nota en `calcularSubtituloCabecera`.
 */
describe("calcularSubtituloCabecera", () => {
  const base: MagnitudesPreparacion = {
    bultosRetiradosHoy: 1,
    enBodegaAhora: 1,
    deVuelta: 0,
    sinNovedades: 0,
    bultosSinIdentificar: 0,
  };

  it("pluraliza en singular cuando cada magnitud es 1 (en_curso_tranquilo)", () => {
    expect(calcularSubtituloCabecera("en_curso_tranquilo", base)).toBe(
      "1 bulto retirado hasta ahora · 1 conductor en bodega",
    );
  });

  it("pluraliza en plural con 0 o 2+ (en_curso_con_avisos)", () => {
    const m: MagnitudesPreparacion = { ...base, bultosRetiradosHoy: 0, sinNovedades: 2 };
    expect(calcularSubtituloCabecera("en_curso_con_avisos", m)).toBe(
      "0 bultos retirados hasta ahora · 2 visitas sin novedades",
    );
  });

  it("cierre_de_manana no menciona enBodegaAhora ni sinNovedades", () => {
    const m: MagnitudesPreparacion = { ...base, bultosRetiradosHoy: 84 };
    expect(calcularSubtituloCabecera("cierre_de_manana", m)).toBe(
      "84 bultos retirados en total · todos los conductores están de vuelta",
    );
  });

  it("arranque_vacio es texto fijo, sin importar las magnitudes", () => {
    expect(calcularSubtituloCabecera("arranque_vacio", base)).toBe(
      "Ningún conductor ha abierto una visita todavía",
    );
  });
});

describe("agruparVisitas", () => {
  it("abiertas: ordenadas por señal más antigua primero (la más urgente arriba)", () => {
    const visitas = [
      visita({ sesionId: "reciente", abiertaEn: "2026-08-13T12:10:00.000Z" }),
      visita({ sesionId: "antigua", abiertaEn: "2026-08-13T12:00:00.000Z" }),
    ];
    const { abiertas } = agruparVisitas(visitas);
    expect(abiertas.map((v) => v.sesionId)).toEqual(["antigua", "reciente"]);
  });

  it("abiertas: la señal es el ÚLTIMO ESCANEO cuando existe, no la apertura", () => {
    const visitas = [
      // Abrió primero pero escaneó hace muy poco: menos urgente.
      visita({ sesionId: "activa", abiertaEn: "2026-08-13T11:00:00.000Z", ultimoEscaneoEn: "2026-08-13T12:19:00.000Z" }),
      // Abrió después pero nunca escaneó: más urgente.
      visita({ sesionId: "muda", abiertaEn: "2026-08-13T12:00:00.000Z", ultimoEscaneoEn: null }),
    ];
    const { abiertas } = agruparVisitas(visitas);
    expect(abiertas.map((v) => v.sesionId)).toEqual(["muda", "activa"]);
  });

  it("cerradas: ordenadas por cierre más reciente primero", () => {
    const visitas = [
      visita({
        sesionId: "temprano",
        estado: "cerrada",
        cerradaEn: "2026-08-13T09:00:00.000Z",
        acta: { total: 1, resueltos: 1, sinResolver: 0 },
      }),
      visita({
        sesionId: "tarde",
        estado: "cerrada",
        cerradaEn: "2026-08-13T11:00:00.000Z",
        acta: { total: 1, resueltos: 1, sinResolver: 0 },
      }),
    ];
    const { cerradas } = agruparVisitas(visitas);
    expect(cerradas.map((v) => v.sesionId)).toEqual(["tarde", "temprano"]);
  });

  it("separa abiertas de cerradas sin perder ninguna", () => {
    const visitas = [
      visita({ sesionId: "a" }),
      visita({
        sesionId: "b",
        estado: "cerrada",
        cerradaEn: "2026-08-13T10:00:00.000Z",
        acta: { total: 1, resueltos: 1, sinResolver: 0 },
      }),
    ];
    const { abiertas, cerradas } = agruparVisitas(visitas);
    expect(abiertas).toHaveLength(1);
    expect(cerradas).toHaveLength(1);
  });
});
