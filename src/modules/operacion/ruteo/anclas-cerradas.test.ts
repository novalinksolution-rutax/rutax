import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { leerParadasYAnclarCerradas } from "./anclas-cerradas";

const TENANT = "11111111-1111-4111-8111-111111111111";
const MANIFIESTO = "22222222-2222-4222-8222-222222222222";

interface FilaAsignacion {
  pedido_id: string;
  orden_ruta: number | null;
  pedidos: { id: string; estado: string };
}

/**
 * Falso mínimo de las DOS tablas que se leen. Devuelve lo que se le da: si
 * inventara columnas, la prueba dejaría de decir algo sobre el código real
 * (ver la regresión de `fecha_compromiso`, 2026-08-27).
 */
function clienteFalso(opciones: {
  asignaciones?: FilaAsignacion[];
  cierres?: { pedido_id: string }[];
  errorAsignaciones?: string;
}): SupabaseClient {
  return {
    from(tabla: string) {
      if (tabla === "asignaciones_pedido") {
        const resultado = opciones.errorAsignaciones
          ? { data: null, error: { message: opciones.errorAsignaciones } }
          : { data: opciones.asignaciones ?? [], error: null };
        const cadena = {
          select: () => cadena,
          eq: () => cadena,
          then: (resolver: (v: unknown) => unknown) => Promise.resolve(resultado).then(resolver),
        };
        return cadena;
      }
      if (tabla === "cierres_conductor") {
        const resultado = { data: opciones.cierres ?? [], error: null };
        const cadena = {
          select: () => cadena,
          in: () => cadena,
          eq: () => cadena,
          then: (resolver: (v: unknown) => unknown) => Promise.resolve(resultado).then(resolver),
        };
        return cadena;
      }
      throw new Error(`tabla inesperada: ${tabla}`);
    },
  } as unknown as SupabaseClient;
}

const parada = (
  id: string,
  estado: string,
  orden: number | null,
): FilaAsignacion => ({ pedido_id: id, orden_ruta: orden, pedidos: { id, estado } });

describe("leerParadasYAnclarCerradas", () => {
  it("ancla las cerradas por ESTADO y deja libres las abiertas", async () => {
    const cliente = clienteFalso({
      asignaciones: [
        parada("p1", "entregado", 1),
        parada("p2", "asignado", 2),
        parada("p3", "fallido", 3),
        parada("p4", "en_ruta", 4),
      ],
    });

    const { fijaciones } = await leerParadasYAnclarCerradas(cliente, {
      tenantId: TENANT,
      manifiestoId: MANIFIESTO,
    });

    expect(fijaciones).toEqual([
      { pedidoId: "p1", orden: 1 },
      { pedidoId: "p3", orden: 3 },
    ]);
  });

  it("🔴 ancla una parada FLEX cerrada solo en cierres_conductor, que por estado parece abierta", async () => {
    // El caso que se rompe al mirar únicamente el estado: en Flex el estado lo
    // escribe Mercado Envíos y puede tardar horas. El conductor ya la entregó y
    // lo declaró en la app; reordenarla sería mover una entrega hecha.
    const cliente = clienteFalso({
      asignaciones: [parada("flex1", "en_ruta", 1), parada("p2", "asignado", 2)],
      cierres: [{ pedido_id: "flex1" }],
    });

    const { fijaciones, estaCerrada } = await leerParadasYAnclarCerradas(cliente, {
      tenantId: TENANT,
      manifiestoId: MANIFIESTO,
    });

    expect(estaCerrada("flex1", "en_ruta")).toBe(true);
    expect(fijaciones).toEqual([{ pedidoId: "flex1", orden: 1 }]);
  });

  it("una cerrada SIN orden_ruta no se ancla: no tiene posición que conservar", async () => {
    const cliente = clienteFalso({
      asignaciones: [parada("p1", "entregado", null), parada("p2", "asignado", null)],
    });

    const { fijaciones, tieneSecuencia } = await leerParadasYAnclarCerradas(cliente, {
      tenantId: TENANT,
      manifiestoId: MANIFIESTO,
    });

    expect(fijaciones).toEqual([]);
    expect(tieneSecuencia).toBe(false);
  });

  it("tieneSecuencia distingue el manifiesto ruteado del que nadie ordenó", async () => {
    const ruteado = await leerParadasYAnclarCerradas(
      clienteFalso({ asignaciones: [parada("p1", "asignado", 1)] }),
      { tenantId: TENANT, manifiestoId: MANIFIESTO },
    );
    expect(ruteado.tieneSecuencia).toBe(true);
  });

  it("🔴 un fallo de lectura LANZA: no puede parecerse a «no hay paradas»", async () => {
    // Devolver una lista vacía haría que el llamador recalculara la ruta entera
    // sin una sola ancla — reordenando entregas ya hechas, en silencio.
    await expect(
      leerParadasYAnclarCerradas(clienteFalso({ errorAsignaciones: "column does not exist" }), {
        tenantId: TENANT,
        manifiestoId: MANIFIESTO,
      }),
    ).rejects.toThrow(/column does not exist/);
  });
});
