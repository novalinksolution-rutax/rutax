/**
 * Pruebas de `obtenerManifiestoVigenteDelConductor`.
 *
 * El caso que importa —dos manifiestos vivos del mismo conductor y día— no
 * tenía NINGUNA prueba en ninguna de las dos superficies del conductor antes de
 * esto, y su síntoma en producción es que desaparecen paradas sin ruido.
 *
 * El doble de Supabase LANZA ante cualquier tabla o método que no espera. Un
 * doble permisivo dejaría pasar una consulta mal dirigida sin que nadie se
 * entere, que es exactamente cómo estos defectos sobreviven meses en este repo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/observabilidad", () => ({
  capturarMensaje: vi.fn().mockResolvedValue(undefined),
}));

import { capturarMensaje } from "@/lib/observabilidad";
import { obtenerManifiestoVigenteDelConductor } from "./manifiesto-vigente";

const TENANT = "10000000-0000-0000-0000-000000000001";
const DRIVER = "20000000-0000-0000-0000-000000000001";
const HOY = "2026-08-14";

interface FilaManifiestoFalsa {
  id: string;
  nombre: string;
  fecha_operacion: string;
  estado: string;
  creado_en: string;
  driver_id?: string;
  tenant_id?: string;
}

function crearCliente(filas: FilaManifiestoFalsa[], opciones: { error?: string } = {}) {
  const filtros: { col: string; val: unknown }[] = [];
  let filtroIn: { col: string; vals: unknown[] } | null = null;
  const ordenes: { col: string; asc: boolean }[] = [];

  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = (col: string, val: unknown) => {
    filtros.push({ col, val });
    return builder;
  };
  builder.in = (col: string, vals: unknown[]) => {
    filtroIn = { col, vals };
    return builder;
  };
  builder.order = (col: string, o: { ascending: boolean }) => {
    ordenes.push({ col, asc: o.ascending });
    return builder;
  };
  builder.limit = () => {
    // `.limit(1)` es exactamente el defecto que esta función existe para no
    // repetir: si alguien lo reintroduce, la consulta deja de poder ver el
    // segundo manifiesto y la alarma nunca sonaría.
    throw new Error("La consulta NO debe usar .limit(): tiene que ver todos los manifiestos del día");
  };
  builder.then = (resolve: (r: { data: FilaManifiestoFalsa[] | null; error: unknown }) => void) => {
    if (opciones.error) {
      resolve({ data: null, error: { message: opciones.error } });
      return;
    }
    const visibles = filtroIn
      ? filas.filter((f) => filtroIn!.vals.includes(f.estado))
      : filas;
    const filtradas = visibles.filter((f) =>
      filtros.every(({ col, val }) => {
        if (col === "driver_id") return (f.driver_id ?? DRIVER) === val;
        if (col === "tenant_id") return (f.tenant_id ?? TENANT) === val;
        if (col === "fecha_operacion") return f.fecha_operacion === val;
        throw new Error(`Columna no esperada en el doble: ${col}`);
      }),
    );
    // El orden real es `creado_en desc, id desc`.
    const ordenadas = [...filtradas].sort((a, b) => {
      if (a.creado_en !== b.creado_en) return a.creado_en < b.creado_en ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
    resolve({ data: ordenadas, error: null });
  };

  const from = vi.fn((tabla: string) => {
    if (tabla !== "manifiestos") throw new Error(`Tabla no esperada en el doble: ${tabla}`);
    return builder;
  });

  return { cliente: { from } as never, from, ordenes };
}

function manifiesto(over: Partial<FilaManifiestoFalsa> & { id: string }): FilaManifiestoFalsa {
  return {
    nombre: `Ruta ${over.id}`,
    fecha_operacion: HOY,
    estado: "borrador",
    creado_en: "2026-08-14T09:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("obtenerManifiestoVigenteDelConductor", () => {
  it("sin manifiestos devuelve null y no reporta nada", async () => {
    const { cliente } = crearCliente([]);
    expect(await obtenerManifiestoVigenteDelConductor(cliente, { tenantId: TENANT, driverId: DRIVER, fecha: HOY })).toBeNull();
    expect(capturarMensaje).not.toHaveBeenCalled();
  });

  it("con uno solo lo devuelve, sin alarma", async () => {
    const { cliente } = crearCliente([manifiesto({ id: "m1", estado: "confirmado" })]);
    const m = await obtenerManifiestoVigenteDelConductor(cliente, { tenantId: TENANT, driverId: DRIVER, fecha: HOY });

    expect(m).toEqual({ id: "m1", nombre: "Ruta m1", fechaOperacion: HOY, estado: "confirmado" });
    expect(capturarMensaje).not.toHaveBeenCalled();
  });

  /**
   * EL CASO QUE ESTABA FALLANDO EN SILENCIO. Antes, las dos superficies hacían
   * `.limit(1)` y las paradas del otro manifiesto simplemente no existían para
   * el conductor — en plena calle y sin ningún aviso.
   */
  it("con DOS vivos devuelve el más reciente y REPORTA la anomalía", async () => {
    const { cliente } = crearCliente([
      manifiesto({ id: "viejo", estado: "confirmado", creado_en: "2026-08-14T08:00:00.000Z" }),
      manifiesto({ id: "nuevo", estado: "borrador", creado_en: "2026-08-14T11:00:00.000Z" }),
    ]);

    const m = await obtenerManifiestoVigenteDelConductor(cliente, { tenantId: TENANT, driverId: DRIVER, fecha: HOY });

    expect(m?.id).toBe("nuevo");
    expect(capturarMensaje).toHaveBeenCalledTimes(1);

    const [mensaje, nivel, contexto] = vi.mocked(capturarMensaje).mock.calls[0];
    expect(nivel).toBe("error");
    expect(mensaje).toMatch(/más de un manifiesto vivo/i);
    // Sin los identificadores, el aviso no sirve para arreglar nada a mano.
    expect(contexto.tenantId).toBe(TENANT);
    expect(contexto.etiquetas?.driverId).toBe(DRIVER);
    expect(contexto.extra?.manifiestosVivos).toEqual([
      { id: "nuevo", estado: "borrador" },
      { id: "viejo", estado: "confirmado" },
    ]);
  });

  /**
   * LA ALARMA FALSA QUE HAY QUE EVITAR. Un manifiesto `completado` más uno nuevo
   * es la segunda vuelta del día, que el motor de asignación en bloque crea a
   * propósito. Si esto alarmara, la alarma sonaría todos los días y nadie
   * volvería a mirarla — y entonces la de verdad tampoco.
   */
  it("un completado más uno nuevo es la segunda vuelta: NO reporta", async () => {
    const { cliente } = crearCliente([
      manifiesto({ id: "primera-vuelta", estado: "completado", creado_en: "2026-08-14T07:00:00.000Z" }),
      manifiesto({ id: "segunda-vuelta", estado: "borrador", creado_en: "2026-08-14T15:00:00.000Z" }),
    ]);

    const m = await obtenerManifiestoVigenteDelConductor(cliente, { tenantId: TENANT, driverId: DRIVER, fecha: HOY });

    expect(m?.id).toBe("segunda-vuelta");
    expect(capturarMensaje).not.toHaveBeenCalled();
  });

  it("dos completados tampoco reportan: ninguno está vivo", async () => {
    const { cliente } = crearCliente([
      manifiesto({ id: "c1", estado: "completado", creado_en: "2026-08-14T07:00:00.000Z" }),
      manifiesto({ id: "c2", estado: "completado", creado_en: "2026-08-14T15:00:00.000Z" }),
    ]);

    await obtenerManifiestoVigenteDelConductor(cliente, { tenantId: TENANT, driverId: DRIVER, fecha: HOY });
    expect(capturarMensaje).not.toHaveBeenCalled();
  });

  it("no ve manifiestos de otro conductor ni de otro tenant ni de otro día", async () => {
    const { cliente } = crearCliente([
      manifiesto({ id: "ajeno-conductor", driver_id: "20000000-0000-0000-0000-000000000009" }),
      manifiesto({ id: "ajeno-tenant", tenant_id: "10000000-0000-0000-0000-000000000009" }),
      manifiesto({ id: "ayer", fecha_operacion: "2026-08-13" }),
      manifiesto({ id: "mio", creado_en: "2026-08-14T10:00:00.000Z" }),
    ]);

    const m = await obtenerManifiestoVigenteDelConductor(cliente, { tenantId: TENANT, driverId: DRIVER, fecha: HOY });

    expect(m?.id).toBe("mio");
    // Y sobre todo: no confundir filas ajenas con "dos manifiestos vivos".
    expect(capturarMensaje).not.toHaveBeenCalled();
  });

  it("ordena por creado_en descendente, con id como desempate determinista", async () => {
    const { cliente, ordenes } = crearCliente([manifiesto({ id: "m1" })]);
    await obtenerManifiestoVigenteDelConductor(cliente, { tenantId: TENANT, driverId: DRIVER, fecha: HOY });

    // El mismo criterio que usa `operacion.asignar_pedidos_en_bloque` para
    // decidir a cuál agregar. Si divergieran, el coordinador estaría llenando
    // un manifiesto y el conductor mirando otro.
    expect(ordenes).toEqual([
      { col: "creado_en", asc: false },
      { col: "id", asc: false },
    ]);
  });

  it("un error de la consulta se propaga en vez de devolver null", async () => {
    // Devolver null aquí diría "no tienes ruta hoy" ante un fallo de infra, que
    // es una mentira operativa: el conductor se iría a su casa.
    const { cliente } = crearCliente([], { error: "conexión caída" });
    await expect(
      obtenerManifiestoVigenteDelConductor(cliente, { tenantId: TENANT, driverId: DRIVER, fecha: HOY }),
    ).rejects.toThrow(/conexión caída/);
  });
});
