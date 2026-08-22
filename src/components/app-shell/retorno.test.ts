import { describe, expect, it } from "vitest";

import { destinoRetorno, hrefConRetorno } from "@/components/app-shell/retorno";

/**
 * `?volver=` viene de la URL, o sea de quien sea que arme el enlace. Si se usa
 * tal cual como destino de un `<Link>`, es una **redirección abierta**: basta
 * mandarle a alguien `…/pedidos/123?volver=//sitio-malo.cl` para que el botón
 * «Volver a pedidos» —que se ve del producto— lo saque del producto.
 *
 * Estas pruebas fijan que solo pasen rutas internas.
 */

describe("destinoRetorno · solo rutas internas", () => {
  it("sin `volver`, usa el destino por defecto de la pantalla", () => {
    expect(destinoRetorno("/operaciones")).toBe("/operaciones");
    expect(destinoRetorno("/operaciones", null)).toBe("/operaciones");
    expect(destinoRetorno("/operaciones", "")).toBe("/operaciones");
  });

  it("conserva una ruta interna con su query — que es todo el punto", () => {
    expect(destinoRetorno("/operaciones", "/operaciones?seller=vega-norte&comuna=nunoa")).toBe(
      "/operaciones?seller=vega-norte&comuna=nunoa"
    );
  });

  it("rechaza el protocolo-relativo `//host`, que sale del sitio", () => {
    expect(destinoRetorno("/operaciones", "//sitio-malo.cl")).toBe("/operaciones");
    expect(destinoRetorno("/operaciones", "//sitio-malo.cl/phishing")).toBe("/operaciones");
  });

  it("rechaza `/\\host`, que los navegadores tratan igual que `//host`", () => {
    expect(destinoRetorno("/operaciones", "/" + String.fromCharCode(92) + "sitio-malo.cl")).toBe(
      "/operaciones"
    );
  });

  it("rechaza una URL absoluta", () => {
    expect(destinoRetorno("/operaciones", "https://sitio-malo.cl")).toBe("/operaciones");
    expect(destinoRetorno("/operaciones", "http://sitio-malo.cl")).toBe("/operaciones");
    expect(destinoRetorno("/operaciones", "javascript:alert(1)")).toBe("/operaciones");
  });

  it("rechaza una ruta relativa, que resolvería contra la pantalla actual", () => {
    expect(destinoRetorno("/operaciones", "../admin")).toBe("/operaciones");
    expect(destinoRetorno("/operaciones", "operaciones")).toBe("/operaciones");
  });

  it("con `volver` repetido en la query, toma el primero y lo valida igual", () => {
    expect(destinoRetorno("/operaciones", ["/operaciones?x=1", "//sitio-malo.cl"])).toBe(
      "/operaciones?x=1"
    );
    expect(destinoRetorno("/operaciones", ["//sitio-malo.cl", "/operaciones?x=1"])).toBe(
      "/operaciones"
    );
  });
});

describe("hrefConRetorno · el listado se lleva su filtro al detalle", () => {
  it("cuelga el retorno codificado", () => {
    expect(hrefConRetorno("/operaciones/abc", "/operaciones?seller=vega&comuna=nunoa")).toBe(
      "/operaciones/abc?volver=%2Foperaciones%3Fseller%3Dvega%26comuna%3Dnunoa"
    );
  });

  it("respeta una query que el href ya traía", () => {
    expect(hrefConRetorno("/operaciones/abc?tab=dinero", "/operaciones?x=1")).toBe(
      "/operaciones/abc?tab=dinero&volver=%2Foperaciones%3Fx%3D1"
    );
  });

  it("no ensucia el enlace cuando no hay filtro que conservar", () => {
    expect(hrefConRetorno("/operaciones/abc", "")).toBe("/operaciones/abc");
    expect(hrefConRetorno("/operaciones/abc", "/")).toBe("/operaciones/abc");
  });

  it("ida y vuelta: lo que cuelga el listado es lo que recupera el detalle", () => {
    const filtro = "/operaciones?seller=vega-norte&comuna=nunoa,maipu&fecha=2026-08-21";
    const href = hrefConRetorno("/operaciones/abc", filtro);
    const volver = new URL(href, "http://x").searchParams.get("volver");
    expect(destinoRetorno("/operaciones", volver)).toBe(filtro);
  });
});
