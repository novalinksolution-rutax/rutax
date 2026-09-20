import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const registrarEnBitacora = vi.fn().mockResolvedValue(undefined);
vi.mock("@/modules/identidad/auditoria", () => ({ registrarEnBitacora }));

const { guardarConfigCanalConsulta } = await import("./canal-admin");

/**
 * ⚠️ ESTE MOCK NO TIENE `upsert`, Y ESO ES LA PRUEBA.
 *
 * La primera versión de `guardarConfigCanalConsulta` usaba `.upsert()` y estas
 * pruebas pasaban en verde, porque el mock aceptaba lo que la base rechaza:
 * **en un upsert de PostgREST toda columna del payload se escribe también en el
 * UPDATE**, y `tenant_id` está fuera del GRANT de update a propósito. En
 * producción reventaba con 42501 al reconfigurar un courier que ya tenía fila
 * — que es justo el caso del segundo clic.
 *
 * Si alguien vuelve a poner un `.upsert()`, el mock no lo implementa y estas
 * pruebas se caen con un error de tipo en vez de mentir en verde.
 */
function clienteFake(
  opts: { existe?: boolean; errorEscritura?: string; errorLectura?: string } = {},
) {
  const llamadas: string[] = [];
  const cargas: Record<string, unknown>[] = [];

  const resultadoEscritura = () =>
    opts.errorEscritura
      ? Promise.resolve({ error: { message: opts.errorEscritura } })
      : Promise.resolve({ error: null });

  const cliente = {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.existe ? { tenant_id: "t1" } : null,
                error: opts.errorLectura ? { message: opts.errorLectura } : null,
              }),
          }),
        }),
        insert: (fila: Record<string, unknown>) => {
          llamadas.push("insert");
          cargas.push(fila);
          return resultadoEscritura();
        },
        update: (fila: Record<string, unknown>) => {
          llamadas.push("update");
          cargas.push(fila);
          return { eq: () => resultadoEscritura() };
        },
      }),
    }),
    rpc: () =>
      ({
        single: () =>
          Promise.resolve({
            data: {
              canal_activo: false,
              tope_consultas_hora: 20,
              tope_intentos_sin_match_hora: 5,
              configurado: false,
            },
            error: null,
          }),
      }) as unknown,
  } as unknown as SupabaseClient;

  return { cliente, llamadas, cargas };
}

const ENTRADA_VALIDA = {
  tenantId: "t1",
  actorUsuarioId: "u1",
  canalActivo: true,
  topeConsultasHora: 20,
  topeIntentosSinMatchHora: 5,
  nota: null,
};

describe("guardarConfigCanalConsulta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rechaza tope_consultas_hora fuera de rango sin tocar la base", async () => {
    const { cliente, llamadas } = clienteFake();
    const resultado = await guardarConfigCanalConsulta(cliente, {
      ...ENTRADA_VALIDA,
      topeConsultasHora: 500,
    });

    expect(resultado.ok).toBe(false);
    expect(llamadas).toHaveLength(0);
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("rechaza que el umbral de barrido supere al tope general", async () => {
    const { cliente } = clienteFake();
    const resultado = await guardarConfigCanalConsulta(cliente, {
      ...ENTRADA_VALIDA,
      topeConsultasHora: 5,
      topeIntentosSinMatchHora: 10,
    });
    expect(resultado.ok).toBe(false);
  });

  it("courier sin fila: inserta, y ahí sí va el tenant_id", async () => {
    const { cliente, llamadas, cargas } = clienteFake({ existe: false });
    const resultado = await guardarConfigCanalConsulta(cliente, ENTRADA_VALIDA);

    expect(resultado.ok).toBe(true);
    expect(llamadas).toEqual(["insert"]);
    expect(cargas[0]).toMatchObject({ tenant_id: "t1", canal_activo: true });
  });

  it("courier que ya tenía fila: actualiza SIN tenant_id en la carga", async () => {
    const { cliente, llamadas, cargas } = clienteFake({ existe: true });
    const resultado = await guardarConfigCanalConsulta(cliente, ENTRADA_VALIDA);

    expect(resultado.ok).toBe(true);
    expect(llamadas).toEqual(["update"]);
    // El fallo real de producción: `tenant_id` en el UPDATE ⇒ 42501, porque
    // está fuera del GRANT para que nadie mueva la config de un courier a otro.
    expect(cargas[0]).not.toHaveProperty("tenant_id");
    expect(cargas[0]).not.toHaveProperty("creado_en");
    expect(cargas[0]).toMatchObject({ canal_activo: true, actualizado_por: "u1" });
  });

  it("bitácora se escribe ANTES de la escritura, con el actor", async () => {
    const orden: string[] = [];
    registrarEnBitacora.mockImplementation(async () => {
      orden.push("bitacora");
    });
    const { cliente } = clienteFake({ existe: true });

    const resultado = await guardarConfigCanalConsulta(cliente, { ...ENTRADA_VALIDA, nota: "piloto" });

    expect(resultado.ok).toBe(true);
    expect(orden).toEqual(["bitacora"]);
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "t1",
        actorUsuarioId: "u1",
        actorTipo: "super_admin",
        accion: "conversacion.canal_config_actualizado",
      }),
    );
  });

  it("propaga el fallo de escritura como resultado, no como excepción", async () => {
    const { cliente } = clienteFake({ existe: true, errorEscritura: "boom" });
    const resultado = await guardarConfigCanalConsulta(cliente, ENTRADA_VALIDA);
    expect(resultado).toEqual({
      ok: false,
      mensaje: "No se pudo guardar la configuración del canal.",
    });
  });

  it("un fallo al LEER corta antes de escribir a ciegas", async () => {
    const { cliente, llamadas } = clienteFake({ errorLectura: "sin permiso" });

    // La lectura previa (la que arma el "antes" de la bitácora) lanza en vez de
    // devolver `ok: false`. Lo que importa acá es que NADA se escribió: una
    // config guardada sin saber desde qué valor se cambió deja la bitácora
    // mintiendo. ⚠️ La Server Action atrapa esta excepción y la muestra como
    // problema de permisos, que no siempre es la causa.
    await expect(guardarConfigCanalConsulta(cliente, ENTRADA_VALIDA)).rejects.toThrow();
    expect(llamadas).toHaveLength(0);
  });
});
