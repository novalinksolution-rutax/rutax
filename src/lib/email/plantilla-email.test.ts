/**
 * La plantilla de correo, comprobada contra lo que de verdad rompe un correo.
 *
 * Ninguna de estas pruebas es de estética: cada una fija algo que, al faltar,
 * hace que el correo llegue roto a un cliente real.
 */

import { describe, expect, it } from "vitest";

import { envolverEmail } from "./plantilla-email";

const BASE = {
  marca: "Andes Express",
  titular: "Tu período de agosto quedó cerrado",
  cuerpoHtml: "<p>Cerramos tu período con 285 entregas.</p>",
  motivoRecepcion: "Recibes esto porque Andes Express despacha tus pedidos.",
};

describe("plantilla de correo · lo que hace que llegue entero", () => {
  it("es un documento completo, no un fragmento de <p> suelto", () => {
    // Sin contenedor, Outlook estira el texto al ancho de la ventana y deja
    // líneas de 200 caracteres. Era lo que hacían los once correos.
    const html = envolverEmail(BASE);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<head>");
    expect(html).toContain("</html>");
  });

  it("declara el juego de caracteres", () => {
    // Sin esto, «Ñuñoa» o «$ 864.100» pueden salir con caracteres rotos.
    expect(envolverEmail(BASE)).toContain('<meta charset="utf-8">');
  });

  it("la columna es una tabla con ancho en ATRIBUTO, no solo en CSS", () => {
    // Outlook usa el motor de Word: no implementa `max-width` ni `flex`. La
    // única caja que respeta es una tabla con `width` como atributo.
    const html = envolverEmail(BASE);
    expect(html).toContain('width="600"');
    expect(html).toContain("<table");
  });

  it("no usa casi-blanco ni casi-negro", () => {
    // Los clientes invierten por su cuenta en modo oscuro y no se puede
    // impedir. Un #F1F6F6 invertido queda gris sucio; #FFFFFF sobrevive.
    const html = envolverEmail(BASE);
    expect(html).toContain("#FFFFFF");
    expect(html).not.toMatch(/#0[bB]1114[^"]*;color:#1[aA]/);
  });

  it("el botón declara su fondo DOS veces: bgcolor y style", () => {
    // Si el cliente descarta uno, queda el otro. Un botón sin fondo es un
    // texto blanco sobre blanco.
    const html = envolverEmail({
      ...BASE,
      accion: { etiqueta: "Ver el detalle", url: "https://rutax.io/x" },
    });
    expect(html).toContain('bgcolor="#007D69"');
    expect(html).toContain("background-color:#007D69");
  });

  it("el enlace de respaldo va aunque haya botón", () => {
    // Es lo único que queda cuando el cliente degrada, y lo que se puede
    // copiar y pegar.
    const html = envolverEmail({
      ...BASE,
      accion: { etiqueta: "Ver el detalle", url: "https://rutax.io/detalle" },
    });
    const apariciones = html.split("https://rutax.io/detalle").length - 1;
    expect(apariciones).toBeGreaterThanOrEqual(2);
  });

  it("NINGÚN correo depende de una imagen (regla 61)", () => {
    // La mayoría de los clientes bloquea imágenes por defecto: un correo cuya
    // identidad es un logo bloqueado llega anónimo. La marca es texto.
    const html = envolverEmail({
      ...BASE,
      accion: { etiqueta: "Ver", url: "https://rutax.io/x" },
      datos: [{ etiqueta: "Total", valor: "$ 864.100", destacada: true }],
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("background-image");
    expect(html).toContain("Andes Express");
  });

  it("el bloque de datos va en mono y el total se destaca", () => {
    const html = envolverEmail({
      ...BASE,
      datos: [
        { etiqueta: "Entregas", valor: "285" },
        { etiqueta: "Total neto", valor: "$ 864.100", destacada: true },
      ],
    });
    expect(html).toContain("monospace");
    // La fila destacada lleva regla de 2 px y peso; la normal, no.
    expect(html).toContain("border-top:2px solid");
    expect(html).toContain("font-weight:700");
  });

  it("el pie dice por qué lo recibe, y no es opcional", () => {
    expect(envolverEmail(BASE)).toContain("Recibes esto porque");
  });

  it("el preencabezado se oculta del cuerpo", () => {
    // Si se ve, aparece dos veces: en la bandeja y arriba del correo.
    const html = envolverEmail({ ...BASE, preencabezado: "285 entregas · $ 864.100" });
    expect(html).toMatch(/display:none[^"]*"[^>]*>285 entregas/);
  });
});

describe("plantilla de correo · escapa todo menos el cuerpo", () => {
  it("la marca, el titular y el pie se escapan", () => {
    // El nombre del courier sale de la base. Escapa la PLANTILLA y no cada
    // llamador, porque un llamador nuevo se olvida y nadie lo nota.
    const html = envolverEmail({
      marca: '<script>alert("x")</script>',
      titular: '<img src=x onerror=alert(1)>',
      cuerpoHtml: "<p>ok</p>",
      motivoRecepcion: "<b>ojo</b>",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>ojo</b>");
  });

  it("la etiqueta y la URL del botón también", () => {
    const html = envolverEmail({
      marca: "Andes",
      titular: "Hola",
      cuerpoHtml: "<p>ok</p>",
      motivoRecepcion: "porque sí",
      accion: { etiqueta: '<script>x</script>', url: 'https://x.cl/"><script>y</script>' },
    });
    expect(html).not.toContain("<script>");
  });

  it("las filas de datos también", () => {
    const html = envolverEmail({
      marca: "Andes",
      titular: "Hola",
      cuerpoHtml: "<p>ok</p>",
      motivoRecepcion: "porque sí",
      datos: [{ etiqueta: "<script>a</script>", valor: "<script>b</script>" }],
    });
    expect(html).not.toContain("<script>");
  });

  it("`cuerpoHtml` SÍ pasa como HTML: es el único campo así, por contrato", () => {
    const html = envolverEmail({
      marca: "Andes",
      titular: "Hola",
      cuerpoHtml: "<p><strong>285</strong> entregas</p>",
      motivoRecepcion: "porque sí",
    });
    expect(html).toContain("<strong>285</strong>");
  });
});
