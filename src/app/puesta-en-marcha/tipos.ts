/**
 * Tipos y constantes del wizard COMPARTIDOS entre servidor y cliente.
 * =============================================================================
 *
 * Viven aparte de `estado.ts` a propósito: `estado.ts` importa el cliente de
 * Supabase de servidor (que usa `next/headers`), así que importarlo desde un
 * Client Component arrastra código de servidor al bundle del navegador y rompe
 * el build de producción. Este módulo no tiene NINGÚN import de servidor, así
 * que tanto `estado.ts` (servidor) como `wizard.tsx`/`pasos.tsx` (cliente)
 * pueden leerlo sin cruzar esa frontera.
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
  /** Primer paso pendiente; es dónde abre el wizard. */
  primerPendiente: ClavePaso;
  /** `true` cuando los obligatorios están listos: se puede cerrar. */
  puedeCompletar: boolean;
}
