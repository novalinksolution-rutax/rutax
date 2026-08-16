/**
 * Cliente HTTP de Falabella Seller Center.
 *
 * Estas pruebas existen por lo que este proveedor tiene de distinto y de
 * peligroso: **no hay sandbox** (cada llamada golpea producción del seller), el
 * error puede llegar con HTTP 200, la firma caduca entre reintentos, y la clave
 * de firma es un secreto que no puede filtrarse ni a una URL ni a un objeto de
 * error. Las cuatro cosas fallan en silencio si nadie las mira.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  peticionFalabella,
  construirUserAgent,
  esCredencialInvalida,
  ErrorHttpFalabella,
  ErrorRespuestaFalabella,
  FALABELLA_API_URL,
  CODIGO_ERROR_FALABELLA,
} from "./cliente-http";
import { ErrorRedIntegracion } from "../resiliencia";

const SIN_REINTENTOS = { maxIntentos: 1 };
const SIN_DORMIR = { dormir: async () => {} };

const API_KEY = "clave-de-firma-secretisima";

const BASE = {
  action: "GetOrders",
  userId: "operaciones@courier.cl",
  apiKey: API_KEY,
  sellerId: "JJJ123",
} as const;

function respuesta(
  cuerpo: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function sobreExito(body: unknown, head: Record<string, unknown> = {}) {
  return {
    SuccessResponse: {
      Head: { RequestAction: "GetOrders", ResponseType: "Orders", ...head },
      Body: body,
    },
  };
}

function sobreError(codigo: number, mensaje: string, tipo = "Sender") {
  return {
    ErrorResponse: {
      Head: {
        RequestAction: "GetOrders",
        ErrorType: tipo,
        // La doc muestra el código como entero en XML; en JSON «todos los
        // valores deben tratarse como strings». Se prueban las dos formas.
        ErrorCode: String(codigo),
        ErrorMessage: mensaje,
      },
      Body: {},
    },
  };
}

/**
 * Espera el rechazo y devuelve el error ya tipado. Si la petición resolviera,
 * la prueba falla aquí — un `.catch` a secas devolvería la unión con el valor
 * resuelto y dejaría pasar un éxito disfrazado.
 */
async function capturarFallo<E>(promesa: Promise<unknown>): Promise<E> {
  try {
    await promesa;
  } catch (error) {
    return error as E;
  }
  throw new Error("Se esperaba que la petición fallara, y resolvió.");
}

function urlDe(fetchFalso: ReturnType<typeof vi.fn>, llamada = 0): URL {
  return new URL(fetchFalso.mock.calls[llamada][0] as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("construirUserAgent", () => {
  it("arma el formato exigido por la doc, con FACL para Chile", () => {
    expect(construirUserAgent({ sellerId: "JJJ123", versionNode: "22.11.0" })).toBe(
      "JJJ123/Node/22.11.0/RUTAX/FACL",
    );
  });

  it("sanea el sellerId: no deja que un dato del seller rompa el header", () => {
    // Un `/` desplazaría los campos del formato; un `\n` inyectaría un header.
    expect(construirUserAgent({ sellerId: "A/B\nX-Evil: 1", versionNode: "22" })).toBe(
      "ABX-Evil1/Node/22/RUTAX/FACL",
    );
  });

  it("permite otra unidad de negocio sin tocar el resto", () => {
    expect(
      construirUserAgent({
        sellerId: "S1",
        unidadNegocio: "FAPE",
        versionNode: "22",
      }),
    ).toBe("S1/Node/22/RUTAX/FAPE");
  });
});

describe("construcción de la solicitud", () => {
  it("firma la query string con los parámetros comunes obligatorios", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta(sobreExito({ Orders: [] })));
    vi.stubGlobal("fetch", fetchFalso);

    await peticionFalabella({
      ...BASE,
      parametros: { Limit: 100, Offset: 0, Status: "pending" },
      ahora: () => new Date(Date.UTC(2026, 7, 16, 12, 0, 0)),
      opcionesReintento: SIN_REINTENTOS,
    });

    const url = urlDe(fetchFalso);
    expect(`${url.origin}${url.pathname}`).toBe(FALABELLA_API_URL);
    expect(url.searchParams.get("Action")).toBe("GetOrders");
    expect(url.searchParams.get("Version")).toBe("1.0");
    expect(url.searchParams.get("Format")).toBe("JSON");
    expect(url.searchParams.get("UserID")).toBe("operaciones@courier.cl");
    expect(url.searchParams.get("Timestamp")).toBe("2026-08-16T12:00:00+00:00");
    expect(url.searchParams.get("Limit")).toBe("100");
    expect(url.searchParams.get("Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("la API Key NO aparece en la URL, ni en los headers, ni en el cuerpo", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta(sobreExito({})));
    vi.stubGlobal("fetch", fetchFalso);

    await peticionFalabella({
      ...BASE,
      metodo: "POST",
      cuerpo: { contenido: "<Request/>", contentType: "application/xml" },
      opcionesReintento: SIN_REINTENTOS,
    });

    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(API_KEY);
    expect(JSON.stringify(init.headers)).not.toContain(API_KEY);
    expect(String(init.body)).not.toContain(API_KEY);
  });

  it("manda el User-Agent obligatorio en cada llamada", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta(sobreExito({})));
    vi.stubGlobal("fetch", fetchFalso);

    await peticionFalabella({ ...BASE, opcionesReintento: SIN_REINTENTOS });

    const init = fetchFalso.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["user-agent"]).toMatch(
      /^JJJ123\/Node\/.+\/RUTAX\/FACL$/,
    );
  });

  it("una acción de escritura manda el cuerpo aparte, sin firmarlo", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta(sobreExito({})));
    vi.stubGlobal("fetch", fetchFalso);

    await peticionFalabella({
      ...BASE,
      action: "SetStatusToPackedByMarketplace",
      metodo: "POST",
      parametros: { OrderItemIds: "[240300]", DeliveryType: "dropship" },
      cuerpo: {
        contenido: "<Request><X/></Request>",
        contentType: "application/xml",
      },
      opcionesReintento: SIN_REINTENTOS,
    });

    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe("<Request><X/></Request>");
    // Los comunes y los propios de la acción siguen en la query firmada.
    expect(new URL(url).searchParams.get("OrderItemIds")).toBe("[240300]");
    expect(new URL(url).searchParams.get("Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("por defecto es GET y no manda cuerpo", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta(sobreExito({})));
    vi.stubGlobal("fetch", fetchFalso);

    await peticionFalabella({ ...BASE, opcionesReintento: SIN_REINTENTOS });

    const init = fetchFalso.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });
});

describe("respuesta exitosa", () => {
  it("devuelve head y body por separado: el TotalCount vive en el head", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          respuesta(sobreExito({ Orders: [{ OrderId: "1104089001" }] }, { TotalCount: "2" })),
        ),
    );

    const r = await peticionFalabella<{ Orders: { OrderId: string }[] }>({
      ...BASE,
      opcionesReintento: SIN_REINTENTOS,
    });

    // Sin el TotalCount la ingesta no sabe que falta una página y trunca sin avisar.
    expect(r.head.TotalCount).toBe("2");
    expect(r.body.Orders[0].OrderId).toBe("1104089001");
  });

  it("un 200 sin sobre reconocible NO pasa por bueno", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta({ Otra: { cosa: 1 } })));

    await expect(
      peticionFalabella({ ...BASE, opcionesReintento: SIN_REINTENTOS }),
    ).rejects.toBeInstanceOf(ErrorHttpFalabella);
  });

  it("al reportar un sobre desconocido lista las CLAVES, nunca los valores", async () => {
    // El body de GetOrders trae nombre y dirección del destinatario: volcarlo a
    // un mensaje de error lo mandaría al log de un job.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respuesta({ Inesperado: { CustomerFirstName: "TestNombre" } })),
    );

    const error = await capturarFallo<Error>(
      peticionFalabella({ ...BASE, opcionesReintento: SIN_REINTENTOS }),
    );

    expect(error.message).toContain("Inesperado");
    expect(error.message).not.toContain("TestNombre");
  });
});

describe("[TRAMPA] el error puede venir con HTTP 200", () => {
  it("un 200 con ErrorResponse es un FALLO, no un éxito con body vacío", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(respuesta(sobreError(7, "E007: Login failed. Signature mismatching"))),
    );

    const error = await capturarFallo<ErrorRespuestaFalabella>(
      peticionFalabella({ ...BASE, opcionesReintento: SIN_REINTENTOS }),
    );

    expect(error).toBeInstanceOf(ErrorRespuestaFalabella);
    expect(error.status).toBe(200);
    expect(error.codigo).toBe(CODIGO_ERROR_FALABELLA.FIRMA_INVALIDA);
  });

  it("una firma inválida NO se reintenta: reintentar una firma mala solo quema cuota", async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(respuesta(sobreError(7, "E007: Login failed. Signature mismatching")));
    vi.stubGlobal("fetch", fetchFalso);

    const error = await capturarFallo<ErrorRespuestaFalabella>(
      peticionFalabella({
        ...BASE,
        opcionesReintento: { maxIntentos: 3, ...SIN_DORMIR },
      }),
    );

    expect(error.reintentable).toBeUndefined();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("E429 sí es reintentable aunque llegue con 200", async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(respuesta(sobreError(429, "E429: Too many requests")))
      .mockResolvedValueOnce(respuesta(sobreExito({ Orders: [] })));
    vi.stubGlobal("fetch", fetchFalso);

    const r = await peticionFalabella<{ Orders: unknown[] }>({
      ...BASE,
      opcionesReintento: { maxIntentos: 2, ...SIN_DORMIR },
    });

    expect(r.body.Orders).toEqual([]);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("un error de tipo Platform es reintentable aunque su código no esté en la lista", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respuesta(sobreError(1234, "Falla nuestra", "Platform"))),
    );

    const error = await capturarFallo<ErrorRespuestaFalabella>(
      peticionFalabella({ ...BASE, opcionesReintento: SIN_REINTENTOS }),
    );

    expect(error.reintentable).toBe(true);
  });

  it("E003 (Timestamp expirado) NO se reintenta: es reloj desfasado, no suerte", async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(respuesta(sobreError(3, "E003: Timestamp has expired")));
    vi.stubGlobal("fetch", fetchFalso);

    const error = await capturarFallo<ErrorRespuestaFalabella>(
      peticionFalabella({
        ...BASE,
        opcionesReintento: { maxIntentos: 3, ...SIN_DORMIR },
      }),
    );

    expect(error.reintentable).toBeUndefined();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("interpreta el ErrorCode venga como número o como string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        respuesta({
          ErrorResponse: {
            Head: {
              ErrorType: "Sender",
              ErrorCode: 9,
              ErrorMessage: "E009: Access Denied",
            },
          },
        }),
      ),
    );

    const error = await capturarFallo<ErrorRespuestaFalabella>(
      peticionFalabella({ ...BASE, opcionesReintento: SIN_REINTENTOS }),
    );

    expect(error.codigo).toBe(CODIGO_ERROR_FALABELLA.ACCESO_DENEGADO);
  });
});

describe("transporte", () => {
  it("un 401 es definitivo y no se reintenta", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta("no autorizado", { status: 401 }));
    vi.stubGlobal("fetch", fetchFalso);

    const error = await capturarFallo<ErrorHttpFalabella>(
      peticionFalabella({
        ...BASE,
        opcionesReintento: { maxIntentos: 3, ...SIN_DORMIR },
      }),
    );

    expect(error).toBeInstanceOf(ErrorHttpFalabella);
    expect(error.reintentable).toBeUndefined();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("un 429 respeta el Retry-After del proveedor en vez de adivinar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respuesta("", { status: 429, headers: { "retry-after": "3" } })),
    );

    const error = await capturarFallo<ErrorHttpFalabella>(
      peticionFalabella({ ...BASE, opcionesReintento: SIN_REINTENTOS }),
    );

    expect(error.reintentable).toBe(true);
    expect(error.retryAfterMs).toBe(3000);
  });

  it("se levanta de un 502 transitorio y devuelve el resultado del reintento", async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(respuesta("<html>bad gateway</html>", { status: 502 }))
      .mockResolvedValueOnce(respuesta(sobreExito({ Orders: [] })));
    vi.stubGlobal("fetch", fetchFalso);

    const r = await peticionFalabella<{ Orders: unknown[] }>({
      ...BASE,
      opcionesReintento: { maxIntentos: 2, ...SIN_DORMIR },
    });

    expect(r.body.Orders).toEqual([]);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("un cuerpo no-JSON con un 5xx no rompe el parseo, se recorta", async () => {
    const html = `<html>${"x".repeat(5000)}</html>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(html, { status: 503 })));

    const error = await capturarFallo<ErrorHttpFalabella>(
      peticionFalabella({ ...BASE, opcionesReintento: SIN_REINTENTOS }),
    );

    expect(error.status).toBe(503);
    expect(String(error.cuerpo)).toHaveLength(500);
  });

  it("una caída de red se reintenta en vez de tumbar la ingesta", async () => {
    const fetchFalso = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(respuesta(sobreExito({ Orders: [] })));
    vi.stubGlobal("fetch", fetchFalso);

    const r = await peticionFalabella<{ Orders: unknown[] }>({
      ...BASE,
      opcionesReintento: { maxIntentos: 2, ...SIN_DORMIR },
    });

    expect(r.body.Orders).toEqual([]);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("si la red no vuelve, el error final dice qué acción falló y no filtra la firma", async () => {
    const fetchFalso = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchFalso);

    const error = await capturarFallo<ErrorRedIntegracion>(
      peticionFalabella({
        ...BASE,
        opcionesReintento: { maxIntentos: 2, ...SIN_DORMIR },
      }),
    );

    expect(error).toBeInstanceOf(ErrorRedIntegracion);
    expect(error.reintentable).toBe(true);
    expect(error.message).toContain("GetOrders");
    expect(error.message).not.toContain("Signature");
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });
});

describe("resiliencia propia de esta API", () => {
  it("re-firma en CADA intento: el Timestamp no se recicla entre reintentos", async () => {
    // Si se firmara una vez fuera del reintento, un backoff largo convertiría un
    // 429 transitorio en un E003 «Timestamp has expired» permanente.
    let segundo = 0;
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(respuesta("", { status: 503 }))
      .mockResolvedValueOnce(respuesta(sobreExito({})));
    vi.stubGlobal("fetch", fetchFalso);

    await peticionFalabella({
      ...BASE,
      ahora: () => new Date(Date.UTC(2026, 7, 16, 12, 0, (segundo += 30))),
      opcionesReintento: { maxIntentos: 2, ...SIN_DORMIR },
    });

    const primera = urlDe(fetchFalso, 0);
    const segunda = urlDe(fetchFalso, 1);
    expect(primera.searchParams.get("Timestamp")).toBe("2026-08-16T12:00:30+00:00");
    expect(segunda.searchParams.get("Timestamp")).toBe("2026-08-16T12:01:00+00:00");
    // Timestamp distinto ⇒ firma distinta. Si coincidieran, la firma sería vieja.
    expect(segunda.searchParams.get("Signature")).not.toBe(primera.searchParams.get("Signature"));
  });

  it("esCredencialInvalida distingue 'hay que re-vincular' de 'se resuelve solo'", async () => {
    const firmaMala = new ErrorRespuestaFalabella({
      mensaje: "x",
      status: 200,
      codigo: CODIGO_ERROR_FALABELLA.FIRMA_INVALIDA,
      tipo: "Sender",
      accion: "GetOrders",
    });
    const limiteTasa = new ErrorRespuestaFalabella({
      mensaje: "x",
      status: 200,
      codigo: CODIGO_ERROR_FALABELLA.DEMASIADAS_SOLICITUDES,
      tipo: "Sender",
      accion: "GetOrders",
    });

    expect(esCredencialInvalida(firmaMala)).toBe(true);
    expect(esCredencialInvalida(limiteTasa)).toBe(false);
    expect(esCredencialInvalida(new ErrorHttpFalabella("x", 403, null))).toBe(true);
    expect(esCredencialInvalida(new ErrorHttpFalabella("x", 500, null))).toBe(false);
    expect(esCredencialInvalida(new Error("otra cosa"))).toBe(false);
  });

  it("ningún error lleva la API Key encima, ni en el mensaje ni en sus campos", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(respuesta(sobreError(7, "E007: Login failed. Signature mismatching"))),
    );

    const error = await capturarFallo<Error>(
      peticionFalabella({ ...BASE, opcionesReintento: SIN_REINTENTOS }),
    );

    const volcado = `${error.message} ${error.stack ?? ""} ${JSON.stringify(
      Object.getOwnPropertyNames(error).map(
        (k) => (error as unknown as Record<string, unknown>)[k],
      ),
    )}`;
    expect(volcado).not.toContain(API_KEY);
    // El UserID sí puede figurar: no es secreto y es lo que identifica la conexión.
    expect(error.message).toContain(BASE.userId);
  });
});
