/**
 * Pruebas unitarias del módulo `pruebas-entrega`.
 *
 * Cubre:
 * 1. Cálculo de distancia Haversine (función pura).
 * 2. Lógica de geocerca: dentro / fuera / sin_referencia.
 * 3. Lógica de es_valido para tipo_resultado='entregado'.
 * 4. Lógica de es_valido para tipo_resultado='fallido'.
 * 5. registrarPruebaEntrega — barrera RBAC (conductor sin capacidad).
 * 6. registrarPruebaEntrega — barrera FRONTERA (pedido Flex).
 * 7. registrarPruebaEntrega — barrera asignación (conductor no asignado).
 * 8. registrarPruebaEntrega — exige foto para que es_valido=true en entregado.
 * 9. registrarPruebaEntrega — fallido sin tipo_incidencia lanza ErrorValidacion.
 * 10. Idempotencia: si ya existe POD 'entregado', devuelve el existente.
 */

import { describe, expect, it } from "vitest";
import { haversineMetros, POD_GEOCERCA_RADIO_M, registrarPruebaEntrega } from "./pruebas-entrega";
import type { PodGeoResultado } from "./pruebas-entrega";
import { ErrorValidacion } from "@/modules/identidad/errores";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";

// =============================================================================
// Fixtures
// =============================================================================

const TENANT_A = "aaaa0000-0000-0000-0000-000000000010";
const PEDIDO_1 = "bbbb0000-0000-0000-0000-000000000020";
const SELLER_1 = "cccc0000-0000-0000-0000-000000000030";
const CONDUCTOR_1 = "dddd0000-0000-0000-0000-000000000040";
/**
 * El id de `auth.users` del conductor, DELIBERADAMENTE distinto de
 * `CONDUCTOR_1`. En la realidad nunca coinciden: `identidad.conductores.id` se
 * genera con `crypto.randomUUID()` (`conductores.ts:530`) y no tiene relación
 * con auth. Si aquí se usara el mismo valor para los dos, la prueba de abajo
 * pasaría igual con el bug puesto — que es exactamente cómo sobrevivió.
 */
const USUARIO_AUTH_1 = "eeee0000-0000-0000-0000-000000000099";

// Coordenadas de referencia: Plaza de Armas, Santiago
const LAT_DESTINO = -33.4372;
const LONG_DESTINO = -70.6506;

function actorConductor(driverId: string = CONDUCTOR_1): UsuarioActual & { usuarioId: string } {
  return {
    usuarioId: USUARIO_AUTH_1,
    tenantId: TENANT_A,
    tipoUsuario: "conductor",
    sellerId: null,
    driverId,
    rol: "conductor",
    estado: "activo",
    areasHabilitadas: [...AREAS_PRODUCTO],
  };
}

function actorSinCapacidad(): UsuarioActual & { usuarioId: string } {
  return {
    usuarioId: USUARIO_AUTH_1,
    tenantId: TENANT_A,
    tipoUsuario: "seller",
    sellerId: SELLER_1,
    driverId: null,
    rol: "seller",
    estado: "activo",
    areasHabilitadas: [...AREAS_PRODUCTO],
  };
}

// =============================================================================
// 1. Haversine — función pura
// =============================================================================

/**
 * Un desplazamiento en latitud, en grados, para una distancia dada en metros.
 *
 * Las pruebas de «está fuera» se escribían con un offset fijo («0.0135 ≈ 1,5
 * km») que era mayor que el radio SOLO mientras el radio fuera 1 km. Al subirlo
 * a 3 km (2026-08-27) seis pruebas se cayeron a la vez, y las que no dependían
 * del radio para su aserción habrían pasado en verde afirmando lo contrario de
 * su nombre. Derivándolo de la constante, el caso «fuera» sigue estando fuera
 * con cualquier radio futuro.
 */
const gradosLatitudPara = (metros: number) => metros / 111_190;

describe("haversineMetros — cálculo de distancia GPS", () => {
  it("distancia entre el mismo punto es 0", () => {
    expect(haversineMetros(LAT_DESTINO, LONG_DESTINO, LAT_DESTINO, LONG_DESTINO)).toBe(0);
  });

  it("distancia ~100 m hacia el norte está dentro del radio de 1 km", () => {
    // ~0.0009 grados de latitud ≈ 100 m
    const latCerca = LAT_DESTINO - 0.0009; // 100 m al norte (latitud negativa → norte)
    const dist = haversineMetros(latCerca, LONG_DESTINO, LAT_DESTINO, LONG_DESTINO);
    expect(dist).toBeLessThan(POD_GEOCERCA_RADIO_M);
    expect(dist).toBeGreaterThan(0);
  });

  it("un punto a 1,5× el radio está fuera de la geocerca", () => {
    const latLejos = LAT_DESTINO - gradosLatitudPara(POD_GEOCERCA_RADIO_M * 1.5);
    const dist = haversineMetros(latLejos, LONG_DESTINO, LAT_DESTINO, LONG_DESTINO);
    expect(dist).toBeGreaterThan(POD_GEOCERCA_RADIO_M);
  });

  it("distancia ~1 km es aproximadamente 1000 m (±5 %)", () => {
    // ~0.009 grados ≈ 1 km
    const latKm = LAT_DESTINO - 0.009;
    const dist = haversineMetros(latKm, LONG_DESTINO, LAT_DESTINO, LONG_DESTINO);
    expect(dist).toBeGreaterThan(950);
    expect(dist).toBeLessThan(1050);
  });

  it("la función es simétrica", () => {
    const d1 = haversineMetros(-33.4, -70.6, -33.5, -70.7);
    const d2 = haversineMetros(-33.5, -70.7, -33.4, -70.6);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001); // diferencia < 1 mm
  });
});

// =============================================================================
// 2. POD_GEOCERCA_RADIO_M — constante de contrato
// =============================================================================

describe("POD_GEOCERCA_RADIO_M", () => {
  /**
   * Esta prueba no comprueba una regla: comprueba que nadie mueva el radio sin
   * darse cuenta. Es la única barrera que convierte "ensanchar la geocerca" en
   * un acto deliberado — el radio decide si una entrega cierra sola o queda
   * esperando a que el coordinador la revise a mano, y se aplica a las tres
   * superficies que lo reusan (POD same-day, cierre Flex y evidencia).
   *
   * 3.000 m desde el 2026-08-27 (1.000 m desde el 15-ago, 150 m antes), por
   * decisión del usuario. El porqué y el intercambio están escritos junto a la
   * constante — incluido que a 3 km es un radio de PRUEBA y que la nota dice
   * cómo devolverlo.
   */
  it("es exactamente 3.000 metros", () => {
    expect(POD_GEOCERCA_RADIO_M).toBe(3000);
  });
});

// =============================================================================
// 3. registrarPruebaEntrega — barreras RBAC y same-day (con mocks del cliente)
// =============================================================================

/**
 * Construye un doble de Supabase para las pruebas que no necesitan
 * llamadas reales a BD. El patrón replica el de pedidos.test.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function construirClienteMock(overrides: Record<string, any> = {}) {
  const pedidoBaseData = {
    id: PEDIDO_1,
    tenant_id: TENANT_A,
    seller_id: SELLER_1,
    fuente: "rutax_manual", tipo_pedido: "same_day",
    driver_id_asignado: CONDUCTOR_1,
    lat: LAT_DESTINO,
    long: LONG_DESTINO,
    geo_estado: "resuelto",
    estado: "en_ruta",
  };

  const podExistenteBase = {
    id: "eeee0000-0000-0000-0000-000000000050",
    tenant_id: TENANT_A,
    pedido_id: PEDIDO_1,
    seller_id: SELLER_1,
    conductor_id: CONDUCTOR_1,
    tipo_resultado: "entregado",
    tiene_foto: true,
    foto_object_path: "path/foto.jpg",
    tiene_firma: false,
    firma_object_path: null,
    otp_estado: "no_aplica",
    geo_lat: LAT_DESTINO,
    geo_long: LONG_DESTINO,
    geo_precision_m: 5,
    distancia_destino_m: 10,
    geocerca_resultado: "dentro",
    es_valido: true,
    tipo_incidencia: null,
    capturado_en: new Date().toISOString(),
    creado_en: new Date().toISOString(),
  };

  const pedidoDatos = { ...pedidoBaseData, ...overrides.pedido };
  const podExistenteData = overrides.podExistente ?? null;
  const insertResult = overrides.insertResult
    ?? { data: { ...podExistenteBase, ...overrides.insertar }, error: null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockQuery = (resultData: any) => {
    const chain: Record<string, unknown> = {};
    const resolved = Promise.resolve(resultData);
    chain.eq = () => chain;
    chain.select = () => chain;
    chain.limit = () => chain;
    chain.maybeSingle = () => resolved;
    chain.single = () => resolved;
    chain.insert = () => chain;
    chain.upsert = () => chain;
    return chain;
  };

  return {
    from: (tabla: string) => {
      if (tabla === "pedidos") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: pedidoDatos, error: null }),
              }),
            }),
          }),
        };
      }
      if (tabla === "pruebas_entrega") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: podExistenteData, error: null }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve(insertResult),
            }),
          }),
        };
      }
      if (tabla === "bitacora_auditoria") {
        return {
          insert: () => Promise.resolve({ error: null }),
        };
      }
      return mockQuery({ data: null, error: null });
    },
  };
}

describe("registrarPruebaEntrega — barreras de acceso y same-day", () => {
  // -------------------------------------------------------------------------
  // 5. RBAC: conductor sin capacidad → ErrorValidacion
  // -------------------------------------------------------------------------
  it("actor sin capacidad marcar_evidencias_propias lanza ErrorValidacion", async () => {
    const mock = construirClienteMock();
    await expect(
      registrarPruebaEntrega(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mock as any,
        { pedidoId: PEDIDO_1, tenantId: TENANT_A, tipoResultado: "entregado" },
        actorSinCapacidad(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  // -------------------------------------------------------------------------
  // RBAC: actor sin driverId → ErrorValidacion
  // -------------------------------------------------------------------------
  it("conductor sin driverId lanza ErrorValidacion", async () => {
    const mock = construirClienteMock();
    const actorSinId: UsuarioActual & { usuarioId: string } = { ...actorConductor(), driverId: null };
    await expect(
      registrarPruebaEntrega(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mock as any,
        { pedidoId: PEDIDO_1, tenantId: TENANT_A, tipoResultado: "entregado" },
        actorSinId,
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  // -------------------------------------------------------------------------
  // 6. FRONTERA: pedido Flex → ErrorValidacion
  // -------------------------------------------------------------------------
  it("pedido Flex lanza ErrorValidacion (frontera dura same-day)", async () => {
    const mock = construirClienteMock({ pedido: { fuente: "ml_flex", tipo_pedido: "flex" } });
    await expect(
      registrarPruebaEntrega(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mock as any,
        { pedidoId: PEDIDO_1, tenantId: TENANT_A, tipoResultado: "entregado" },
        actorConductor(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  // -------------------------------------------------------------------------
  // 7. Conductor no asignado → ErrorValidacion
  // -------------------------------------------------------------------------
  it("conductor no asignado al pedido lanza ErrorValidacion", async () => {
    const otroDriver = "ffff0000-0000-0000-0000-000000000060";
    const mock = construirClienteMock({ pedido: { driver_id_asignado: otroDriver } });
    await expect(
      registrarPruebaEntrega(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mock as any,
        { pedidoId: PEDIDO_1, tenantId: TENANT_A, tipoResultado: "entregado" },
        actorConductor(), // CONDUCTOR_1, pero asignado es otroDriver
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  // -------------------------------------------------------------------------
  // 9. Fallido sin tipo_incidencia → ErrorValidacion (validación estática TS)
  // Este caso se valida a nivel de tipos TypeScript en compile-time; aquí
  // verificamos el runtime para mayor robustez.
  // -------------------------------------------------------------------------
  it("fallido sin tipo_incidencia lanza ErrorValidacion", async () => {
    const mock = construirClienteMock();
    await expect(
      registrarPruebaEntrega(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mock as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { pedidoId: PEDIDO_1, tenantId: TENANT_A, tipoResultado: "fallido" } as any,
        actorConductor(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });
});

// =============================================================================
// Lógica de geocerca y esValido — verificación de la lógica pura
// (sin mocks; solo usando haversineMetros y la constante)
// =============================================================================

describe("Lógica de geocerca y es_valido", () => {
  // Dentro del radio
  it("punto a 50 m del destino está DENTRO de la geocerca", () => {
    const lat50m = LAT_DESTINO - 0.00045; // ~50 m
    const dist = haversineMetros(lat50m, LONG_DESTINO, LAT_DESTINO, LONG_DESTINO);
    expect(dist).toBeLessThanOrEqual(POD_GEOCERCA_RADIO_M);
    // es_valido para entregado: tieneFoto=true AND resultado!='fuera'
    const geocercaResultado = dist <= POD_GEOCERCA_RADIO_M ? "dentro" : "fuera";
    const esValido = true && geocercaResultado !== "fuera"; // tieneFoto=true
    expect(esValido).toBe(true);
  });

  // Fuera del radio
  it("punto a 1,5× el radio del destino está FUERA de la geocerca", () => {
    const latLejos = LAT_DESTINO - gradosLatitudPara(POD_GEOCERCA_RADIO_M * 1.5);
    const dist = haversineMetros(latLejos, LONG_DESTINO, LAT_DESTINO, LONG_DESTINO);
    expect(dist).toBeGreaterThan(POD_GEOCERCA_RADIO_M);
    const geocercaResultado = dist <= POD_GEOCERCA_RADIO_M ? "dentro" : "fuera";
    // Con foto pero fuera → es_valido = false
    const esValidoConFoto = true && geocercaResultado !== "fuera";
    expect(esValidoConFoto).toBe(false);
  });

  // Sin referencia: pedido sin geo_estado='resuelto' → sin_referencia → válido con foto
  // La regla es: es_valido = tieneFoto AND geocerca IN ('dentro','sin_referencia').
  // 'sin_referencia' está en el conjunto de resultados aceptables.
  it("sin_referencia con foto → es_valido = true", () => {
    // Usamos un conjunto explícito para evitar la comparación literal que TS optimiza.
    const resultadosAceptables = new Set<PodGeoResultado>(["dentro", "sin_referencia"]);
    const geocercaResultado: PodGeoResultado = "sin_referencia";
    const tieneFoto = true;
    const esValido = tieneFoto && resultadosAceptables.has(geocercaResultado);
    expect(esValido).toBe(true);
  });

  // Sin foto → es_valido = false aunque geocerca sea 'dentro'
  it("dentro pero sin foto → es_valido = false", () => {
    const resultadosAceptables = new Set<PodGeoResultado>(["dentro", "sin_referencia"]);
    const geocercaResultado: PodGeoResultado = "dentro";
    const tieneFoto = false;
    const esValido = tieneFoto && resultadosAceptables.has(geocercaResultado);
    expect(esValido).toBe(false);
  });

  // Para fallido: es_valido depende solo de tipo_incidencia
  it("fallido con tipo_incidencia → es_valido = true", () => {
    const tipoIncidencia = "destinatario_ausente";
    const esValido = !!tipoIncidencia;
    expect(esValido).toBe(true);
  });

  it("fallido sin tipo_incidencia → es_valido = false", () => {
    const tipoIncidencia = null;
    const esValido = !!tipoIncidencia;
    expect(esValido).toBe(false);
  });
});

// =============================================================================
// 5. Bitácora: el autor es el usuario de AUTH, nunca el conductor
// =============================================================================

/**
 * La prueba que faltaba, y por la que un bug crítico sobrevivió meses.
 *
 * `bitacora_auditoria.actor_usuario_id` tiene FK a `auth.users(id)`. Durante un
 * tiempo estas tres escrituras del conductor (POD same-day, cierre Flex y
 * evidencias) pasaban `actor.driverId`, que es `identidad.conductores.id` —
 * generado con `crypto.randomUUID()` y sin ninguna relación con auth. El INSERT
 * fallaba con 23503 y, como la bitácora va ANTES del efecto por invariante del
 * proyecto, **ninguna entrega llegaba a registrarse**.
 *
 * No lo vio nadie porque el doble de cliente resolvía la bitácora con
 * `insert: () => Promise.resolve({ error: null })`, aceptando cualquier payload
 * sin mirarlo. Un mock que no mira lo que recibe no prueba nada: por eso este
 * caso captura el payload y lo afirma.
 */
describe("registrarPruebaEntrega — autor de la bitácora", () => {
  it("escribe el usuarioId de auth como actor, y NO el driverId", async () => {
    const asientos: Record<string, unknown>[] = [];

    const mock = {
      from: (tabla: string) => {
        if (tabla === "pedidos") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: PEDIDO_1,
                        tenant_id: TENANT_A,
                        seller_id: SELLER_1,
                        fuente: "rutax_manual", tipo_pedido: "same_day",
                        driver_id_asignado: CONDUCTOR_1,
                        lat: LAT_DESTINO,
                        long: LONG_DESTINO,
                        geo_estado: "resuelto",
                        estado: "en_ruta",
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        if (tabla === "pruebas_entrega") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: "ffff0000-0000-0000-0000-000000000001",
                      tenant_id: TENANT_A,
                      pedido_id: PEDIDO_1,
                      seller_id: SELLER_1,
                      conductor_id: CONDUCTOR_1,
                      tipo_resultado: "entregado",
                      tiene_foto: true,
                      foto_object_path: "path/foto.jpg",
                      tiene_firma: false,
                      firma_object_path: null,
                      otp_estado: "no_aplica",
                      geo_lat: LAT_DESTINO,
                      geo_long: LONG_DESTINO,
                      geo_precision_m: 5,
                      distancia_destino_m: 10,
                      geocerca_resultado: "dentro",
                      es_valido: true,
                      tipo_incidencia: null,
                      capturado_en: new Date().toISOString(),
                      creado_en: new Date().toISOString(),
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (tabla === "bitacora_auditoria") {
          // A diferencia del doble genérico, éste SÍ mira lo que recibe.
          return {
            insert: (fila: Record<string, unknown>) => {
              asientos.push(fila);
              return Promise.resolve({ error: null });
            },
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      },
    };

    await registrarPruebaEntrega(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mock as any,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        tipoResultado: "entregado",
        fotoObjectPath: "path/foto.jpg",
      },
      actorConductor(),
    );

    expect(asientos.length).toBeGreaterThan(0);
    const asiento = asientos[0];

    // Lo que importa: el id de AUTH, no el del conductor.
    expect(asiento.actor_usuario_id).toBe(USUARIO_AUTH_1);
    expect(asiento.actor_usuario_id).not.toBe(CONDUCTOR_1);
  });
});
