import { describe, it, expect } from "vitest";

import {
  construirEmailFacturaEmitida,
  construirEmailLiquidacionPagada,
  construirEmailPagoRechazado,
  construirEmailFoliosPorAgotarse,
  construirEmailCertificadoPorVencer,
} from "./notificaciones-dinero";

/**
 * Los cinco correos de dinero.
 *
 * Lo que se prueba no es el estilo: es **quién firma**, **qué dice el asunto** y
 * **que no se escape a un destinatario lo que no le toca**. Un correo con el
 * remitente equivocado o con un dato de más no se puede deshacer.
 */

const BASE_FACTURA = {
  nombreCourier: "Andes Express",
  folio: 1041,
  fechaEmision: "2026-08-31",
  periodoInicio: "2026-08-01",
  periodoFin: "2026-08-31",
  netoClp: 864100,
  ivaClp: 164179,
  totalClp: 1028279,
  entregas: 227,
  urlPortal: "https://rutax.io/portal/cobros/abc",
};

describe("factura emitida · al seller", () => {
  const r = construirEmailFacturaEmitida(BASE_FACTURA);

  it("el asunto lleva el hecho y su NÚMERO, no el nombre del producto", () => {
    // El folio es lo que el contador del seller busca en su bandeja.
    expect(r.asunto).toBe("Factura 1041 · $1.028.279");
    expect(r.asunto).not.toContain("Rutax");
  });

  it("firma el COURIER, no Rutax: el seller es su cliente (regla 42)", () => {
    expect(r.html).toContain("Andes Express");

    // ⚠️ La regla 42 rige el CUERPO, no el pie. La lámina de la plantilla base
    // y la tarjeta de seguimiento de B7 ponen las dos lo mismo abajo:
    // «Despacho gestionado con Rutax», en 11 px. Presente, no protagonista —
    // sin eso el seller no tiene forma de saber a quién reclamarle si el
    // software falla, ni de reconocer el correo si cambia de courier.
    const sinUrls = r.html.replace(/https?:\/\/[^"']+/g, "");
    const [antesDelPie, pie] = partirEnElPie(sinUrls);
    expect(antesDelPie).not.toContain("Rutax");
    expect(pie).toContain("Despacho gestionado con");
  });

  it("es el ÚNICO correo que nombra el IVA, y lo nombra", () => {
    // La regla 22 dice que Rutax no muestra impuestos en sus pantallas. Esto no
    // es una pantalla: es el aviso de un documento del SII, y esconder el IVA
    // haría que el total del correo no cuadrara con el papel.
    expect(r.html).toContain("IVA 19 %");
    expect(r.html).toContain("$164.179");
    expect(r.html).toContain("$864.100");
  });

  it("sin dominio configurado NO inventa un botón", () => {
    const sinUrl = construirEmailFacturaEmitida({ ...BASE_FACTURA, urlPortal: null });
    expect(sinUrl.html).not.toContain("Ver el detalle y descargar");
  });
});

describe("liquidación pagada · al conductor", () => {
  const base = {
    nombreCourier: "Andes Express",
    montoClp: 284500,
    periodoInicio: "2026-08-01",
    periodoFin: "2026-08-15",
    entregas: 74,
    visitas: 3,
    urlApp: null,
  };

  it("el monto va en el ASUNTO: es lo que decide si se abre ahora", () => {
    expect(construirEmailLiquidacionPagada(base).asunto).toBe("Te transferimos $284.500");
  });

  it("nombra las visitas aparte de las entregas", () => {
    // Son dos hechos generadores distintos, y la visita es la parte que el
    // conductor no da por descontada.
    const r = construirEmailLiquidacionPagada(base);
    expect(r.texto).toContain("74 entregas");
    expect(r.texto).toContain("3 visitas a bodega");
  });

  it("sin visitas no inventa la fila ni la menciona", () => {
    const r = construirEmailLiquidacionPagada({ ...base, visitas: 0 });
    expect(r.texto).not.toContain("visita");
    expect(r.html).not.toContain("Visitas a bodega");
  });

  it("avisa que el banco puede tardar", () => {
    // Sin esto, el conductor mira su cuenta, no ve nada y llama.
    expect(construirEmailLiquidacionPagada(base).texto).toContain("tardar unas horas");
  });

  it("singular y plural", () => {
    const r = construirEmailLiquidacionPagada({ ...base, entregas: 1, visitas: 1 });
    expect(r.texto).toContain("1 entrega y 1 visita a bodega");
  });
});

describe("pago rechazado · al courier", () => {
  const base = {
    nombreConductor: "Juan Pérez",
    montoClp: 284500,
    periodoInicio: "2026-08-01",
    periodoFin: "2026-08-15",
    motivoBanco: "Cuenta no existe",
    urlLiquidacion: null,
  };

  it("dice explícitamente que el conductor NO recibió el aviso", () => {
    // Va al courier porque es quien puede arreglarlo. Avisarle al conductor de
    // un rechazo que no puede resolver lo deja llamando sin nada que hacer.
    expect(construirEmailPagoRechazado(base).html).toContain("Él no recibió este aviso");
  });

  it("pasa el motivo del banco TAL COMO VINO, sin traducirlo", () => {
    // Inventar una explicación sobre un código que no se persiste fue el
    // defecto que ya se corrigió en la pantalla de liquidaciones.
    expect(construirEmailPagoRechazado(base).html).toContain("Cuenta no existe");
  });

  it("sin motivo del banco no inventa uno", () => {
    const r = construirEmailPagoRechazado({ ...base, motivoBanco: null });
    expect(r.html).not.toContain("Dijo el banco");
    expect(r.texto).not.toContain("Dijo:");
  });

  it("el asunto nombra al conductor: el courier tiene varios", () => {
    expect(construirEmailPagoRechazado(base).asunto).toContain("Juan Pérez");
  });
});

describe("folios por agotarse · al courier", () => {
  const r = construirEmailFoliosPorAgotarse({
    nombreCourier: "Andes Express",
    foliosRestantes: 12,
    folioHasta: 5000,
    urlFolios: null,
  });

  it("dice la CONSECUENCIA, no solo el número", () => {
    // «Te quedan 12» no significa nada para quien no sabe que sin folios no se
    // emite.
    expect(r.html).toContain("no vas a poder emitir facturas");
  });

  it("firma Rutax: es infraestructura que el courier contrató con nosotros", () => {
    expect(r.html).toContain("Rutax");
  });

  it("el asunto lleva el número", () => {
    expect(r.asunto).toBe("Te quedan 12 folios para facturar");
  });
});

describe("certificado por vencer · al courier", () => {
  it("el plazo va en DÍAS, no solo en fecha", () => {
    // «Vence el 12-09-2026» obliga a hacer la cuenta, y el que la hace mal es el
    // que se queda sin facturar.
    const r = construirEmailCertificadoPorVencer({
      nombreCourier: "Andes Express",
      diasRestantes: 15,
      fechaVencimiento: "2026-09-12",
      urlCertificado: null,
    });
    expect(r.asunto).toBe("Tu certificado digital vence en 15 días");
    expect(r.html).toContain("15 días");
  });

  it("«mañana» y «hoy» se dicen con esas palabras", () => {
    expect(
      construirEmailCertificadoPorVencer({
        nombreCourier: "A",
        diasRestantes: 1,
        fechaVencimiento: "2026-09-12",
        urlCertificado: null,
      }).asunto,
    ).toContain("mañana");
  });

  it("ya vencido cambia el tiempo verbal y no ofrece un plazo", () => {
    const r = construirEmailCertificadoPorVencer({
      nombreCourier: "A",
      diasRestantes: 0,
      fechaVencimiento: "2026-09-12",
      urlCertificado: null,
    });
    expect(r.asunto).toBe("Tu certificado digital venció");
    expect(r.html).not.toContain("Te quedan");
    expect(r.texto).toContain("No puedes emitir facturas");
  });
});

describe("los cinco, como conjunto", () => {
  const todos = [
    construirEmailFacturaEmitida(BASE_FACTURA),
    construirEmailLiquidacionPagada({
      nombreCourier: "A",
      montoClp: 1,
      periodoInicio: "2026-08-01",
      periodoFin: "2026-08-15",
      entregas: 1,
      visitas: 0,
      urlApp: null,
    }),
    construirEmailPagoRechazado({
      nombreConductor: "J",
      montoClp: 1,
      periodoInicio: "2026-08-01",
      periodoFin: "2026-08-15",
      motivoBanco: null,
      urlLiquidacion: null,
    }),
    construirEmailFoliosPorAgotarse({
      nombreCourier: "A",
      foliosRestantes: 1,
      folioHasta: 2,
      urlFolios: null,
    }),
    construirEmailCertificadoPorVencer({
      nombreCourier: "A",
      diasRestantes: 5,
      fechaVencimiento: "2026-09-12",
      urlCertificado: null,
    }),
  ];

  it("todos son documentos completos, no fragmentos de `<p>`", () => {
    // Un fragmento sin `<head>` lo renderiza cada cliente como quiere, y sin
    // juego de caracteres declarado un «Ñuñoa» puede llegar roto.
    for (const c of todos) {
      expect(c.html.toLowerCase()).toContain("<!doctype html");
      expect(c.html).toContain("charset");
    }
  });

  it("ninguno termina el asunto en « — Rutax »", () => {
    // Son seis caracteres de los ~45 que se ven en el teléfono, y el remitente
    // ya lo dice.
    for (const c of todos) expect(c.asunto).not.toMatch(/—\s*Rutax\s*$/);
  });

  it("todos declaran por qué se reciben", () => {
    for (const c of todos) expect(c.html).toContain("Recibes este correo porque");
  });

  it("todos traen versión en texto plano", () => {
    for (const c of todos) expect(c.texto.length).toBeGreaterThan(40);
  });

  it("ninguno depende de una imagen (regla 61)", () => {
    for (const c of todos) expect(c.html).not.toContain("<img");
  });
});

/**
 * Parte el HTML en «todo lo anterior al pie» y «el pie».
 *
 * El pie es la última banda de la plantilla: la que lleva fondo tenue y el
 * borde superior. Se localiza por su `background-color`, que es el único de esa
 * banda en todo el documento.
 */
function partirEnElPie(html: string): [string, string] {
  const i = html.lastIndexOf("background-color:#F1F6F6");
  if (i < 0) throw new Error("no se encontró la banda de pie");
  return [html.slice(0, i), html.slice(i)];
}
