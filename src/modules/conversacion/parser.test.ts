import { describe, it, expect } from "vitest";
import { reconocerCodigosEnMensaje, primerCodigoReconocido } from "./parser";

// Payload real capturado escaneando una etiqueta Flex (docs/arquitectura/retiro-y-ruteo.md §3).
const PAYLOAD_FLEX_REAL =
  '{"id":"44760788897","sender_id":2114191787,"hash_code":"fwH77GO2qbT3SrRS/UKb14MN2s5JA3AhWG4Pen/l6WY=","security_digit":"0"}';

describe("reconocerCodigosEnMensaje — el envoltorio de §6.1", () => {
  it('un "hola cómo va mi pedido" NO produce ningún código — cae al menú', () => {
    // Esto es lo que una versión anterior del documento tenía mal: el parser
    // subyacente jamás dice "no" (todo cae a `desconocido` con éxito). El
    // envoltorio es el que sí sabe decir que acá no hay nada.
    expect(reconocerCodigosEnMensaje("hola cómo va mi pedido")).toEqual([]);
    expect(primerCodigoReconocido("hola cómo va mi pedido")).toBeNull();
  });

  it("reconoce el JSON completo del QR de Flex como un único token", () => {
    const [reconocido] = reconocerCodigosEnMensaje(PAYLOAD_FLEX_REAL);
    expect(reconocido).toEqual({
      clasificacion: "ml_shipment_id",
      identificador: { tipo: "ml_shipment_id", valor: "44760788897" },
    });
  });

  it("reconoce un código interno rutax_interno dentro de una frase", () => {
    const [reconocido] = reconocerCodigosEnMensaje("mi pedido es RX-AB12-CD34 gracias");
    expect(reconocido).toEqual({
      clasificacion: "codigo_interno",
      identificador: { tipo: "codigo_interno", valor: "RX-AB12-CD34" },
    });
  });

  it("clasifica un shipment id TECLEADO como flex_manual, distinto de un QR escaneado", () => {
    const [reconocido] = reconocerCodigosEnMensaje("44760788897");
    expect(reconocido.clasificacion).toBe("flex_manual");
    // Mismo identificador que el QR: es el MISMO bulto, solo cambia cómo llegó.
    expect(reconocido.identificador).toEqual({ tipo: "ml_shipment_id", valor: "44760788897" });
  });

  it("NUNCA expone la credencial — ni el hash_code del QR ni el crudo de un desconocido", () => {
    const reconocidos = reconocerCodigosEnMensaje(PAYLOAD_FLEX_REAL);
    const serializado = JSON.stringify(reconocidos);
    expect(serializado).not.toContain("hash_code");
    expect(serializado).not.toContain("fwH77GO2qbT3SrRS");
    expect(serializado).not.toContain("credencial");
  });

  it("descarta un número demasiado corto (no confunde un RUT o un monto con un shipment id)", () => {
    expect(reconocerCodigosEnMensaje("tengo 5 pedidos")).toEqual([]);
  });

  it("un mensaje vacío no reconoce nada", () => {
    expect(reconocerCodigosEnMensaje("   ")).toEqual([]);
  });

  it("reconoce varios códigos en el mismo mensaje, en orden", () => {
    const reconocidos = reconocerCodigosEnMensaje("RX-AB12-CD34 y también 44760788897");
    expect(reconocidos).toHaveLength(2);
    expect(reconocidos[0].clasificacion).toBe("codigo_interno");
    expect(reconocidos[1].clasificacion).toBe("flex_manual");
  });

  it("primerCodigoReconocido devuelve solo el primero", () => {
    const primero = primerCodigoReconocido("RX-AB12-CD34 y también 44760788897");
    expect(primero?.clasificacion).toBe("codigo_interno");
  });
});
