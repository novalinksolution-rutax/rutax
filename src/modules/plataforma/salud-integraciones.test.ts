import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  clasificarConexion,
  contarPorCajonSalud,
  DIAS_VENCE_PRONTO,
  type ConexionSalud,
} from "./salud-integraciones";

const AHORA = Date.parse("2026-08-24T12:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;

function conexion(p: Partial<ConexionSalud> = {}): ConexionSalud {
  return {
    id: "c1",
    empresa: "Andes Express",
    seller: "Vega Norte SpA",
    cuenta: "Vega Norte Oficial",
    fuente: "ml_flex",
    estadoSalud: "sana",
    tokenExpiraEn: null,
    desconectadaDesde: null,
    ultimaSyncExitosaEn: null,
    ...p,
  };
}

describe("clasificarConexion", () => {
  it("sana y sin caducidad cerca: sana", () => {
    expect(clasificarConexion(conexion(), AHORA)).toBe("sana");
    expect(
      clasificarConexion(
        conexion({ tokenExpiraEn: new Date(AHORA + 40 * DIA).toISOString() }),
        AHORA,
      ),
    ).toBe("sana");
  });

  it("desvinculada y atención caen las dos en «caída»", () => {
    // Para el courier el resultado es el mismo: no le entran los pedidos.
    expect(clasificarConexion(conexion({ estadoSalud: "desvinculada" }), AHORA)).toBe("caida");
    expect(clasificarConexion(conexion({ estadoSalud: "atencion" }), AHORA)).toBe("caida");
  });

  it("🔴 `pendiente` también es caída: es la que más se olvida", () => {
    // Nunca llegó a funcionar, así que nunca "dejó" de andar — y por eso no
    // aparece en ninguna alarma. El seller cree que conectó y no entra nada.
    expect(clasificarConexion(conexion({ estadoSalud: "pendiente" }), AHORA)).toBe("caida");
  });

  it("vence dentro de la ventana: «vence pronto»", () => {
    expect(
      clasificarConexion(conexion({ tokenExpiraEn: new Date(AHORA + 3 * DIA).toISOString() }), AHORA),
    ).toBe("vence_pronto");
  });

  it("el borde exacto de la ventana todavía cuenta", () => {
    expect(
      clasificarConexion(
        conexion({ tokenExpiraEn: new Date(AHORA + DIAS_VENCE_PRONTO * DIA).toISOString() }),
        AHORA,
      ),
    ).toBe("vence_pronto");
    // Un minuto después, ya no.
    expect(
      clasificarConexion(
        conexion({ tokenExpiraEn: new Date(AHORA + DIAS_VENCE_PRONTO * DIA + 60_000).toISOString() }),
        AHORA,
      ),
    ).toBe("sana");
  });

  it("token ya vencido aunque el estado diga sana: caída", () => {
    // El sondeo todavía no pasó. Es lo más parecido a una caída que se puede
    // afirmar sin mentir, y dejarlo en «sana» esconde el caso más urgente.
    expect(
      clasificarConexion(conexion({ tokenExpiraEn: new Date(AHORA - DIA).toISOString() }), AHORA),
    ).toBe("caida");
  });

  it("🔴 lo urgente manda sobre lo anticipado", () => {
    // Ya caída Y a punto de vencer sigue siendo caída: en «vence pronto» se
    // saldría de la lista de las que hay que llamar hoy.
    expect(
      clasificarConexion(
        conexion({
          estadoSalud: "desvinculada",
          tokenExpiraEn: new Date(AHORA + DIA).toISOString(),
        }),
        AHORA,
      ),
    ).toBe("caida");
  });

  it("una fecha ilegible NO llena el cajón de avisos falsos", () => {
    expect(clasificarConexion(conexion({ tokenExpiraEn: "mañana" }), AHORA)).toBe("sana");
    expect(clasificarConexion(conexion({ tokenExpiraEn: "" }), AHORA)).toBe("sana");
  });
});

describe("🔴 Shopify nunca vence, aunque el tablero dibuje una fila que sí", () => {
  it("una conexión de Shopify sana nunca cae en «vence pronto»", () => {
    // Su token es un Admin API token de app privada, pegado a mano: no caduca.
    // Se revoca, y eso se ve como caída.
    expect(clasificarConexion(conexion({ fuente: "shopify", tokenExpiraEn: null }), AHORA)).toBe(
      "sana",
    );
  });

  it("y la tabla de Shopify sigue sin columna de expiración", () => {
    // Candado: si algún día aparece, hay que volver acá y decidir qué significa
    // —hoy el mapeo pone `tokenExpiraEn: null` a mano.
    const migracion = readFileSync(
      "supabase/migrations/20260816000005_identidad_conexiones_seller_shopify.sql",
      "utf8",
    );
    // ⚠️ Se busca la DECLARACIÓN de la columna, no la palabra: la migración
    // nombra `token_expira_en` dos veces —en su cabecera y en un `comment on`—
    // precisamente para explicar que Shopify NO lo tiene. Un `not.toContain`
    // pelado fallaría por la explicación de por qué no existe.
    expect(migracion).not.toMatch(/token_expira_en\s+timestamptz/i);
    expect(migracion).not.toMatch(/add\s+column[^;]*token_expira_en/i);
  });
});

describe("contarPorCajonSalud", () => {
  it("devuelve los tres cajones aunque estén en cero", () => {
    expect(contarPorCajonSalud([], AHORA)).toEqual({ caida: 0, vence_pronto: 0, sana: 0 });
  });

  it("la suma de los tres es el total: ninguna conexión se pierde", () => {
    const lista = [
      conexion({ id: "1" }),
      conexion({ id: "2", estadoSalud: "desvinculada" }),
      conexion({ id: "3", tokenExpiraEn: new Date(AHORA + 2 * DIA).toISOString() }),
      conexion({ id: "4", fuente: "shopify" }),
    ];
    const c = contarPorCajonSalud(lista, AHORA);
    expect(c).toEqual({ caida: 1, vence_pronto: 1, sana: 2 });
    expect(c.caida + c.vence_pronto + c.sana).toBe(lista.length);
  });
});

describe("🔴 la consulta no toca los secretos", () => {
  it("el `select` deja fuera toda referencia de token", () => {
    // Esta pantalla necesita saber si la conexión anda, no cómo se autentica.
    // Un `select("*")` pondría punteros a secretos en la memoria de un Server
    // Component por comodidad.
    const fuente = readFileSync("src/modules/plataforma/salud-integraciones.ts", "utf8");
    const consultas = fuente.slice(fuente.indexOf("listarConexionesDeTodosLosCouriers"));
    expect(consultas).not.toContain("access_token_ref");
    expect(consultas).not.toContain("refresh_token_ref");
    expect(consultas).not.toContain('"*"');
  });
});
