/**
 * Esquemas de validación reutilizables (zod) para entradas no confiables.
 * =============================================================================
 *
 * Adopción incremental (#10 de la auditoría): se aplica primero donde el riesgo
 * es mayor — los webhooks (JSON externo) y los argumentos de las Server Actions
 * de dinero que vienen del cliente (IDs y texto libre del usuario).
 *
 * Estos esquemas son piezas puras de zod, sin acoplamiento a errores de dominio.
 * Cada llamador decide cómo reaccionar a un fallo: un webhook responde 4xx; una
 * Server Action lanza `ErrorValidacion` (ver `validarEntrada` en el módulo dinero).
 */

import { z } from "zod";

/** UUID (ids de entidad que llegan del cliente: períodos, pagos, liquidaciones). */
export const esquemaUuid = z.uuid("Identificador inválido.");

/** Texto libre obligatorio del usuario (p. ej. motivo de anulación/descarte). */
export const esquemaMotivo = z
  .string()
  .trim()
  .min(1, "El motivo es obligatorio.")
  .max(500, "El motivo es demasiado largo (máximo 500 caracteres).");
