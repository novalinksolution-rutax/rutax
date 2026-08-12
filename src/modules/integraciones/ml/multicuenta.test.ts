/**
 * Pruebas del flip 1:1 → 1:N de conexiones ML (seller con hasta N cuentas).
 * =====================================================================
 * Cubre la lógica de `persistirTokensYActualizarConexion` a través de
 * `intercambiarCodigoPorTokens` (su único llamador público en el intercambio
 * inicial), que bajo el modelo 1:N ya NO usa `upsert(onConflict)` sino
 * SELECT-por-cuenta → UPDATE | INSERT explícito:
 *
 * 1. Cuenta NUEVA (no existe fila) → INSERT.
 * 2. Cuenta EXISTENTE (misma ml_user_id) → UPDATE por id, sin duplicar.
 * 3. INSERT rechazado por el trigger de tope (SQLSTATE 23514) →
 *    ErrorTopeCuentasMlAlcanzado.
 * 4. INSERT rechazado por unicidad parcial (SQLSTATE 23505) en carrera →
 *    se relee y se devuelve la fila ganadora (idempotente).
 *
 * Cubre además el `desenlace` que el puerto devuelve junto a la conexión
 * (`alta_nueva` | `conexion_existente_actualizada`): es lo único que distingue
 * "el seller agregó una cuenta" de "el seller volvió del OAuth con la MISMA
 * cuenta y solo se rotaron sus tokens". ML no ofrece forma de prevenir lo
 * segundo (el endpoint `/authorization` no admite `prompt`/`select_account`/
 * `approval_prompt`/`max_age`/`login_hint`, ni hay logout documentado), así que
 * la detección post-canje es la única vía — y sin ella la UI mentía.
 *
 * Mocks: Supabase service-role, cifrado, Inngest y fetch (sin red).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/lib/inngest/cliente", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../secretos", () => ({
  cifrarSecreto: vi.fn(),
  descifrarSecreto: vi.fn(),
}));

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { inngest } from "@/lib/inngest/cliente";
import { cifrarSecreto } from "../secretos";
import {
  intercambiarCodigoPorTokens,
  ErrorTopeCuentasMlAlcanzado,
  ErrorCuentaMlYaConectada,
} from "./puerto";

const SELLER_ID = "22222222-2222-2222-2222-222222222222";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

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

function fila(overrides: Partial<FilaConexion> = {}): FilaConexion {
  return {
    id: "conexion-1",
    tenant_id: TENANT_ID,
    seller_id: SELLER_ID,
    ml_user_id: "999",
    access_token_ref: "ref-access",
    refresh_token_ref: "ref-refresh",
    token_expira_en: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
    estado_salud: "sana",
    ultima_sync_exitosa_en: new Date().toISOString(),
    desconectada_desde: null,
    ultimo_error: null,
    ...overrides,
  };
}

/**
 * Mock del cliente supabase con handlers por operación terminal. Cada llamada
 * a `.maybeSingle()`/`.single()` consume el siguiente resultado de la cola
 * correspondiente (según si la cadena incluyó `.insert`/`.update` o solo
 * `.select`). Registra los INSERT/UPDATE emitidos para aserciones.
 */
function crearMock(opts: {
  selects: Array<{ data: unknown; error: unknown }>;
  inserts?: Array<{ data: unknown; error: unknown }>;
  updates?: Array<{ data: unknown; error: unknown }>;
}) {
  const selects = [...opts.selects];
  const inserts = [...(opts.inserts ?? [])];
  const updates = [...(opts.updates ?? [])];
  const insertsEmitidos: unknown[] = [];
  const updatesEmitidos: unknown[] = [];

  function nuevoBuilder() {
    let modo: "select" | "insert" | "update" = "select";
    const b: Record<string, unknown> = {
      schema: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      insert: vi.fn((payload: unknown) => {
        modo = "insert";
        insertsEmitidos.push(payload);
        return b;
      }),
      update: vi.fn((payload: unknown) => {
        modo = "update";
        updatesEmitidos.push(payload);
        return b;
      }),
      maybeSingle: vi.fn(() => Promise.resolve(consumir())),
      single: vi.fn(() => Promise.resolve(consumir())),
    };
    function consumir() {
      if (modo === "insert") return inserts.shift() ?? { data: null, error: null };
      if (modo === "update") return updates.shift() ?? { data: null, error: null };
      return selects.shift() ?? { data: null, error: null };
    }
    return b;
  }

  // Fábrica: cada `crearClienteServiceRole()` devuelve un builder FRESCO (con su
  // propio `modo`), igual que en producción. Las colas de resultados y los
  // registros de INSERT/UPDATE se comparten entre builders (cierre léxico).
  return { fabrica: () => nuevoBuilder(), insertsEmitidos, updatesEmitidos };
}

/** fetch que responde el token del intercambio inicial (grant authorization_code). */
function mockFetchToken(userId: number | string) {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: "access-nuevo",
        token_type: "bearer",
        expires_in: 21600,
        user_id: userId,
        refresh_token: "refresh-nuevo",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

describe("conexiones ML 1:N — persistir por cuenta (seller con hasta N cuentas)", () => {
  const fetchOriginal = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ML_APP_CLIENT_ID = "APP-ID";
    process.env.ML_APP_CLIENT_SECRET = "secret";
    vi.mocked(cifrarSecreto).mockResolvedValue({ referenciaExternaId: "ref-x" as never });
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
    delete process.env.ML_APP_CLIENT_ID;
    delete process.env.ML_APP_CLIENT_SECRET;
  });

  it("cuenta nueva (no existe fila) → INSERT de una fila nueva", async () => {
    const insertada = fila({ id: "conexion-nueva", ml_user_id: "777" });
    const { fabrica, insertsEmitidos, updatesEmitidos } = crearMock({
      selects: [{ data: null, error: null }], // leerFilaConexionPorSellerYCuenta → no existe
      inserts: [{ data: insertada, error: null }],
    });
    vi.mocked(crearClienteServiceRole).mockImplementation(() => fabrica() as never);
    global.fetch = mockFetchToken(777) as unknown as typeof fetch;

    const { conexion, desenlace } = await intercambiarCodigoPorTokens({
      tenantId: TENANT_ID,
      sellerId: SELLER_ID,
      codigo: "code-A",
      redirectUri: "https://app/cb",
    });

    expect(conexion.mlUserId).toBe("777");
    expect(desenlace).toBe("alta_nueva");
    expect(insertsEmitidos).toHaveLength(1);
    expect(updatesEmitidos).toHaveLength(0);
    // El INSERT lleva ml_user_id de la cuenta (no un token en claro).
    expect((insertsEmitidos[0] as Record<string, unknown>).ml_user_id).toBe("777");
    expect(JSON.stringify(insertsEmitidos[0])).not.toContain("access-nuevo");
  });

  it("cuenta existente (misma ml_user_id) → UPDATE por id, sin INSERT ni duplicado", async () => {
    const existente = fila({ id: "conexion-1", ml_user_id: "999" });
    const actualizada = fila({ id: "conexion-1", ml_user_id: "999" });
    const { fabrica, insertsEmitidos, updatesEmitidos } = crearMock({
      selects: [{ data: existente, error: null }], // ya existe
      updates: [{ data: actualizada, error: null }],
    });
    vi.mocked(crearClienteServiceRole).mockImplementation(() => fabrica() as never);
    global.fetch = mockFetchToken(999) as unknown as typeof fetch;

    const { conexion, desenlace } = await intercambiarCodigoPorTokens({
      tenantId: TENANT_ID,
      sellerId: SELLER_ID,
      codigo: "code-B",
      redirectUri: "https://app/cb",
    });

    expect(conexion.id).toBe("conexion-1");
    // Lo que el callback necesita para NO decir "agregaste la cuenta".
    expect(desenlace).toBe("conexion_existente_actualizada");
    expect(updatesEmitidos).toHaveLength(1);
    expect(insertsEmitidos).toHaveLength(0);
  });

  it("INSERT rechazado por el trigger de tope (23514) → ErrorTopeCuentasMlAlcanzado", async () => {
    const { fabrica } = crearMock({
      selects: [{ data: null, error: null }], // no existe → intenta INSERT
      inserts: [{ data: null, error: { code: "23514", message: "check_violation" } }],
    });
    vi.mocked(crearClienteServiceRole).mockImplementation(() => fabrica() as never);
    global.fetch = mockFetchToken(555) as unknown as typeof fetch;

    await expect(
      intercambiarCodigoPorTokens({
        tenantId: TENANT_ID,
        sellerId: SELLER_ID,
        codigo: "code-C",
        redirectUri: "https://app/cb",
      }),
    ).rejects.toBeInstanceOf(ErrorTopeCuentasMlAlcanzado);
  });

  it("INSERT en carrera rechazado por unicidad parcial (23505) → relee y devuelve la ganadora", async () => {
    const ganadora = fila({ id: "conexion-ganadora", ml_user_id: "888" });
    const { fabrica } = crearMock({
      selects: [
        { data: null, error: null }, // 1º SELECT: no existe aún
        { data: ganadora, error: null }, // relectura tras 23505: la fila ganadora
      ],
      inserts: [{ data: null, error: { code: "23505", message: "unique_violation" } }],
    });
    vi.mocked(crearClienteServiceRole).mockImplementation(() => fabrica() as never);
    global.fetch = mockFetchToken(888) as unknown as typeof fetch;

    const { conexion, desenlace } = await intercambiarCodigoPorTokens({
      tenantId: TENANT_ID,
      sellerId: SELLER_ID,
      codigo: "code-D",
      redirectUri: "https://app/cb",
    });

    expect(conexion.id).toBe("conexion-ganadora");
    expect(conexion.mlUserId).toBe("888");
    // La cuenta NO estaba conectada cuando este flujo empezó (lo confirmó el
    // SELECT previo): la creó el gemelo concurrente. Para el seller es un alta.
    expect(desenlace).toBe("alta_nueva");
  });

  it("23505 sin fila ganadora relegible → ErrorCuentaMlYaConectada", async () => {
    const { fabrica } = crearMock({
      selects: [
        { data: null, error: null }, // no existe
        { data: null, error: null }, // relectura vacía
      ],
      inserts: [{ data: null, error: { code: "23505", message: "unique_violation" } }],
    });
    vi.mocked(crearClienteServiceRole).mockImplementation(() => fabrica() as never);
    global.fetch = mockFetchToken(444) as unknown as typeof fetch;

    await expect(
      intercambiarCodigoPorTokens({
        tenantId: TENANT_ID,
        sellerId: SELLER_ID,
        codigo: "code-E",
        redirectUri: "https://app/cb",
      }),
    ).rejects.toBeInstanceOf(ErrorCuentaMlYaConectada);
  });

  /**
   * Doble callback con el mismo `code` (doble clic, recarga, reintento del
   * navegador). El `code` es de un solo uso en ML, así que la segunda pasada
   * NO puede re-canjearlo: sale de `resultadosIntercambio`. Lo que se prueba
   * aquí es que esa caché memoriza el DESENLACE, no solo la conexión — si la
   * segunda pasada lo re-derivara leyendo la BD, vería la fila que la primera
   * acaba de insertar y contaría una historia distinta (alta → "ya estaba
   * conectada") para el mismo clic del seller.
   */
  describe("doble callback con el mismo `code` — la caché devuelve el MISMO desenlace", () => {
    it("cuenta REPETIDA: ambas pasadas dicen `conexion_existente_actualizada`, sin re-canjear ni re-escribir", async () => {
      const existente = fila({ id: "conexion-1", ml_user_id: "999" });
      const { fabrica, insertsEmitidos, updatesEmitidos } = crearMock({
        selects: [{ data: existente, error: null }],
        updates: [{ data: fila({ id: "conexion-1", ml_user_id: "999" }), error: null }],
      });
      vi.mocked(crearClienteServiceRole).mockImplementation(() => fabrica() as never);
      const fetchMock = mockFetchToken(999);
      global.fetch = fetchMock as unknown as typeof fetch;

      const entrada = {
        tenantId: TENANT_ID,
        sellerId: SELLER_ID,
        codigo: "code-doble-repetida",
        redirectUri: "https://app/cb",
      };

      const primera = await intercambiarCodigoPorTokens(entrada);
      const llamadasTrasPrimera = fetchMock.mock.calls.length;
      const segunda = await intercambiarCodigoPorTokens(entrada);

      expect(primera.desenlace).toBe("conexion_existente_actualizada");
      expect(segunda.desenlace).toBe(primera.desenlace);
      expect(segunda.conexion.id).toBe(primera.conexion.id);
      // La segunda no vuelve a golpear ML ni a persistir nada.
      expect(fetchMock.mock.calls.length).toBe(llamadasTrasPrimera);
      expect(updatesEmitidos).toHaveLength(1);
      expect(insertsEmitidos).toHaveLength(0);
      // Y no re-publica el evento que dispara el backfill (comportamiento
      // existente: se publica una sola vez por intercambio efectivo).
      expect(vi.mocked(inngest.send)).toHaveBeenCalledTimes(1);
    });

    it("cuenta NUEVA: ambas pasadas dicen `alta_nueva` (la segunda NO re-deriva del estado que la primera escribió)", async () => {
      const { fabrica, insertsEmitidos } = crearMock({
        selects: [{ data: null, error: null }],
        inserts: [{ data: fila({ id: "conexion-nueva", ml_user_id: "777" }), error: null }],
      });
      vi.mocked(crearClienteServiceRole).mockImplementation(() => fabrica() as never);
      const fetchMock = mockFetchToken(777);
      global.fetch = fetchMock as unknown as typeof fetch;

      const entrada = {
        tenantId: TENANT_ID,
        sellerId: SELLER_ID,
        codigo: "code-doble-nueva",
        redirectUri: "https://app/cb",
      };

      const primera = await intercambiarCodigoPorTokens(entrada);
      const segunda = await intercambiarCodigoPorTokens(entrada);

      expect(primera.desenlace).toBe("alta_nueva");
      expect(segunda.desenlace).toBe("alta_nueva");
      expect(segunda.conexion.id).toBe(primera.conexion.id);
      expect(insertsEmitidos).toHaveLength(1);
    });
  });
});
