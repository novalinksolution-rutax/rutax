import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Las tres barreras de «Reportar un problema».
 * =============================================================================
 *
 * La tercera —«el pedido es suyo»— es la que no se puede comprobar mirando la
 * pantalla: el diálogo solo ofrece los pedidos del seller, así que en el
 * navegador nunca se llega a probar el caso de mandar el id de otro. Y es
 * justamente el que importa: una Server Action recibe lo que le manden, no lo
 * que el formulario dibujó.
 *
 * `abrirIncidencia` valida el tenant y NO el seller —para el courier con eso
 * basta— así que sin esta comprobación un seller podría abrir una incidencia
 * sobre el pedido de otro seller del mismo courier.
 */

const sesionFalsa = vi.fn();
const abrirIncidenciaFalsa = vi.fn();
const desdeFalso = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  obtenerSesionActual: () => sesionFalsa(),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: () => ({ from: desdeFalso }),
}));
vi.mock("@/modules/operacion/incidencias", () => ({
  abrirIncidencia: (...args: unknown[]) => abrirIncidenciaFalsa(...args),
}));

import { accionReportarProblema } from "./acciones-incidencias";

/** Un `from("pedidos")` que devuelve la fila que se le diga. */
function pedidoEnBase(fila: { id: string; seller_id: string } | null) {
  desdeFalso.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: fila, error: null }) }),
      }),
    }),
  });
}

// Las capacidades NO viajan en el usuario: salen del rol, por
// `MATRIZ_ROL_CAPACIDADES`. Y `estaActivo` exige `estado === "activo"`, así que
// un seller suspendido tampoco reporta.
const SESION_SELLER = {
  usuarioId: "u1",
  usuario: {
    tenantId: "t1",
    sellerId: "s1",
    tipoUsuario: "seller",
    rol: "seller",
    estado: "activo",
  },
};

describe("accionReportarProblema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    abrirIncidenciaFalsa.mockResolvedValue({ id: "i1" });
    sesionFalsa.mockResolvedValue(SESION_SELLER);
    pedidoEnBase({ id: "p1", seller_id: "s1" });
  });

  it("abre la incidencia cuando el pedido es del seller", async () => {
    const r = await accionReportarProblema("p1", "reagendado", "El cliente pide otro día.");
    expect(r).toEqual({ ok: true, incidenciaId: "i1" });
  });

  it("rechaza el pedido de OTRO seller del mismo courier", async () => {
    // El caso que la pantalla no puede probar: el diálogo solo lista lo suyo,
    // pero la Server Action recibe el id que le manden.
    pedidoEnBase({ id: "p9", seller_id: "s2" });
    const r = await accionReportarProblema("p9", "reagendado", "El cliente pide otro día.");
    expect(r).toEqual({ ok: false, mensaje: "Ese pedido no es tuyo." });
    expect(abrirIncidenciaFalsa).not.toHaveBeenCalled();
  });

  it("rechaza un pedido que no existe", async () => {
    pedidoEnBase(null);
    const r = await accionReportarProblema("p0", "reagendado", "El cliente pide otro día.");
    expect(r.ok).toBe(false);
    expect(abrirIncidenciaFalsa).not.toHaveBeenCalled();
  });

  it("exige sesión de seller: no basta con estar autenticado", async () => {
    sesionFalsa.mockResolvedValue({
      usuarioId: "u2",
      usuario: {
        tenantId: "t1",
        sellerId: null,
        tipoUsuario: "interno",
        rol: "coordinador",
        estado: "activo",
      },
    });
    const r = await accionReportarProblema("p1", "reagendado", "El cliente pide otro día.");
    expect(r.ok).toBe(false);
    expect(abrirIncidenciaFalsa).not.toHaveBeenCalled();
  });

  it("un seller suspendido no reporta, aunque su rol tenga la capacidad", async () => {
    // `tieneCapacidad` corta por `estaActivo` antes de mirar el rol.
    sesionFalsa.mockResolvedValue({
      ...SESION_SELLER,
      usuario: { ...SESION_SELLER.usuario, estado: "suspendido" },
    });
    const r = await accionReportarProblema("p1", "reagendado", "El cliente pide otro día.");
    expect(r.ok).toBe(false);
    expect(abrirIncidenciaFalsa).not.toHaveBeenCalled();
  });

  it("rechaza un tipo que no está en el catálogo", async () => {
    // Si un tipo inventado entrara, la reportería del courier contaría una
    // categoría que ninguna de sus pantallas sabe nombrar.
    const r = await accionReportarProblema("p1", "se_lo_comio_el_perro", "Pasó algo raro acá.");
    expect(r.ok).toBe(false);
    expect(abrirIncidenciaFalsa).not.toHaveBeenCalled();
  });

  it("no acepta una descripción de dos palabras", async () => {
    const r = await accionReportarProblema("p1", "reagendado", "malo");
    expect(r.ok).toBe(false);
  });

  it("no marca la incidencia como acción manual del courier", async () => {
    // `esAccionManual: true` exige `puedeGestionarIncidencias`, que es la
    // capacidad del supervisor. El seller no la tiene ni debe tenerla.
    await accionReportarProblema("p1", "reagendado", "El cliente pide otro día.");
    expect(abrirIncidenciaFalsa).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ esAccionManual: false, sellerId: "s1", tenantId: "t1" }),
    );
  });
});
