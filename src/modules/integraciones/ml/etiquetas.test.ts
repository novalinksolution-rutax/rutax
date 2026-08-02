/**
 * Pruebas de `obtenerEtiquetaEnvio` / `obtenerAccessTokenValido` (RF-021).
 *
 * Casos cubiertos (skill flex-ml: backoff, idempotencia, salud de conexión):
 * 1. Token vigente → llama directo a `shipment_labels`, sin refrescar.
 * 2. Token vencido (o por vencer) → refresca primero, luego pide la etiqueta
 *    con el token nuevo.
 * 3. `requiere_revinculacion` → lanza `ErrorConexionMlRequiereRevinculacion`
 *    SIN llamar a `shipment_labels`.
 * 4. Error HTTP de ML al pedir la etiqueta (4xx no reintentable) → se propaga
 *    como `ErrorHttpMl`.
 *
 * Mocks: Supabase service-role (lectura/escritura de `conexiones_seller_ml`),
 * `cifrarSecreto`/`descifrarSecreto` (sin cifrado real), Inngest (no se
 * disparan eventos reales) y `global.fetch` (sin red real).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/lib/inngest/cliente", () => ({
  inngest: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../secretos", () => ({
  cifrarSecreto: vi.fn(),
  descifrarSecreto: vi.fn(),
}));

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { cifrarSecreto, descifrarSecreto } from "../secretos";
import { ErrorHttpMl } from "./cliente-http";
import {
  ErrorConexionMlRequiereRevinculacion,
  obtenerAccessTokenValido,
  obtenerEtiquetaEnvio,
} from "./puerto";

const SELLER_ID = "22222222-2222-2222-2222-222222222222";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const CONEXION_ID = "33333333-3333-3333-3333-333333333333";

interface FilaConexion {
  id: string;
  tenant_id: string;
  seller_id: string;
  ml_user_id: string | null;
  access_token_ref: string | null;
  refresh_token_ref: string | null;
  token_expira_en: string | null;
  estado_salud: string;
  ultima_sync_exitosa_en: string | null;
  desconectada_desde: string | null;
  ultimo_error: string | null;
}

function filaBase(overrides: Partial<FilaConexion> = {}): FilaConexion {
  return {
    id: CONEXION_ID,
    tenant_id: TENANT_ID,
    seller_id: SELLER_ID,
    ml_user_id: "999",
    access_token_ref: "ref-access-vigente",
    refresh_token_ref: "ref-refresh-vigente",
    token_expira_en: new Date(Date.now() + 60 * 60_000).toISOString(), // +1h
    estado_salud: "sana",
    ultima_sync_exitosa_en: new Date().toISOString(),
    desconectada_desde: null,
    ultimo_error: null,
    ...overrides,
  };
}

/**
 * Mock mínimo del cliente Supabase: cada llamada terminal
 * (`.maybeSingle()`, `.single()`, o el `await` de la cadena cuando NO termina
 * en single — p. ej. `leerFilaConexionRepresentativaPorSeller`, que espera un
 * array) devuelve el siguiente valor de `respuestas` (en orden de invocación).
 *
 * Para el caso "array": la respuesta debe traer `data` como arreglo (la fila o
 * filas de la conexión). El builder es `thenable`, así que `await builder`
 * resuelve al siguiente valor sin llamar `.single()`.
 */
function crearMockSupabase(respuestas: Array<{ data: unknown; error: unknown }>) {
  let indice = 0;
  const siguiente = () => respuestas[Math.min(indice++, respuestas.length - 1)];

  const builder: Record<string, unknown> = {
    schema: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => Promise.resolve(siguiente())),
    single: vi.fn(() => Promise.resolve(siguiente())),
    // Thenable: `await builder` (cadena que NO termina en single) resuelve aquí.
    then: (resolver: (v: unknown) => unknown) => resolver(siguiente()),
  };

  return builder;
}

describe("obtenerAccessTokenValido / obtenerEtiquetaEnvio (RF-021)", () => {
  const fetchOriginal = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ML_APP_CLIENT_ID = "APP-ID-DE-PRUEBA";
    process.env.ML_APP_CLIENT_SECRET = "secret-de-prueba";
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
    delete process.env.ML_APP_CLIENT_ID;
    delete process.env.ML_APP_CLIENT_SECRET;
  });

  it("caso feliz: token vigente → llama directo a shipment_labels sin refrescar", async () => {
    const mockSupabase = crearMockSupabase([
      { data: filaBase(), error: null }, // leerFilaConexionPorSeller
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);
    vi.mocked(descifrarSecreto).mockResolvedValue({
      valor: "access-token-vigente",
      tipoSecreto: "token_oauth_ml_access",
      venceEn: null,
      metadata: {},
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new ArrayBuffer(8), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const resultado = await obtenerEtiquetaEnvio({
      sellerId: SELLER_ID,
      mlShipmentId: "555",
      mlUserId: "999",
    });

    expect(resultado.contentType).toBe("application/pdf");
    expect(resultado.contenido.byteLength).toBe(8);

    // Una sola llamada HTTP — a shipment_labels, no a /oauth/token.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/shipment_labels?");
    expect(url).toContain("shipment_ids=555");
    expect(url).toContain("response_type=pdf");
    expect((opciones.headers as Record<string, string>).authorization).toBe(
      "Bearer access-token-vigente",
    );
  });

  it("token vencido: refresca primero (vía /oauth/token) y luego pide la etiqueta con el token nuevo", async () => {
    const filaVencida = filaBase({
      token_expira_en: new Date(Date.now() - 60_000).toISOString(), // ya venció
    });
    const filaRefrescada = filaBase({
      access_token_ref: "ref-access-nuevo",
      refresh_token_ref: "ref-refresh-nuevo",
      token_expira_en: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
    });

    const mockSupabase = crearMockSupabase([
      { data: filaVencida, error: null }, // leerFilaConexionPorSeller (obtenerAccessTokenValido)
      { data: filaVencida, error: null }, // leerFilaConexionPorId (refrescarToken)
      { data: filaRefrescada, error: null }, // upsert tras refrescar (persistirTokens...)
      { data: filaRefrescada, error: null }, // leerFilaConexionPorId (releer tras refrescar)
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    vi.mocked(descifrarSecreto).mockImplementation(async (ref) => {
      if (ref === "ref-refresh-vigente") {
        return {
          valor: "refresh-token-vigente",
          tipoSecreto: "token_oauth_ml_refresh",
          venceEn: null,
          metadata: {},
        };
      }
      return {
        valor: "access-token-nuevo",
        tipoSecreto: "token_oauth_ml_access",
        venceEn: null,
        metadata: {},
      };
    });
    vi.mocked(cifrarSecreto).mockResolvedValue({
      referenciaExternaId: "ref-access-nuevo" as never,
    });

    const fetchMock = vi.fn();
    // 1) POST /oauth/token (refresco)
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "access-token-nuevo",
          token_type: "bearer",
          expires_in: 21600,
          user_id: 999,
          refresh_token: "refresh-token-nuevo",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    // 2) GET /shipment_labels
    fetchMock.mockResolvedValueOnce(
      new Response(new ArrayBuffer(16), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const resultado = await obtenerEtiquetaEnvio({
      sellerId: SELLER_ID,
      mlShipmentId: "777",
      mlUserId: "999",
    });

    expect(resultado.contenido.byteLength).toBe(16);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [primeraUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(primeraUrl).toContain("/oauth/token");

    const [segundaUrl, segundasOpciones] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(segundaUrl).toContain("/shipment_labels?");
    expect((segundasOpciones.headers as Record<string, string>).authorization).toBe(
      "Bearer access-token-nuevo",
    );
  });

  it("requiere_revinculacion: lanza ErrorConexionMlRequiereRevinculacion sin pedir la etiqueta", async () => {
    const filaVencida = filaBase({
      token_expira_en: new Date(Date.now() - 60_000).toISOString(),
    });
    const filaDesvinculada = filaBase({
      estado_salud: "desvinculada",
      desconectada_desde: new Date().toISOString(),
      ultimo_error: "Mercado Libre rechazó el refresh_token",
    });

    const mockSupabase = crearMockSupabase([
      { data: filaVencida, error: null }, // leerFilaConexionPorSeller
      { data: filaVencida, error: null }, // leerFilaConexionPorId (refrescarToken)
      { data: filaDesvinculada, error: null }, // update a 'desvinculada'
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    vi.mocked(descifrarSecreto).mockResolvedValue({
      valor: "refresh-token-vigente",
      tipoSecreto: "token_oauth_ml_refresh",
      venceEn: null,
      metadata: {},
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant", message: "..." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      obtenerEtiquetaEnvio({ sellerId: SELLER_ID, mlShipmentId: "888", mlUserId: "999" }),
    ).rejects.toBeInstanceOf(ErrorConexionMlRequiereRevinculacion);

    // Solo la llamada de refresco — nunca llegó a pedir shipment_labels.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain("/oauth/token");
  });

  it("error HTTP de ML al pedir la etiqueta se propaga como ErrorHttpMl", async () => {
    const mockSupabase = crearMockSupabase([{ data: filaBase(), error: null }]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);
    vi.mocked(descifrarSecreto).mockResolvedValue({
      valor: "access-token-vigente",
      tipoSecreto: "token_oauth_ml_access",
      venceEn: null,
      metadata: {},
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Shipment not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const error = await obtenerEtiquetaEnvio({
      sellerId: SELLER_ID,
      mlShipmentId: "999",
      mlUserId: "999",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ErrorHttpMl);
    expect((error as ErrorHttpMl).status).toBe(404);
    expect((error as ErrorHttpMl).reintentable).toBeUndefined();
  });

  it("obtenerAccessTokenValido lanza error claro si no existe conexión para el seller", async () => {
    const mockSupabase = crearMockSupabase([{ data: [], error: null }]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    await expect(obtenerAccessTokenValido("seller-sin-conexion")).rejects.toThrow(
      /No existe conexión ML/,
    );
  });

  it("sin mlUserId (pedido legacy / seller de una sola cuenta): cae a la conexión representativa más saludable", async () => {
    // Dos conexiones del mismo seller: una desvinculada y una sana. Sin
    // mlUserId, el puerto debe elegir la SANA (prioridad de salud) — el path
    // representativo NO debe errar con 2+ filas (modelo 1:N).
    const desvinculada = filaBase({
      id: "conexion-desvinculada",
      ml_user_id: "111",
      estado_salud: "desvinculada",
    });
    const sana = filaBase({ id: "conexion-sana", ml_user_id: "222", estado_salud: "sana" });

    const mockSupabase = crearMockSupabase([
      { data: [desvinculada, sana], error: null }, // leerFilaConexionRepresentativaPorSeller (array)
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);
    vi.mocked(descifrarSecreto).mockResolvedValue({
      valor: "access-token-vigente",
      tipoSecreto: "token_oauth_ml_access",
      venceEn: null,
      metadata: {},
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new ArrayBuffer(8), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    // No lanza (elige la conexión sana) y descarga la etiqueta.
    const resultado = await obtenerEtiquetaEnvio({ sellerId: SELLER_ID, mlShipmentId: "555" });
    expect(resultado.contentType).toBe("application/pdf");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
