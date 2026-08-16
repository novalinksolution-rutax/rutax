/**
 * Monto por defecto que el courier le paga al conductor por CADA visita
 * cerrada a una bodega de seller — `identidad.courier_config_retiro`, 1:1 con
 * el tenant (migración `20260815000004`).
 *
 * Se lee desde DOS pantallas que no se conocen entre sí: Configuración →
 * Retiro (para editarlo) y Configuración → Bodegas (para mostrar el monto
 * EFECTIVO de cada bodega de seller, heredado o propio vía
 * `identidad.seller_bodegas.monto_visita_clp`). Vive en un solo lugar para no
 * duplicar la consulta ni, más importante, el significado del `null`: la
 * AUSENCIA de fila es "sin configurar" — nunca "cero" — ver el comentario de
 * la columna en la migración.
 *
 * Sin caché a propósito (a diferencia de `sellers.ts`): es una lectura de una
 * sola fila por PK, y el courier espera ver el cambio reflejado de inmediato
 * en Bodegas justo después de guardarlo en Retiro — son dos rutas distintas,
 * y cachear introduciría un desfase que no se paga con una consulta tan barata.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";

export async function obtenerMontoVisitaDefaultClp(tenantId: string): Promise<number | null> {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .schema("identidad")
    .from("courier_config_retiro")
    .select("monto_visita_bodega_clp")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return data ? Number(data.monto_visita_bodega_clp) : null;
}

/**
 * El monto de RESPALDO: lo que el courier declara que le paga al conductor por
 * una ENTREGA (`identidad.tarifas.monto_conductor_clp`).
 *
 * Se usa cuando no hay monto por visita configurado — ni del tenant ni de la
 * bodega. Decisión del usuario (2026-08-16): un courier que recién empieza a
 * usar el retiro no tiene por qué quedarse sin pagarle a sus conductores
 * mientras descubre que hay una pantalla nueva que llenar.
 *
 * ⚠️ Devuelve `null` si el mejor valor disponible es 0 o menos. Esa columna
 * nació con `default 0` y ningún formulario la escribía hasta el 2026-08-15, así
 * que las tarifas que ya existen siguen en 0: tratar ese cero como "tarifa" sería
 * liquidar $0 en silencio, el bug exacto que todo esto viene a evitar. Un 0 acá
 * NO es una tarifa, es una tarifa sin configurar.
 *
 * Toma el MÁXIMO entre las tarifas activas del tenant, no la de un seller
 * concreto: esta pantalla es del courier entero y no sabe de qué bodega se
 * hablará. El job (`generar-linea-retiro.ts`) sí resuelve la tarifa del seller
 * exacto de la visita, así que la cifra que se muestra acá es una referencia —
 * el máximo, y no el mínimo, para no prometer menos de lo que se va a pagar.
 */
export async function obtenerMontoEntregaDeRespaldoClp(tenantId: string): Promise<number | null> {
  const supabase = crearClienteServiceRole();
  const hoy = fechaLocalEnSantiago(new Date());

  const { data } = await supabase
    .schema("identidad")
    .from("tarifas")
    .select("monto_conductor_clp")
    .eq("tenant_id", tenantId)
    .eq("estado", "activa")
    .lte("vigente_desde", hoy)
    .or(`vigente_hasta.is.null,vigente_hasta.gte.${hoy}`)
    .order("monto_conductor_clp", { ascending: false })
    .limit(1);

  const valor = data?.[0]?.monto_conductor_clp;
  if (valor == null) return null;
  const numero = Math.round(Number(valor));
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}
