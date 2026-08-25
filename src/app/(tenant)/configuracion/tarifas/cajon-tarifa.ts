/**
 * En qué cajón cae una tarifa — y por qué esto no se decide a ojo.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 ESTA FUNCIÓN ES LA MITAD DE UN PAR, Y LA OTRA MITAD COBRA PLATA
 * -----------------------------------------------------------------------------
 * La otra mitad es `resolverTarifaVigente` en `src/modules/operacion/tarifas.ts`,
 * que es la que el motor entrega→dinero consulta para saber cuánto cobrar. Su
 * predicado, literal:
 *
 *     .eq("estado", "activa")
 *     .lte("vigente_desde", fecha)
 *     .or(`vigente_hasta.is.null,vigente_hasta.gte.${fecha}`)
 *
 * **Si esta clasificación se aparta de ese predicado, la pantalla miente sobre
 * qué tarifa está cobrando hoy.** Y miente de la peor manera: con un número
 * plausible al lado. Por eso `clasificarTarifa` reproduce las tres condiciones y
 * `cajon-tarifa.test.ts` las ata a la copia literal del predicado.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ SON CUATRO CAJONES Y EL TABLERO DIBUJA TRES
 * -----------------------------------------------------------------------------
 * B3b dibuja **Vigentes · Programadas · Inactivas**. Falta uno que los datos sí
 * permiten: `vigente_hasta` es un campo del formulario, así que una tarifa
 * puede tener su ventana **ya cerrada** y seguir con `estado = 'activa'`.
 *
 * Esa tarifa **no cobra nada** —el motor la descarta por la tercera condición—
 * pero tampoco está inactiva. Meterla en «Vigentes» sería afirmar que gobierna
 * cuando no gobierna, que es exactamente la clase de mentira que este rediseño
 * persigue; y meterla en «Inactivas» le ofrecería un «Reactivar» que no arregla
 * nada, porque su `estado` ya es `activa`.
 *
 * Así que va en **«Vencidas»**, con su propia salida: editarla para correr o
 * borrar la fecha de término. Se anota como apartado del tablero.
 *
 * -----------------------------------------------------------------------------
 * LAS FECHAS SE COMPARAN COMO TEXTO, A PROPÓSITO
 * -----------------------------------------------------------------------------
 * `vigente_desde` y `vigente_hasta` son `date` en Postgres y llegan como
 * `YYYY-MM-DD`. En ese formato el orden lexicográfico **es** el orden
 * cronológico, así que comparar cadenas da el mismo resultado que comparar
 * fechas y no abre la puerta a que un `new Date("2026-09-01")` se interprete en
 * UTC y adelante el día en Santiago. Es lo mismo que hace la consulta de
 * PostgREST, que también compara contra una cadena.
 */

/** El cajón, tal como se ve en la barra. */
export type CajonTarifa = "vigente" | "programada" | "vencida" | "inactiva";

export interface TarifaClasificable {
  estado: "activa" | "inactiva";
  /** `YYYY-MM-DD`. */
  vigenteDesdeFecha: string;
  /** `YYYY-MM-DD`, o `null` si no tiene término. */
  vigenteHasta: string | null;
}

/**
 * @param hoy fecha civil de Santiago, `YYYY-MM-DD`. La pasa el llamador con
 * `hoyEnSantiago()`: acá no se resuelve ninguna zona horaria.
 */
export function clasificarTarifa(t: TarifaClasificable, hoy: string): CajonTarifa {
  // `estado` manda sobre todo lo demás: una tarifa inactivada no vuelve a
  // cobrar aunque su ventana la incluya.
  if (t.estado === "inactiva") return "inactiva";

  // Las dos condiciones de ventana, en el mismo orden que el motor.
  if (t.vigenteDesdeFecha > hoy) return "programada";
  if (t.vigenteHasta !== null && t.vigenteHasta < hoy) return "vencida";

  return "vigente";
}

/**
 * Cuenta cuántas caen en cada cajón. Devuelve los cuatro **siempre**, incluso en
 * cero: un cajón que desaparece cuando se vacía obliga a recordar que existía.
 */
export function contarPorCajon(
  tarifas: readonly TarifaClasificable[],
  hoy: string,
): Record<CajonTarifa, number> {
  const conteo: Record<CajonTarifa, number> = {
    vigente: 0,
    programada: 0,
    vencida: 0,
    inactiva: 0,
  };
  for (const t of tarifas) conteo[clasificarTarifa(t, hoy)] += 1;
  return conteo;
}

/**
 * ¿Le paga al conductor más de lo que le cobra al seller?
 *
 * ⚠️ **No es una validación: es un aviso, y va antes de guardar.** Puede ser
 * deliberado —una promoción, un tramo que se subsidia para no perder al
 * seller—, así que bloquearlo sería decidir por el courier. Pero es también la
 * forma más cara de equivocarse de tecla en todo el producto: cada entrega
 * hecha bajo esa tarifa genera su línea de cobro y su línea de liquidación, y
 * la resta va en contra. Nadie lo nota hasta el cierre del período.
 */
export function pagasMasDeLoQueCobras(cobras: number, pagas: number): boolean {
  if (!Number.isFinite(cobras) || !Number.isFinite(pagas)) return false;
  return pagas > cobras;
}
