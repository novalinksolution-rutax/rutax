/**
 * Pruebas del lector del payload `link.created` de Fintoc.
 *
 * POR QUÉ IMPORTAN MÁS QUE UNA PRUEBA DE PARSEO CUALQUIERA: el `link_token` de
 * este payload no se puede volver a pedir nunca («can never be retrieved again»).
 * Si el lector no lo encuentra, no hay reintento que lo recupere. Por eso se fijan
 * las cuatro formas de anidamiento toleradas, y se fija que un payload SIN token
 * devuelva `null` en vez de lanzar (quien llama responde 200 y NO quema el nonce).
 */

import { describe, expect, it } from "vitest";
import { construirAliasCuenta, esPayloadLinkCreado, leerLinkCreado } from "./link-creado";

const CUENTA = {
  institution: { name: "Banco de Chile" },
  accounts: [{ number: "000123456789", institution: { name: "Banco de Chile" } }],
};

describe("leerLinkCreado", () => {
  it("lee el link_token en la raíz", () => {
    expect(leerLinkCreado({ link_token: "lt_1", ...CUENTA })?.linkToken).toBe("lt_1");
  });

  it("lee el link_token bajo `data`", () => {
    expect(leerLinkCreado({ type: "link.created", data: { link_token: "lt_2" } })?.linkToken).toBe(
      "lt_2",
    );
  });

  it("lee el link_token bajo `link`", () => {
    expect(leerLinkCreado({ link: { link_token: "lt_3" } })?.linkToken).toBe("lt_3");
  });

  it("lee el link_token bajo `data.link`", () => {
    expect(leerLinkCreado({ data: { link: { link_token: "lt_4" } } })?.linkToken).toBe("lt_4");
  });

  it("devuelve null (no lanza) si no hay token — así el nonce no se quema", () => {
    // Este es el payload REAL de `onSuccess` del widget: id y nada más.
    expect(leerLinkCreado({ id: "link_XXX", link: { id: "link_XXX" } })).toBeNull();
    expect(leerLinkCreado({ link_token: "   " })).toBeNull();
    expect(leerLinkCreado(null)).toBeNull();
    expect(leerLinkCreado("no soy un objeto")).toBeNull();
  });

  it("arma el alias sin filtrar el token ni el RUT del titular", () => {
    const leido = leerLinkCreado({ link_token: "lt_5", ...CUENTA, holder_id: "11111111-1" });
    expect(leido?.cuentaBancoAlias).toBe("Banco de Chile ••••6789");
    expect(JSON.stringify(leido)).not.toContain("11111111");
  });
});

describe("esPayloadLinkCreado", () => {
  it("reconoce el `type` explícito en sus dos grafías", () => {
    expect(esPayloadLinkCreado({ type: "link.created" })).toBe(true);
    expect(esPayloadLinkCreado({ type: "link_created" })).toBe(true);
  });

  it("un `type` de otro evento manda, aunque traiga cosas parecidas", () => {
    // Clave: el canal ad-hoc del widget recibe también movimientos. Un evento de
    // dinero NUNCA debe entrar por el camino sin firma.
    expect(esPayloadLinkCreado({ type: "transfer.inbound.succeeded", link_token: "lt" })).toBe(
      false,
    );
  });

  it("sin `type`, la presencia de un link_token alcanza como señal", () => {
    expect(esPayloadLinkCreado({ link_token: "lt" })).toBe(true);
    expect(esPayloadLinkCreado({ id: "link_XXX" })).toBe(false);
  });
});

describe("construirAliasCuenta", () => {
  it("degrada a null sin reventar cuando no hay ni institución ni número", () => {
    expect(construirAliasCuenta({})).toBeNull();
    expect(construirAliasCuenta({ accounts: [] })).toBeNull();
  });

  it("acepta la institución como string plano", () => {
    expect(construirAliasCuenta({ accounts: [{ institution: "Banco Estado", number: "987654" }] }))
      .toBe("Banco Estado ••••7654");
  });
});
