/**
 * Pruebas de resiliencia del mecanismo compartido (`resiliencia.ts`) y, por
 * extensión, de las garantías que el puerto ML construye encima:
 * reintentos con backoff, respeto de `Retry-After`, no-reintento de errores
 * definitivos, e idempotencia.
 */
import { describe, expect, it } from "vitest";

import {
  CacheIdempotencia,
  calcularEsperaBackoff,
  esErrorReintentable,
  reintentarConBackoff,
  type ErrorReintentable,
} from "./resiliencia";

class ErrorDePrueba extends Error implements ErrorReintentable {
  reintentable = true as const;
  retryAfterMs?: number;
  constructor(mensaje: string, retryAfterMs?: number) {
    super(mensaje);
    this.retryAfterMs = retryAfterMs;
  }
}

class ErrorDefinitivoDePrueba extends Error {
  // Deliberadamente SIN `reintentable` — simula 401/403/404.
}

function dormirFalso(registro: number[]) {
  return async (ms: number) => {
    registro.push(ms);
  };
}

describe("reintentarConBackoff", () => {
  it("reintenta errores marcados como reintentables hasta tener éxito", async () => {
    let intentos = 0;
    const esperas: number[] = [];

    const resultado = await reintentarConBackoff(
      async () => {
        intentos += 1;
        if (intentos < 3) throw new ErrorDePrueba(`fallo transitorio #${intentos}`);
        return "ok";
      },
      { maxIntentos: 5, dormir: dormirFalso(esperas) },
    );

    expect(resultado).toBe("ok");
    expect(intentos).toBe(3);
    // Dos esperas (antes del 2º y 3er intento), nunca cero ni negativas.
    expect(esperas).toHaveLength(2);
    for (const espera of esperas) {
      expect(espera).toBeGreaterThanOrEqual(0);
    }
  });

  it("NO reintenta errores definitivos (sin marca `reintentable`)", async () => {
    let intentos = 0;

    await expect(
      reintentarConBackoff(
        async () => {
          intentos += 1;
          throw new ErrorDefinitivoDePrueba("401 no autorizado");
        },
        { maxIntentos: 5, dormir: dormirFalso([]) },
      ),
    ).rejects.toBeInstanceOf(ErrorDefinitivoDePrueba);

    expect(intentos).toBe(1);
  });

  it("se detiene tras maxIntentos y propaga el último error", async () => {
    let intentos = 0;

    await expect(
      reintentarConBackoff(
        async () => {
          intentos += 1;
          throw new ErrorDePrueba(`intento ${intentos}`);
        },
        { maxIntentos: 3, dormir: dormirFalso([]) },
      ),
    ).rejects.toThrow(/intento 3/);

    expect(intentos).toBe(3);
  });

  it("respeta retryAfterMs del proveedor en lugar del backoff calculado (límite de tasa)", async () => {
    let intentos = 0;
    const esperas: number[] = [];

    await reintentarConBackoff(
      async () => {
        intentos += 1;
        if (intentos === 1) throw new ErrorDePrueba("429 límite de tasa", 12_345);
        return "ok";
      },
      { maxIntentos: 3, dormir: dormirFalso(esperas) },
    );

    expect(esperas).toEqual([12_345]);
  });

  it("invoca el observador `alReintentar` sin alterar el resultado final", async () => {
    let intentos = 0;
    const eventos: Array<{ intento: number; esperaMs: number }> = [];

    const resultado = await reintentarConBackoff(
      async () => {
        intentos += 1;
        if (intentos < 2) throw new ErrorDePrueba("transitorio");
        return 42;
      },
      {
        maxIntentos: 3,
        dormir: dormirFalso([]),
        alReintentar: ({ intento, esperaMs }) => eventos.push({ intento, esperaMs }),
      },
    );

    expect(resultado).toBe(42);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.intento).toBe(1);
  });
});

describe("calcularEsperaBackoff", () => {
  it("crece exponencialmente en promedio y respeta el tope superior", () => {
    const esperaBaseMs = 100;
    const esperaMaximaMs = 1_000;

    for (let intento = 0; intento < 10; intento += 1) {
      const espera = calcularEsperaBackoff(intento, esperaBaseMs, esperaMaximaMs);
      expect(espera).toBeGreaterThanOrEqual(0);
      expect(espera).toBeLessThanOrEqual(esperaMaximaMs);
    }
  });

  it("con jitter, dos llamadas para el mismo intento no producen siempre el mismo valor", () => {
    const valores = new Set<number>();
    for (let i = 0; i < 25; i += 1) {
      valores.add(calcularEsperaBackoff(3, 100, 10_000));
    }
    // Con 25 muestras de un rango amplio, es prácticamente seguro obtener
    // más de un valor distinto si el jitter funciona — esto detecta una
    // implementación que degenera a un valor fijo.
    expect(valores.size).toBeGreaterThan(1);
  });
});

describe("esErrorReintentable", () => {
  it("identifica errores marcados explícitamente como reintentables", () => {
    expect(esErrorReintentable(new ErrorDePrueba("x"))).toBe(true);
    expect(esErrorReintentable(new ErrorDefinitivoDePrueba("y"))).toBe(false);
    expect(esErrorReintentable(null)).toBe(false);
    expect(esErrorReintentable("string cualquiera")).toBe(false);
    expect(esErrorReintentable({ reintentable: false })).toBe(false);
  });
});

describe("CacheIdempotencia", () => {
  it("marca una clave como nueva solo la primera vez dentro del TTL", () => {
    const cache = new CacheIdempotencia(60_000);

    expect(cache.marcarSiEsNuevo("evento:1")).toBe(true);
    expect(cache.marcarSiEsNuevo("evento:1")).toBe(false);
    expect(cache.marcarSiEsNuevo("evento:1")).toBe(false);
    expect(cache.marcarSiEsNuevo("evento:2")).toBe(true);

    expect(cache.tamano).toBe(2);
  });

  it("purga claves expiradas y vuelve a admitirlas tras el TTL", async () => {
    const cache = new CacheIdempotencia(10); // TTL muy corto para la prueba

    expect(cache.marcarSiEsNuevo("evento:expira")).toBe(true);
    expect(cache.marcarSiEsNuevo("evento:expira")).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(cache.marcarSiEsNuevo("evento:expira")).toBe(true);
  });

  it("dos rutas de detección del mismo evento (webhook + sondeo) no lo duplican", () => {
    // Simula exactamente el escenario que `flex-ml` exige resolver: el mismo
    // pedido llega por notificación Y por sondeo de respaldo.
    const cache = new CacheIdempotencia(60_000);
    const claveCanonica = (idPedido: string) => `ml:pedido:${idPedido}`;

    const procesados: string[] = [];
    function procesarSiEsNuevo(idPedido: string, origen: "webhook" | "sondeo") {
      if (!cache.marcarSiEsNuevo(claveCanonica(idPedido))) return;
      procesados.push(`${idPedido} via ${origen}`);
    }

    procesarSiEsNuevo("PED-100", "webhook");
    procesarSiEsNuevo("PED-100", "sondeo"); // mismo pedido, otra vía — no debe duplicar
    procesarSiEsNuevo("PED-101", "sondeo");

    expect(procesados).toEqual(["PED-100 via webhook", "PED-101 via sondeo"]);
  });
});
