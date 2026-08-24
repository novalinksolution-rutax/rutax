import { describe, it, expect } from "vitest";
import {
  calcularHolguraRuta,
  formatearDuracionCorta,
  formatearHoraDeMinutos,
  HORA_CORTE,
  HORA_DESPACHO,
  MINUTOS_POR_PARADA,
} from "./holgura-ruta";

describe("calcularHolguraRuta", () => {
  it("no estima nada cuando ya no quedan paradas abiertas", () => {
    // Un «cierra a las 18:40» sobre un conductor que se fue a la casa es una
    // cifra inventada. Sin paradas abiertas la respuesta correcta es ninguna.
    expect(
      calcularHolguraRuta({
        paradasAbiertas: 0,
        metrosGuardados: 185_300,
        metrosPropuestos: 198_700,
        ahoraMin: 17 * 60,
      }),
    ).toBeNull();
  });

  it("arranca el reloj en el despacho cuando todavía no son las 16:00", () => {
    // Reordenar a las 11:00 no adelanta ninguna entrega: la flota sale a las
    // 16:00 igual. Si el reloj arrancara «ahora», la pantalla prometería cerrar
    // a las 15:00 y todo cambio se vería inofensivo.
    const r = calcularHolguraRuta({
      paradasAbiertas: 20,
      metrosGuardados: null,
      metrosPropuestos: null,
      ahoraMin: 11 * 60,
    })!;
    expect(r.cierreEstimadoMin).toBe(HORA_DESPACHO * 60 + 20 * MINUTOS_POR_PARADA);
    expect(r.margenMin).toBe(HORA_CORTE * 60 - r.cierreEstimadoMin);
  });

  it("convierte el delta de kilómetros en minutos y lo suma al cierre", () => {
    // +13,4 km en línea recta a 15 km/h son ~54 min.
    const r = calcularHolguraRuta({
      paradasAbiertas: 14,
      metrosGuardados: 185_300,
      metrosPropuestos: 198_700,
      ahoraMin: 17 * 60,
    })!;
    expect(r.minutosDelCambio).toBe(54);
    expect(r.cierreEstimadoMin).toBe(17 * 60 + 14 * MINUTOS_POR_PARADA + 54);
  });

  it("un cambio que acorta la ruta devuelve minutos negativos", () => {
    const r = calcularHolguraRuta({
      paradasAbiertas: 10,
      metrosGuardados: 200_000,
      metrosPropuestos: 185_000,
      ahoraMin: 17 * 60,
    })!;
    expect(r.minutosDelCambio).toBe(-60);
    expect(r.cierreEstimadoMin).toBe(17 * 60 + 10 * MINUTOS_POR_PARADA - 60);
  });

  it("declara margen negativo cuando la ruta se pasa del corte, sin recortarlo a cero", () => {
    // Un margen que se detiene en 0 esconde justo el caso que importa: hay que
    // poder distinguir «llega justo» de «se pasa por hora y media».
    const r = calcularHolguraRuta({
      paradasAbiertas: 30,
      metrosGuardados: null,
      metrosPropuestos: null,
      ahoraMin: 19 * 60,
    })!;
    expect(r.margenMin).toBeLessThan(0);
    expect(r.margenMin).toBe(HORA_CORTE * 60 - (19 * 60 + 30 * MINUTOS_POR_PARADA));
  });

  it("sin distancias que comparar sigue estimando el cierre, con el delta en null", () => {
    // Es el manifiesto sin bodega de origen configurada: no hay kilómetros, pero
    // las paradas y el corte siguen existiendo.
    const r = calcularHolguraRuta({
      paradasAbiertas: 12,
      metrosGuardados: null,
      metrosPropuestos: 198_700,
      ahoraMin: 16 * 60,
    })!;
    expect(r.minutosDelCambio).toBeNull();
    expect(r.cierreEstimadoMin).toBe(16 * 60 + 12 * MINUTOS_POR_PARADA);
  });

  it("acompaña el número con sus supuestos", () => {
    // La pantalla los muestra al lado. Que viajen dentro del resultado es lo que
    // impide mostrar el número sin ellos.
    const r = calcularHolguraRuta({
      paradasAbiertas: 5,
      metrosGuardados: 0,
      metrosPropuestos: 0,
      ahoraMin: 16 * 60,
    })!;
    expect(r.supuestos).toEqual({ minutosPorParada: 12, kmhLineaRecta: 15 });
  });
});

describe("formateo", () => {
  it("escribe la hora con dos dígitos y da la vuelta al reloj pasada la medianoche", () => {
    // «25:30» se escribió una vez y no sobrevivió a verlo en pantalla: nadie
    // lee un reloj de 25 horas. La bandera es para que la frase pueda decir
    // «de mañana» y no deje un «01:30» que parece del mismo día.
    expect(formatearHoraDeMinutos(21 * 60)).toEqual({ hora: "21:00", cruzaMedianoche: false });
    expect(formatearHoraDeMinutos(9 * 60 + 5)).toEqual({ hora: "09:05", cruzaMedianoche: false });
    expect(formatearHoraDeMinutos(25 * 60 + 30)).toEqual({ hora: "01:30", cruzaMedianoche: true });
    expect(formatearHoraDeMinutos(24 * 60)).toEqual({ hora: "00:00", cruzaMedianoche: true });
  });

  it("escribe duraciones cortas en minutos y largas en horas", () => {
    expect(formatearDuracionCorta(40)).toBe("40 min");
    expect(formatearDuracionCorta(-40)).toBe("40 min");
    expect(formatearDuracionCorta(80)).toBe("1 h 20");
    expect(formatearDuracionCorta(120)).toBe("2 h");
  });
});
