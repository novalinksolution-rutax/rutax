import { describe, expect, it } from "vitest";

import {
  BADGE_COBERTURA_ESTADO,
  BADGE_ESTADO_CONCILIACION,
  BADGE_ESTADO_INCIDENCIA,
  BADGE_ESTADO_LIQUIDACION,
  BADGE_ESTADO_MANIFIESTO,
  BADGE_ESTADO_MATCH_PAGO,
  BADGE_ESTADO_PAYOUT,
  BADGE_ESTADO_PEDIDO,
  BADGE_ESTADO_PERIODO,
  BADGE_ESTADO_SELLER,
  BADGE_GEO_ESTADO,
  BADGE_SITUACION_RETIRO,
  BADGE_CATEGORIA_NEGOCIO_CONCILIACION,
  BADGE_ESTADO_COBRO_PERIODO,
  BADGE_ESTADO_MANDATO,
  BADGE_ESTADO_PAGO_SUSCRIPCION,
  BADGE_ESTADO_PERIODO_SUSCRIPCION,
  BADGE_ESTADO_SUSCRIPCION,
  BADGE_ESTADO_SII,
  BADGE_SALUD_CONEXION,
  BADGE_CONEXION_COBRANZA,
  BADGE_INVITACION,
  BADGE_FOLIO_CAF,
  BADGE_CERTIFICACION_DTE,
  BADGE_SALUD_JOB,
  type BadgeVariante,
} from "@/lib/ui/traduccion-estados";
import {
  CORRECCIONES_TONO,
  EJE,
  TONOS_ESTADO,
  tonoDeEstado,
  tonoDesdeVariante,
  type NombreEje,
  type VarianteHeredada,
} from "@/lib/ui/tonos-estado";

/**
 * La red mecánica de la tabla de correcciones de tono.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ---------------------------------------------------------------------------
 * `CORRECCIONES_TONO` es un `Record<string, …>` con claves `"eje:valor"`
 * escritas a mano. Eso tiene una trampa que no avisa: **un typo no rompe nada**.
 * `"pedido:asignadoo"` compila, se lee, y simplemente no coincide nunca — la
 * corrección queda muerta y el estado se sigue pintando como antes. Nadie se
 * entera hasta que alguien mira la pantalla y encuentra un cancelado en gris
 * plano.
 *
 * Estas pruebas cierran las cuatro formas de que eso pase:
 *   1. el eje no existe
 *   2. el valor no existe dentro de ese eje
 *   3. la corrección declara el mismo tono que ya salía solo (es un no-op que
 *      miente: parece que se decidió algo y no se decidió nada)
 *   4. el tono declarado no es uno de los seis
 *
 * CÓMO SE AGREGA UN EJE
 * ---------------------------------------------------------------------------
 * Se suma a `EJE` en `tonos-estado.ts` y su mapa `BADGE_*` a `VOCABULARIOS` acá
 * abajo. Si se olvida lo segundo, la prueba 1 lo caza en cuanto se declare una
 * corrección para él.
 */

/**
 * Cada eje con el vocabulario real que le corresponde en el código.
 *
 * Se usan los mapas `BADGE_*` y no los `VARIANTE_*` porque los segundos son
 * privados de `traduccion-estados.ts` — pero tienen exactamente las mismas
 * claves, que es lo que acá importa.
 */
const VOCABULARIOS: Record<NombreEje, Record<string, BadgeVariante>> = {
  [EJE.pedido]: BADGE_ESTADO_PEDIDO,
  [EJE.retiro]: BADGE_SITUACION_RETIRO,
  [EJE.incidencia]: BADGE_ESTADO_INCIDENCIA,
  [EJE.manifiesto]: BADGE_ESTADO_MANIFIESTO,
  [EJE.seller]: BADGE_ESTADO_SELLER,
  [EJE.geo]: BADGE_GEO_ESTADO,
  [EJE.cobertura]: BADGE_COBERTURA_ESTADO,
  [EJE.periodo]: BADGE_ESTADO_PERIODO,
  [EJE.liquidacion]: BADGE_ESTADO_LIQUIDACION,
  [EJE.payout]: BADGE_ESTADO_PAYOUT,
  [EJE.conciliacion]: BADGE_ESTADO_CONCILIACION,
  [EJE.categoriaConciliacion]: BADGE_CATEGORIA_NEGOCIO_CONCILIACION,
  [EJE.matchPago]: BADGE_ESTADO_MATCH_PAGO,
  [EJE.cobroPeriodo]: BADGE_ESTADO_COBRO_PERIODO,
  [EJE.suscripcion]: BADGE_ESTADO_SUSCRIPCION,
  [EJE.periodoSuscripcion]: BADGE_ESTADO_PERIODO_SUSCRIPCION,
  [EJE.pagoSuscripcion]: BADGE_ESTADO_PAGO_SUSCRIPCION,
  [EJE.mandato]: BADGE_ESTADO_MANDATO,
  [EJE.sii]: BADGE_ESTADO_SII,
  [EJE.conexion]: BADGE_SALUD_CONEXION,
  [EJE.conexionCobranza]: BADGE_CONEXION_COBRANZA,
  [EJE.invitacion]: BADGE_INVITACION,
  [EJE.folio]: BADGE_FOLIO_CAF,
  [EJE.certificacion]: BADGE_CERTIFICACION_DTE,
  [EJE.job]: BADGE_SALUD_JOB,
};

/** La misma traducción que hace `badge-estado.tsx`, para poder comparar. */
const BADGE_A_VARIANTE: Record<BadgeVariante, VarianteHeredada> = {
  success: "exito",
  info: "info",
  warning: "advertencia",
  destructive: "error",
  error: "error",
  neutral: "neutral",
  secondary: "neutral",
  outline: "neutral",
  default: "marca",
};

const claves = Object.keys(CORRECCIONES_TONO);

describe("CORRECCIONES_TONO · la tabla no puede mentir en silencio", () => {
  it("declara al menos una corrección (si no, algo se borró)", () => {
    expect(claves.length).toBeGreaterThan(20);
  });

  it("toda clave tiene la forma `eje:valor`", () => {
    const malFormadas = claves.filter((k) => k.split(":").length !== 2);
    expect(malFormadas).toEqual([]);
  });

  it("todo eje citado existe en EJE", () => {
    const ejesConocidos = new Set<string>(Object.values(EJE));
    const desconocidos = claves
      .map((k) => k.split(":")[0])
      .filter((eje) => !ejesConocidos.has(eje));
    expect([...new Set(desconocidos)]).toEqual([]);
  });

  it("todo valor citado existe de verdad en su vocabulario", () => {
    const inexistentes = claves.filter((k) => {
      const [eje, valor] = k.split(":");
      const vocabulario = VOCABULARIOS[eje as NombreEje];
      return !vocabulario || !(valor in vocabulario);
    });
    expect(inexistentes).toEqual([]);
  });

  it("ninguna corrección es un no-op: todas cambian el tono que salía solo", () => {
    const inutiles = claves.filter((k) => {
      const [eje, valor] = k.split(":");
      const vocabulario = VOCABULARIOS[eje as NombreEje];
      const badge = vocabulario?.[valor];
      if (!badge) return false; // ya lo caza la prueba anterior
      const mecanico = tonoDesdeVariante(BADGE_A_VARIANTE[badge]);
      return CORRECCIONES_TONO[k].tono === mecanico;
    });
    expect(inutiles).toEqual([]);
  });

  it("todo tono declarado es uno de los seis", () => {
    const fuera = claves.filter((k) => !TONOS_ESTADO.includes(CORRECCIONES_TONO[k].tono));
    expect(fuera).toEqual([]);
  });

  it("toda corrección lleva su razón escrita, y no una frase de relleno", () => {
    const sinRazon = claves.filter((k) => (CORRECCIONES_TONO[k].razon ?? "").trim().length < 25);
    expect(sinRazon).toEqual([]);
  });

  it("cada eje del código está en VOCABULARIOS: agregar uno obliga a registrarlo", () => {
    const registrados = Object.keys(VOCABULARIOS).sort();
    const declarados = Object.values(EJE).slice().sort();
    expect(registrados).toEqual(declarados);
  });
});

describe("tonoDeEstado · los casos que sostienen las reglas del sistema", () => {
  it("sin eje ni valor cae en la traducción mecánica", () => {
    expect(tonoDesdeVariante("exito")).toBe("balanced");
    expect(tonoDesdeVariante("marca")).toBe("neutral");
  });

  it("lo que está fuera de juego a propósito va en inert", () => {
    expect(tonoDeEstado(EJE.pedido, "cancelado", "neutral")).toBe("inert");
    expect(tonoDeEstado(EJE.manifiesto, "cancelado", "neutral")).toBe("inert");
    expect(tonoDeEstado(EJE.seller, "suspendido", "error")).toBe("inert");
    expect(tonoDeEstado(EJE.periodo, "anulado", "error")).toBe("inert");
    expect(tonoDeEstado(EJE.matchPago, "descartado", "neutral")).toBe("inert");
    expect(tonoDeEstado(EJE.mandato, "cancelado", "neutral")).toBe("inert");
  });

  it("lo normal no se celebra ni se alarma", () => {
    expect(tonoDeEstado(EJE.seller, "activo", "exito")).toBe("neutral");
    expect(tonoDeEstado(EJE.retiro, "retirado", "exito")).toBe("neutral");
    expect(tonoDeEstado(EJE.pedido, "pendiente_asignacion", "advertencia")).toBe("neutral");
    expect(tonoDeEstado(EJE.pedido, "asignado", "info")).toBe("neutral");
    expect(tonoDeEstado(EJE.cobroPeriodo, "pendiente", "advertencia")).toBe("neutral");
  });

  it("el avance real empieza en ruta, no al asignar", () => {
    expect(tonoDeEstado(EJE.pedido, "asignado", "info")).toBe("neutral");
    expect(tonoDeEstado(EJE.pedido, "en_ruta", "info")).toBe("progress");
  });

  it("la incidencia abierta se queda en fault: es el único rojo de la Torre", () => {
    expect(tonoDeEstado(EJE.incidencia, "abierta", "error")).toBe("fault");
  });

  it("«aceptado con observaciones» va en attention, NUNCA en fault", () => {
    // Regla del registro §14.4: una factura válida pintada de rojo hace que
    // alguien la reemita y consuma otro folio.
    expect(tonoDeEstado(EJE.sii, "aceptado_con_discrepancias", "advertencia")).toBe("attention");
    expect(tonoDeEstado(EJE.sii, "rechazado", "error")).toBe("fault");
  });

  it("lo consumido y lo revocado quedan inertes, no en rojo ni en gris de pendiente", () => {
    expect(tonoDeEstado(EJE.folio, "agotado", "neutral")).toBe("inert");
    expect(tonoDeEstado(EJE.folio, "vencido", "error")).toBe("inert");
    expect(tonoDeEstado(EJE.invitacion, "expirada", "neutral")).toBe("inert");
    expect(tonoDeEstado(EJE.conexionCobranza, "desconectado", "neutral")).toBe("inert");
  });

  it("una suspensión por mora sube a fault, no se queda en attention", () => {
    expect(tonoDeEstado(EJE.suscripcion, "suspendida", "advertencia")).toBe("fault");
  });

  it("un eje desconocido no explota: cae en la traducción mecánica", () => {
    expect(tonoDeEstado("eje-que-no-existe", "loquesea", "exito")).toBe("balanced");
  });
});
