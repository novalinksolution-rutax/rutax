/**
 * Pruebas del puerto OAuth de Mercado Libre — enfocadas en las decisiones de
 * resiliencia que NO requieren red ni base de datos real:
 *
 * 1. Construcción de la URL de autorización (pura).
 * 2. Clasificación de fallos de refresco: "transitorio / requiere
 *    re-vinculación / operativo" — el corazón de "distinguir lo que se
 *    resolvió solo de lo que requiere al seller" que exige la skill `flex-ml`
 *    y §7 del documento de arquitectura.
 * 3. Marcado de errores HTTP como reintentables según código de estado y
 *    `Retry-After` — la base de la resiliencia ante límites de tasa.
 *
 * Las funciones que sí tocan red/BD (`intercambiarCodigoPorTokens`,
 * `refrescarToken` end-to-end) se prueban en integración cuando exista un
 * entorno Supabase de pruebas — fuera del alcance de esta unidad aislada.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ErrorHttpMl } from "./cliente-http";
import { clasificarRazonFallo, iniciarAutorizacion } from "./puerto";

describe("iniciarAutorizacion — construcción de URL (pura, sin red)", () => {
  let clientIdOriginal: string | undefined;
  let clientSecretOriginal: string | undefined;

  beforeAll(() => {
    clientIdOriginal = process.env.ML_APP_CLIENT_ID;
    clientSecretOriginal = process.env.ML_APP_CLIENT_SECRET;
    process.env.ML_APP_CLIENT_ID = "APP-ID-DE-PRUEBA";
    process.env.ML_APP_CLIENT_SECRET = "no-se-usa-en-esta-prueba";
  });

  afterAll(() => {
    if (clientIdOriginal === undefined) delete process.env.ML_APP_CLIENT_ID;
    else process.env.ML_APP_CLIENT_ID = clientIdOriginal;

    if (clientSecretOriginal === undefined) delete process.env.ML_APP_CLIENT_SECRET;
    else process.env.ML_APP_CLIENT_SECRET = clientSecretOriginal;
  });

  it("construye la URL de autorización con los parámetros OAuth correctos", () => {
    const { urlAutorizacion } = iniciarAutorizacion({
      tenantId: "11111111-1111-1111-1111-111111111111",
      sellerId: "22222222-2222-2222-2222-222222222222",
      redirectUri: "https://app.ejemplo.cl/integraciones/ml/callback",
      state: "estado-anti-csrf-opaco",
    });

    const url = new URL(urlAutorizacion);

    // Consentimiento en el host de Chile (no en el host global de la API).
    expect(url.origin).toBe("https://auth.mercadolibre.cl");
    expect(url.pathname).toBe("/authorization");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("APP-ID-DE-PRUEBA");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.ejemplo.cl/integraciones/ml/callback",
    );
    expect(url.searchParams.get("state")).toBe("estado-anti-csrf-opaco");
  });

  it("nunca incluye client_secret en la URL de autorización", () => {
    const { urlAutorizacion } = iniciarAutorizacion({
      tenantId: "t",
      sellerId: "s",
      redirectUri: "https://app.ejemplo.cl/cb",
      state: "x",
    });

    expect(urlAutorizacion).not.toContain("no-se-usa-en-esta-prueba");
    expect(urlAutorizacion.toLowerCase()).not.toContain("secret");
  });
});

describe("clasificarRazonFallo — distingue transitorio de definitivo (skill flex-ml)", () => {
  it("invalid_grant (400) ⇒ refresh_token inválido/revocado: requiere re-vinculación", () => {
    const error = new ErrorHttpMl("rechazado", 400, { error: "invalid_grant", message: "..." });
    expect(clasificarRazonFallo(error)).toBe("refresh_token_invalido_o_revocado");
  });

  it("400 con otro código de error NO se clasifica como invalid_grant", () => {
    const error = new ErrorHttpMl("rechazado", 400, { error: "invalid_request" });
    expect(clasificarRazonFallo(error)).not.toBe("refresh_token_invalido_o_revocado");
  });

  it("429 ⇒ límite de tasa (transitorio, no culpa del seller)", () => {
    const error = new ErrorHttpMl("demasiadas peticiones", 429, null);
    expect(clasificarRazonFallo(error)).toBe("limite_de_tasa");
  });

  it("5xx ⇒ error transitorio del proveedor (no culpa del seller)", () => {
    expect(clasificarRazonFallo(new ErrorHttpMl("falla", 500, null))).toBe("error_transitorio_proveedor");
    expect(clasificarRazonFallo(new ErrorHttpMl("falla", 503, null))).toBe("error_transitorio_proveedor");
  });

  it("401/403 ⇒ credenciales de la app inválidas (operativo, no del seller)", () => {
    expect(clasificarRazonFallo(new ErrorHttpMl("no autorizado", 401, null))).toBe(
      "credenciales_app_invalidas",
    );
    expect(clasificarRazonFallo(new ErrorHttpMl("prohibido", 403, null))).toBe(
      "credenciales_app_invalidas",
    );
  });

  it("códigos no contemplados caen en 'desconocido' (no se asume sin evidencia)", () => {
    expect(clasificarRazonFallo(new ErrorHttpMl("rareza", 418, null))).toBe("desconocido");
  });
});

describe("ErrorHttpMl — marca de reintentabilidad para el backoff compartido", () => {
  it("marca 429 y 5xx como reintentables; conserva retryAfterMs si el proveedor lo informó", () => {
    const limiteDeTasa = new ErrorHttpMl("429", 429, null, 5_000);
    expect(limiteDeTasa.reintentable).toBe(true);
    expect(limiteDeTasa.retryAfterMs).toBe(5_000);

    const errorServidor = new ErrorHttpMl("500", 500, null);
    expect(errorServidor.reintentable).toBe(true);
    expect(errorServidor.retryAfterMs).toBeUndefined();
  });

  it("NO marca 4xx definitivos (400/401/403/404) como reintentables", () => {
    for (const status of [400, 401, 403, 404]) {
      const error = new ErrorHttpMl(`status ${status}`, status, null);
      expect(error.reintentable).toBeUndefined();
    }
  });
});
