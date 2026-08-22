import { describe, expect, it } from "vitest";

import { destinosMovil, MAX_DESTINOS_MOVIL } from "@/components/app-shell/destinos-movil";
import type { ItemNav } from "@/components/app-shell/iconos-nav";

/**
 * La barra inferior del teléfono no tiene una lista de destinos por rol: toma
 * los primeros cuatro de su orden de preferencia **entre los que la persona ya
 * puede ver**. Estas pruebas fijan esa derivación, porque es lo que hace que
 * «los del coordinador no son los de Administración» sea cierto por
 * construcción y no por un `if` que alguien tiene que acordarse de actualizar.
 */

const item = (href: string): ItemNav => ({ href, etiqueta: href, icono: "pedidos" });

/** Lo que el layout arma hoy para cada rol, en orden de sidebar. */
const NAV = {
  coordinador: [
    "/torre-de-control",
    "/preparacion",
    "/operaciones",
    "/manifiestos",
    "/conductores",
    "/operaciones/incidencias",
    "/sellers",
  ],
  dueno: [
    "/dashboard",
    "/torre-de-control",
    "/preparacion",
    "/operaciones",
    "/manifiestos",
    "/conductores",
    "/operaciones/incidencias",
    "/dinero/periodos",
    "/dinero/liquidaciones",
    "/dinero/conciliacion",
    "/dinero/cobranza",
    "/sellers",
  ],
  // Administración no tiene ninguna capacidad de operación.
  administracion: [
    "/dinero/periodos",
    "/dinero/liquidaciones",
    "/dinero/conciliacion",
    "/dinero/cobranza",
    "/sellers",
  ],
  seller: ["/portal", "/portal/pedidos", "/portal/bodegas", "/portal/incidencias", "/portal/cobros"],
};

const hrefs = (items: ItemNav[]) => items.map((i) => i.href);

describe("destinosMovil · los cuatro salen del rol, no de una lista aparte", () => {
  it("quien coordina recibe los cuatro del tablero P1", () => {
    expect(hrefs(destinosMovil(NAV.coordinador.map(item)))).toEqual([
      "/operaciones",
      "/preparacion",
      "/torre-de-control",
      "/operaciones/incidencias",
    ]);
  });

  it("Administración recibe los de dinero, sin que nadie lo declare por rol", () => {
    expect(hrefs(destinosMovil(NAV.administracion.map(item)))).toEqual([
      "/dinero/periodos",
      "/dinero/liquidaciones",
      "/dinero/conciliacion",
      "/dinero/cobranza",
    ]);
  });

  it("los del dueño y los de Administración NO coinciden", () => {
    const dueno = hrefs(destinosMovil(NAV.dueno.map(item)));
    const admin = hrefs(destinosMovil(NAV.administracion.map(item)));
    expect(dueno).not.toEqual(admin);
  });

  it("el dashboard cede su lugar a lo que se abre de pie", () => {
    // Es la pantalla de inicio del dueño en escritorio y aun así queda fuera de
    // los cuatro: en el teléfono pierde contra la bodega. Sigue en el panel.
    const dueno = hrefs(destinosMovil(NAV.dueno.map(item)));
    expect(dueno).not.toContain("/dashboard");
    expect(dueno).toContain("/operaciones");
  });

  it("el seller recibe los suyos, no los del courier", () => {
    expect(hrefs(destinosMovil(NAV.seller.map(item)))).toEqual([
      "/portal",
      "/portal/pedidos",
      "/portal/cobros",
      "/portal/incidencias",
    ]);
  });

  it("nunca devuelve más de cuatro", () => {
    for (const nav of Object.values(NAV)) {
      expect(destinosMovil(nav.map(item)).length).toBeLessThanOrEqual(MAX_DESTINOS_MOVIL);
    }
  });

  it("con menos de cuatro destinos conocidos, completa con lo que haya", () => {
    // Una barra de dos es mejor que ninguna.
    const pocos = ["/algo-nuevo", "/otra-cosa"].map(item);
    expect(hrefs(destinosMovil(pocos))).toEqual(["/algo-nuevo", "/otra-cosa"]);
  });

  it("sin navegación no hay barra", () => {
    expect(destinosMovil([])).toEqual([]);
  });

  it("no repite un destino que ya entró por prioridad", () => {
    const conRepetido = ["/operaciones", "/preparacion", "/operaciones"].map(item);
    const salida = hrefs(destinosMovil(conRepetido));
    expect(new Set(salida).size).toBe(salida.length);
  });
});
