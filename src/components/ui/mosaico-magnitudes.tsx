/**
 * `mosaico de magnitudes` — el patrón del dashboard operativo (tablero B1c).
 *
 * -----------------------------------------------------------------------------
 * QUÉ RESUELVE
 * -----------------------------------------------------------------------------
 * «El dueño entra poco, decide mucho, y a veces desde el teléfono un domingo. La
 * pantalla responde dos preguntas en cinco segundos: ¿el día va bien? y ¿hay algo
 * roto que no me contaron?»
 *
 * De ahí salen las tres reglas del patrón, y ninguna es decorativa:
 *
 *   1. **Magnitud con su denominador, nunca un índice.** «82 de 120», no «68 de
 *      avance». Un número suelto no se puede juzgar en cinco segundos.
 *   2. **Cada tarjeta es un enlace a su listado YA FILTRADO**, no a una pantalla
 *      intermedia. Por eso `href` es obligatorio: una magnitud sin destino es una
 *      magnitud que obliga a buscar a mano lo que acaba de nombrar.
 *   3. **Nada de gráficos sobre el pliegue.** Primero las magnitudes; la
 *      tendencia va después, y es responsabilidad de quien compone la pantalla.
 *
 * -----------------------------------------------------------------------------
 * EL TEÑIDO NO ES ÉNFASIS: ES ESTADO
 * -----------------------------------------------------------------------------
 * Solo se tiñe el fondo de lo que está mal, y el tablero es explícito en cuáles:
 * incidencias, rezagados y lo que no cuadra. Todo lo demás va en blanco. Teñir
 * una cuarta tarjeta «porque es importante» rompe el patrón: si todo grita, nada
 * grita.
 *
 * Hay un segundo grado, más débil, para lo que merece atención sin ser una falla:
 * `tintaCifra` tiñe la cifra y la bajada dejando el fondo blanco. Es lo que el
 * tablero hace con «conexiones caídas» (atención) y «en ruta ahora» (progreso).
 *
 * Y como manda la regla 5 —el color nunca es el único portador—, el estado
 * siempre está dicho también en el texto de la bajada.
 *
 * -----------------------------------------------------------------------------
 * EN EL TELÉFONO CAMBIA EL ORDEN, NO SOLO EL ANCHO
 * -----------------------------------------------------------------------------
 * En 390 el mosaico se apila en una columna y **las teñidas suben al principio**:
 * el domingo, el dueño quiere ver primero si hay algo roto. El orden se deriva
 * del tono, no se escribe a mano, para que agregar o quitar una magnitud no deje
 * el orden móvil desactualizado en silencio.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";

/** Tiñe el FONDO. Reservado a lo que está mal: es el grado fuerte. */
export type TonoMagnitud = "fault" | "attention";

/** Tiñe solo la TINTA, con el fondo en blanco: el grado débil. */
export type TintaMagnitud = "attention" | "progress" | "balanced";

export interface Magnitud {
  /** Rótulo en versalitas: «ENTREGADOS HOY». */
  rotulo: string;
  /** La cifra grande. Número o monto ya formateado. */
  cifra: React.ReactNode;
  /**
   * Lo que va junto a la cifra y la hace juzgable: «de 120», «· 1 sin gestionar».
   * Sin esto la magnitud es un índice, y la regla 1 dice que no.
   */
  denominador?: React.ReactNode;
  /** La línea de abajo. El `›` lo agrega el componente. */
  bajada: React.ReactNode;
  /** El listado ya filtrado. Obligatorio: ver la regla 2. */
  href: string;
  /** Tiñe el fondo. Solo para lo que está mal. */
  tono?: TonoMagnitud;
  /** Tiñe la cifra y la bajada, con el fondo en blanco. */
  tintaCifra?: TintaMagnitud;
  /** La cifra de dinero va un punto más chica que la operativa: es más larga. */
  escala?: "operativa" | "dinero";
  /** Nombre accesible del enlace, si el rótulo solo no basta. */
  etiquetaEnlace?: string;
}

const FONDO_POR_TONO: Record<TonoMagnitud, string> = {
  fault: "border-fault-line bg-fault-bg text-fault-fg",
  attention: "border-attention-line bg-attention-bg text-attention-fg",
};

const TINTA_POR_TONO: Record<TintaMagnitud, string> = {
  attention: "text-attention-fg",
  progress: "text-progress-fg",
  balanced: "text-balanced-fg",
};

/**
 * Prioridad en el teléfono: primero lo que está mal. El resto conserva el orden
 * de escritorio, que es el que agrupa operación arriba y dinero abajo.
 */
const PRIORIDAD_MOVIL: Record<TonoMagnitud | "sin-tono", number> = {
  fault: 0,
  attention: 1,
  "sin-tono": 2,
};

/**
 * Tailwind necesita la clase entera escrita: `order-${n}` interpolado no existe
 * al compilar. Ocho posiciones son todas las que el patrón admite.
 */
const ORDEN_MOVIL = [
  "order-1",
  "order-2",
  "order-3",
  "order-4",
  "order-5",
  "order-6",
  "order-7",
  "order-8",
] as const;

export function TarjetaMagnitud({
  magnitud,
  ordenMovil,
}: {
  magnitud: Magnitud;
  ordenMovil?: number;
}) {
  const { tono, tintaCifra, escala = "operativa" } = magnitud;
  const tenida = Boolean(tono);

  return (
    <Link
      href={magnitud.href}
      aria-label={magnitud.etiquetaEnlace}
      className={cn(
        // `basis` de 25 % menos su parte del gap (0.75rem × 3 ÷ 4): ocho
        // tarjetas caen en dos filas de cuatro sin declarar filas.
        "flex min-w-[200px] grow flex-col gap-2 border p-4 transition-colors",
        "sm:basis-[calc(25%-0.5625rem)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text",
        tenida
          ? FONDO_POR_TONO[tono!]
          : "border-line bg-bg-raised hover:border-line-strong",
        ordenMovil !== undefined ? ORDEN_MOVIL[ordenMovil] : null,
        // En escritorio manda el orden del documento: operación arriba, dinero
        // abajo. El reordenamiento es exclusivo del teléfono.
        "sm:order-none",
      )}
    >
      <span
        className={cn(
          "rx-num text-[10px] leading-none font-medium tracking-[0.14em] uppercase",
          tenida ? null : "text-fg-muted",
        )}
      >
        {magnitud.rotulo}
      </span>

      <p className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={cn(
            "rx-num leading-none font-semibold",
            escala === "dinero" ? "text-[30px]" : "text-[34px]",
            tenida ? null : tintaCifra ? TINTA_POR_TONO[tintaCifra] : "text-fg",
          )}
        >
          {magnitud.cifra}
        </span>
        {magnitud.denominador !== undefined ? (
          <span
            className={cn(
              "rx-num text-sm",
              tenida ? "opacity-80" : "text-fg-muted",
            )}
          >
            {magnitud.denominador}
          </span>
        ) : null}
      </p>

      <p
        className={cn(
          "text-xs leading-snug",
          tenida ? null : tintaCifra ? TINTA_POR_TONO[tintaCifra] : "text-fg-muted",
        )}
      >
        {magnitud.bajada} <span aria-hidden="true">›</span>
      </p>
    </Link>
  );
}

/**
 * El mosaico. Recibe las magnitudes en el orden de ESCRITORIO —las operativas
 * primero, las de dinero después— y deriva solo el orden del teléfono.
 *
 * ⚠️ **Es UN solo contenedor flex, no una fila por grupo.** El tablero las dibuja
 * como dos filas de cuatro y la tentación es escribir dos `<div>`; pero `order`
 * solo reordena DENTRO de su contenedor, y las tres teñidas viven en filas
 * distintas —incidencias y rezagados arriba, «dinero que no cuadra» abajo—, así
 * que con dos contenedores el reordenamiento del teléfono no ocurriría y el
 * defecto sería invisible en escritorio.
 *
 * Las dos filas salen solas del `basis` de 25 %: ocho tarjetas con ese ancho se
 * parten en cuatro y cuatro. Y como además llevan `min-width: 200px`, el mosaico
 * se reacomoda a dos por fila en la tablet de la bodega sin un punto de quiebre
 * escrito para cada ancho.
 */
export function MosaicoMagnitudes({
  magnitudes,
  className,
}: {
  magnitudes: Magnitud[];
  className?: string;
}) {
  const ordenPorRotulo = new Map(
    magnitudes
      .map((m, indiceOriginal) => ({ m, indiceOriginal }))
      .sort(
        (a, b) =>
          PRIORIDAD_MOVIL[a.m.tono ?? "sin-tono"] -
            PRIORIDAD_MOVIL[b.m.tono ?? "sin-tono"] ||
          a.indiceOriginal - b.indiceOriginal,
      )
      .map(({ m }, posicion) => [m.rotulo, posicion] as const),
  );

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:flex-wrap", className)}>
      {magnitudes.map((m) => (
        <TarjetaMagnitud
          key={m.rotulo}
          magnitud={m}
          ordenMovil={ordenPorRotulo.get(m.rotulo)}
        />
      ))}
    </div>
  );
}
