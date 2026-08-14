import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEBOUNCE_MS,
  MAX_ESPERA_MS,
  crearProgramadorRefresco,
} from "./programador-refresco";

/**
 * El reloj del programador y el de los temporizadores falsos se avanzan JUNTOS.
 * Si se movieran por separado, la prueba mediría un mundo que no existe: el
 * temporizador dispararía en un instante y `ahora()` reportaría otro.
 */
function crearBanco() {
  let reloj = 0;
  const ejecutar = vi.fn();
  const programador = crearProgramadorRefresco(ejecutar, { ahora: () => reloj });

  return {
    ejecutar,
    programador,
    avanzar(ms: number) {
      reloj += ms;
      vi.advanceTimersByTime(ms);
    },
  };
}

describe("crearProgramadorRefresco", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("agrupa la ráfaga: un evento suelto refresca una sola vez, tras la calma", () => {
    const { ejecutar, programador, avanzar } = crearBanco();

    programador.programar();

    avanzar(DEBOUNCE_MS - 1);
    expect(ejecutar).not.toHaveBeenCalled();

    avanzar(1);
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it("varios eventos dentro de la ventana de calma producen UN refresco", () => {
    const { ejecutar, programador, avanzar } = crearBanco();

    programador.programar();
    avanzar(200);
    programador.programar();
    avanzar(200);
    programador.programar();

    avanzar(DEBOUNCE_MS);
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  /**
   * LA PRUEBA QUE IMPORTA — es el defecto que estuvo vivo hasta 2026-08-13.
   *
   * Diez conductores escaneando en bodega generan eventos sostenidos a menos de
   * 800 ms de distancia. Con el debounce puro anterior, cada evento cancelaba el
   * temporizador del anterior y la pantalla NO SE REFRESCABA NUNCA, mientras el
   * indicador seguía diciendo "En vivo".
   *
   * Con el tope, la ráfaga se corta sola: pase lo que pase, hay refresco antes
   * de `MAX_ESPERA_MS` contados desde el primer evento.
   */
  it("bajo ráfaga SOSTENIDA refresca igual, al llegar al tope", () => {
    const { ejecutar, programador, avanzar } = crearBanco();

    // Eventos cada 500 ms (< 800 ms) durante 10 segundos: el debounce puro
    // nunca habría disparado en toda esa ventana.
    const PASO = 500;
    for (let transcurrido = 0; transcurrido < 10_000; transcurrido += PASO) {
      programador.programar();
      avanzar(PASO);
    }

    expect(ejecutar).toHaveBeenCalled();
    // 10 s con techo de 4 s: al menos dos refrescos completos.
    expect(ejecutar.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * CONTRAPRUEBA — demuestra que la prueba de arriba SÍ es capaz de fallar.
   *
   * Reconstruye el comportamiento anterior (debounce puro = tope infinito) y
   * comprueba que, en efecto, no refresca NUNCA bajo la misma ráfaga. Sin este
   * caso, la prueba de la ráfaga podría estar pasando por vacuidad y nadie se
   * enteraría: un test verde que jamás se probó fallando no prueba nada.
   */
  it("contraprueba: sin tope (el comportamiento anterior) no refresca nunca", () => {
    let reloj = 0;
    const ejecutar = vi.fn();
    const debouncePuro = crearProgramadorRefresco(ejecutar, {
      ahora: () => reloj,
      maxEsperaMs: Number.POSITIVE_INFINITY,
    });

    for (let transcurrido = 0; transcurrido < 10_000; transcurrido += 500) {
      debouncePuro.programar();
      reloj += 500;
      vi.advanceTimersByTime(500);
    }

    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("el primer refresco de una ráfaga sostenida no se atrasa más que el tope", () => {
    const { ejecutar, programador, avanzar } = crearBanco();

    // Un evento cada 100 ms, sin pausa.
    for (let transcurrido = 0; transcurrido < MAX_ESPERA_MS; transcurrido += 100) {
      programador.programar();
      avanzar(100);
    }

    // En el instante MAX_ESPERA_MS el techo ya venció; el disparo sale en el
    // tick siguiente, no queda pendiente hasta que la ráfaga se calme.
    avanzar(1);
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it("tras disparar por tope, la ventana se reinicia y vuelve a agrupar", () => {
    const { ejecutar, programador, avanzar } = crearBanco();

    for (let transcurrido = 0; transcurrido <= MAX_ESPERA_MS; transcurrido += 100) {
      programador.programar();
      avanzar(100);
    }
    expect(ejecutar).toHaveBeenCalledTimes(1);

    // Ráfaga nueva: si el techo no se hubiera reiniciado, este evento suelto
    // dispararía de inmediato en vez de esperar la calma.
    ejecutar.mockClear();
    programador.programar();
    avanzar(DEBOUNCE_MS - 1);
    expect(ejecutar).not.toHaveBeenCalled();
    avanzar(1);
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it("eventos separados por más que la calma refrescan uno por uno", () => {
    const { ejecutar, programador, avanzar } = crearBanco();

    programador.programar();
    avanzar(DEBOUNCE_MS);
    programador.programar();
    avanzar(DEBOUNCE_MS);

    expect(ejecutar).toHaveBeenCalledTimes(2);
  });

  it("cancelar descarta el refresco pendiente (desmontaje del componente)", () => {
    const { ejecutar, programador, avanzar } = crearBanco();

    programador.programar();
    programador.cancelar();

    avanzar(MAX_ESPERA_MS * 2);
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("cancelar también cierra la ventana del tope, no solo el temporizador", () => {
    const { ejecutar, programador, avanzar } = crearBanco();

    // Ráfaga que casi alcanza el techo, y se cancela (el usuario navegó fuera).
    for (let transcurrido = 0; transcurrido < MAX_ESPERA_MS - 200; transcurrido += 100) {
      programador.programar();
      avanzar(100);
    }
    programador.cancelar();

    // Al volver, un evento suelto debe esperar la calma completa. Si la ventana
    // hubiera quedado abierta, el techo vencido lo dispararía de inmediato.
    programador.programar();
    avanzar(DEBOUNCE_MS - 1);
    expect(ejecutar).not.toHaveBeenCalled();
    avanzar(1);
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });
});
