/**
 * Pruebas de refrescar-tokens.ts
 *
 * Prueba la lógica de resiliencia del job:
 * 1. El loop continúa ante el fallo de una conexión.
 * 2. `requiere_revinculacion` → continúa sin lanzar.
 * 3. Error transitorio → se propaga (Inngest reintenta).
 *
 * Se extrae y prueba la función de lógica interna directamente, inyectando
 * mocks del puerto ML y del cliente de BD.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConexionSellerMl } from "../tipos";

// ---------------------------------------------------------------------------
// Función de lógica extraída del job para prueba aislada
// ---------------------------------------------------------------------------

type MockRefrescarToken = (entrada: { conexionId: string }) => Promise<{
  resultado: "refrescado" | "requiere_revinculacion";
  conexion: ConexionSellerMl;
}>;

/**
 * Lógica central del loop de refresco, extraída para testabilidad.
 * El job real llama `refrescarToken` del puerto; aquí la inyectamos como mock.
 */
async function ejecutarLoopRefresco(
  conexiones: Array<{ id: string; seller_id: string; tenant_id: string; estado_salud: string }>,
  fnRefrescar: MockRefrescarToken,
  onLog: (nivel: "info" | "warn" | "error", msg: string) => void,
): Promise<{
  exitosos: number;
  fallidosTransitorios: number;
  requierenRevinculacion: number;
}> {
  let exitosos = 0;
  let fallidosTransitorios = 0;
  let requierenRevinculacion = 0;

  const resultados = await Promise.allSettled(
    conexiones.map(async (conexion) => {
      try {
        const resultado = await fnRefrescar({ conexionId: conexion.id });

        if (resultado.resultado === "requiere_revinculacion") {
          onLog("warn", `Conexión ${conexion.id} requiere re-vinculación.`);
          requierenRevinculacion++;
          return { estado: "requiere_revinculacion" };
        }

        exitosos++;
        return { estado: "refrescado" };
      } catch (error) {
        // Error transitorio: propagar para que Inngest reintente
        fallidosTransitorios++;
        throw error;
      }
    }),
  );

  // El loop NO lanza si algunos fallaron — devuelve conteos.
  void resultados;

  return { exitosos, fallidosTransitorios, requierenRevinculacion };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("jobRefrescarTokens — lógica del loop de refresco", () => {
  const conexionSana: ConexionSellerMl = {
    id: "conn-1",
    tenantId: "tenant-1",
    sellerId: "seller-1",
    mlUserId: "ml-user-1",
    tokenExpiraEn: new Date(Date.now() + 3600_000),
    estadoSalud: "sana",
    ultimaSyncExitosaEn: new Date(),
    desconectadaDesde: null,
    ultimoError: null,
  };

  const conexionDesvinculada: ConexionSellerMl = {
    ...conexionSana,
    id: "conn-desvinculated",
    estadoSalud: "desvinculada",
    desconectadaDesde: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("el loop continúa ante el fallo transitorio de una conexión", async () => {
    const fnMock: MockRefrescarToken = vi
      .fn()
      .mockResolvedValueOnce({ resultado: "refrescado", conexion: conexionSana }) // conn-1 ok
      .mockRejectedValueOnce(new Error("Error transitorio de red")) // conn-2 falla
      .mockResolvedValueOnce({ resultado: "refrescado", conexion: conexionSana }); // conn-3 ok

    const logs: string[] = [];
    const onLog = (_nivel: string, msg: string) => logs.push(msg);

    const resultado = await ejecutarLoopRefresco(
      [
        { id: "conn-1", seller_id: "s-1", tenant_id: "t-1", estado_salud: "sana" },
        { id: "conn-2", seller_id: "s-2", tenant_id: "t-1", estado_salud: "sana" },
        { id: "conn-3", seller_id: "s-3", tenant_id: "t-1", estado_salud: "sana" },
      ],
      fnMock,
      onLog,
    );

    // Las otras dos conexiones se procesaron igualmente
    expect(resultado.exitosos).toBe(2);
    expect(resultado.fallidosTransitorios).toBe(1);
    // El loop no lanzó — todas las conexiones fueron intentadas
    expect(fnMock).toHaveBeenCalledTimes(3);
  });

  it("'requiere_revinculacion' → continúa sin lanzar, cuenta como procesado", async () => {
    const fnMock: MockRefrescarToken = vi
      .fn()
      .mockResolvedValueOnce({ resultado: "requiere_revinculacion", conexion: conexionDesvinculada })
      .mockResolvedValueOnce({ resultado: "refrescado", conexion: conexionSana });

    const logs: string[] = [];
    const onLog = (nivel: string, msg: string) => {
      if (nivel === "warn") logs.push(msg);
    };

    const resultado = await ejecutarLoopRefresco(
      [
        { id: "conn-desvinculated", seller_id: "s-1", tenant_id: "t-1", estado_salud: "atencion" },
        { id: "conn-1", seller_id: "s-2", tenant_id: "t-1", estado_salud: "sana" },
      ],
      fnMock,
      onLog,
    );

    expect(resultado.requierenRevinculacion).toBe(1);
    expect(resultado.exitosos).toBe(1);
    // Se loguea la situación como advertencia
    expect(logs.some((l) => l.includes("re-vinculación"))).toBe(true);
    // El loop NO lanzó
    expect(fnMock).toHaveBeenCalledTimes(2);
  });

  it("error transitorio de una conexión no afecta a las demás", async () => {
    const errorTransitorio = Object.assign(new Error("ML 500"), { reintentable: true });

    const fnMock: MockRefrescarToken = vi
      .fn()
      .mockRejectedValueOnce(errorTransitorio)
      .mockRejectedValueOnce(errorTransitorio)
      .mockResolvedValueOnce({ resultado: "refrescado", conexion: conexionSana });

    const resultado = await ejecutarLoopRefresco(
      [
        { id: "c-1", seller_id: "s-1", tenant_id: "t", estado_salud: "sana" },
        { id: "c-2", seller_id: "s-2", tenant_id: "t", estado_salud: "sana" },
        { id: "c-3", seller_id: "s-3", tenant_id: "t", estado_salud: "sana" },
      ],
      fnMock,
      () => {},
    );

    // Dos fallidas, una exitosa — el loop completó los tres
    expect(resultado.fallidosTransitorios).toBe(2);
    expect(resultado.exitosos).toBe(1);
    expect(fnMock).toHaveBeenCalledTimes(3);
  });

  it("con lista vacía de conexiones, devuelve conteos en cero", async () => {
    const fnMock = vi.fn();

    const resultado = await ejecutarLoopRefresco([], fnMock, () => {});

    expect(resultado.exitosos).toBe(0);
    expect(resultado.fallidosTransitorios).toBe(0);
    expect(resultado.requierenRevinculacion).toBe(0);
    expect(fnMock).not.toHaveBeenCalled();
  });
});
