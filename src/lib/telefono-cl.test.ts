/**
 * Pruebas del formateo de teléfonos.
 *
 * La NORMALIZACIÓN ya estaba cubierta desde que esta función vivía dentro de
 * WhatsApp (`whatsapp/telefono.test.ts`, 21 casos), y esas pruebas siguen
 * corriendo contra este archivo a través del re-export — o sea que también son
 * la red del refactor que subió el mecanismo a `lib`.
 *
 * Lo que se prueba acá es lo que NACIÓ acá: las dos funciones de presentación
 * que necesitó la ficha del conductor, y el ida y vuelta entre ambas capas.
 */

import { describe, expect, it } from "vitest";
import {
  normalizarTelefonoE164,
  formatearTelefonoLegible,
  telefonoParaMarcar,
  enmascararTelefono,
} from "./telefono-cl";

describe("formatearTelefonoLegible", () => {
  it("agrupa un móvil chileno como lo escribiría una persona", () => {
    expect(formatearTelefonoLegible("56947095571")).toBe("+56 9 4709 5571");
  });

  it("no inventa agrupación para un número extranjero", () => {
    // Sin reglas de agrupación de ese país, agrupar sería adivinar. Se devuelve
    // entero con su `+`, que siempre es legible aunque no sea bonito.
    expect(formatearTelefonoLegible("14155552671")).toBe("+14155552671");
  });

  it("devuelve la entrada tal cual si no es E.164 — nunca rompe la pantalla", () => {
    // Una fila vieja o corrupta no debe tumbar el render de una ficha.
    expect(formatearTelefonoLegible("no-es-un-numero")).toBe("no-es-un-numero");
  });
});

describe("telefonoParaMarcar", () => {
  it("antepone el + que exige el href tel:", () => {
    expect(telefonoParaMarcar("56947095571")).toBe("+56947095571");
  });

  it("no lleva espacios: un tel: con separadores no marca en todos los teléfonos", () => {
    expect(telefonoParaMarcar("56947095571")).not.toMatch(/\s/);
  });
});

describe("la ida y la vuelta", () => {
  it("lo que se muestra se puede volver a normalizar al mismo valor", () => {
    // Importa de verdad: la ficha rellena el input con el formato legible, así
    // que si el usuario abre «Editar» y guarda sin tocar nada, ese texto vuelve
    // por la normalización. Si el ciclo no cerrara, un guardado inocente
    // cambiaría el número.
    const guardado = "56947095571";
    const enPantalla = formatearTelefonoLegible(guardado);
    const devuelta = normalizarTelefonoE164(enPantalla);

    expect(devuelta).toEqual({ valido: true, telefonoE164: guardado });
  });

  it("también cierra el ciclo para un número extranjero", () => {
    const guardado = "14155552671";
    const devuelta = normalizarTelefonoE164(formatearTelefonoLegible(guardado));
    expect(devuelta).toEqual({ valido: true, telefonoE164: guardado });
  });
});

describe("enmascarar y formatear son cosas distintas", () => {
  it("enmascarar oculta el medio; formatear no oculta nada", () => {
    expect(enmascararTelefono("56947095571")).toBe("+56 9 **** 5571");
    expect(formatearTelefonoLegible("56947095571")).toBe("+56 9 4709 5571");
  });

  it("ninguna de las dos pierde los últimos cuatro dígitos", () => {
    // Son los que permiten reconocer el número en una bitácora enmascarada.
    expect(enmascararTelefono("56947095571")).toContain("5571");
    expect(formatearTelefonoLegible("56947095571")).toContain("5571");
  });
});
