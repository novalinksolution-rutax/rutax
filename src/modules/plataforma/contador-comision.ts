/**
 * El contador del mes que ve el courier: cuánto lleva y cuánto va debiendo.
 * =============================================================================
 *
 * 🔴 POR QUÉ EXISTE, Y NO ES UN ADORNO
 * -----------------------------------------------------------------------------
 * Con una cuota plana el courier sabía en el día 1 lo que iba a pagar. Con una
 * comisión no: la cifra depende de lo que despache, y la sabría recién cuando le
 * llegue la boleta. **Nadie firma una comisión que no puede ver correr** —
 * decisión del usuario, y es lo que hace creer el modelo.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ SE CACHEA, Y LA FRESCURA ES UNA DECISIÓN, NO UN DETALLE
 * -----------------------------------------------------------------------------
 * La cuenta lee `operacion.pedidos` y `operacion.asignaciones_pedido` paginado:
 * no es barata, y esta pantalla se abre desde el menú. Ponerla en cada visita se
 * nota con volúmenes reales, y nadie necesita saber si lleva 311 o 312.
 *
 * Se cachea por tenant con `revalidate: 300` (cinco minutos), que es la
 * frescura que pidió el usuario: «al día, se recalcula cada pocos minutos». El
 * día que un courier reclame por su boleta, la pantalla le sirve para
 * comprobarla — que es la prueba que tiene que pasar.
 *
 * ⚠️ La clave del caché lleva el `tenantId` y la consulta también filtra por él.
 * Las dos cosas: la clave aísla el caché entre couriers y el filtro aísla los
 * datos. Confiar solo en la clave dejaría el aislamiento dependiendo de que
 * nadie se equivoque al componerla.
 *
 * -----------------------------------------------------------------------------
 * LO QUE MUESTRA NO ES LO QUE SE VA A COBRAR, Y SE DICE
 * -----------------------------------------------------------------------------
 * El mes todavía no cierra: una entrega de hoy puede devolverse mañana, y la
 * tarifa puede cambiar antes del cierre (se cobra la vigente al cerrar). Por eso
 * el contador es «lo que llevas», no «lo que vas a pagar», y la pantalla lo
 * redacta así.
 */

import { unstable_cache } from 'next/cache';

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { ahoraEnSantiago } from '@/lib/fecha-santiago';

import { calcularMontoComision, contarPedidosEfectivosDelMes, esPrimerPeriodoCobrado } from './cobro-por-pedido';

export interface ContadorDelMes {
  /** 'YYYY-MM' del mes en curso, calendario de Santiago. */
  mes: string;
  pedidosEfectivos: number;
  precioPorPedidoClp: number;
  minimoMensualClp: number | null;
  /** Lo que llevaría el mes si cerrara ahora. */
  montoClp: number;
  /** `true` si hoy mandaría el piso y no la comisión. */
  aplicoMinimo: boolean;
  /** El primer mes no lleva piso: la pantalla lo dice en vez de callarlo. */
  esPrimerMes: boolean;
}

async function calcularContador(entrada: {
  tenantId: string;
  suscripcionId: string;
  precioPorPedidoClp: number;
  minimoMensualClp: number | null;
}): Promise<ContadorDelMes> {
  const supabase = crearClienteServiceRole();
  const mes = ahoraEnSantiago().fecha.slice(0, 7);

  const [pedidosEfectivos, esPrimerMes] = await Promise.all([
    contarPedidosEfectivosDelMes(supabase, { tenantId: entrada.tenantId, mes }),
    esPrimerPeriodoCobrado(supabase, entrada.suscripcionId),
  ]);

  const calculo = calcularMontoComision({
    pedidosEfectivos,
    tarifa: {
      precioPorPedidoClp: entrada.precioPorPedidoClp,
      minimoMensualClp: entrada.minimoMensualClp,
    },
    esPrimerMes,
  });

  return {
    mes,
    pedidosEfectivos: calculo.pedidosEfectivos,
    precioPorPedidoClp: entrada.precioPorPedidoClp,
    minimoMensualClp: entrada.minimoMensualClp,
    montoClp: calculo.montoClp,
    aplicoMinimo: calculo.aplicoMinimo,
    esPrimerMes,
  };
}

/**
 * El contador del mes en curso, cacheado cinco minutos por tenant.
 *
 * `null` si el plan no es de comisión: no hay nada que contar y la pantalla no
 * debe inventar un cero, que se leería como «no has entregado nada».
 */
export function obtenerContadorDelMes(entrada: {
  tenantId: string;
  suscripcionId: string;
  precioPorPedidoClp: number | null;
  minimoMensualClp: number | null;
}): Promise<ContadorDelMes | null> {
  if (entrada.precioPorPedidoClp === null) return Promise.resolve(null);

  const tarifa = entrada.precioPorPedidoClp;
  return unstable_cache(
    () =>
      calcularContador({
        tenantId: entrada.tenantId,
        suscripcionId: entrada.suscripcionId,
        precioPorPedidoClp: tarifa,
        minimoMensualClp: entrada.minimoMensualClp,
      }),
    // ⚠️ La tarifa entra en la CLAVE: si Rutax la cambia, el contador tiene que
    // recalcular en la siguiente visita en vez de esperar cinco minutos
    // mostrando una cifra calculada con el precio viejo.
    ['contador-comision', entrada.tenantId, String(tarifa), String(entrada.minimoMensualClp ?? '')],
    { revalidate: 300 },
  )();
}
