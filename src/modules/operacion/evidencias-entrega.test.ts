/**
 * Pruebas unitarias del módulo `evidencias-entrega` (evidencia INFORMATIVA).
 *
 * Contraste clave con `pruebas-entrega`: aquí un pedido Flex SÍ se acepta (la
 * evidencia es paralela a ML, no la reemplaza). Cubre:
 * 1. RBAC: actor sin capacidad → ErrorValidacion.
 * 2. RBAC: actor sin driverId → ErrorValidacion.
 * 3. Validación: sin fotoObjectPath → ErrorValidacion.
 * 4. Pertenencia: conductor no asignado → ErrorValidacion.
 * 5. Flex PERMITIDO: registra evidencia para un pedido Flex (no hay frontera).
 * 6. Geocerca: dentro / fuera / sin_referencia se reflejan en el resultado.
 * 7. Idempotencia: si ya existe la evidenciaId, devuelve la existente sin insertar.
 */

import { describe, expect, it } from "vitest";
import {
  registrarEvidenciaEntrega,
  type RegistrarEvidenciaEntrada,
} from "./evidencias-entrega";
import { ErrorValidacion } from "@/modules/identidad/errores";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";

// =============================================================================
// Fixtures
// =============================================================================

const TENANT_A = "aaaa0000-0000-0000-0000-000000000010";
const PEDIDO_1 = "bbbb0000-0000-0000-0000-000000000020";
const SELLER_1 = "cccc0000-0000-0000-0000-000000000030";
const CONDUCTOR_1 = "dddd0000-0000-0000-0000-000000000040";
/**
 * Id de `auth.users` del conductor, DELIBERADAMENTE distinto de `CONDUCTOR_1`:
 * `identidad.conductores.id` se genera con `crypto.randomUUID()` y nunca es un
 * usuario de auth. Con el mismo valor en ambos, la prueba no distinguiría el
 * bug que pasaba `driverId` donde va el id de auth.
 */
const USUARIO_AUTH_1 = "eeee0000-0000-0000-0000-000000000099";

const EVIDENCIA_1 = "eeee0000-0000-0000-0000-000000000050";

// Plaza de Armas, Santiago
const LAT_DESTINO = -33.4372;
const LONG_DESTINO = -70.6506;

const FOTO_PATH = `${TENANT_A}/${PEDIDO_1}/evidencia/${EVIDENCIA_1}.jpg`;

function actorConductor(driverId: string = CONDUCTOR_1): UsuarioActual & { usuarioId: string } {
  return {
    usuarioId: USUARIO_AUTH_1,
    tenantId: TENANT_A,
    tipoUsuario: "conductor",
    sellerId: null,
    driverId,
    rol: "conductor",
    estado: "activo",
  };
}

function actorSeller(): UsuarioActual & { usuarioId: string } {
  return {
    usuarioId: USUARIO_AUTH_1,
    tenantId: TENANT_A,
    tipoUsuario: "seller",
    sellerId: SELLER_1,
    driverId: null,
    rol: "seller",
    estado: "activo",
  };
}

// =============================================================================
// Mock de cliente Supabase
// =============================================================================

interface Overrides {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pedido?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evidenciaExistente?: Record<string, any> | null;
}

function construirClienteMock(overrides: Overrides = {}) {
  const pedidoBase = {
    id: PEDIDO_1,
    tenant_id: TENANT_A,
    seller_id: SELLER_1,
    tipo_pedido: "flex",
    driver_id_asignado: CONDUCTOR_1,
    lat: LAT_DESTINO,
    long: LONG_DESTINO,
    geo_estado: "resuelto",
  };
  const pedidoDatos = { ...pedidoBase, ...overrides.pedido };
  const evidenciaExistente = overrides.evidenciaExistente ?? null;

  return {
    from: (tabla: string) => {
      if (tabla === "pedidos") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: pedidoDatos, error: null }),
              }),
            }),
          }),
        };
      }
      if (tabla === "evidencias_entrega") {
        return {
          // Idempotencia: .select().eq("id").eq("tenant_id").maybeSingle()
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: evidenciaExistente, error: null }),
              }),
            }),
          }),
          // Insert: .insert(payload).select().single() → echo del payload.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          insert: (payload: Record<string, any>) => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: payload.id ?? EVIDENCIA_1,
                    nota: null,
                    capturado_en: new Date().toISOString(),
                    subido_en: new Date().toISOString(),
                    creado_en: new Date().toISOString(),
                    ...payload,
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (tabla === "bitacora_auditoria") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return {};
    },
  };
}

const ENTRADA_BASE: RegistrarEvidenciaEntrada = {
  pedidoId: PEDIDO_1,
  tenantId: TENANT_A,
  fotoObjectPath: FOTO_PATH,
};

// =============================================================================
// 1-4. Barreras de acceso y validación
// =============================================================================

describe("registrarEvidenciaEntrega — barreras", () => {
  it("actor sin capacidad (seller) lanza ErrorValidacion", async () => {
    const mock = construirClienteMock();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registrarEvidenciaEntrega(mock as any, ENTRADA_BASE, actorSeller()),
    ).rejects.toThrow(ErrorValidacion);
  });

  it("conductor sin driverId lanza ErrorValidacion", async () => {
    const mock = construirClienteMock();
    const actorSinId: UsuarioActual & { usuarioId: string } = { ...actorConductor(), driverId: null };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registrarEvidenciaEntrega(mock as any, ENTRADA_BASE, actorSinId),
    ).rejects.toThrow(ErrorValidacion);
  });

  it("sin fotoObjectPath lanza ErrorValidacion", async () => {
    const mock = construirClienteMock();
    await expect(
      registrarEvidenciaEntrega(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mock as any,
        { ...ENTRADA_BASE, fotoObjectPath: "" },
        actorConductor(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it("conductor no asignado al pedido lanza ErrorValidacion", async () => {
    const otroDriver = "ffff0000-0000-0000-0000-000000000060";
    const mock = construirClienteMock({ pedido: { driver_id_asignado: otroDriver } });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registrarEvidenciaEntrega(mock as any, ENTRADA_BASE, actorConductor()),
    ).rejects.toThrow(ErrorValidacion);
  });
});

// =============================================================================
// 5. Flex PERMITIDO (el diferenciador frente a pruebas-entrega)
// =============================================================================

describe("registrarEvidenciaEntrega — Flex permitido", () => {
  it("registra evidencia para un pedido Flex (no hay frontera de tipo)", async () => {
    const mock = construirClienteMock({ pedido: { tipo_pedido: "flex" } });
    const ev = await registrarEvidenciaEntrega(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mock as any,
      ENTRADA_BASE,
      actorConductor(),
    );
    expect(ev.pedidoId).toBe(PEDIDO_1);
    expect(ev.conductorId).toBe(CONDUCTOR_1);
    expect(ev.sellerId).toBe(SELLER_1);
    expect(ev.fotoObjectPath).toBe(FOTO_PATH);
  });

  it("también acepta same-day (evidencia suplementaria)", async () => {
    const mock = construirClienteMock({ pedido: { tipo_pedido: "same_day" } });
    const ev = await registrarEvidenciaEntrega(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mock as any,
      ENTRADA_BASE,
      actorConductor(),
    );
    expect(ev.pedidoId).toBe(PEDIDO_1);
  });
});

// =============================================================================
// 6. Geocerca
// =============================================================================

describe("registrarEvidenciaEntrega — geocerca", () => {
  it("captura dentro del radio → 'dentro'", async () => {
    const mock = construirClienteMock();
    const ev = await registrarEvidenciaEntrega(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mock as any,
      { ...ENTRADA_BASE, geo: { lat: LAT_DESTINO, long: LONG_DESTINO } },
      actorConductor(),
    );
    expect(ev.geocercaResultado).toBe("dentro");
    expect(ev.distanciaDestinoM).toBeLessThan(150);
  });

  it("captura lejana → 'fuera' pero se guarda igual (no bloquea)", async () => {
    const mock = construirClienteMock();
    const ev = await registrarEvidenciaEntrega(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mock as any,
      { ...ENTRADA_BASE, geo: { lat: LAT_DESTINO - 0.01, long: LONG_DESTINO } },
      actorConductor(),
    );
    expect(ev.geocercaResultado).toBe("fuera");
    expect(ev.distanciaDestinoM).toBeGreaterThan(150);
  });

  it("sin geo del conductor → 'sin_referencia'", async () => {
    const mock = construirClienteMock();
    const ev = await registrarEvidenciaEntrega(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mock as any,
      ENTRADA_BASE,
      actorConductor(),
    );
    expect(ev.geocercaResultado).toBe("sin_referencia");
    expect(ev.distanciaDestinoM).toBeNull();
  });

  it("destino sin geocoding resuelto → 'sin_referencia' aunque haya geo del conductor", async () => {
    const mock = construirClienteMock({ pedido: { geo_estado: "pendiente", lat: null, long: null } });
    const ev = await registrarEvidenciaEntrega(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mock as any,
      { ...ENTRADA_BASE, geo: { lat: LAT_DESTINO, long: LONG_DESTINO } },
      actorConductor(),
    );
    expect(ev.geocercaResultado).toBe("sin_referencia");
  });
});

// =============================================================================
// 7. Idempotencia
// =============================================================================

describe("registrarEvidenciaEntrega — idempotencia", () => {
  it("si ya existe la evidenciaId, devuelve la existente sin insertar", async () => {
    const existente = {
      id: EVIDENCIA_1,
      tenant_id: TENANT_A,
      pedido_id: PEDIDO_1,
      seller_id: SELLER_1,
      conductor_id: CONDUCTOR_1,
      foto_object_path: FOTO_PATH,
      nota: "ya existía",
      geo_lat: null,
      geo_long: null,
      geo_precision_m: null,
      distancia_destino_m: null,
      geocerca_resultado: "sin_referencia",
      capturado_en: new Date().toISOString(),
      subido_en: new Date().toISOString(),
      creado_en: new Date().toISOString(),
    };
    const mock = construirClienteMock({ evidenciaExistente: existente });
    const ev = await registrarEvidenciaEntrega(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mock as any,
      { ...ENTRADA_BASE, evidenciaId: EVIDENCIA_1 },
      actorConductor(),
    );
    expect(ev.id).toBe(EVIDENCIA_1);
    expect(ev.nota).toBe("ya existía");
  });
});
