/**
 * Regla de negocio: cómo una incidencia afecta el cobro al seller y la
 * liquidación al conductor, según su tipo.
 *
 * ÚNICA fuente de verdad de esta regla. La consume `incidencias.ts` (al abrir,
 * para fijar `afecta_cobro`/`afecta_liquidacion`) y la UI (para mostrar la
 * consecuencia al elegir el tipo — UX-9). Es una función PURA, sin imports de
 * servidor, así que es segura de importar desde un Client Component.
 *
 * Fuente: §2.5 nota de dominio + §3 invariante 4 del doc de arquitectura.
 */

import type { TipoIncidencia } from "./tipos";

export interface ReglaAfectacion {
  afectaCobro: boolean;
  afectaLiquidacion: boolean;
}

export function afectacionDeIncidencia(tipo: TipoIncidencia): ReglaAfectacion {
  switch (tipo) {
    case "reagendado":
      // El pedido se reagenda → afecta cobro (timing/descuento) pero NO la
      // liquidación del conductor (que igual salió a intentar la entrega).
      return { afectaCobro: true, afectaLiquidacion: false };

    case "destinatario_ausente":
    case "rechazo_destinatario":
      // No se completó la entrega por causas del destinatario → tanto cobro
      // como liquidación se ven afectados (puede aplicar tarifa reducida).
      return { afectaCobro: true, afectaLiquidacion: true };

    case "paquete_danado":
      // El paquete llegó dañado → afecta ambos (responsabilidad y costos).
      return { afectaCobro: true, afectaLiquidacion: true };

    // Todos los demás tipos (direccion_erronea, problema_acceso, otro):
    // por defecto ambos = true (el caso más conservador, Fase C puede
    // refinar si necesita excepciones).
    default:
      return { afectaCobro: true, afectaLiquidacion: true };
  }
}
