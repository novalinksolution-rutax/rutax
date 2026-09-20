/**
 * §1 de la tarea: cablear el interruptor del canal (migración
 * `20260920000002`). Lo central: canal apagado ⇒ NUNCA se llama al puerto de
 * WhatsApp (contraprueba: encendido ⇒ sí se llama), y el job termina en éxito
 * (`reintentable: false`), no en error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const enviarTexto = vi.fn();
const registrarEnBitacora = vi.fn();
const estadoDePedidoParaSeller = vi.fn();
const retiroDelDiaParaSeller = vi.fn();
const resolverAlcanceDesdeContacto = vi.fn();
const leerConfigCanalConsulta = vi.fn();
const excedeTopeDeAbuso = vi.fn();
const detectaBarridoDeCodigos = vi.fn();

const actualizaciones: Array<{ id: string; patch: Record<string, unknown> }> = [];
/** Cuánto devuelve la consulta de "¿ya se avisó en 24h?" — mutable por test. */
let countAvisosPrevios = 0;

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: () => ({
    schema: () => ({
      from: () => ({
        update: (patch: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => {
            actualizaciones.push({ id, patch });
            return Promise.resolve({ error: null });
          },
        }),
        select: () => ({
          eq: () => ({
            in: () => ({
              gte: () => Promise.resolve({ count: countAvisosPrevios, error: null }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/modules/identidad/auditoria", () => ({ registrarEnBitacora }));

vi.mock("@/modules/integraciones/notificaciones/whatsapp", () => ({
  obtenerPuertoWhatsApp: () => ({ enviarTexto }),
}));

vi.mock("@/modules/operacion/consultas/seller", () => ({
  estadoDePedidoParaSeller,
  retiroDelDiaParaSeller,
}));

vi.mock("../alcance", () => ({ resolverAlcanceDesdeContacto }));
vi.mock("../canal", () => ({ leerConfigCanalConsulta }));
vi.mock("../abuso", () => ({ excedeTopeDeAbuso, detectaBarridoDeCodigos }));

const ALCANCE_RESUELTO = {
  resolucion: "resuelto" as const,
  alcance: { tenantId: "tenant-1", sellerId: "seller-1" },
  contactoId: "contacto-1",
};

const CONFIG_APAGADA = {
  canalActivo: false,
  topeConsultasHora: 20,
  topeIntentosSinMatchHora: 5,
  configurado: true,
};

const CONFIG_ENCENDIDA = {
  canalActivo: true,
  topeConsultasHora: 20,
  topeIntentosSinMatchHora: 5,
  configurado: true,
};

describe("procesarConsulta — interruptor del canal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actualizaciones.length = 0;
    countAvisosPrevios = 0;
    resolverAlcanceDesdeContacto.mockResolvedValue(ALCANCE_RESUELTO);
    excedeTopeDeAbuso.mockResolvedValue(false);
    detectaBarridoDeCodigos.mockResolvedValue(false);
    estadoDePedidoParaSeller.mockResolvedValue(null);
    retiroDelDiaParaSeller.mockResolvedValue({ esperadosHoy: 0, visitas: [] });
    enviarTexto.mockResolvedValue({ enviado: true });
  });

  it("canal apagado ⇒ NO llama al puerto de WhatsApp, ni a bitácora, ni consulta operacion", async () => {
    leerConfigCanalConsulta.mockResolvedValue(CONFIG_APAGADA);
    const { procesarConsulta } = await import("./responder-mensaje");

    const resultado = await procesarConsulta({
      mensajeEntranteId: "msg-1",
      telefonoE164: "56911112222",
      texto: "RX-0001-0001",
    });

    expect(enviarTexto).not.toHaveBeenCalled();
    expect(registrarEnBitacora).not.toHaveBeenCalled();
    expect(estadoDePedidoParaSeller).not.toHaveBeenCalled();
    expect(excedeTopeDeAbuso).not.toHaveBeenCalled();

    // Termina en ÉXITO, no en error: no es reintentable.
    expect(resultado).toEqual({ respondido: false, reintentable: false, motivo: "canal_apagado" });
  });

  it("canal apagado ⇒ la fila queda registrada con resolución 'resuelto' y el alcance completo", async () => {
    leerConfigCanalConsulta.mockResolvedValue(CONFIG_APAGADA);
    const { procesarConsulta } = await import("./responder-mensaje");

    await procesarConsulta({ mensajeEntranteId: "msg-1", telefonoE164: "56911112222", texto: "hola" });

    expect(actualizaciones).toHaveLength(1);
    expect(actualizaciones[0]).toEqual({
      id: "msg-1",
      patch: {
        resolucion: "resuelto",
        tenant_id: "tenant-1",
        seller_id: "seller-1",
        contacto_id: "contacto-1",
        motivo_no_respondido: "canal_apagado",
      },
    });
  });

  it("contraprueba — canal encendido ⇒ SÍ llama al puerto de WhatsApp", async () => {
    leerConfigCanalConsulta.mockResolvedValue(CONFIG_ENCENDIDA);
    const { procesarConsulta } = await import("./responder-mensaje");

    const resultado = await procesarConsulta({
      mensajeEntranteId: "msg-2",
      telefonoE164: "56911112222",
      texto: "algo que no calza",
    });

    expect(enviarTexto).toHaveBeenCalledTimes(1);
    expect(registrarEnBitacora).toHaveBeenCalledTimes(1);
    expect(resultado.respondido).toBe(true);
  });

  it("el tope de abuso y el umbral de barrido salen de la config, no de una constante", async () => {
    leerConfigCanalConsulta.mockResolvedValue({
      canalActivo: true,
      topeConsultasHora: 7,
      topeIntentosSinMatchHora: 2,
      configurado: true,
    });
    const { procesarConsulta } = await import("./responder-mensaje");

    await procesarConsulta({ mensajeEntranteId: "msg-3", telefonoE164: "56911112222", texto: "hola" });

    expect(excedeTopeDeAbuso).toHaveBeenCalledWith(expect.anything(), "contacto-1", 7);
  });

  it("canal apagado se evalúa ANTES del tope de abuso", async () => {
    leerConfigCanalConsulta.mockResolvedValue(CONFIG_APAGADA);
    const { procesarConsulta } = await import("./responder-mensaje");

    await procesarConsulta({ mensajeEntranteId: "msg-4", telefonoE164: "56911112222", texto: "hola" });

    expect(excedeTopeDeAbuso).not.toHaveBeenCalled();
  });
});

describe("procesarConsulta — motivo_no_respondido por rama", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actualizaciones.length = 0;
    countAvisosPrevios = 0;
    resolverAlcanceDesdeContacto.mockResolvedValue(ALCANCE_RESUELTO);
    excedeTopeDeAbuso.mockResolvedValue(false);
    detectaBarridoDeCodigos.mockResolvedValue(false);
    estadoDePedidoParaSeller.mockResolvedValue(null);
    retiroDelDiaParaSeller.mockResolvedValue({ esperadosHoy: 0, visitas: [] });
    enviarTexto.mockResolvedValue({ enviado: true });
  });

  it("ilegible ⇒ 'sin_alcance'", async () => {
    resolverAlcanceDesdeContacto.mockResolvedValue({ resolucion: "ilegible" });
    const { procesarConsulta } = await import("./responder-mensaje");

    await procesarConsulta({ mensajeEntranteId: "msg-ilegible", telefonoE164: null, texto: "??" });

    expect(actualizaciones).toEqual([
      { id: "msg-ilegible", patch: { resolucion: "ilegible", motivo_no_respondido: "sin_alcance" } },
    ]);
  });

  it("sin_contacto sin aviso previo ⇒ 'respondido'", async () => {
    resolverAlcanceDesdeContacto.mockResolvedValue({ resolucion: "sin_contacto" });
    const { procesarConsulta } = await import("./responder-mensaje");

    await procesarConsulta({ mensajeEntranteId: "msg-sc", telefonoE164: "56911112222", texto: "hola" });

    expect(actualizaciones).toEqual([
      {
        id: "msg-sc",
        patch: { resolucion: "sin_contacto", motivo_no_respondido: "respondido" },
      },
    ]);
  });

  it("ambiguo con aviso ya mandado en 24h ⇒ 'aviso_neutro_omitido' (contraprueba de 'respondido')", async () => {
    resolverAlcanceDesdeContacto.mockResolvedValue({ resolucion: "ambiguo" });
    countAvisosPrevios = 1;
    const { procesarConsulta } = await import("./responder-mensaje");

    const resultado = await procesarConsulta({
      mensajeEntranteId: "msg-amb",
      telefonoE164: "56911112222",
      texto: "hola",
    });

    expect(resultado.motivo).toBe("ambiguo_ya_avisado");
    expect(actualizaciones).toEqual([
      { id: "msg-amb", patch: { resolucion: "ambiguo", motivo_no_respondido: "aviso_neutro_omitido" } },
    ]);
  });

  it("tope de consultas excedido ⇒ 'tope_consultas'", async () => {
    leerConfigCanalConsulta.mockResolvedValue(CONFIG_ENCENDIDA);
    excedeTopeDeAbuso.mockResolvedValue(true);
    const { procesarConsulta } = await import("./responder-mensaje");

    await procesarConsulta({ mensajeEntranteId: "msg-tope", telefonoE164: "56911112222", texto: "hola" });

    expect(actualizaciones).toEqual([
      {
        id: "msg-tope",
        patch: {
          resolucion: "resuelto",
          tenant_id: "tenant-1",
          seller_id: "seller-1",
          contacto_id: "contacto-1",
          motivo_no_respondido: "tope_consultas",
        },
      },
    ]);
  });

  it("barrido de códigos ⇒ 'barrido_codigos', en un SEGUNDO update tras el que deja el motivo en NULL", async () => {
    leerConfigCanalConsulta.mockResolvedValue(CONFIG_ENCENDIDA);
    detectaBarridoDeCodigos.mockResolvedValue(true);
    const { procesarConsulta } = await import("./responder-mensaje");

    // Ristra de dígitos (6-64) → `determinarIntencion` la clasifica `flex_manual`.
    await procesarConsulta({
      mensajeEntranteId: "msg-barrido",
      telefonoE164: "56911112222",
      texto: "123456789",
    });

    expect(actualizaciones).toHaveLength(2);
    expect(actualizaciones[0].patch).not.toHaveProperty("motivo_no_respondido");
    expect(actualizaciones[1]).toEqual({
      id: "msg-barrido",
      patch: { motivo_no_respondido: "barrido_codigos" },
    });
  });

  it("respuesta normal ⇒ segundo update con 'respondido', tras uno inicial sin motivo", async () => {
    leerConfigCanalConsulta.mockResolvedValue(CONFIG_ENCENDIDA);
    const { procesarConsulta } = await import("./responder-mensaje");

    await procesarConsulta({ mensajeEntranteId: "msg-ok", telefonoE164: "56911112222", texto: "algo" });

    expect(actualizaciones).toHaveLength(2);
    expect(actualizaciones[0].patch).not.toHaveProperty("motivo_no_respondido");
    expect(actualizaciones[1]).toEqual({
      id: "msg-ok",
      patch: { motivo_no_respondido: "respondido" },
    });
  });
});

describe("procesarConsulta — varios códigos en un mismo mensaje", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actualizaciones.length = 0;
    countAvisosPrevios = 0;
    resolverAlcanceDesdeContacto.mockResolvedValue(ALCANCE_RESUELTO);
    leerConfigCanalConsulta.mockResolvedValue(CONFIG_ENCENDIDA);
    excedeTopeDeAbuso.mockResolvedValue(false);
    detectaBarridoDeCodigos.mockResolvedValue(false);
    retiroDelDiaParaSeller.mockResolvedValue({ esperadosHoy: 0, visitas: [] });
    enviarTexto.mockResolvedValue({ enviado: true });
  });

  it("dos códigos ⇒ itera la función de dominio dos veces, con el MISMO alcance, y arma una sola respuesta", async () => {
    estadoDePedidoParaSeller.mockImplementation((_c: unknown, _alcance: unknown, id: { valor: string }) =>
      Promise.resolve(
        id.valor === "RX-AB12-CD34"
          ? { codigo: "RX-AB12-CD34", estado: "en_ruta", ultimoHito: null, parada: null }
          : null,
      ),
    );

    const resultado = await procesarConsultaImport({
      mensajeEntranteId: "msg-multi",
      telefonoE164: "56911112222",
      texto: "RX-AB12-CD34 RX-ZZ99-ZZ99",
    });

    expect(estadoDePedidoParaSeller).toHaveBeenCalledTimes(2);
    for (const llamada of estadoDePedidoParaSeller.mock.calls) {
      expect(llamada[1]).toEqual({ tenantId: "tenant-1", sellerId: "seller-1" });
    }
    expect(resultado.respondido).toBe(true);

    const textoEnviado = enviarTexto.mock.calls[0][0].texto as string;
    expect(textoEnviado).toContain("RX-AB12-CD34");
    expect(textoEnviado).toContain("No encontramos: RX-ZZ99-ZZ99");
  });

  it("5 códigos ⇒ UNA sola consulta de tope de abuso (un mensaje no pesa como 5)", async () => {
    estadoDePedidoParaSeller.mockResolvedValue(null);
    const codigos = Array.from({ length: 5 }, (_, i) => `RX-AB${i}2-CD34`).join(" ");

    await procesarConsultaImport({ mensajeEntranteId: "msg-5", telefonoE164: "56911112222", texto: codigos });

    expect(excedeTopeDeAbuso).toHaveBeenCalledTimes(1);
    expect(estadoDePedidoParaSeller).toHaveBeenCalledTimes(5);
  });

  it("más de 5 códigos ⇒ solo se consultan los primeros 5 y se avisa cuántos quedaron fuera", async () => {
    estadoDePedidoParaSeller.mockResolvedValue(null);
    const codigos = Array.from({ length: 8 }, (_, i) => `RX-AB${i}2-CD34`).join(" ");

    await procesarConsultaImport({ mensajeEntranteId: "msg-8", telefonoE164: "56911112222", texto: codigos });

    expect(estadoDePedidoParaSeller).toHaveBeenCalledTimes(5);
    const textoEnviado = enviarTexto.mock.calls[0][0].texto as string;
    expect(textoEnviado).toContain("3 código");
  });

  it("códigos repetidos en el mismo mensaje se consultan cada uno", async () => {
    estadoDePedidoParaSeller.mockResolvedValue(null);

    await procesarConsultaImport({
      mensajeEntranteId: "msg-rep",
      telefonoE164: "56911112222",
      texto: "RX-AB12-CD34 RX-AB12-CD34",
    });

    expect(estadoDePedidoParaSeller).toHaveBeenCalledTimes(2);
  });

  it("un solo código ⇒ se sigue comportando como antes (no se rompe)", async () => {
    estadoDePedidoParaSeller.mockResolvedValue({
      codigo: "RX-AB12-CD34",
      estado: "entregado",
      ultimoHito: null,
      parada: null,
    });

    const resultado = await procesarConsultaImport({
      mensajeEntranteId: "msg-uno",
      telefonoE164: "56911112222",
      texto: "RX-AB12-CD34",
    });

    expect(estadoDePedidoParaSeller).toHaveBeenCalledTimes(1);
    expect(resultado.respondido).toBe(true);
    const patchConClasificacion = actualizaciones.find((a) => a.patch.clasificacion);
    expect(patchConClasificacion?.patch.clasificacion).toBe("codigo_interno");
    expect(patchConClasificacion?.patch.hubo_match).toBe(true);
  });

  it("mezcla de flex_manual sin match y codigo_interno con match ⇒ la fila se clasifica flex_manual sin match (no esconde el sondeo)", async () => {
    estadoDePedidoParaSeller.mockImplementation((_c: unknown, _alcance: unknown, id: { valor: string }) =>
      Promise.resolve(
        id.valor === "RX-AB12-CD34"
          ? { codigo: "RX-AB12-CD34", estado: "en_ruta", ultimoHito: null, parada: null }
          : null,
      ),
    );

    await procesarConsultaImport({
      mensajeEntranteId: "msg-mix",
      telefonoE164: "56911112222",
      texto: "RX-AB12-CD34 987654321",
    });

    const patchConClasificacion = actualizaciones.find((a) => a.patch.clasificacion);
    expect(patchConClasificacion?.patch.clasificacion).toBe("flex_manual");
    expect(patchConClasificacion?.patch.hubo_match).toBe(false);
  });
});

/** Import perezoso para reusar el mismo mock de módulo entre describes. */
async function procesarConsultaImport(entrada: {
  mensajeEntranteId: string;
  telefonoE164: string | null;
  texto: string | null;
}) {
  const { procesarConsulta } = await import("./responder-mensaje");
  return procesarConsulta(entrada);
}
