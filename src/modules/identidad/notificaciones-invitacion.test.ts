import { describe, expect, it } from "vitest";
import { construirEmailInvitacion } from "./notificaciones-invitacion";

const BASE = {
  nombreCourier: "Andes Express",
  urlInvitacion: "https://app.rutax.cl/invitacion/tok-123",
  expiraEn: new Date("2026-08-14T12:00:00Z").toISOString(),
};

describe("construirEmailInvitacion", () => {
  it("al seller le explica de quién viene y qué gana — es un cliente, no un usuario interno", () => {
    const email = construirEmailInvitacion({ ...BASE, tipoUsuario: "seller" });

    expect(email.asunto).toContain("Andes Express");
    expect(email.html).toContain(BASE.urlInvitacion);
    expect(email.texto).toContain(BASE.urlInvitacion);
    // El siguiente paso real del seller: conectar su cuenta de ML.
    expect(email.html).toContain("Mercado Libre");
  });

  it("distingue los tres destinatarios: seller, conductor e interno", () => {
    const asuntos = (["seller", "conductor", "interno"] as const).map(
      (tipoUsuario) => construirEmailInvitacion({ ...BASE, tipoUsuario }).asunto,
    );
    expect(new Set(asuntos).size).toBe(3);
  });

  it("no filtra jerga técnica al destinatario", () => {
    for (const tipoUsuario of ["seller", "conductor", "interno"] as const) {
      const email = construirEmailInvitacion({ ...BASE, tipoUsuario });
      const todo = `${email.asunto} ${email.html} ${email.texto}`.toLowerCase();
      for (const jerga of ["token", "oauth", "tenant", "invitación pendiente"]) {
        expect(todo).not.toContain(jerga);
      }
    }
  });

  it("avisa la fecha de vencimiento en las dos versiones del cuerpo", () => {
    const email = construirEmailInvitacion({ ...BASE, tipoUsuario: "seller" });
    expect(email.html).toContain("14-08-2026");
    expect(email.texto).toContain("14-08-2026");
  });

  it("escapa el nombre del courier — sale de la base y podría traer HTML", () => {
    const email = construirEmailInvitacion({
      ...BASE,
      tipoUsuario: "seller",
      nombreCourier: 'Andes <script>alert("x")</script>',
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});
