/**
 * La marca de disponibilidad, del lado del coordinador.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL DATO ESTABA Y NO SE PINTABA EN NINGUNA PARTE
 * -----------------------------------------------------------------------------
 * `ConductorOpcion` lleva `disponible: boolean` desde que existe, la lista se
 * ordena poniendo a los disponibles primero… y el selector mostraba
 * `«{nombre} · {carga} hoy»` para todos por igual. El coordinador podía repartir
 * treinta paquetes a alguien que no está trabajando **y la pantalla no decía una
 * palabra**: el no disponible simplemente quedaba más abajo en una lista de
 * nombres idénticos.
 *
 * Es la brecha #6, y a las 15:50 cuesta la salida a las 16:00 — el paquete se
 * descubre sin dueño cuando la van ya se fue.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ QUIÉN ES DUEÑO DE ESTA MARCA, Y POR QUÉ CAMBIA EL COPY
 * -----------------------------------------------------------------------------
 * Desde el 24-08 `conductores.disponible` **es solo del conductor**: se marca
 * desde su app y `actualizarDisponibilidadConductor` se retiró entera para que
 * nadie la cambie por él (ver `disponibilidad-conductor.ts`). Así que acá no se
 * ofrece un interruptor: se muestra un **hecho ajeno**, y el copy tiene que
 * decir de quién es.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ Y POR QUÉ NO DICE «HOY» EN NINGUNA PARTE
 * -----------------------------------------------------------------------------
 * Porque **no hay reseteo diario**. La columna es `boolean not null default
 * true` y no existe ningún job que la baje a medianoche: quien se marcó
 * disponible el lunes sigue marcado el martes sin haber tocado nada, y un
 * conductor recién dado de alta nace disponible sin haber abierto la app.
 *
 * Escribir «se marcó disponible hoy» sería que la pantalla afirme algo que el
 * dato no sostiene. Se dice el estado y nada más. *(Que la marca debería ser de
 * asistencia diaria es una decisión de producto abierta, anotada en el
 * checklist; no se resuelve inventando la palabra «hoy» acá.)*
 *
 * -----------------------------------------------------------------------------
 * NO SE ESCONDE AL NO DISPONIBLE, Y NO SE BLOQUEA LA ASIGNACIÓN
 * -----------------------------------------------------------------------------
 * Sacarlo de la lista obligaría a salir a otra pantalla cuando el conductor
 * acaba de llamar diciendo que ya viene, y bloquear sería que el software le
 * discuta al coordinador un hecho que él sí conoce. Se marca, se separa y se
 * avisa; decidir sigue siendo suyo. Es la misma regla que el aviso de margen
 * invertido en tarifas.
 */

export interface OpcionConductor {
  id: string;
  nombre: string;
  disponible: boolean;
  cargaHoy: number;
}

export interface GruposConductores<T extends OpcionConductor> {
  disponibles: T[];
  noDisponibles: T[];
}

/**
 * Parte la lista en los dos grupos que ve el selector.
 *
 * **Conserva el orden de entrada dentro de cada grupo**: el llamador ya la
 * ordenó alfabéticamente, y reordenar acá haría que la lista salte entre
 * renders sin que nadie sepa por qué.
 */
export function agruparPorDisponibilidad<T extends OpcionConductor>(
  conductores: readonly T[],
): GruposConductores<T> {
  const disponibles: T[] = [];
  const noDisponibles: T[] = [];
  for (const c of conductores) (c.disponible ? disponibles : noDisponibles).push(c);
  return { disponibles, noDisponibles };
}

/**
 * Lo que se lee en la fila del selector, y también en el disparador una vez
 * elegido — por eso la marca va en el ítem y no solo en el rótulo del grupo:
 * con el desplegable cerrado, el rótulo ya no está a la vista.
 *
 * La carga va siempre, disponible o no: «12 hoy» sobre alguien no disponible es
 * justamente el dato que dice cuánto habría que mover si no aparece.
 */
export function etiquetaConductor(c: OpcionConductor): string {
  const carga = `${c.cargaHoy} hoy`;
  return c.disponible ? `${c.nombre} · ${carga}` : `${c.nombre} · ${carga} · no disponible`;
}

/**
 * El aviso que aparece al elegir a alguien que no está disponible.
 *
 * Devuelve `null` cuando no hay nada que decir — el caso normal— para que el
 * llamador no tenga que decidir cuándo callarse.
 *
 * Dice **el hecho, de quién es la marca y que no bloquea**, en ese orden. Sin la
 * segunda parte el coordinador cree que es un estado que él puso mal; sin la
 * tercera, cree que tiene que arreglarlo antes de poder asignar.
 */
export function avisoNoDisponible(
  conductores: readonly OpcionConductor[],
  elegidoId: string | null,
): string | null {
  if (!elegidoId) return null;
  const elegido = conductores.find((c) => c.id === elegidoId);
  if (!elegido || elegido.disponible) return null;
  return (
    `${elegido.nombre} no está disponible. Esa marca la pone el conductor desde su app. ` +
    `Si ya hablaste con él, asígnale igual.`
  );
}
