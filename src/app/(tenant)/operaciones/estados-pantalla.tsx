/**
 * Los cinco estados de la pantalla de Pedidos.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SON CINCO Y NO DOS
 * -----------------------------------------------------------------------------
 * «Con datos» y «vacío» son dos, y con dos esta pantalla miente. Los **tres
 * vacíos de Pedidos dicen cosas opuestas** y hasta ahora se veían iguales:
 *
 * · **Buena noticia** — no hay direcciones por revisar. Es el estado deseable.
 *   Si se dibuja como los otros dos, el coordinador lee un problema donde hay un
 *   trabajo terminado.
 * · **Filtro sin resultados** — hay pedidos, pero tu filtro los dejó fuera. El
 *   dato que lo convierte en accionable es **cuántos hay fuera**.
 * · **Arranque** — todavía no llegó ninguno hoy. Ni bueno ni malo: temprano.
 *
 * Y el quinto no es un vacío en absoluto:
 *
 * · **Falla de lectura** — no sabemos si hay pedidos. Decir «no hay» sería
 *   afirmar un hecho que no se comprobó.
 *
 * -----------------------------------------------------------------------------
 * 🔴 LOS CONTADORES NO SE PONEN EN CERO
 * -----------------------------------------------------------------------------
 * Esa regla vive en `barra-cajones-pedidos.tsx`, y es la consecuencia dura de
 * todo esto: **a las 15:50, un cajón que dice 0 hace que alguien deje de
 * asignar**. Ante una lectura fallida los cajones conservan su último valor
 * conocido y dicen de cuándo es.
 */

import Link from "next/link";
import { AlertTriangle, Inbox, MapPinCheck, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatearFechaCorta, formatearHora } from "@/lib/formato-cl";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";

/**
 * Vacío 1 · **Buena noticia.** No hay direcciones por revisar.
 *
 * Lleva la hora de la última revisión porque sin ella el mensaje es indistinguible
 * de «el geocodificador está caído y por eso no aparece nada».
 */
export function VacioSinDireccionesPorRevisar({
  totalDelDia,
  ubicandose,
  ultimaRevision,
}: {
  totalDelDia: number | null;
  /** Cuántas siguen ubicándose. Con esto el mensaje deja de mentir de mañana. */
  ubicandose: number | null;
  ultimaRevision: string | null;
}) {
  return (
    <EmptyState
      icon={MapPinCheck}
      tono="buen-estado"
      titulo="No hay direcciones por revisar"
      descripcion={cuerpoBuenaNoticia(totalDelDia, ubicandose)}
      accion={
        ultimaRevision ? (
          <p className="rx-num font-mono text-xs text-fg-subtle">
            Última revisión: {momentoDeRevision(ultimaRevision)}
          </p>
        ) : undefined
      }
    />
  );
}

/**
 * ⚠️ **«No hay ninguna por revisar» y «ya se revisaron todas» NO son lo mismo**,
 * y a las 09:00 la diferencia es toda la información.
 *
 * «Por revisar» cuenta las direcciones **con problema**. A primera hora no hay
 * ninguna porque el geocodificador todavía no llegó a ellas: decir ahí «las 13
 * direcciones de hoy quedaron ubicadas» afirma que una revisión terminó cuando
 * ni siquiera empezó, y el coordinador cierra la pantalla tranquilo.
 *
 * Así que si quedan direcciones ubicándose, se dicen.
 */
function cuerpoBuenaNoticia(totalDelDia: number | null, ubicandose: number | null): string {
  const cola = "Si alguna falla, aparece acá y el pedido no sale a ruta sin avisarte.";

  if (ubicandose !== null && ubicandose > 0) {
    const listas = totalDelDia !== null ? Math.max(totalDelDia - ubicandose, 0) : null;
    const cabeza =
      listas !== null && listas > 0
        ? `${listas.toLocaleString("es-CL")} ${listas === 1 ? "dirección" : "direcciones"} de hoy ya quedaron ubicadas y ${ubicandose.toLocaleString("es-CL")} ${ubicandose === 1 ? "sigue" : "siguen"} ubicándose.`
        : `${ubicandose.toLocaleString("es-CL")} ${ubicandose === 1 ? "dirección sigue" : "direcciones siguen"} ubicándose. Todavía no hay ninguna con problema.`;
    return `${cabeza} ${cola}`;
  }

  return totalDelDia !== null
    ? `Las ${totalDelDia.toLocaleString("es-CL")} direcciones de hoy quedaron ubicadas. ${cola}`
    : `Las direcciones de hoy quedaron ubicadas. ${cola}`;
}

/**
 * Vacío 2 · **El filtro los dejó fuera.**
 *
 * ⚠️ El copy nombra **los filtros puestos** y **cuántos pedidos hay fuera**. Sin
 * esas dos cosas el mensaje es «no hay nada», que es justo lo que no pasa. Es el
 * más largo de los tres y por eso fija el ancho mínimo del bloque: en 390 px
 * ocupa tres líneas.
 */
export function VacioFiltroSinResultados({
  filtrosPuestos,
  fueraDelFiltro,
  hrefLimpiar,
}: {
  filtrosPuestos: string[];
  fueraDelFiltro: number | null;
  hrefLimpiar: string;
}) {
  const lista = enumerarEnEspanol(filtrosPuestos);
  const cuantos =
    fueraDelFiltro !== null && fueraDelFiltro > 0
      ? ` Hay ${fueraDelFiltro.toLocaleString("es-CL")} ${fueraDelFiltro === 1 ? "pedido" : "pedidos"} hoy fuera de ese filtro.`
      : "";

  return (
    <EmptyState
      icon={SearchX}
      tono="filtro"
      titulo="Ningún pedido coincide"
      descripcion={lista ? `Estás filtrando por ${lista}.${cuantos}` : `Ningún pedido coincide.${cuantos}`}
      accion={
        <Button asChild variant="outline" size="sm">
          <Link href={hrefLimpiar}>Limpiar los filtros</Link>
        </Button>
      }
    />
  );
}

/**
 * Vacío 3 · **Arranque.** Ni bueno ni malo: temprano.
 *
 * ⚠️ **`accionCrear` llega como ELEMENTO YA RENDERIZADO, no como componente.**
 * Es el mismo patrón que exige el resto del repo: pasar una función de
 * componente a través de un límite de servidor tumba en ejecución todo lo que
 * el árbol envuelve, y ni el typecheck ni el lint lo notan.
 *
 * 🔴 **El botón llevaba a `/operaciones/nuevo`.** Un vacío es exactamente el
 * momento en que el courier no quiere cambiar de pantalla: está mirando su día
 * y lo que necesita es meter un pedido, no navegar a otro sitio y volver. El
 * formulario ya vivía en un panel lateral —que bajo 768 px es una hoja de
 * abajo hacia arriba— en el encabezado de esta misma pantalla; el vacío se
 * había quedado con el enlace viejo. La página **no se retira**: sigue siendo
 * una URL que se comparte y que el botón atrás respeta.
 */
export function VacioArranque({ accionCrear }: { accionCrear?: React.ReactNode }) {
  return (
    <EmptyState
      icon={Inbox}
      titulo="Aún no hay pedidos para hoy"
      descripcion={
        accionCrear
          ? "Los pedidos de tus sellers llegan solos cuando ellos venden. También puedes crear uno same-day a mano."
          : "Los pedidos de tus sellers llegan solos cuando ellos venden."
      }
      accion={accionCrear}
    />
  );
}

/**
 * Estado 5 · **Falla de lectura. No es un vacío.**
 *
 * 🔴 La primera frase del cuerpo existe para **impedir la lectura equivocada**:
 * un panel vacío con un icono de alerta se lee como «no hay pedidos», y a las
 * 15:50 eso hace que alguien deje de asignar. Hay que decirlo con todas las
 * letras: no es que no haya, es que no pudimos leer.
 */
export function FallaDeLectura({ hrefReintentar }: { hrefReintentar: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 border border-fault-line bg-fault-bg p-6 sm:flex-row sm:items-center"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-fault-line">
        <AlertTriangle className="size-5 text-fault-fg" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-heading text-sm font-medium text-fg">No pudimos cargar los pedidos</p>
        <p className="mt-1 text-sm text-fg-muted">
          Esto no significa que no haya pedidos: significa que no los pudimos leer. Los contadores
          de arriba son del último dato que alcanzamos a leer.
        </p>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link href={hrefReintentar}>Volver a intentar</Link>
      </Button>
    </div>
  );
}

/**
 * `hoy 16:04` cuando es de hoy, `21-08 16:04` cuando no.
 *
 * El «hoy» no es un adorno: el mensaje contesta «¿esto está al día?», y una fecha
 * suelta obliga al lector a compararla con el calendario mentalmente.
 */
function momentoDeRevision(iso: string): string {
  const esDeHoy = fechaLocalEnSantiago(new Date(iso)) === fechaLocalEnSantiago(new Date());
  const dia = esDeHoy ? "hoy" : formatearFechaCorta(iso);
  return `${dia} ${formatearHora(iso)}`;
}

/**
 * Une con comas y una «y» final: «Vega Norte, Maipú y 21-08».
 *
 * Existe porque `Array.join(", ")` produce «Vega Norte, Maipú, 21-08», que se lee
 * como una lista de sistema y no como una frase — y este copy es una frase.
 */
export function enumerarEnEspanol(partes: string[]): string {
  const limpias = partes.filter(Boolean);
  if (limpias.length === 0) return "";
  if (limpias.length === 1) return limpias[0];
  return `${limpias.slice(0, -1).join(", ")} y ${limpias[limpias.length - 1]}`;
}
