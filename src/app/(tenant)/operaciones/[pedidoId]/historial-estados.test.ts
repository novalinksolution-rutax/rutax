import { describe, it, expect } from "vitest";
import { ACCIONES_HISTORIAL_ESTADO_PEDIDO } from "./historial-estados";

/**
 * Regresión (frontend, 2026-08-11): el detalle del pedido consulta
 * `bitacora_auditoria` filtrando por esta lista de acciones para decidir si
 * el "Historial de estados" atribuye el cambio a una persona o cae al texto
 * genérico "Sincronización automática". Si `ACCIONES_HISTORIAL_ESTADO_PEDIDO`
 * no incluye 'pedido.cancelado', un pedido cancelado a mano por un usuario
 * queda sin ninguna fila en el historial y la pantalla contradice la sección
 * "Cancelación" (que sí muestra quién lo canceló).
 */
describe("ACCIONES_HISTORIAL_ESTADO_PEDIDO", () => {
  it("incluye la corrección manual genérica de estado", () => {
    expect(ACCIONES_HISTORIAL_ESTADO_PEDIDO).toContain("pedido.estado_corregido_manual");
  });

  it("incluye la cancelación manual — sin esto, un pedido cancelado por una persona muestra 'Sincronización automática' en el historial", () => {
    expect(ACCIONES_HISTORIAL_ESTADO_PEDIDO).toContain("pedido.cancelado");
  });

  it("no incluye acciones de sincronización/ingesta que no representan un acto humano", () => {
    // 'pedido.creado_fuera_corte' (pedidos.ts) es informativo de ingesta, no un
    // cambio de estado ejecutado por una persona — no debe colarse aquí.
    expect(ACCIONES_HISTORIAL_ESTADO_PEDIDO).not.toContain("pedido.creado_fuera_corte");
  });
});
