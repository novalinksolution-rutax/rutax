/**
 * Las reglas duras de la etiqueta térmica, comprobadas sobre el PDF real.
 *
 * No son preferencias de estilo: la térmica es un medio hostil. No tiene grises
 * —los simula con una trama de puntos que a cuerpo 7 se vuelve una mancha—, el
 * fondo lleno gasta cabezal y se corre con el calor, y la etiqueta se lee desde
 * una camioneta.
 *
 * Se comprueba contra los **objetos de estilo**, que es donde viven las reglas,
 * y se genera además el PDF para confirmar que sigue produciéndose.
 */

import { describe, expect, it } from "vitest";

import { generarEtiquetaSameDayPdf, ESTILOS_TERMICA_PARA_PRUEBAS } from "./etiqueta-same-day-pdf";

const DATOS = {
  codigoInterno: "RX-7K2M-9QP4",
  destinatarioNombre: "Juan Pérez",
  destinatarioDireccion: "Av. Providencia 123",
  destinatarioComuna: "Providencia",
  destinatarioTelefono: "+56 9 1234 5678",
  sellerNombre: "Tienda Demo",
  fechaCompromiso: "2026-07-05",
  instruccionesEntrega: null,
  formato: "termica" as const,
};

/** Todos los valores de una hoja de estilos, aplanados. */
function valores(hoja: Record<string, Record<string, unknown>>): [string, unknown][] {
  return Object.entries(hoja).flatMap(([bloque, reglas]) =>
    Object.entries(reglas).map(([prop, valor]) => [`${bloque}.${prop}`, valor] as [string, unknown]),
  );
}

describe("etiqueta térmica · las cuatro reglas duras", () => {
  it("cero grises: todo color es negro puro o blanco puro", () => {
    // Había `#6b7280` en los rótulos y `#9ca3af` en el pie.
    const colores = valores(ESTILOS_TERMICA_PARA_PRUEBAS)
      .filter(([prop]) => /color/i.test(prop))
      .map(([prop, v]) => [prop, String(v).toLowerCase()] as const);
    expect(colores.length).toBeGreaterThan(0);
    for (const [prop, color] of colores) {
      expect(["#000000", "#ffffff"], `${prop} no es negro ni blanco: ${color}`).toContain(color);
    }
  });

  it("ningún texto bajo 15", () => {
    // Los rótulos de campo estaban en 7, y el pie también.
    const tamanos = valores(ESTILOS_TERMICA_PARA_PRUEBAS).filter(([prop]) =>
      prop.endsWith(".fontSize"),
    );
    expect(tamanos.length).toBeGreaterThan(3);
    for (const [prop, tamano] of tamanos) {
      expect(Number(tamano), `${prop} está bajo el piso`).toBeGreaterThanOrEqual(15);
    }
  });

  it("cero tramas de fondo: ningún bloque lleva relleno", () => {
    // El encabezado era un rectángulo #111827 sólido con texto blanco.
    const fondos = valores(ESTILOS_TERMICA_PARA_PRUEBAS).filter(([prop]) =>
      prop.endsWith(".backgroundColor"),
    );
    expect(fondos).toEqual([]);
  });

  it("las reglas son de 2 o 3, nunca de medio punto", () => {
    // Un borde de 0.5 no existe en una térmica: o se pierde o sale de 1 punto.
    const bordes = valores(ESTILOS_TERMICA_PARA_PRUEBAS).filter(([prop]) =>
      /border\w*Width$/.test(prop),
    );
    expect(bordes.length).toBeGreaterThan(0);
    for (const [prop, ancho] of bordes) {
      expect([2, 3], `${prop} mide ${ancho}`).toContain(Number(ancho));
    }
  });

  it("la comuna es MÁS grande que el nombre del destinatario", () => {
    // Se ordena por comuna en el piso de la bodega; el nombre se lee al timbre.
    const { comuna, destinatario } = ESTILOS_TERMICA_PARA_PRUEBAS;
    expect(Number(comuna.fontSize)).toBeGreaterThan(Number(destinatario.fontSize));
  });

  it("el QR lleva su zona de silencio", () => {
    // Sin ella el lector engancha el texto de al lado como parte del símbolo.
    expect(Number(ESTILOS_TERMICA_PARA_PRUEBAS.qr.padding)).toBeGreaterThan(0);
  });

  it("sigue produciendo un PDF", async () => {
    const buf = await generarEtiquetaSameDayPdf(DATOS);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });
});

/**
 * El resto de los impresos comparte una sola regla de tinta: **un solo gris de
 * texto**, el del sistema. Había tres repartidos entre los dos documentos, y el
 * más claro —`#9ca3af`, 2,5:1 sobre blanco— iba en el pie, que es donde está el
 * folio y la fecha de emisión.
 */
describe("impresos carta · un solo gris de texto", () => {
  it("la liquidación del conductor no usa ningún gris fuera del sistema", async () => {
    const { ESTILOS_LIQUIDACION_PARA_PRUEBAS } = await import("@/modules/dinero/liquidacion-pdf");
    const PERMITIDOS = new Set(["#0b1114", "#3e4d53", "#c6d6d8", "#dce7e8", "#f7fbfb", "#ffffff"]);
    const colores = valores(ESTILOS_LIQUIDACION_PARA_PRUEBAS)
      .filter(([prop]) => /color/i.test(prop))
      .map(([prop, v]) => [prop, String(v).toLowerCase()] as const);
    expect(colores.length).toBeGreaterThan(0);
    for (const [prop, color] of colores) {
      expect([...PERMITIDOS], `${prop} usa ${color}, que no es del sistema`).toContain(color);
    }
  });
});
