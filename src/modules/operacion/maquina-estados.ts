/**
 * Máquina de estados del pedido — función pura, sin dependencia de BD.
 *
 * Implementa la tabla completa de §3 del documento `docs/arquitectura/fase-b-operacion.md`.
 * Al ser pura, es completamente testeable sin mocks.
 *
 * Invariantes que respeta:
 * 1. Los estados terminales (entregado, entregado_manual, cancelado, devuelto)
 *    no admiten ninguna transición de salida.
 * 2. Las transiciones con ejecutor='sistema' las inicia el job de webhook/polling ML.
 * 3. Las transiciones con ejecutor='interno' las inicia un usuario humano con
 *    capacidad `puedeAjustarOperacionDiaria` (verificada en `pedidos.ts`, no aquí).
 * 4. La función es agnóstica de permisos: solo valida la transición de estado.
 *    La validación de RBAC es responsabilidad de quien llama a esta función.
 */

import type { EstadoPedido, EjecutorTransicion } from "./tipos";
import { ESTADOS_TERMINALES } from "./tipos";
import { ErrorTransicionInvalida } from "./errores";

// =============================================================================
// Tabla de transiciones válidas — fuente: §3 del doc de arquitectura Fase B
// =============================================================================
// Estructura: origen → destino → ejecutores que pueden hacer esa transición.

interface TransicionValida {
  destino: EstadoPedido;
  ejecutores: ReadonlyArray<EjecutorTransicion>;
}

const TRANSICIONES: ReadonlyMap<EstadoPedido, ReadonlyArray<TransicionValida>> = new Map([
  [
    "pendiente_asignacion",
    [
      // Sistema (job de asignación) asigna el pedido a un manifiesto activo.
      { destino: "asignado", ejecutores: ["sistema"] },
    ],
  ],
  [
    "asignado",
    [
      // ML reporta "shipped" o equivalente.
      { destino: "en_ruta", ejecutores: ["sistema"] },
      // Reasignación: coordinador/supervisor devuelve a cola para asignarlo a otro.
      { destino: "pendiente_asignacion", ejecutores: ["interno"] },
      // Cancelación antes de salir a ruta (ML lo reporta).
      { destino: "cancelado", ejecutores: ["sistema"] },
      // Correcciones manuales con nota obligatoria (RF-029).
      { destino: "entregado_manual", ejecutores: ["interno"] },
      { destino: "fallido_manual", ejecutores: ["interno"] },
    ],
  ],
  [
    "en_ruta",
    [
      // ML reporta delivered.
      { destino: "entregado", ejecutores: ["sistema"] },
      // ML reporta not_delivered o equivalente.
      { destino: "fallido", ejecutores: ["sistema"] },
      // Cancelación tardía (ML la reporta ya estando en ruta).
      { destino: "cancelado", ejecutores: ["sistema"] },
      // ML reporta devolución al origen.
      { destino: "devuelto", ejecutores: ["sistema"] },
      // Correcciones manuales con nota obligatoria (supervisor+).
      { destino: "entregado_manual", ejecutores: ["interno"] },
      { destino: "fallido_manual", ejecutores: ["interno"] },
    ],
  ],
  [
    "fallido",
    [
      // Reintento: nueva asignación. La incidencia previa queda abierta.
      { destino: "asignado", ejecutores: ["interno"] },
      // Sin reintento posible: cierre definitivo.
      { destino: "cancelado", ejecutores: ["interno"] },
    ],
  ],
  [
    "fallido_manual",
    [
      // Igual que fallido: reintento con nueva asignación.
      { destino: "asignado", ejecutores: ["interno"] },
    ],
  ],
  // Estados terminales: sin transiciones válidas de salida.
  // La ausencia de entrada en el mapa hace que la función lance el error.
]);

// =============================================================================
// Función pura de validación
// =============================================================================

/**
 * Valida si la transición `estadoActual` → `estadoNuevo` con el ejecutor dado
 * está permitida por la máquina de estados.
 *
 * Devuelve `true` si la transición es válida.
 * Lanza `ErrorTransicionInvalida` si no lo es.
 *
 * No toca la base de datos. No requiere contexto de usuario.
 * La verificación de permisos RBAC es responsabilidad del llamador.
 */
export function validarTransicion(
  estadoActual: EstadoPedido,
  estadoNuevo: EstadoPedido,
  ejecutor: EjecutorTransicion,
): true {
  // Regla 1: los estados terminales no admiten ninguna transición de salida.
  if (ESTADOS_TERMINALES.includes(estadoActual)) {
    throw new ErrorTransicionInvalida(
      estadoActual,
      estadoNuevo,
      `El estado '${estadoActual}' es terminal — no admite transiciones de salida`,
    );
  }

  // Regla 2: verificar si el par (origen, destino) existe en la tabla.
  const transicionesDesdeOrigen = TRANSICIONES.get(estadoActual);

  if (!transicionesDesdeOrigen) {
    // Estado origen no tiene transiciones definidas (no debería ocurrir con los
    // enums actuales, pero defensive programming ante extensiones futuras).
    throw new ErrorTransicionInvalida(
      estadoActual,
      estadoNuevo,
      `El estado '${estadoActual}' no tiene transiciones definidas en la máquina de estados`,
    );
  }

  const transicion = transicionesDesdeOrigen.find((t) => t.destino === estadoNuevo);

  if (!transicion) {
    throw new ErrorTransicionInvalida(estadoActual, estadoNuevo);
  }

  // Regla 3: verificar que el ejecutor está autorizado para esta transición.
  if (!transicion.ejecutores.includes(ejecutor)) {
    throw new ErrorTransicionInvalida(
      estadoActual,
      estadoNuevo,
      `La transición '${estadoActual}' → '${estadoNuevo}' no puede ser ejecutada por '${ejecutor}'`,
    );
  }

  return true;
}

/**
 * Variante que devuelve boolean (no lanza). Útil para validación en UI o
 * para construir tablas de transiciones posibles.
 */
export function esTransicionValida(
  estadoActual: EstadoPedido,
  estadoNuevo: EstadoPedido,
  ejecutor: EjecutorTransicion,
): boolean {
  try {
    validarTransicion(estadoActual, estadoNuevo, ejecutor);
    return true;
  } catch {
    return false;
  }
}
