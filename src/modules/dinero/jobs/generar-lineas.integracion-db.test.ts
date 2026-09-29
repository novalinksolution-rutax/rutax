/**
 * QA — motor entrega→dinero contra un Postgres REAL (Supabase local).
 *
 * Las pruebas con dobles (`generar-lineas-tarifa.test.ts`) demuestran que el job
 * llama a las cosas correctas; esta demuestra que lo que la base contesta es lo
 * que el job espera: el RPC `resolver_tarifa_por_comuna` expuesto por PostgREST,
 * los grants de service_role, el guardado real del paso 4 (RPC transaccional) y
 * las líneas que quedan escritas. Corre el HANDLER REAL de `jobGenerarLineas`
 * (solo se sustituye el cliente de Inngest y el paso `step.run`, que es un
 * pass-through).
 *
 * NO corre en `npm test`: necesita la base local levantada. Se activa con
 *
 *     QA_DB_LOCAL=1 npx vitest run src/modules/dinero/jobs/generar-lineas.integracion-db.test.ts
 *
 * Seguridad: se niega a ejecutarse si NEXT_PUBLIC_SUPABASE_URL no es
 * localhost/127.0.0.1 (jamás contra producción). Lee .env.local.
 *
 * Deja datos en la base local (tenants "QA-INT-*"). Limpieza opcional:
 *
 *   docker exec -i supabase_db_SaaS_Courier_Again psql -U postgres -d postgres <<'SQL'
 *   set session_replication_role = replica;
 *   do $$ declare r record; begin
 *     for r in select table_schema s, table_name t from information_schema.columns
 *              where column_name = 'tenant_id' and table_schema in
 *              ('identidad','operacion','dinero','integraciones','plataforma','contexto') loop
 *       execute format('delete from %I.%I where tenant_id in (select id from identidad.tenants where nombre_fantasia like %L)', r.s, r.t, 'QA-INT-%');
 *     end loop;
 *     delete from identidad.tenants where nombre_fantasia like 'QA-INT-%';
 *   end $$;
 *   SQL
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inngest/cliente", () => ({
  inngest: {
    createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

const ACTIVO = process.env.QA_DB_LOCAL === "1";

function cargarEnvLocal() {
  try {
    const txt = readFileSync(path.resolve(__dirname, "../../../../.env.local"), "utf8");
    for (const linea of txt.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    /* sin .env.local: fallará el guard de abajo */
  }
}

const suite = ACTIVO ? describe : describe.skip;

type Cliente = ReturnType<typeof import("@/lib/supabase/service-role").crearClienteServiceRole>;
type Handler = (ctx: {
  event: { data: Record<string, unknown> };
  step: { run: <T>(l: string, fn: () => Promise<T>) => Promise<T> };
  logger: { info: (m: string) => void; warn: (m: string) => void };
  runId: string;
}) => Promise<Record<string, unknown>>;

let db: Cliente;
let handler: Handler;
let guardarPaso4: (tenant: string, hoy: string, zonas: unknown) => Promise<{ error: { message: string } | null }>;
let hoy: string;
let ayer: string;
let hace10: string;

// Ids y RUT NUEVOS en cada corrida: la base local se reusa y un paso 4 re-guardado
// por una corrida anterior contaminaría la siguiente.
const CORRIDA = String(Date.now()).slice(-8);
const uid = (n: number) => `9f${String(n).padStart(6, "0")}-${CORRIDA.slice(0, 4)}-4000-8000-${CORRIDA}0000`;
const rutUnico = (base: number) => `${base}${CORRIDA.slice(-4)}-1`;
const T_A = uid(1); // con zonas y tarifas
const T_SIN = uid(2); // sin ninguna tarifa
const T_LEGADO = uid(3); // solo tarifa legada por régimen

const ids = {
  sellerA: uid(11),
  sellerSin: uid(12),
  sellerLeg: uid(13),
  driverA: uid(21),
  driverSin: uid(22),
  driverLeg: uid(23),
};

async function crearPedido(
  tenant: string,
  seller: string,
  sobre: Record<string, unknown> = {},
): Promise<string> {
  const id = crypto.randomUUID(); // distinto en cada corrida: la base local se reusa
  const { error } = await db.schema("operacion").from("pedidos").insert({
    id,
    tenant_id: tenant,
    seller_id: seller,
    tipo_pedido: "flex",
    fuente: "ml_flex",
    origen: "ml_ingesta",
    ml_shipment_id: `QA-INT-${id}`,
    estado: "entregado",
    destinatario_nombre: "Dest QA",
    destinatario_direccion: "Calle 1",
    destinatario_comuna: "Providencia",
    fecha_compromiso: hoy,
    ...sobre,
  });
  if (error) throw new Error(`pedido: ${error.message}`);
  return id;
}

async function entregar(
  pedidoId: string,
  tenant: string,
  seller: string,
  driver: string,
  sobre: Record<string, unknown> = {},
) {
  // 12:00 hora de Santiago del día pedido (UTC-3/-4: 15:00Z queda siempre en el mismo día local).
  const fecha = (sobre.dia as string | undefined) ?? hoy;
  delete sobre.dia;
  return handler({
    event: {
      data: {
        pedidoId,
        tenantId: tenant,
        sellerId: seller,
        driverIdAsignado: driver,
        estadoNuevo: "entregado",
        estadoAnterior: "en_ruta",
        fechaTransicion: `${fecha}T15:00:00.000Z`,
        tipoPedido: "flex",
        tarifaAplicableId: null,
        ...sobre,
      },
    },
    step: { run: (_l, fn) => fn() },
    logger: { info: () => undefined, warn: () => undefined },
    runId: `qa-run-${pedidoId}`,
  });
}

async function lineas(pedidoId: string) {
  const cobro = await db
    .schema("dinero")
    .from("lineas_cobro")
    .select("id, tarifa_id, monto_base_clp, monto_final_clp, snapshot_regla, anulada")
    .eq("pedido_id", pedidoId);
  const liq = await db
    .schema("dinero")
    .from("lineas_liquidacion")
    .select("id, monto_base_clp, monto_final_clp, snapshot_regla")
    .eq("pedido_id", pedidoId);
  const exc = await db
    .schema("dinero")
    .from("eventos_conciliacion")
    .select("tipo_diferencia, bloquea_facturacion, bloquea_pago, estado")
    .eq("pedido_id", pedidoId);
  // Un error de lectura NO puede leerse como «no hay líneas» (así se escondió uno).
  for (const r of [cobro, liq, exc]) if (r.error) throw new Error(`lectura: ${r.error.message}`);
  return { cobro: cobro.data ?? [], liq: liq.data ?? [], exc: exc.data ?? [] };
}

function zonasPayload(
  z1: string | null,
  z2: string | null,
  c1: number,
  p1: number,
  c2: number,
  p2: number,
  exc: { fuente: string; c: number; p: number }[] = [],
) {
  const ex = (z: 1 | 2) =>
    exc.map((e) => ({ fuente: e.fuente, cobro_clp: e.c, pago_clp: e.p })).filter(() => z === 1);
  return [
    {
      id: z1,
      nombre: "Gran Santiago urbano",
      es_respaldo: false,
      comunas: ["Providencia", "Ñuñoa"],
      cobro_clp: c1,
      pago_clp: p1,
      excepciones: ex(1),
    },
    {
      id: z2,
      nombre: "Periferia",
      es_respaldo: true,
      comunas: ["Buin", "Pirque"],
      cobro_clp: c2,
      pago_clp: p2,
      excepciones: [],
    },
  ];
}

suite("motor entrega→dinero contra Postgres real", () => {
  beforeAll(async () => {
    cargarEnvLocal();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
      throw new Error(`Se niega a correr: ${url || "(sin URL)"} no es la base local.`);
    }
    const { crearClienteServiceRole } = await import("@/lib/supabase/service-role");
    const { hoyEnSantiago } = await import("@/lib/fecha-santiago");
    const mod = await import("./generar-lineas");
    db = crearClienteServiceRole();
    handler = (mod.jobGenerarLineas as unknown as { handler: Handler }).handler;
    hoy = hoyEnSantiago();
    const { fechaLocalEnSantiago } = await import("@/lib/fecha-santiago");
    // 15:00Z cae siempre en el mismo día civil de Santiago (UTC-3/-4).
    const d = (n: number) => fechaLocalEnSantiago(new Date(Date.parse(`${hoy}T15:00:00Z`) + n * 86_400_000));
    ayer = d(-1);
    hace10 = d(-10);

    guardarPaso4 = async (tenant, fecha, zonas) => {
      const r = await db.schema("identidad").rpc("guardar_zonas_y_tarifas_puesta_en_marcha", {
        p_tenant_id: tenant,
        p_hoy: fecha,
        p_zonas: zonas as never,
      });
      return { error: r.error };
    };

    for (const [t, n, rut] of [
      [T_A, "A", rutUnico(7601)],
      [T_SIN, "SIN", rutUnico(7602)],
      [T_LEGADO, "LEG", rutUnico(7603)],
    ] as const) {
      const { error } = await db.schema("identidad").from("tenants").upsert(
        { id: t, nombre_fantasia: `QA-INT-${n}`, razon_social: `QA-INT-${n} SpA`, rut, estado: "activo" },
        { onConflict: "id" },
      );
      if (error) throw new Error(`tenant ${n}: ${error.message}`);
      await db.schema("identidad").from("courier_config_operacion").upsert(
        { tenant_id: t, ofrece_flex: true, ofrece_shopify: true, puesta_en_marcha_paso: 3 },
        { onConflict: "tenant_id" },
      );
    }
    for (const [s, t, n, rut] of [
      [ids.sellerA, T_A, "A", rutUnico(7701)],
      [ids.sellerSin, T_SIN, "SIN", rutUnico(7702)],
      [ids.sellerLeg, T_LEGADO, "LEG", rutUnico(7703)],
    ] as const) {
      const { error } = await db.schema("identidad").from("sellers").upsert(
        { id: s, tenant_id: t, razon_social: `Seller QA ${n}`, rut, estado: "activo" },
        { onConflict: "id" },
      );
      if (error) throw new Error(`seller ${n}: ${error.message}`);
    }
    for (const [dr, t, n, rut] of [
      [ids.driverA, T_A, "A", rutUnico(1101)],
      [ids.driverSin, T_SIN, "SIN", rutUnico(1102)],
      [ids.driverLeg, T_LEGADO, "LEG", rutUnico(1103)],
    ] as const) {
      const { error } = await db.schema("identidad").from("conductores").upsert(
        { id: dr, tenant_id: t, nombre_completo: `Cond QA ${n}`, rut, tipo_relacion: "independiente" },
        { onConflict: "id" },
      );
      if (error) throw new Error(`conductor ${n}: ${error.message}`);
    }

    // Tenant A: paso 4 guardado hace 10 días (vigente_desde < hoy). Sin
    // excepciones: Zona 1 = 3500/2400, Periferia = 4000/2900.
    const { data: yaHay } = await db.schema("identidad").from("zonas").select("id").eq("tenant_id", T_A);
    if (!yaHay || yaHay.length === 0) {
      const r = await guardarPaso4(T_A, hace10, zonasPayload(null, null, 3500, 2400, 4000, 2900));
      if (r.error) throw new Error(`paso 4: ${r.error.message}`);
    }

    // Tenant LEGADO: una sola tarifa legada por régimen, como las de antes de v2.
    const { data: leg } = await db.schema("identidad").from("tarifas").select("id").eq("tenant_id", T_LEGADO);
    if (!leg || leg.length === 0) {
      const { error } = await db.schema("identidad").from("tarifas").insert({
        tenant_id: T_LEGADO,
        tipo_entrega: "flex",
        modo_calculo: "monto_fijo",
        monto_clp: 1800,
        monto_conductor_clp: 1200,
        vigente_desde: "2026-01-01",
      });
      if (error) throw new Error(`legada: ${error.message}`);
    }
  });

  it("Flex entregado SIN tarifa_aplicable_id cobra y liquida con la tarifa de SU zona (> 0)", async () => {
    const p = await crearPedido(T_A, ids.sellerA);
    await entregar(p, T_A, ids.sellerA, ids.driverA);
    const l = await lineas(p);
    expect(l.cobro).toHaveLength(1);
    expect(l.liq).toHaveLength(1);
    expect(l.cobro[0].monto_final_clp).toBe(3500);
    expect(l.liq[0].monto_final_clp).toBe(2400);
    expect(l.cobro[0].snapshot_regla).toMatchObject({
      version: 2,
      zona: { por_respaldo: false, comuna_destinatario: "Providencia" },
      estado_pedido: { fuente: "ml_flex" },
    });
    expect(l.exc).toHaveLength(0);
  });

  it("comuna fuera de toda zona: se cobra como respaldo (Periferia) y el snapshot marca por_respaldo", async () => {
    const p = await crearPedido(T_A, ids.sellerA, { destinatario_comuna: "Quilicura" });
    await entregar(p, T_A, ids.sellerA, ids.driverA);
    const l = await lineas(p);
    expect(l.cobro[0].monto_final_clp).toBe(4000);
    expect(l.liq[0].monto_final_clp).toBe(2900);
    expect(l.cobro[0].snapshot_regla).toMatchObject({ zona: { por_respaldo: true } });
  });

  it("la comuna llega con otra grafía («ñuñoa», con espacios): se canoniza y cae en su zona, no en el respaldo", async () => {
    const p = await crearPedido(T_A, ids.sellerA, { destinatario_comuna: "  ñuñoa " });
    await entregar(p, T_A, ids.sellerA, ids.driverA);
    const l = await lineas(p);
    expect(l.cobro[0].monto_final_clp).toBe(3500);
    expect(l.cobro[0].snapshot_regla).toMatchObject({ zona: { por_respaldo: false } });
  });

  it("idempotente: el mismo evento dos veces deja UNA línea de cada lado", async () => {
    const p = await crearPedido(T_A, ids.sellerA);
    await entregar(p, T_A, ids.sellerA, ids.driverA);
    await entregar(p, T_A, ids.sellerA, ids.driverA);
    const l = await lineas(p);
    expect(l.cobro).toHaveLength(1);
    expect(l.liq).toHaveLength(1);
  });

  it("re-guardar el paso 4 con OTROS montos: lo ya cobrado no cambia; la entrega de ayer sigue a la tarifa de ayer; la de hoy usa la nueva", async () => {
    const antes = await crearPedido(T_A, ids.sellerA);
    await entregar(antes, T_A, ids.sellerA, ids.driverA);
    const lineaAntes = (await lineas(antes)).cobro[0];
    expect(lineaAntes.monto_final_clp).toBe(3500);

    const { data: z } = await db.schema("identidad").from("zonas").select("id, es_respaldo").eq("tenant_id", T_A);
    const z1 = z!.find((x) => !x.es_respaldo)!.id as string;
    const z2 = z!.find((x) => x.es_respaldo)!.id as string;
    const r = await guardarPaso4(T_A, hoy, zonasPayload(z1, z2, 3900, 2600, 4400, 3000));
    expect(r.error).toBeNull();

    // 1) La línea ya escrita no se toca.
    const { data: releida } = await db
      .schema("dinero").from("lineas_cobro").select("monto_final_clp, tarifa_id").eq("id", lineaAntes.id).single();
    expect(releida).toMatchObject({ monto_final_clp: 3500, tarifa_id: lineaAntes.tarifa_id });

    // 2) La fila de tarifa vieja conserva su monto (se versiona, no se edita).
    const { data: vieja } = await db
      .schema("identidad").from("tarifas").select("monto_clp, vigente_hasta").eq("id", lineaAntes.tarifa_id).single();
    expect(Number(vieja!.monto_clp)).toBe(3500);
    expect(vieja!.vigente_hasta).toBe(ayer);

    // 3) Una entrega que ocurrió AYER y se procesa recién ahora (reintento tardío) cobra lo de ayer.
    const tarde = await crearPedido(T_A, ids.sellerA, { fecha_compromiso: ayer });
    await entregar(tarde, T_A, ids.sellerA, ids.driverA, { dia: ayer });
    expect((await lineas(tarde)).cobro[0].monto_final_clp).toBe(3500);

    // 4) Una entrega de HOY cobra lo nuevo.
    const nueva = await crearPedido(T_A, ids.sellerA);
    await entregar(nueva, T_A, ids.sellerA, ids.driverA);
    const l = await lineas(nueva);
    expect(l.cobro[0].monto_final_clp).toBe(3900);
    expect(l.liq[0].monto_final_clp).toBe(2600);
  });

  it("excepción por plataforma: gana a la zona SOLO para esa fuente", async () => {
    const { data: z } = await db.schema("identidad").from("zonas").select("id, es_respaldo").eq("tenant_id", T_A);
    const z1 = z!.find((x) => !x.es_respaldo)!.id as string;
    const z2 = z!.find((x) => x.es_respaldo)!.id as string;
    const r = await guardarPaso4(
      T_A,
      hoy,
      zonasPayload(z1, z2, 3900, 2600, 4400, 3000, [{ fuente: "shopify", c: 5100, p: 3300 }]),
    );
    expect(r.error).toBeNull();

    const shop = await crearPedido(T_A, ids.sellerA, {
      tipo_pedido: "same_day",
      fuente: "shopify",
      origen: "shopify_ingesta",
      ml_shipment_id: null,
      id_externo: `QA-INT-${crypto.randomUUID()}`,
    });
    await entregar(shop, T_A, ids.sellerA, ids.driverA, { tipoPedido: "same_day" });
    const flex = await crearPedido(T_A, ids.sellerA);
    await entregar(flex, T_A, ids.sellerA, ids.driverA);

    expect((await lineas(shop)).cobro[0].monto_final_clp).toBe(5100);
    expect((await lineas(shop)).liq[0].monto_final_clp).toBe(3300);
    expect((await lineas(shop)).cobro[0].snapshot_regla).toMatchObject({
      tarifa: { resolucion: { por_fuente: true, por_zona: true } },
    });
    expect((await lineas(flex)).cobro[0].monto_final_clp).toBe(3900);
  });

  it("sin NINGUNA tarifa: no lanza, no escribe línea en $0 y deja las dos excepciones bloqueantes", async () => {
    const p = await crearPedido(T_SIN, ids.sellerSin);
    await expect(entregar(p, T_SIN, ids.sellerSin, ids.driverSin)).resolves.toMatchObject({ sinTarifa: true });
    const l = await lineas(p);
    expect(l.cobro).toHaveLength(0);
    expect(l.liq).toHaveLength(0);
    const porTipo = Object.fromEntries(l.exc.map((e) => [e.tipo_diferencia, e]));
    expect(porTipo.pedido_entregado_sin_linea_cobro).toMatchObject({ bloquea_facturacion: true, estado: "pendiente" });
    expect(porTipo.pedido_entregado_sin_linea_liquidacion).toMatchObject({ bloquea_pago: true, estado: "pendiente" });

    // El pedido no queda marcado como cobrado.
    const { data: ped } = await db
      .schema("operacion").from("pedidos").select("cobro_generado, liquidacion_generada").eq("id", p).single();
    expect(ped).toMatchObject({ cobro_generado: false, liquidacion_generada: false });

    // Reintento: no duplica las excepciones.
    await entregar(p, T_SIN, ids.sellerSin, ids.driverSin);
    expect((await lineas(p)).exc).toHaveLength(2);
  });

  it("entrega ANTERIOR al inicio de toda vigencia: sin tarifa, excepción (no se cobra con una tarifa futura)", async () => {
    const p = await crearPedido(T_A, ids.sellerA, { fecha_compromiso: "2026-01-05" });
    await entregar(p, T_A, ids.sellerA, ids.driverA, { dia: "2026-01-05" });
    const l = await lineas(p);
    expect(l.cobro).toHaveLength(0);
    expect(l.exc.map((e) => e.tipo_diferencia)).toContain("pedido_entregado_sin_linea_cobro");
  });

  it("filas LEGADAS (tipo_entrega puesto) resuelven igual que antes: con y sin tarifa_aplicable_id", async () => {
    const { data: t } = await db.schema("identidad").from("tarifas").select("id").eq("tenant_id", T_LEGADO).single();
    const conId = await crearPedido(T_LEGADO, ids.sellerLeg, { tarifa_aplicable_id: t!.id });
    await entregar(conId, T_LEGADO, ids.sellerLeg, ids.driverLeg, { tarifaAplicableId: t!.id });
    const sinId = await crearPedido(T_LEGADO, ids.sellerLeg);
    await entregar(sinId, T_LEGADO, ids.sellerLeg, ids.driverLeg);
    for (const p of [conId, sinId]) {
      const l = await lineas(p);
      expect(l.cobro[0].monto_final_clp).toBe(1800);
      expect(l.liq[0].monto_final_clp).toBe(1200);
      expect(l.cobro[0].tarifa_id).toBe(t!.id);
    }
  });

  it("aislamiento en el motor: una tarifa del tenant A jamás se aplica a un pedido del tenant B", async () => {
    // El tenant SIN tiene el mismo comuna/fuente que A y NINGUNA tarifa propia.
    const p = await crearPedido(T_SIN, ids.sellerSin, { destinatario_comuna: "Providencia" });
    await entregar(p, T_SIN, ids.sellerSin, ids.driverSin);
    const l = await lineas(p);
    expect(l.cobro).toHaveLength(0);
    const { data: ajenas } = await db
      .schema("dinero").from("lineas_cobro").select("id").eq("pedido_id", p);
    expect(ajenas).toHaveLength(0);
  });

  it("el respaldo del PAGO DE RETIRO no toma una tarifa cualquiera: con varias vigentes el mismo día usa la general (montos del respaldo), no una excepción de plataforma", async () => {
    // Tras el test de excepciones, A tiene: Zona 1 (2600), Periferia (3000), la general
    // (3000, montos del respaldo) y la excepción Shopify de Zona 1 (3300), todas con la
    // misma vigencia. Antes del arreglo `limit 1` devolvía la de Shopify.
    const { leerMontoConductorDeTarifa } = await import("./generar-linea-retiro");
    const monto = await leerMontoConductorDeTarifa(db, T_A, ids.sellerA);
    expect(monto).toBe(3000);
  });
});
