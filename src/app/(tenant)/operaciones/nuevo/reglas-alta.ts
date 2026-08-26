/**
 * Las tres reglas del alta same-day que no son de presentación.
 *
 * Viven aparte del formulario para poder probarlas sin navegador: las tres
 * deciden lo que el courier ve —si aparece un error, si aparece el aviso de
 * corte, qué comuna queda elegida— y las tres son del tipo que se pudre en
 * silencio cuando alguien toca un formato.
 */

import { COMUNAS_RM } from "@/lib/ui/comunas-rm";

/**
 * Móvil chileno: `+56 9` y ocho dígitos.
 *
 * Se aceptan las tres formas en que la gente lo escribe de verdad —con `+56`,
 * con `56` a secas, o empezando por el `9`— y con espacios en cualquier parte
 * de los grupos. Lo que NO se acepta es un fijo: el campo existe para avisarle
 * al destinatario que el conductor va en camino, y eso es un mensaje al móvil.
 */
import {
  puedeAjustarOperacionDiaria,
  puedeSolicitarSameDay,
} from "@/modules/identidad/capacidades";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";

/**
 * Quién puede usar la búsqueda de direcciones del alta same-day.
 * =============================================================================
 *
 * 🔴 **Son DOS capacidades, no una.** El formulario de alta es compartido: el
 * courier lo monta en `/operaciones/nuevo` y el portal del seller monta
 * exactamente el mismo componente desde el 25-08-2026. Pero la acción que
 * alimenta las sugerencias exigía solo `ajustar_operacion_diaria`, que es del
 * equipo INTERNO — así que para todo seller devolvía lista vacía en la primera
 * línea, y **el autocompletado estaba muerto en el portal** sin que nada lo
 * dijera: una lista vacía se lee como «esa dirección no existe».
 *
 * La regla correcta es «quien puede dar de alta un same-day puede buscarle la
 * dirección», y eso se escribe con las dos capacidades. Vive acá y no dentro del
 * archivo de acciones porque en un módulo `"use server"` no se puede exportar
 * nada que no sea una acción asíncrona — y sin exportarlo no hay forma de
 * probarlo.
 */
export function puedeUsarBusquedaDeDirecciones(usuario: UsuarioActual): boolean {
  return puedeAjustarOperacionDiaria(usuario) || puedeSolicitarSameDay(usuario);
}

export const MOVIL_CL = /^(\+?56)?\s?9\s?\d{4}\s?\d{4}$/;

export function esMovilChileno(valor: string): boolean {
  const v = valor.trim();
  // Vacío es válido: el teléfono es opcional. Un campo opcional que se pone en
  // rojo por estar vacío es un error de la interfaz, no de quien lo dejó así.
  return v === "" || MOVIL_CL.test(v);
}

function normalizarComuna(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^comuna de /, "")
    .trim();
}

/**
 * Casa la comuna que devuelve el proveedor contra el catálogo del producto.
 *
 * El proveedor la escribe a su manera —«Ñuñoa», «Nunoa», «Comuna de Ñuñoa»— y
 * el `Select` solo reconoce los valores del catálogo. Sin esto, elegir una
 * dirección de la lista dejaría la comuna vacía justo cuando más se confía en
 * que quedó bien.
 *
 * Devuelve `null` si no calza: entonces la persona elige, que es mejor que
 * dejar una comuna inventada.
 */
export function comunaDelCatalogo(comuna: string | null | undefined): string | null {
  if (!comuna) return null;
  const buscado = normalizarComuna(comuna);
  return COMUNAS_RM.find((c) => normalizarComuna(c) === buscado) ?? null;
}

/**
 * ¿`horaActual` ya pasó el corte `horaCorte`? Ambas `HH:MM`.
 *
 * Se compara en minutos y no como texto porque `"9:30" > "16:00"` es verdadero
 * al comparar cadenas, y ese es exactamente el error que haría aparecer el
 * aviso de corte a las nueve de la mañana.
 */
export function superaHoraDeCorte(horaActual: string, horaCorte: string): boolean {
  const enMinutos = (h: string): number | null => {
    const [hh, mm] = h.split(":").map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return hh * 60 + mm;
  };
  const ahora = enMinutos(horaActual);
  const corte = enMinutos(horaCorte);
  // Ante una hora ilegible NO se avisa: un aviso falso de «se va mañana»
  // empuja al courier a reagendar un pedido que sí alcanzaba a salir hoy.
  if (ahora === null || corte === null) return false;
  return ahora > corte;
}
