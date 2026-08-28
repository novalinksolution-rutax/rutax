/**
 * Las tres periodicidades de facturación, con nombre — la parte PURA.
 * =============================================================================
 *
 * ⚠️ **Sin `"use client"` y sin `"use server"`, y las dos ausencias importan.**
 *
 * · Sin `"use client"` porque lo lee también `seccion-periodos.tsx`, que es un
 *   Server Component. Es la lección de `secciones.ts`: un Server Component no
 *   puede llamar a nada exportado por un módulo de cliente, y el error no lo
 *   ven ni `typecheck` ni `lint` — aparece como un 500 al abrir la pantalla.
 * · Sin `"use server"` porque un módulo con esa directiva **solo puede exportar
 *   funciones async**. Una constante ahí dentro tumba el build de producción.
 *
 * -----------------------------------------------------------------------------
 * EL TEXTO DESCRIBE LA REGLA; EL RANGO CONCRETO LO CALCULA EL MOTOR
 * -----------------------------------------------------------------------------
 * Acá va solo la descripción de la regla («del 1 al 15 y del 16 al último día»).
 * El rango de HOY —el que la pantalla muestra debajo— sale de
 * `calcularRangoPeriodo`, la misma función que usa el motor al crear el período.
 * Así la pantalla no puede prometer un corte que el motor no vaya a hacer: si
 * alguien cambia la regla en el motor, la pantalla cambia con ella.
 */

import type { TipoPeriodoFacturacion } from "@/modules/dinero/tipos";

export interface OpcionPeriodicidad {
  valor: TipoPeriodoFacturacion;
  etiqueta: string;
  /** La regla, en una línea. Nunca una fecha concreta — esa la calcula el motor. */
  regla: string;
}

/**
 * El orden es de más corto a más largo, que es como se piensa la decisión
 * («¿cada cuánto le paso la cuenta?»), no el orden alfabético ni el del enum.
 */
export const OPCIONES_PERIODICIDAD: readonly OpcionPeriodicidad[] = [
  {
    valor: "semanal",
    etiqueta: "Semanal",
    regla: "De lunes a domingo. Cierra cada domingo.",
  },
  {
    valor: "quincenal",
    etiqueta: "Quincenal",
    regla: "Del 1 al 15, y del 16 al último día del mes.",
  },
  {
    valor: "mensual",
    etiqueta: "Mensual",
    regla: "Del 1 al último día del mes.",
  },
] as const;

export function etiquetaPeriodicidad(valor: TipoPeriodoFacturacion): string {
  return OPCIONES_PERIODICIDAD.find((o) => o.valor === valor)?.etiqueta ?? valor;
}
