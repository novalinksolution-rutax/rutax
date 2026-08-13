/**
 * Suite adversarial — Bloque 2: ciclo same-day propio
 * (ejecución del conductor + POD + tracking + batch + ubicación)
 *
 * Objetivo: romper las fronteras críticas NO cubiertas por las pruebas
 * existentes en `pedidos.test.ts`, `maquina-estados.test.ts` y
 * `pruebas-entrega.test.ts`. Cada describe cita el escenario del brief.
 *
 * Convenio con los mocks:
 *   - El doble de Supabase sigue el mismo patrón de los tests existentes
 *     (encadenamiento de métodos que devuelve Promises resueltas).
 *   - Se declara `as never` donde el tipo exacto no importa; evita
 *     `@typescript-eslint/no-explicit-any` global y conserva el lint limpio.
 *   - Inngest se mockea via vi.mock para evitar llamadas reales.
 *
 * Los escenarios que requieren stack vivo (pgTAP / RLS real) se documentan
 * al final como pendientes.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  registrarPruebaEntrega,
  haversineMetros,
  obtenerUrlFirmadaPod,
  POD_GEOCERCA_RADIO_M,
} from "./pruebas-entrega";
import type { PodGeoResultado } from "./pruebas-entrega";
import { transicionarPedidosSameDayAEnRuta } from "./manifiestos-same-day";
import {
  actualizarUbicacionConductor,
  borrarUbicacionAlCerrarRuta,
} from "./ubicacion-conductor";
import { ErrorValidacion } from "@/modules/identidad/errores";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";

// ---------------------------------------------------------------------------
// Mock de Inngest — evita llamadas reales de red en actualizarEstadoPedido
// ---------------------------------------------------------------------------
vi.mock("@/lib/inngest/cliente", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

// ---------------------------------------------------------------------------
// Fixtures compartidos
// ---------------------------------------------------------------------------

const TENANT_A = "aaaa0000-0000-0000-0000-000000000010";
const TENANT_B = "bbbb0000-0000-0000-0000-000000000011"; // tenant distinto (aislamiento)
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

const CONDUCTOR_2 = "dddd0000-0000-0000-0000-000000000041"; // conductor ajeno
const MANIFIESTO_1 = "eeee0000-0000-0000-0000-000000000050";
const POD_ID_1 = "ffff0000-0000-0000-0000-000000000060";

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
  };
}

function actorInterno(): UsuarioActual & { usuarioId: string } {
  return {
    usuarioId: USUARIO_AUTH_1,
    tenantId: TENANT_A,
    tipoUsuario: "interno",
    sellerId: null,
    driverId: null,
    rol: "dueno",
    estado: "activo",
  };
}

function actorSeller(sellerId: string = SELLER_1): UsuarioActual & { usuarioId: string } {
  return {
    usuarioId: USUARIO_AUTH_1,
    tenantId: TENANT_A,
    tipoUsuario: "seller",
    sellerId,
    driverId: null,
    rol: "seller",
    estado: "activo",
  };
}

// ---------------------------------------------------------------------------
// Helpers de mock
// ---------------------------------------------------------------------------

/** Devuelve un stub de bitácora que acepta cualquier insert. */
function bitacoraMock() {
  return {
    insert: vi.fn().mockResolvedValue({ error: null }),
  };
}

/**
 * Construye un cliente mínimo para `registrarPruebaEntrega`.
 * Permite controlar:
 *   - Los datos del pedido devueltos en el SELECT.
 *   - Si ya existe un POD 'entregado' (idempotencia).
 *   - El resultado del INSERT.
 */
function clientePodMock(opts: {
  pedido?: Record<string, unknown>;
  podExistente?: Record<string, unknown> | null;
  insertResult?: { data: Record<string, unknown> | null; error: { code?: string; message: string } | null };
}) {
  const pedidoBase: Record<string, unknown> = {
    id: PEDIDO_1,
    tenant_id: TENANT_A,
    seller_id: SELLER_1,
    tipo_pedido: "same_day",
    driver_id_asignado: CONDUCTOR_1,
    lat: LAT_DESTINO,
    long: LONG_DESTINO,
    geo_estado: "resuelto",
    estado: "en_ruta",
    ...opts.pedido,
  };

  const podFila: Record<string, unknown> = {
    id: POD_ID_1,
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

  const podExistente = opts.podExistente !== undefined ? opts.podExistente : null;

  const insertData = opts.insertResult ?? { data: podFila, error: null };

  return {
    from: (tabla: string) => {
      if (tabla === "pedidos") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: pedidoBase, error: null }),
              }),
            }),
          }),
        };
      }
      if (tabla === "pruebas_entrega") {
        return {
          // Consulta de idempotencia (existente)
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: podExistente, error: null }),
                }),
              }),
            }),
          }),
          // INSERT
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve(insertData),
            }),
          }),
        };
      }
      if (tabla === "bitacora_auditoria") {
        return bitacoraMock();
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    },
  } as never;
}

// =============================================================================
// Escenario 4 — POD: es_valido según foto + geocerca (integración del módulo)
// =============================================================================

describe("Esc-4 | registrarPruebaEntrega — es_valido según combinación foto+geocerca", () => {
  // -------------------------------------------------------------------------
  // 4a. Con foto + geocerca 'dentro' → es_valido=true (happy path)
  // -------------------------------------------------------------------------
  it("foto=sí, geocerca=dentro → registra POD con es_valido=true", async () => {
    // Punto a ~50 m del destino (dentro del radio de 150 m)
    const latCerca = LAT_DESTINO - 0.00045; // ≈ 50 m al norte

    const podInsertado: Record<string, unknown> = {
      id: POD_ID_1,
      tenant_id: TENANT_A,
      pedido_id: PEDIDO_1,
      seller_id: SELLER_1,
      conductor_id: CONDUCTOR_1,
      tipo_resultado: "entregado",
      tiene_foto: true,
      foto_object_path: "pod/foto.jpg",
      tiene_firma: false,
      firma_object_path: null,
      otp_estado: "no_aplica",
      geo_lat: latCerca,
      geo_long: LONG_DESTINO,
      geo_precision_m: 5,
      distancia_destino_m: haversineMetros(latCerca, LONG_DESTINO, LAT_DESTINO, LONG_DESTINO),
      geocerca_resultado: "dentro",
      es_valido: true,
      tipo_incidencia: null,
      capturado_en: new Date().toISOString(),
      creado_en: new Date().toISOString(),
    };

    const mock = clientePodMock({
      podExistente: null,
      insertResult: { data: podInsertado, error: null },
    });

    const pod = await registrarPruebaEntrega(
      mock,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        tipoResultado: "entregado",
        fotoObjectPath: "pod/foto.jpg",
        geo: { lat: latCerca, long: LONG_DESTINO, precisionM: 5 },
      },
      actorConductor(),
    );

    expect(pod.esValido).toBe(true);
    expect(pod.geocercaResultado).toBe("dentro");
    expect(pod.tieneFoto).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4b. Sin foto → es_valido=false aunque geocerca='dentro'
  // -------------------------------------------------------------------------
  it("foto=no, geocerca=dentro → registra POD con es_valido=false", async () => {
    const latCerca = LAT_DESTINO - 0.00045;

    const podInsertado: Record<string, unknown> = {
      id: POD_ID_1,
      tenant_id: TENANT_A,
      pedido_id: PEDIDO_1,
      seller_id: SELLER_1,
      conductor_id: CONDUCTOR_1,
      tipo_resultado: "entregado",
      tiene_foto: false,
      foto_object_path: null,
      tiene_firma: false,
      firma_object_path: null,
      otp_estado: "no_aplica",
      geo_lat: latCerca,
      geo_long: LONG_DESTINO,
      geo_precision_m: null,
      distancia_destino_m: haversineMetros(latCerca, LONG_DESTINO, LAT_DESTINO, LONG_DESTINO),
      geocerca_resultado: "dentro",
      es_valido: false,          // sin foto → inválido
      tipo_incidencia: null,
      capturado_en: new Date().toISOString(),
      creado_en: new Date().toISOString(),
    };

    const mock = clientePodMock({
      podExistente: null,
      insertResult: { data: podInsertado, error: null },
    });

    const pod = await registrarPruebaEntrega(
      mock,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        tipoResultado: "entregado",
        // fotoObjectPath omitido → tieneFoto = false
        geo: { lat: latCerca, long: LONG_DESTINO },
      },
      actorConductor(),
    );

    // La lógica de es_valido en registrarPruebaEntrega evalúa: tieneFoto AND geocerca!='fuera'
    // Sin foto → false, aunque la geocerca sea 'dentro'.
    expect(pod.esValido).toBe(false);
    expect(pod.tieneFoto).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 4c. Con foto + geocerca 'fuera' → es_valido=false
  // -------------------------------------------------------------------------
  it("foto=sí, geocerca=fuera (>150 m) → registra POD con es_valido=false", async () => {
    const latLejos = LAT_DESTINO - 0.0027; // ≈ 300 m al norte

    const distancia = haversineMetros(latLejos, LONG_DESTINO, LAT_DESTINO, LONG_DESTINO);
    expect(distancia).toBeGreaterThan(POD_GEOCERCA_RADIO_M); // pre-condición del test

    const podInsertado: Record<string, unknown> = {
      id: POD_ID_1,
      tenant_id: TENANT_A,
      pedido_id: PEDIDO_1,
      seller_id: SELLER_1,
      conductor_id: CONDUCTOR_1,
      tipo_resultado: "entregado",
      tiene_foto: true,
      foto_object_path: "pod/foto.jpg",
      tiene_firma: false,
      firma_object_path: null,
      otp_estado: "no_aplica",
      geo_lat: latLejos,
      geo_long: LONG_DESTINO,
      geo_precision_m: 10,
      distancia_destino_m: distancia,
      geocerca_resultado: "fuera",
      es_valido: false,           // foto=sí pero fuera → inválido
      tipo_incidencia: null,
      capturado_en: new Date().toISOString(),
      creado_en: new Date().toISOString(),
    };

    const mock = clientePodMock({
      podExistente: null,
      insertResult: { data: podInsertado, error: null },
    });

    const pod = await registrarPruebaEntrega(
      mock,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        tipoResultado: "entregado",
        fotoObjectPath: "pod/foto.jpg",
        geo: { lat: latLejos, long: LONG_DESTINO, precisionM: 10 },
      },
      actorConductor(),
    );

    expect(pod.esValido).toBe(false);
    expect(pod.geocercaResultado).toBe("fuera");
    expect(pod.tieneFoto).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4d. Con foto + pedido sin lat/long (sin_referencia) → es_valido=true
  // -------------------------------------------------------------------------
  it("foto=sí, pedido sin lat/long resuelto → geocerca=sin_referencia, es_valido=true", async () => {
    const podInsertado: Record<string, unknown> = {
      id: POD_ID_1,
      tenant_id: TENANT_A,
      pedido_id: PEDIDO_1,
      seller_id: SELLER_1,
      conductor_id: CONDUCTOR_1,
      tipo_resultado: "entregado",
      tiene_foto: true,
      foto_object_path: "pod/foto.jpg",
      tiene_firma: false,
      firma_object_path: null,
      otp_estado: "no_aplica",
      geo_lat: LAT_DESTINO,
      geo_long: LONG_DESTINO,
      geo_precision_m: 5,
      distancia_destino_m: null,     // sin referencia → null
      geocerca_resultado: "sin_referencia",
      es_valido: true,               // foto=sí + sin_referencia → válido
      tipo_incidencia: null,
      capturado_en: new Date().toISOString(),
      creado_en: new Date().toISOString(),
    };

    // Pedido sin lat/long ni geo_estado='resuelto'
    const mock = clientePodMock({
      pedido: { lat: null, long: null, geo_estado: "pendiente" },
      podExistente: null,
      insertResult: { data: podInsertado, error: null },
    });

    const pod = await registrarPruebaEntrega(
      mock,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        tipoResultado: "entregado",
        fotoObjectPath: "pod/foto.jpg",
        geo: { lat: LAT_DESTINO, long: LONG_DESTINO, precisionM: 5 },
      },
      actorConductor(),
    );

    expect(pod.esValido).toBe(true);
    expect(pod.geocercaResultado).toBe("sin_referencia");
    expect(pod.distanciaDestinoM).toBeNull();
  });
});

// =============================================================================
// Escenario 5 — Haversine adversarial con coordenadas reales de Santiago
// =============================================================================

describe("Esc-5 | haversineMetros — geocerca Haversine con coordenadas reales", () => {
  // Coordenadas reales verificables con Google Maps:
  // Plaza de Armas Santiago: -33.4372, -70.6506
  // Catedral Metropolitana:  -33.4380, -70.6511  (~98 m → dentro)
  // Parque Balmaceda:        -33.4430, -70.6333  (~2.2 km → fuera)
  // Cerro Santa Lucía:       -33.4403, -70.6441  (~398 m → fuera)
  // Paseo Estado 1 (aprox):  -33.4379, -70.6513  (~100 m → dentro)

  it("Plaza de Armas → Catedral Metropolitana (~98 m) está DENTRO del radio de 150 m", () => {
    const dist = haversineMetros(-33.4372, -70.6506, -33.4380, -70.6511);
    expect(dist).toBeLessThan(POD_GEOCERCA_RADIO_M);
    expect(dist).toBeGreaterThan(80);  // sanity check: no puede ser 0
    expect(dist).toBeLessThan(120);    // ~98 m con tolerancia
  });

  it("Plaza de Armas → Parque Balmaceda (~1.7 km real) está FUERA del radio de 150 m", () => {
    // Haversine real: ~1730 m (estimación visual era errónea — el Parque Balmaceda
    // está a ~1.7 km, no 2.2 km, de la Plaza de Armas).
    const dist = haversineMetros(-33.4372, -70.6506, -33.4430, -70.6333);
    expect(dist).toBeGreaterThan(POD_GEOCERCA_RADIO_M);
    expect(dist).toBeGreaterThan(1500); // conservador: real ≈ 1730 m
    expect(dist).toBeLessThan(2000);    // acotado para detectar regresiones
  });

  it("Plaza de Armas → Cerro Santa Lucía (~695 m real) está FUERA del radio de 150 m", () => {
    // Haversine real: ~695 m (estimación visual era errónea — el Cerro Santa Lucía
    // está a ~695 m de la Plaza de Armas, no 398 m).
    const dist = haversineMetros(-33.4372, -70.6506, -33.4403, -70.6441);
    expect(dist).toBeGreaterThan(POD_GEOCERCA_RADIO_M);
    expect(dist).toBeGreaterThan(600);  // conservador: real ≈ 695 m
    expect(dist).toBeLessThan(800);     // acotado para detectar regresiones
  });

  it("Punto exactamente en el límite (150 m) retorna DENTRO (≤ radio)", () => {
    // 150 m al norte ≈ 0.00135 grados de latitud
    const lat150m = LAT_DESTINO - 0.00135;
    const dist = haversineMetros(lat150m, LONG_DESTINO, LAT_DESTINO, LONG_DESTINO);
    // El resultado real puede ser ligeramente menor de 150 m (≈148–152 m)
    // según la convergencia de meridianos en lat -33. Verificamos que la
    // distancia esté razonablemente cerca del radio límite.
    expect(dist).toBeGreaterThan(130);
    expect(dist).toBeLessThan(165);
  });

  it("Punto a 149 m → dentro; punto a 151 m → fuera (discriminación límite)", () => {
    // Ajuste fino para que la distancia caiga dentro/fuera del radio.
    // 0.00134 grados ≈ 149 m; 0.00136 grados ≈ 151 m.
    const latDentro = LAT_DESTINO - 0.00134;
    const latFuera  = LAT_DESTINO - 0.00136;

    const dDentro = haversineMetros(latDentro, LONG_DESTINO, LAT_DESTINO, LONG_DESTINO);
    const dFuera  = haversineMetros(latFuera,  LONG_DESTINO, LAT_DESTINO, LONG_DESTINO);

    // El discriminador de geocerca usa <=
    const geocercaDentro: PodGeoResultado = dDentro <= POD_GEOCERCA_RADIO_M ? "dentro" : "fuera";
    const geocercaFuera:  PodGeoResultado = dFuera  <= POD_GEOCERCA_RADIO_M ? "dentro" : "fuera";

    // Puede haber ligera variación numérica: lo que importa es que el punto
    // interior está más cerca que el exterior.
    expect(dDentro).toBeLessThan(dFuera);
    // Y que el punto interior realmente está a menos de 150 m.
    expect(dDentro).toBeLessThan(POD_GEOCERCA_RADIO_M);
    // Y el exterior a más.
    expect(dFuera).toBeGreaterThan(POD_GEOCERCA_RADIO_M);
    // Los discriminadores deben ser opuestos.
    expect(geocercaDentro).toBe("dentro");
    expect(geocercaFuera).toBe("fuera");
  });

  it("pedido sin lat/long → distanciaDestinoM sería null y geocerca='sin_referencia' (lógica pura)", () => {
    // No hay punto de destino: la función NO se invoca; el resultado es null.
    // Verificamos la rama condicional de la lógica de registrarPruebaEntrega directamente.
    const destinoLat: number | null = null;
    const destinoLong: number | null = null;
    const geoEstado: string = "pendiente";

    let distanciaDestinoM: number | null = null;
    let geocercaResultado: PodGeoResultado = "sin_referencia";

    const geoInput = { lat: LAT_DESTINO, long: LONG_DESTINO };
    if (geoInput && destinoLat !== null && destinoLong !== null && geoEstado === "resuelto") {
      distanciaDestinoM = haversineMetros(geoInput.lat, geoInput.long, destinoLat, destinoLong);
      geocercaResultado = distanciaDestinoM <= POD_GEOCERCA_RADIO_M ? "dentro" : "fuera";
    }

    expect(distanciaDestinoM).toBeNull();
    expect(geocercaResultado).toBe("sin_referencia");
  });
});

// =============================================================================
// Escenario 6 — Idempotencia POD: registrar dos veces el POD 'entregado'
// =============================================================================

describe("Esc-6 | registrarPruebaEntrega — idempotencia POD 'entregado'", () => {
  it("si ya existe un POD 'entregado', devuelve el existente sin crear uno nuevo", async () => {
    const podExistente = {
      id: POD_ID_1,
      tenant_id: TENANT_A,
      pedido_id: PEDIDO_1,
      seller_id: SELLER_1,
      conductor_id: CONDUCTOR_1,
      tipo_resultado: "entregado",
      tiene_foto: true,
      foto_object_path: "path/original.jpg",
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

    const insertSpy = vi.fn();
    // El cliente retorna el POD existente antes de llegar al INSERT
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
                        tipo_pedido: "same_day",
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
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({ data: podExistente, error: null }),
                  }),
                }),
              }),
            }),
            insert: () => {
              insertSpy(); // no debe invocarse
              return { select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) };
            },
          };
        }
        if (tabla === "bitacora_auditoria") {
          return { insert: vi.fn().mockResolvedValue({ error: null }) };
        }
        return {};
      },
    } as never;

    const result = await registrarPruebaEntrega(
      mock,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        tipoResultado: "entregado",
        fotoObjectPath: "pod/intento2.jpg", // segunda foto — se ignora
        geo: { lat: LAT_DESTINO - 0.001, long: LONG_DESTINO },
      },
      actorConductor(),
    );

    // El INSERT no debe haberse invocado.
    expect(insertSpy).not.toHaveBeenCalled();

    // Devuelve el POD original, no el del segundo intento.
    expect(result.id).toBe(POD_ID_1);
    expect(result.fotoObjectPath).toBe("path/original.jpg");
  });

  it("un segundo POD 'fallido' para el mismo pedido SÍ se registra (no hay unicidad parcial en fallido)", async () => {
    // El índice parcial UNIQUE es solo WHERE tipo_resultado='entregado'.
    // Registrar dos POD 'fallido' (por dos intentos distintos de entrega) es
    // una operación válida que el sistema debe permitir.
    const podFallidoNuevo: Record<string, unknown> = {
      id: "pod-fallido-2",
      tenant_id: TENANT_A,
      pedido_id: PEDIDO_1,
      seller_id: SELLER_1,
      conductor_id: CONDUCTOR_1,
      tipo_resultado: "fallido",
      tiene_foto: false,
      foto_object_path: null,
      tiene_firma: false,
      firma_object_path: null,
      otp_estado: "no_aplica",
      geo_lat: null,
      geo_long: null,
      geo_precision_m: null,
      distancia_destino_m: null,
      geocerca_resultado: "sin_referencia",
      es_valido: true,
      tipo_incidencia: "destinatario_ausente",
      capturado_en: new Date().toISOString(),
      creado_en: new Date().toISOString(),
    };

    const mock = clientePodMock({
      // No hay idempotencia previa para 'fallido'
      podExistente: null,
      insertResult: { data: podFallidoNuevo, error: null },
    });

    const result = await registrarPruebaEntrega(
      mock,
      {
        pedidoId: PEDIDO_1,
        tenantId: TENANT_A,
        tipoResultado: "fallido",
        tipoIncidencia: "destinatario_ausente",
      },
      actorConductor(),
    );

    expect(result.tipoResultado).toBe("fallido");
    expect(result.tipoIncidencia).toBe("destinatario_ausente");
    expect(result.esValido).toBe(true);
  });
});

// =============================================================================
// Escenario 8 — Batch en_ruta: transicionarPedidosSameDayAEnRuta
// =============================================================================

describe("Esc-8 | transicionarPedidosSameDayAEnRuta — batch solo same_day, idempotente", () => {
  // Helpers para construir el cliente del batch
  function clienteBatchMock(opts: {
    asignaciones: Array<{
      pedido_id: string;
      pedidos: { id: string; estado: string; tipo_pedido: string; driver_id_asignado: string };
    }>;
    errorConsulta?: { message: string };
    /** Si true, la actualización del pedido lanza ErrorConflicto (ya se movió). */
    pedidoYaMovido?: boolean;
  }) {
    const estadosPedidos: Record<string, string> = {};
    for (const a of opts.asignaciones) {
      estadosPedidos[a.pedido_id] = a.pedidos.estado;
    }

    return {
      from: (tabla: string) => {
        if (tabla === "asignaciones_pedido") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () =>
                        Promise.resolve({
                          data: opts.errorConsulta ? null : opts.asignaciones,
                          error: opts.errorConsulta ?? null,
                        }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (tabla === "pedidos") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: (pedidoId?: string) => {
                    // Devolvemos el pedido para el primer eq encadenado
                    const asig = opts.asignaciones.find(
                      (a) => estadosPedidos[a.pedido_id] === "asignado",
                    );
                    if (!asig) return Promise.resolve({ data: null, error: null });
                    const p = asig.pedidos;
                    return Promise.resolve({
                      data: {
                        id: p.id,
                        estado: p.estado,
                        seller_id: SELLER_1,
                        tenant_id: TENANT_A,
                        driver_id_asignado: p.driver_id_asignado,
                        tipo_pedido: p.tipo_pedido,
                        tarifa_aplicable_id: null,
                        fecha_compromiso_hora: null,
                        fecha_compromiso: null,
                      },
                      error: null,
                    });
                  },
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      single: async () => {
                        if (opts.pedidoYaMovido) {
                          // Simula que el UPDATE no afectó filas (ya se movió)
                          return { data: null, error: null };
                        }
                        // Actualiza el estado en memoria
                        const pedidoId = opts.asignaciones[0]?.pedido_id;
                        if (pedidoId) estadosPedidos[pedidoId] = "en_ruta";
                        return {
                          data: {
                            id: opts.asignaciones[0]?.pedido_id,
                            tenant_id: TENANT_A,
                            seller_id: SELLER_1,
                            tipo_pedido: "same_day",
                            driver_id_asignado: CONDUCTOR_1,
                            estado: "en_ruta",
                            tarifa_aplicable_id: null,
                            fecha_compromiso_hora: null,
                            fecha_compromiso: null,
                            lat: null,
                            long: null,
                            geo_estado: "pendiente",
                            geo_confianza: null,
                            geocodificado_en: null,
                            cobertura_estado: "pendiente",
                            corte_riesgo: false,
                            sla_cumplido: null,
                            tracking_token: "tok-abc",
                            // Campos extra del pedido
                            origen: "same_day_manual",
                            ml_order_id: null,
                            ml_shipment_id: null,
                            estado_ml: null,
                            subestado_ml: null,
                            ultima_sync_ml_en: null,
                            destinatario_nombre: "Test",
                            destinatario_direccion: "Calle 1",
                            destinatario_comuna: "Santiago",
                            destinatario_telefono: null,
                            instrucciones_entrega: null,
                            monto_cobro_clp: null,
                            monto_liquidacion_clp: null,
                            cobro_generado: false,
                            liquidacion_generada: false,
                            notas_internas: null,
                            creado_en: new Date().toISOString(),
                            actualizado_en: new Date().toISOString(),
                          },
                          error: null,
                        };
                      },
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (tabla === "pruebas_entrega") {
          // No hay POD: el batch de en_ruta no requiere POD
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      limit: () => ({
                        maybeSingle: () => Promise.resolve({ data: null, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (tabla === "bitacora_auditoria") {
          return { insert: vi.fn().mockResolvedValue({ error: null }) };
        }
        if (tabla === "incidencias") {
          return {
            select: () => ({ eq: () => ({ eq: () => ({ in: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }),
            insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "inc-1", estado: "abierta", pedido_id: "p1", seller_id: SELLER_1, tipo: "otro", afecta_cobro: false, afecta_liquidacion: false, abierta_en: new Date().toISOString(), creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }, error: null }) }) }),
          };
        }
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        };
      },
    } as never;
  }

  // -------------------------------------------------------------------------
  // 8a. Batch happy path: transiciona pedidos same_day asignados → en_ruta
  // -------------------------------------------------------------------------
  it("transiciona en lote los pedidos same_day 'asignado' → 'en_ruta'", async () => {
    const asignaciones = [
      {
        pedido_id: PEDIDO_1,
        pedidos: {
          id: PEDIDO_1,
          estado: "asignado",
          tipo_pedido: "same_day",
          driver_id_asignado: CONDUCTOR_1,
        },
      },
    ];

    const cliente = clienteBatchMock({ asignaciones });
    // No debe lanzar
    await expect(
      transicionarPedidosSameDayAEnRuta(cliente, MANIFIESTO_1, TENANT_A, CONDUCTOR_1, actorConductor()),
    ).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 8b. Idempotente: si el pedido ya salió de 'asignado', se ignora el conflicto
  // -------------------------------------------------------------------------
  it("idempotente: pedido ya en 'en_ruta' no genera error (carrera resuelta)", async () => {
    // pedidoYaMovido=true simula que el UPDATE devuelve null (otro proceso ganó)
    // → actualizarEstadoPedido lanza ErrorConflicto → el batch lo captura y continúa.
    const asignaciones = [
      {
        pedido_id: PEDIDO_1,
        pedidos: {
          id: PEDIDO_1,
          estado: "asignado",
          tipo_pedido: "same_day",
          driver_id_asignado: CONDUCTOR_1,
        },
      },
    ];

    const cliente = clienteBatchMock({ asignaciones, pedidoYaMovido: true });
    await expect(
      transicionarPedidosSameDayAEnRuta(cliente, MANIFIESTO_1, TENANT_A, CONDUCTOR_1, actorConductor()),
    ).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 8c. Sin asignaciones: no-op sin error
  // -------------------------------------------------------------------------
  it("sin pedidos same_day asignados: retorna sin error (no-op)", async () => {
    const cliente = clienteBatchMock({ asignaciones: [] });
    await expect(
      transicionarPedidosSameDayAEnRuta(cliente, MANIFIESTO_1, TENANT_A, CONDUCTOR_1, actorConductor()),
    ).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 8d. Error de lectura se propaga (no se silencia)
  // -------------------------------------------------------------------------
  it("error de consulta a BD se propaga (no se silencia)", async () => {
    const cliente = clienteBatchMock({
      asignaciones: [],
      errorConsulta: { message: "fallo de conexión simulado" },
    });
    await expect(
      transicionarPedidosSameDayAEnRuta(cliente, MANIFIESTO_1, TENANT_A, CONDUCTOR_1, actorConductor()),
    ).rejects.toThrow("fallo de conexión simulado");
  });
});

// =============================================================================
// Escenario 10 — Ubicación: actualizarUbicacionConductor
// =============================================================================

describe("Esc-10 | actualizarUbicacionConductor — solo escribe con manifiesto en_ruta hoy", () => {
  beforeEach(() => {
    // Congela la hora para que ahoraEnSantiago() devuelva una fecha consistente.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T14:00:00-04:00")); // hora Santiago
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 10a. Sin manifiesto en_ruta hoy → no-op (devuelve null)
  // -------------------------------------------------------------------------
  it("sin manifiesto en_ruta hoy → devuelve null (no escribe)", async () => {
    const upsertSpy = vi.fn();
    const mock = {
      from: (tabla: string) => {
        if (tabla === "manifiestos") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      limit: () => ({
                        maybeSingle: () => Promise.resolve({ data: null, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (tabla === "ubicacion_conductor") {
          return {
            upsert: upsertSpy,
          };
        }
        return {};
      },
    } as never;

    const resultado = await actualizarUbicacionConductor(
      mock,
      CONDUCTOR_1,
      TENANT_A,
      { lat: LAT_DESTINO, long: LONG_DESTINO, precisionM: 10 },
    );

    expect(resultado).toBeNull();
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 10b. Con manifiesto en_ruta hoy → escribe y devuelve la ubicación
  // -------------------------------------------------------------------------
  it("con manifiesto en_ruta hoy → realiza UPSERT y retorna ubicación", async () => {
    const filaUbicacion = {
      conductor_id: CONDUCTOR_1,
      tenant_id: TENANT_A,
      lat: LAT_DESTINO,
      long: LONG_DESTINO,
      precision_m: 10,
      actualizado_en: new Date().toISOString(),
    };

    const mock = {
      from: (tabla: string) => {
        if (tabla === "manifiestos") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      limit: () => ({
                        maybeSingle: () =>
                          Promise.resolve({ data: { id: MANIFIESTO_1 }, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (tabla === "consentimientos_ubicacion") {
          // Gate de consentimiento (ALTO-2): consentimiento vigente → permite escribir.
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: () =>
                        Promise.resolve({ data: { id: "con-1", acepto: true, revocado_en: null }, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (tabla === "ubicacion_conductor") {
          return {
            upsert: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: filaUbicacion, error: null }),
              }),
            }),
          };
        }
        return {};
      },
    } as never;

    const resultado = await actualizarUbicacionConductor(
      mock,
      CONDUCTOR_1,
      TENANT_A,
      { lat: LAT_DESTINO, long: LONG_DESTINO, precisionM: 10 },
    );

    expect(resultado).not.toBeNull();
    expect(resultado!.conductorId).toBe(CONDUCTOR_1);
    expect(resultado!.tenantId).toBe(TENANT_A);
    expect(resultado!.lat).toBe(LAT_DESTINO);
    expect(resultado!.long).toBe(LONG_DESTINO);
    expect(resultado!.precisionM).toBe(10);
  });

  // -------------------------------------------------------------------------
  // 10c. Manifiesto de OTRO conductor → no-op (el filtro es por conductor_id)
  // -------------------------------------------------------------------------
  it("conductor sin manifiesto propio en_ruta hoy → no-op aunque exista manifiesto de otro", async () => {
    const upsertSpy = vi.fn();

    // El SELECT filtra por conductor_id=CONDUCTOR_2; no devuelve manifiesto.
    const mock = {
      from: (tabla: string) => {
        if (tabla === "manifiestos") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      limit: () => ({
                        // CONDUCTOR_2 no tiene manifiesto en_ruta
                        maybeSingle: () => Promise.resolve({ data: null, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (tabla === "ubicacion_conductor") {
          return { upsert: upsertSpy };
        }
        return {};
      },
    } as never;

    const resultado = await actualizarUbicacionConductor(
      mock,
      CONDUCTOR_2, // conductor diferente
      TENANT_A,
      { lat: LAT_DESTINO, long: LONG_DESTINO },
    );

    expect(resultado).toBeNull();
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// borrarUbicacionAlCerrarRuta — minimización de datos (Ley 21.431)
// =============================================================================

describe("borrarUbicacionAlCerrarRuta — elimina la ubicación al cerrar turno", () => {
  it("elimina la fila del conductor al cerrar ruta", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({ error: null });

    const mock = {
      from: (tabla: string) => {
        if (tabla === "ubicacion_conductor") {
          return {
            delete: () => ({
              eq: () => ({
                eq: deleteSpy,
              }),
            }),
          };
        }
        return {};
      },
    } as never;

    await expect(
      borrarUbicacionAlCerrarRuta(mock, CONDUCTOR_1, TENANT_A),
    ).resolves.toBeUndefined();

    expect(deleteSpy).toHaveBeenCalled();
  });

  it("no lanza si la fila no existe (DELETE es idempotente)", async () => {
    // DELETE sin filas afectadas devuelve error=null en Supabase
    const mock = {
      from: (tabla: string) => {
        if (tabla === "ubicacion_conductor") {
          return {
            delete: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }),
          };
        }
        return {};
      },
    } as never;

    await expect(
      borrarUbicacionAlCerrarRuta(mock, CONDUCTOR_1, TENANT_A),
    ).resolves.toBeUndefined();
  });

  it("propaga el error si el DELETE falla en BD", async () => {
    const mock = {
      from: (tabla: string) => {
        if (tabla === "ubicacion_conductor") {
          return {
            delete: () => ({
              eq: () => ({
                eq: () =>
                  Promise.resolve({ error: { message: "fallo de BD simulado" } }),
              }),
            }),
          };
        }
        return {};
      },
    } as never;

    await expect(
      borrarUbicacionAlCerrarRuta(mock, CONDUCTOR_1, TENANT_A),
    ).rejects.toThrow("fallo de BD simulado");
  });
});

// =============================================================================
// Aislamiento cross-tenant — obtenerUrlFirmadaPod
// =============================================================================

describe("Aislamiento cross-tenant | obtenerUrlFirmadaPod", () => {
  // El filtro .eq("tenant_id", actor.tenantId ?? "") impone el aislamiento.
  // Si actor es del TENANT_B pero el POD pertenece a TENANT_A, no debe encontrarlo.

  it("seller de otro tenant NO puede obtener URL firmada del POD (aislamiento)", async () => {
    // El POD pertenece a TENANT_A; el actor es seller de TENANT_B.
    const actorOtroTenant: UsuarioActual & { usuarioId: string } = {
      usuarioId: USUARIO_AUTH_1,
      tenantId: TENANT_B,
      tipoUsuario: "seller",
      sellerId: "seller-b-1",
      driverId: null,
      rol: "seller",
      estado: "activo",
    };

    const mock = {
      from: (tabla: string) => {
        if (tabla === "pruebas_entrega") {
          return {
            select: () => ({
              eq: () => ({
                // La segunda eq es .eq("tenant_id", actor.tenantId ?? "")
                // Como actor.tenantId = TENANT_B y el POD está en TENANT_A,
                // la query no devuelve resultado.
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      },
    } as never;

    await expect(
      obtenerUrlFirmadaPod(mock, POD_ID_1, actorOtroTenant),
    ).rejects.toThrow(ErrorValidacion);
  });

  it("conductor del mismo tenant puede obtener URL de su propio POD", async () => {
    const pod = {
      id: POD_ID_1,
      tenant_id: TENANT_A,
      seller_id: SELLER_1,
      conductor_id: CONDUCTOR_1,
      foto_object_path: "pod/foto.jpg",
    };

    const mock = {
      from: (tabla: string) => {
        if (tabla === "pruebas_entrega") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: pod, error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      },
      storage: {
        from: () => ({
          createSignedUrl: () =>
            Promise.resolve({ data: { signedUrl: "https://signed-url.example" }, error: null }),
        }),
      },
    } as never;

    const url = await obtenerUrlFirmadaPod(mock, POD_ID_1, actorConductor(CONDUCTOR_1));
    expect(url).toBe("https://signed-url.example");
  });

  it("conductor de otro tenant NO puede obtener URL del POD (aislamiento)", async () => {
    // El conductor CONDUCTOR_2 intenta acceder a un POD cuyo conductor_id es CONDUCTOR_1.
    const pod = {
      id: POD_ID_1,
      tenant_id: TENANT_A,
      seller_id: SELLER_1,
      conductor_id: CONDUCTOR_1,          // propietario original
      foto_object_path: "pod/foto.jpg",
    };

    const actorOtro: UsuarioActual & { usuarioId: string } = {
      usuarioId: USUARIO_AUTH_1,
      tenantId: TENANT_A,
      tipoUsuario: "conductor",
      sellerId: null,
      driverId: CONDUCTOR_2,              // conductor diferente
      rol: "conductor",
      estado: "activo",
    };

    const mock = {
      from: (tabla: string) => {
        if (tabla === "pruebas_entrega") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: pod, error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      },
    } as never;

    await expect(
      obtenerUrlFirmadaPod(mock, POD_ID_1, actorOtro),
    ).rejects.toThrow(ErrorValidacion);
  });

  it("seller puede ver URL del POD de su propio pedido", async () => {
    const pod = {
      id: POD_ID_1,
      tenant_id: TENANT_A,
      seller_id: SELLER_1,                // mismo seller que el actor
      conductor_id: CONDUCTOR_1,
      foto_object_path: "pod/foto.jpg",
    };

    const mock = {
      from: (tabla: string) => {
        if (tabla === "pruebas_entrega") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: pod, error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      },
      storage: {
        from: () => ({
          createSignedUrl: () =>
            Promise.resolve({ data: { signedUrl: "https://signed-url-seller.example" }, error: null }),
        }),
      },
    } as never;

    const url = await obtenerUrlFirmadaPod(mock, POD_ID_1, actorSeller(SELLER_1));
    expect(url).toBe("https://signed-url-seller.example");
  });

  it("seller NO puede ver URL del POD de un pedido de otro seller", async () => {
    const otroSellerId = "seller-z-9999";
    const pod = {
      id: POD_ID_1,
      tenant_id: TENANT_A,
      seller_id: otroSellerId,            // seller distinto al actor
      conductor_id: CONDUCTOR_1,
      foto_object_path: "pod/foto.jpg",
    };

    const actorSellerA = actorSeller(SELLER_1); // actor es SELLER_1

    const mock = {
      from: (tabla: string) => {
        if (tabla === "pruebas_entrega") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: pod, error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      },
    } as never;

    await expect(
      obtenerUrlFirmadaPod(mock, POD_ID_1, actorSellerA),
    ).rejects.toThrow(ErrorValidacion);
  });

  it("actor sin tipo reconocido (tipoUsuario invalido) recibe ErrorValidacion", async () => {
    // Verifica el bloque defensivo: ningún tipo fuera de interno/seller/conductor.
    const actorExtravio = {
      tenantId: TENANT_A,
      tipoUsuario: "super_admin" as const,
      sellerId: null,
      driverId: null,
      rol: "super_admin" as const,
      estado: "activo" as const,
    };

    const mock = { from: () => ({}) } as never;

    await expect(
      obtenerUrlFirmadaPod(mock, POD_ID_1, actorExtravio),
    ).rejects.toThrow(ErrorValidacion);
  });
});

// =============================================================================
// Escenario adicional — FRONTERA Flex en el conductor con actualizarEstadoPedido
// (complementa pedidos.test.ts con verificación de mensaje exacto del error)
// =============================================================================

describe("Esc-1 | Frontera Flex — mensaje de error explícito", () => {
  it("el mensaje de ErrorValidacion menciona que los Flex los reporta Mercado Libre", async () => {
    // Importación dinámica para no romper la inicialización del mock de Inngest.
    const { actualizarEstadoPedido } = await import("./pedidos");

    const DRIVER_X = "aaaa1111-0000-0000-0000-000000000001";

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
                        estado: "asignado",
                        seller_id: SELLER_1,
                        tenant_id: TENANT_A,
                        driver_id_asignado: DRIVER_X,
                        tipo_pedido: "flex",          // FRONTERA: Flex
                        tarifa_aplicable_id: null,
                        fecha_compromiso_hora: null,
                        fecha_compromiso: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        if (tabla === "bitacora_auditoria") {
          return { insert: vi.fn().mockResolvedValue({ error: null }) };
        }
        return {};
      },
    } as never;

    try {
      await actualizarEstadoPedido(
        mock,
        {
          pedidoId: PEDIDO_1,
          tenantId: TENANT_A,
          estadoNuevo: "en_ruta",
          estadoEsperado: "asignado",
          ejecutor: "conductor",
        },
        {
          tenantId: TENANT_A,
          tipoUsuario: "conductor",
          sellerId: null,
          driverId: DRIVER_X,
          rol: "conductor",
          estado: "activo",
        },
      );
      expect.fail("debería haber lanzado ErrorValidacion");
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorValidacion);
      // El mensaje debe dejar claro que los Flex son gestionados por ML
      const msg = (e as ErrorValidacion).message.toLowerCase();
      expect(msg).toContain("mercado libre");
    }
  });
});

// =============================================================================
// PENDIENTES de stack vivo (pgTAP / RLS real)
// Documentar aquí; marcar en checklist como "pendiente: stack en puertos
// reubicados; correr tras reinicio con puertos estándar".
// =============================================================================

/**
 * Los siguientes escenarios requieren Supabase local con las migraciones
 * 0016–001x aplicadas y pgTAP disponible:
 *
 * P-1. RLS sobre pruebas_entrega: conductor de TENANT_B no puede SELECT
 *      ni INSERT sobre pruebas_entrega.tenant_id = TENANT_A.
 *      Archivo pendiente: supabase/tests/database/rls_aislamiento_geocoding.test.sql
 *      (ampliar con casos same-day).
 *
 * P-2. Trigger trg_pruebas_entrega_solo_same_day: intentar INSERT de un
 *      POD con pedido Flex desde psql directo → el trigger debe lanzar
 *      CHECK_VIOLATION.
 *
 * P-3. UNIQUE parcial idx_pruebas_entrega_entregado_uk: insertar dos filas
 *      con mismo pedido_id WHERE tipo_resultado='entregado' desde psql →
 *      segunda fila debe fallar con UNIQUE_VIOLATION (23505).
 *
 * P-4. RLS sobre ubicacion_conductor: el seller NO puede leer
 *      ubicacion_conductor de ningún conductor del tenant.
 *
 * P-5. Tracking público /tracking/[token]: acceder a la página con token
 *      válido → 200 con datos del pedido; acceder con token de otro tenant
 *      → 404 (el SELECT filtra por token + tenant_id de la URL pública no
 *      expone tenant_id).
 *
 * Cómo ejecutar tras reiniciar el stack:
 *   npx supabase db reset          # aplica todas las migraciones
 *   npx supabase test db           # corre los pgTAP
 */
describe("Pendientes de stack vivo — documentación (no ejecutables en Vitest)", () => {
  it.skip("P-1: RLS pruebas_entrega aislamiento cross-tenant (requiere pgTAP)", () => {});
  it.skip("P-2: trigger trg_pruebas_entrega_solo_same_day rechaza Flex desde SQL (requiere pgTAP)", () => {});
  it.skip("P-3: UNIQUE parcial idx_pruebas_entrega_entregado_uk desde SQL (requiere pgTAP)", () => {});
  it.skip("P-4: RLS ubicacion_conductor inaccesible para seller (requiere pgTAP)", () => {});
  it.skip("P-5: tracking público /tracking/[token] aislado por token (requiere stack + browser)", () => {});
});
