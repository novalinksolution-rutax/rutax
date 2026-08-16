/**
 * Pruebas del correo de incidencia sin gestionar.
 *
 * La mitad de estas pruebas son NEGATIVAS, y es a propósito: lo que hay que
 * custodiar acá no es que el correo se vea bien, sino que **no lleve datos
 * personales**. Este texto sale hacia una bandeja de entrada — un lugar que
 * Rutax no controla, que se reenvía, que se busca por texto y que sobrevive
 * años. Un nombre o una dirección que se cuelen no se pueden retirar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/identidad/enlace-invitacion", () => ({
  resolverUrlBaseApp: vi.fn(() => "https://rutax.app"),
}));

import { resolverUrlBaseApp } from "@/modules/identidad/enlace-invitacion";
import { construirAvisoIncidencia } from "./aviso-incidencia-email";

const BASE = {
  codigoEnvio: "RX-1234-5678",
  comuna: "Maipú",
  tipoIncidencia: "Destinatario ausente",
  horasAbierta: 5.4,
  pedidoId: "60000000-0000-0000-0000-000000000001",
  nombreCourier: "Despachos del Centro",
};

beforeEach(() => {
  vi.mocked(resolverUrlBaseApp).mockReturnValue("https://rutax.app");
});

describe("construirAvisoIncidencia", () => {
  it("dice qué envío, dónde y por qué — lo mínimo para actuar sin buscar", () => {
    const r = construirAvisoIncidencia(BASE);

    expect(r.asunto).toContain("RX-1234-5678");
    expect(r.asunto).toContain("5 h"); // redondeado: "5.4 horas" no aporta nada
    for (const texto of [r.html, r.texto]) {
      expect(texto).toContain("RX-1234-5678");
      expect(texto).toContain("Maipú");
      expect(texto).toContain("Destinatario ausente");
    }
  });

  it("el enlace lleva a la ficha del pedido, que es donde están los botones", () => {
    const r = construirAvisoIncidencia(BASE);
    const url = `https://rutax.app/operaciones/${BASE.pedidoId}`;
    expect(r.html).toContain(url);
    expect(r.texto).toContain(url);
  });

  it("sin dominio configurado NO pinta un enlace muerto", () => {
    // Un enlace roto hace dudar de si el aviso es real. Mejor decir dónde
    // buscarlo.
    vi.mocked(resolverUrlBaseApp).mockReturnValue(null);
    const r = construirAvisoIncidencia(BASE);

    expect(r.html).not.toContain("href=");
    expect(r.texto).toContain("Operación → Pedidos");
  });

  it("NUNCA lleva nombre, dirección ni teléfono del destinatario", () => {
    // La función ni siquiera los recibe — el tipo `DatosAvisoIncidencia` no
    // tiene esos campos. Esta prueba fija esa forma: si alguien los agregara al
    // tipo "para dar más contexto", tendría que borrar este test a mano y
    // enterarse de por qué existe.
    const claves = Object.keys(BASE);
    expect(claves).not.toContain("destinatarioNombre");
    expect(claves).not.toContain("destinatarioDireccion");
    expect(claves).not.toContain("destinatarioTelefono");
    expect(claves).not.toContain("trackingToken");

    const r = construirAvisoIncidencia(BASE);
    // Y el texto tampoco menciona la calle: solo la comuna.
    expect(r.texto.toLowerCase()).not.toContain("dirección:");
    expect(r.texto.toLowerCase()).not.toContain("teléfono");
  });

  it("escapa el HTML — un nombre de courier con `<` no puede inyectar marcado", () => {
    // El nombre de fantasía lo escribe el propio courier. No es un vector
    // remoto, pero un `<` sin escapar rompería el correo de todas formas.
    const r = construirAvisoIncidencia({
      ...BASE,
      nombreCourier: 'Courier <script>alert("x")</script>',
    });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
  });

  it("el asunto identifica el envío: se lee en la notificación del teléfono, sin abrir", () => {
    const r = construirAvisoIncidencia(BASE);
    // Sin el código en el asunto, dos avisos distintos se ven idénticos en la
    // bandeja y se archivan juntos.
    expect(r.asunto.startsWith("Incidencia sin gestionar")).toBe(true);
    expect(r.asunto).toContain(BASE.codigoEnvio);
  });
});
