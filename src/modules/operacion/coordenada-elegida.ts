/**
 * La coordenada que el autocompletado ya resolvió.
 * =============================================================================
 * Vive en el módulo y no en la carpeta de la ruta porque la usan LAS DOS
 * superficies que dan de alta un same-day: el courier y el portal del seller.
 *
 * ⚠️ **Y no podía quedarse donde estaba.** Estaba dentro de un archivo
 * `"use server"`, y ahí **cada export se convierte en un endpoint alcanzable**:
 * exportarla para reusarla habría publicado como acción un helper que escribe
 * coordenadas de cualquier pedido. Mudarla es lo correcto, no una comodidad.
 */

import { resolverTarifaVigente } from "@/modules/operacion/tarifas";
import { calcularCobertura } from "@/modules/integraciones/geocoding/jobs/geocodificar-pedido";
import { ahoraEnSantiago } from "@/lib/fecha-santiago";

/**
 * Escribe la coordenada que el autocompletado ya resolvió.
 *
 * Falla en silencio a propósito: el pedido **ya está creado** y es lo que
 * importa. Si esta escritura no sale, el job lo geocodifica como siempre y el
 * único costo es una llamada de más al proveedor. Hacer fallar la creación por
 * esto sería cambiar un ahorro por un pedido perdido.
 */
export async function guardarCoordenadaElegida(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cliente: any,
  args: {
    tenantId: string;
    pedidoId: string;
    sellerId: string;
    lat: number;
    long: number;
    comunaDeclarada: string;
    comunaResuelta: string | null;
  },
): Promise<void> {
  try {
    const tarifaId = await resolverTarifaVigente(cliente, {
      tenantId: args.tenantId,
      sellerId: args.sellerId,
      tipoEntrega: "same_day",
      fecha: ahoraEnSantiago().fecha,
    });

    const cobertura = calcularCobertura({
      comunaDeclarada: args.comunaDeclarada,
      comunaResuelta: args.comunaResuelta,
      hayTarifaVigente: tarifaId !== null,
    });

    await cliente
      .schema("operacion")
      .from("pedidos")
      .update({
        lat: args.lat,
        long: args.long,
        geo_estado: "resuelto",
        // La eligió una persona de una lista del proveedor: es la confianza más
        // alta que este sistema puede tener sobre una dirección.
        geo_confianza: 1,
        geocodificado_en: new Date().toISOString(),
        cobertura_estado: cobertura,
      })
      .eq("id", args.pedidoId)
      .eq("tenant_id", args.tenantId);
  } catch {
    console.warn(
      "[alta same-day] No se pudo guardar la coordenada elegida; el job la resolverá.",
    );
  }
}
