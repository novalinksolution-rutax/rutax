import { describe, expect, it } from "vitest";

import { construirEmailSeguimiento, type ArgsEmailSeguimiento } from "./mail-seguimiento";

/**
 * El correo al comprador final.
 *
 * Lo que se prueba no es el estilo: es **a quién NO se le manda** y **qué datos
 * no puede llevar**. Un correo con un dato de más, a un destinatario que ni
 * siquiera es cliente nuestro, no se puede deshacer.
 */

const BASE: ArgsEmailSeguimiento = {
  fuente: "rutax_manual",
  nombreCourier: "Andes Express",
  nombreTienda: "Vega Norte",
  codigoEnvio: "RX-7K2M-9PQR",
  comuna: "Ñuñoa",
  urlSeguimiento: "https://rutax.io/tracking/8f3c1a77-b2e0-4d5e-8a16-c0d4f7b93e21",
  momento: "en_camino",
  cuando: "hoy entre las 15:00 y las 17:00",
};

describe("mail.seguimiento · a quién NO se le manda", () => {
  it("🔴 en Flex devuelve null: la relación con el comprador es de Mercado Libre", () => {
    // ML ya le manda sus propios avisos y su app registra la entrega. Un correo
    // nuestro sería un segundo remitente con otra hora, y la que manda no es la
    // nuestra.
    expect(construirEmailSeguimiento({ ...BASE, fuente: "ml_flex" })).toBeNull();
  });

  it("🔴 ante una fuente desconocida devuelve null: falla cerrado", () => {
    // Una fuente nueva no empieza a escribirle a compradores por omisión.
    expect(construirEmailSeguimiento({ ...BASE, fuente: "falabella" })).toBeNull();
    expect(construirEmailSeguimiento({ ...BASE, fuente: null })).toBeNull();
    expect(construirEmailSeguimiento({ ...BASE, fuente: undefined })).toBeNull();
    expect(construirEmailSeguimiento({ ...BASE, fuente: "" })).toBeNull();
  });

  it("en same-day propio y en Shopify sí se manda", () => {
    expect(construirEmailSeguimiento({ ...BASE, fuente: "rutax_manual" })).not.toBeNull();
    expect(construirEmailSeguimiento({ ...BASE, fuente: "shopify" })).not.toBeNull();
  });
});

describe("mail.seguimiento · la forma más restringida del pedido", () => {
  const r = construirEmailSeguimiento(BASE)!;

  it("🔴 no lleva dirección, ni nombre del destinatario, ni teléfono, ni monto", () => {
    // Un correo se reenvía y se queda en una bandeja que no controlamos. Es la
    // misma regla legal del punto en el mapa de la Torre.
    //
    // Se comprueba sobre el HTML **y** sobre el texto plano: si el dato se
    // colara solo en la versión de texto, la regla quedaría rota por la puerta
    // de atrás y ninguna prueba de HTML lo vería.
    const prohibidos = [
      "Av. Irarrázaval",
      "María González",
      "+569",
      "$",
      "Carlos Vera", // el conductor
    ];
    for (const dato of prohibidos) {
      expect(r.html).not.toContain(dato);
      expect(r.texto).not.toContain(dato);
    }
  });

  it("lleva exactamente el código y la comuna, y nada más como dato", () => {
    expect(r.html).toContain("RX-7K2M-9PQR");
    expect(r.html).toContain("Ñuñoa");
    expect(r.texto).toContain("RX-7K2M-9PQR");
    expect(r.texto).toContain("Ñuñoa");
  });

  it("🔴 el entregado NUNCA dice quién recibió", () => {
    const entregado = construirEmailSeguimiento({
      ...BASE,
      momento: "entregado",
      cuando: "hoy a las 16:24",
    })!;
    expect(entregado.html).toContain("Lo recibió alguien en el domicilio");
    // Y es literalmente el mismo copy que muestra `/tracking/[token]`: dos
    // redacciones para el mismo hecho harían dudar de cuál es la buena.
    expect(entregado.html).not.toMatch(/recibió\s+\w+\s+\w+ó/);
  });
});

describe("mail.seguimiento · quién firma y qué dice el asunto", () => {
  const r = construirEmailSeguimiento(BASE)!;

  it("firma el COURIER, porque es quien entrega", () => {
    expect(r.html).toMatch(/font-size:18px[^<]*font-weight:700[^<]*>Andes Express</);
  });

  it("pero el ASUNTO nombra la TIENDA, que es lo que el comprador reconoce", () => {
    // Si el asunto dijera el courier, la mitad lo leería como publicidad de una
    // empresa que no conoce.
    expect(r.asunto).toBe("Tu pedido de Vega Norte va en camino");
    expect(r.asunto).not.toContain("Andes Express");
    expect(r.asunto).not.toContain("Rutax");
  });

  it("el asunto NO lleva la hora: se congela en la bandeja", () => {
    // Misma razón por la que la tarjeta de enlace compartido dice «Sigue tu
    // pedido» y no el estado: el correo se abre días después.
    expect(r.asunto).not.toContain("15:00");
    expect(r.asunto).not.toContain("hoy");
  });

  it("el entregado cambia el asunto, y sigue nombrando la tienda", () => {
    const entregado = construirEmailSeguimiento({ ...BASE, momento: "entregado" })!;
    expect(entregado.asunto).toBe("Tu pedido de Vega Norte llegó");
  });

  it("el pie explica por qué le llega a alguien que nunca se registró", () => {
    // Sin esta frase el correo parece spam de un remitente ajeno.
    expect(r.html).toContain("Vega Norte nos pidió entregarte este pedido");
    // Y Rutax va al pie, presente pero no protagonista.
    expect(r.html).toContain("Despacho gestionado con");
  });
});

describe("mail.seguimiento · no inventa precisión", () => {
  it("sin ventana comprometida, el titular dice el hecho pelado", () => {
    // Escribir una hora que no existe delante de alguien que no puede
    // contradecirla es la peor forma de fallar en esta pieza.
    const sinHora = construirEmailSeguimiento({ ...BASE, cuando: null })!;
    expect(sinHora.html).toContain("Va en camino");
    expect(sinHora.html).not.toContain("Llega ");
  });

  it("sin hora de entrega, el entregado tampoco la inventa", () => {
    const sinHora = construirEmailSeguimiento({
      ...BASE,
      momento: "entregado",
      cuando: null,
    })!;
    expect(sinHora.html).toContain("Lo entregamos");
    expect(sinHora.html).not.toContain("Se entregó ");
  });
});

describe("mail.seguimiento · escapa lo que sale de la base", () => {
  it("el nombre del courier va escapado también en el cuerpo", () => {
    // El cuerpo es el único campo que la plantilla NO escapa, así que este
    // módulo tiene que hacerlo. El nombre sale de la base.
    const r = construirEmailSeguimiento({
      ...BASE,
      nombreCourier: '<img src=x onerror=alert(1)>',
    })!;
    expect(r.html).not.toContain("<img");
    // Y sigue estando, escapado: escapar no es borrar.
    expect(r.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
