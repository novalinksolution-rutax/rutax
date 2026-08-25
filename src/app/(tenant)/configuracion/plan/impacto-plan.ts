/**
 * Qué le pasaría a ESTE courier con cada plan.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 UN COMPARADOR QUE NO USA LOS DATOS DEL QUE MIRA ES UNA TABLA DE PRECIOS
 * -----------------------------------------------------------------------------
 * Y esa ya está en el sitio comercial. Acá el courier no viene a saber qué
 * incluye el plan Bodega: viene a saber **si le sirve a él**, con sus nueve
 * conductores y sus 3.410 pedidos al mes.
 *
 * Las tarjetas decían «Hasta 6 conductores». Eso obliga a que la persona
 * recuerde cuántos tiene, reste de cabeza y saque la conclusión —y el precio de
 * equivocarse es contratar un plan que la deja fuera de operación el día 1.
 * Ahora la conclusión la da la pantalla: **«Ya tienes 9 conductores: tendrías
 * que dar de baja 3»**.
 *
 * -----------------------------------------------------------------------------
 * LA FRASE DE SUBIR NO ES UNA VENTA, ES LA CONTRARIA
 * -----------------------------------------------------------------------------
 * «Con tu ritmo de 3.410 al mes, todavía no te hace falta.» Un producto que
 * solo dice lo que gana al subir es un catálogo; decir cuándo NO hace falta es
 * lo que hace que se le crea cuando sí.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL LÍMITE DE PEDIDOS NO BLOQUEA IGUAL QUE EL DE CONDUCTORES
 * -----------------------------------------------------------------------------
 * Pasarse de conductores es un problema **inmediato y accionable**: hay que dar
 * de baja gente para poder contratar. Pasarse de pedidos es un problema del
 * mes, y el producto no borra pedidos — avisa. Por eso son dos frases
 * distintas y la de conductores es la que va en tono de atención.
 */

export interface UsoDelCourier {
  /** Conductores activos hoy. */
  conductores: number;
  /** Pedidos del mes en curso. */
  pedidosMes: number;
}

export interface LimitesDelPlan {
  /** `null` = sin tope. */
  conductoresMax: number | null;
  /** `null` = sin tope. */
  pedidosMes: number | null;
}

export type TonoImpacto = "attention" | "neutral";

export interface ImpactoPlan {
  frase: string;
  tono: TonoImpacto;
  /** Cuántos conductores habría que dar de baja. 0 = ninguno. */
  conductoresDeMas: number;
}

/**
 * La frase de una tarjeta de plan, o `null` si no hay nada que decir.
 *
 * `null` es el caso del plan que le queda justo: no se inventa un elogio.
 *
 * @param esElActual el plan que ya tiene. No se le dice nada — ya sabe lo que
 * le pasa con el suyo, y una advertencia sobre el plan vigente se lee como que
 * algo se rompió.
 */
export function impactoDelPlan(
  uso: UsoDelCourier,
  limites: LimitesDelPlan,
  esElActual = false,
): ImpactoPlan | null {
  if (esElActual) return null;

  // 1 · Lo que impide contratar, primero. Es lo único accionable de las dos.
  const conductoresDeMas =
    limites.conductoresMax !== null ? Math.max(0, uso.conductores - limites.conductoresMax) : 0;

  if (conductoresDeMas > 0) {
    return {
      frase:
        `Ya tienes ${uso.conductores} ${uso.conductores === 1 ? "conductor" : "conductores"}: ` +
        `tendrías que dar de baja ${conductoresDeMas}.`,
      tono: "attention",
      conductoresDeMas,
    };
  }

  // 2 · El techo de pedidos: no bloquea la contratación, pero se alcanza.
  if (limites.pedidosMes !== null && uso.pedidosMes > limites.pedidosMes) {
    return {
      frase:
        `Este mes llevas ${miles(uso.pedidosMes)} pedidos y el tope es ${miles(limites.pedidosMes)}: ` +
        `te quedarías corto.`,
      tono: "attention",
      conductoresDeMas: 0,
    };
  }

  // 3 · Subir sin necesitarlo. Se dice, y con la cifra real.
  //
  // El umbral es la MITAD del tope: por debajo de eso el plan es holgado de
  // sobra y decirlo es honesto. Entre la mitad y el tope no se dice nada —
  // «todavía no te hace falta» con el 90 % consumido sería un mal consejo.
  if (limites.pedidosMes !== null && uso.pedidosMes * 2 < limites.pedidosMes) {
    return {
      frase: `Con tu ritmo de ${miles(uso.pedidosMes)} al mes, todavía no te hace falta.`,
      tono: "neutral",
      conductoresDeMas: 0,
    };
  }

  return null;
}

function miles(n: number): string {
  return n.toLocaleString("es-CL");
}
