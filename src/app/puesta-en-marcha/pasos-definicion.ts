/**
 * Definición de los pasos del wizard de puesta en marcha: constantes y tipos
 * PUROS, sin una sola dependencia de servidor.
 * =============================================================================
 *
 * Vive separado de `estado.ts` a propósito. `estado.ts` importa
 * `@/lib/supabase/server` (que usa `next/headers`, solo-servidor); si el wizard
 * de cliente (`wizard.tsx`, "use client") importara el VALOR
 * `PASOS_PUESTA_EN_MARCHA` desde ahí, arrastraría `next/headers` al bundle del
 * navegador y `next build` fallaría. Las piezas cliente-seguras van aquí; la
 * lógica de servidor se queda en `estado.ts`.
 */

/** Las claves de paso, EN ORDEN. El índice es el número de paso. */
export const PASOS_PUESTA_EN_MARCHA = [
  "empresa",
  "tarifa",
  "periodicidad",
  "cobro",
  "retiro",
  "zonas",
  "contacto",
  "equipo",
] as const;

export type ClavePaso = (typeof PASOS_PUESTA_EN_MARCHA)[number];

/** Los siete que bloquean el cierre. "equipo" no está: es saltable. */
export const PASOS_OBLIGATORIOS: ReadonlySet<ClavePaso> = new Set<ClavePaso>([
  "empresa",
  "tarifa",
  "periodicidad",
  "cobro",
  "retiro",
  "zonas",
  "contacto",
]);

export interface DatosInicialesPaso {
  empresa: {
    nombreFantasia: string | null;
    razonSocial: string | null;
    rut: string | null;
    giro: string | null;
    direccion: string | null;
    comuna: string | null;
    actividadEconomica: string | null;
  };
  tarifa: { cobroClp: number | null; pagoConductorClp: number | null };
  periodicidad: { tipo: string; explicita: boolean };
  cobro: {
    banco: string | null;
    tipoCuenta: string | null;
    numeroCuenta: string | null;
    nombreTitular: string | null;
    rutTitular: string | null;
    emailAviso: string | null;
  };
  retiro: { montoVisitaClp: number | null };
  zonas: { comunas: string[] };
  contacto: { telefono: string | null; email: string | null };
  equipo: { sellers: number; conductores: number };
}

export interface EstadoPuestaEnMarcha {
  /** `true`/`false` por cada paso, en el orden de `PASOS_PUESTA_EN_MARCHA`. */
  completos: Record<ClavePaso, boolean>;
  /** Datos ya guardados, para precargar cada pantalla. */
  iniciales: DatosInicialesPaso;
  /** Primer paso obligatorio sin completar; si están todos, el primero pendiente
   *  cualquiera; si no queda ninguno, "equipo". Es dónde abre el wizard. */
  primerPendiente: ClavePaso;
  /** `true` cuando los siete obligatorios están listos: se puede cerrar. */
  puedeCompletar: boolean;
}
