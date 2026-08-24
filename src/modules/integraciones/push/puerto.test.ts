import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { enviarPush, redactarAviso } from "./puerto";

/**
 * El puerto de push.
 *
 * Lo que importa acá no es que un mensaje salga: es **que nada de esto tumbe la
 * operación que lo llamó**. Un traspaso ya guardado no se puede deshacer porque
 * Expo esté caído, así que cada camino de fallo tiene su prueba.
 */
const TOKEN = "ExponentPushToken[abc123]";
const mensaje = (token = TOKEN) => ({
  token,
  titulo: "Hola",
  cuerpo: "Cuerpo",
  destino: "/(main)/manifiesto",
  motivo: "ruta_lista" as const,
});

const fetchFalso = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchFalso);
  fetchFalso.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const respuesta = (cuerpo: unknown, ok = true) => ({
  ok,
  json: () => Promise.resolve(cuerpo),
});

describe("enviarPush", () => {
  it("no llama a nadie si no hay mensajes", async () => {
    expect(await enviarPush([])).toEqual({ enviados: 0, fallidos: 0, tokensMuertos: [] });
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("cuenta los tickets buenos", async () => {
    fetchFalso.mockResolvedValue(respuesta({ data: [{ status: "ok" }, { status: "ok" }] }));
    const r = await enviarPush([mensaje("ExponentPushToken[a]"), mensaje("ExponentPushToken[b]")]);
    expect(r).toEqual({ enviados: 2, fallidos: 0, tokensMuertos: [] });
  });

  it("un 200 con `errors` es un FALLO, no un éxito", async () => {
    // Misma trampa del cliente de Shopify: el código HTTP no alcanza.
    fetchFalso.mockResolvedValue(respuesta({ errors: [{ message: "algo" }] }));
    const r = await enviarPush([mensaje()]);
    expect(r.enviados).toBe(0);
    expect(r.fallidos).toBe(1);
  });

  it("recoge los tokens que Expo declara muertos", async () => {
    // Sin esto, cada aviso siguiente gasta una llamada en un teléfono que ya no
    // tiene la app.
    fetchFalso.mockResolvedValue(
      respuesta({
        data: [
          { status: "ok" },
          { status: "error", details: { error: "DeviceNotRegistered" } },
        ],
      }),
    );
    const r = await enviarPush([mensaje("ExponentPushToken[a]"), mensaje("ExponentPushToken[b]")]);
    expect(r.tokensMuertos).toEqual(["ExponentPushToken[b]"]);
    expect(r.fallidos).toBe(1);
  });

  it("un error que NO es token muerto no borra nada", async () => {
    fetchFalso.mockResolvedValue(
      respuesta({ data: [{ status: "error", details: { error: "MessageTooBig" } }] }),
    );
    const r = await enviarPush([mensaje()]);
    expect(r.tokensMuertos).toEqual([]);
    expect(r.fallidos).toBe(1);
  });

  it("un fallo de red NO lanza: la operación que llamó tiene que seguir", async () => {
    fetchFalso.mockRejectedValue(new Error("sin red"));
    await expect(enviarPush([mensaje()])).resolves.toEqual({
      enviados: 0,
      fallidos: 1,
      tokensMuertos: [],
    });
  });

  it("un HTTP no-2xx tampoco lanza", async () => {
    fetchFalso.mockResolvedValue(respuesta({}, false));
    const r = await enviarPush([mensaje()]);
    expect(r.fallidos).toBe(1);
  });

  it("una respuesta con MENOS tickets que mensajes cuenta la diferencia como fallo", async () => {
    // Expo puede cortar la respuesta. Sin esto, dos avisos que no salieron se
    // reportarían como cero fallos.
    fetchFalso.mockResolvedValue(respuesta({ data: [{ status: "ok" }] }));
    const r = await enviarPush([mensaje("ExponentPushToken[a]"), mensaje("ExponentPushToken[b]")]);
    expect(r.enviados).toBe(1);
    expect(r.fallidos).toBe(1);
  });

  it("parte en tandas de 100", async () => {
    fetchFalso.mockResolvedValue(respuesta({ data: Array(100).fill({ status: "ok" }) }));
    await enviarPush(Array.from({ length: 150 }, (_, i) => mensaje(`ExponentPushToken[${i}]`)));
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });
});

describe("redactarAviso", () => {
  it("«tu ruta está lista» dice cuántas paradas", async () => {
    const r = redactarAviso("ruta_lista", { paradas: 24 });
    expect(r.cuerpo).toContain("24 paradas");
    expect(r.destino).toBe("/(main)/manifiesto");
  });

  it("el traspaso NOMBRA a quién", () => {
    // Sin el nombre, el conductor no sabe a quién buscar si lo que recibe no
    // calza con lo que tiene en la mano.
    const r = redactarAviso("traspaso_recibido", { deQuien: "R. Muñoz", bultos: 6 });
    expect(r.cuerpo).toContain("R. Muñoz");
    expect(r.cuerpo).toContain("6 bultos");
  });

  it("singular y plural, en los tres", () => {
    expect(redactarAviso("ruta_lista", { paradas: 1 }).cuerpo).toContain("1 parada para hoy");
    expect(redactarAviso("ruta_lista", { paradas: 24 }).cuerpo).toContain("24 paradas para hoy");
    expect(redactarAviso("traspaso_recibido", { bultos: 1 }).cuerpo).toContain("1 bulto.");
    expect(redactarAviso("traspaso_recibido", { bultos: 6 }).cuerpo).toContain("6 bultos.");
  });

  it("cada aviso lleva a su pantalla", () => {
    expect(redactarAviso("traspaso_recibido", {}).destino).toBe("/(main)/traspaso");
    expect(redactarAviso("retiro_nuevo", {}).destino).toBe("/(main)/retiro");
  });
});
