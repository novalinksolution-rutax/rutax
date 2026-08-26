"use client";

/**
 * La cabecera de los dos paneles de monitoreo en vivo.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ES UNA SOLA, Y NO DOS CABECERAS PARECIDAS
 * -----------------------------------------------------------------------------
 * El tablero B1a las trata como **una misma pantalla con dos contenidos**
 * («PREPARACIÓN DEL DÍA · MISMO PATRÓN, SIN MAPA»): mismo título, misma línea de
 * estado debajo, mismo grupo de distintivos a la derecha. Dos implementaciones
 * parecidas se separan sin que nadie lo decida — que es justo lo que pasó.
 *
 * -----------------------------------------------------------------------------
 * 🔴 QUÉ ESTABA MAL, Y POR QUÉ SE VEÍA MAL EN PREPARACIÓN
 * -----------------------------------------------------------------------------
 * Reportado por el usuario (26-08-2026): «el título de Preparación del día está
 * mal ubicado en comparación con Torre de control y Pedidos».
 *
 * El `h1` estaba en el sitio exacto —medido: las tres pantallas lo ponen en
 * (32, 24) sobre `main`—, así que no era la posición del título: era **la línea
 * de debajo**. Estaba armada como `flex flex-wrap` con tres hijos y **dos
 * tipografías**: la frase en Chivo y la cuenta regresiva en mono. En teléfono
 * partía en dos renglones de fuentes distintas y **dejaba el «·» colgando al
 * final del primero**. El bloque entero se lee torcido, y lo que uno señala es
 * el título.
 *
 * Ahora la línea es **una sola, corrida y toda en mono**, como el tablero: es
 * texto que fluye, así que al partir parte por donde corresponde y el separador
 * viaja con lo que separa.
 *
 * -----------------------------------------------------------------------------
 * LA MARCA DE HORA VA PRIMERO — es del tablero, y responde otra pregunta
 * -----------------------------------------------------------------------------
 * Las dos cabeceras del tablero empiezan por `21-08 16:04`. No es decoración ni
 * repite al distintivo «En vivo»: aquél dice que el canal está vivo, ésta dice
 * **de cuándo es lo que estás mirando**. En una pantalla que se mira de pie
 * durante horas, en un teléfono que pudo quedar despierto con la vista vieja,
 * son dos preguntas distintas.
 *
 * Se rinde en el cliente y con `useSyncExternalStore`, igual que la cuenta
 * regresiva: en el servidor devuelve `null`, así que la hidratación calza y el
 * reloj no se congela en el instante del render.
 */

import { useSyncExternalStore, type ReactNode } from "react";

import { formatearFechaCorta, formatearHora } from "@/lib/formato-cl";

// =============================================================================
// El reloj
// =============================================================================

let cache: { minuto: number; texto: string } | null = null;

function leerReloj(): string | null {
  const ahora = Date.now();
  const minuto = Math.floor(ahora / 60_000);
  // ⚠️ Cacheado POR MINUTO. Si devolviera una cadena nueva en cada llamada,
  // `useSyncExternalStore` lo leería como cambio permanente y re-renderizaría
  // sin parar. Mismo cuidado que en `CuentaRegresivaDespacho`.
  if (!cache || cache.minuto !== minuto) {
    const instante = new Date(ahora);
    cache = { minuto, texto: `${formatearFechaCorta(instante)} ${formatearHora(instante)}` };
  }
  return cache.texto;
}

function sinReloj(): string | null {
  return null;
}

function suscribir(avisar: () => void): () => void {
  // Cada 15 s: el minuto cambia en cualquier punto del intervalo, así que un tic
  // de un minuto exacto dejaría la hora hasta 59 s atrasada.
  const id = setInterval(avisar, 15_000);
  return () => clearInterval(id);
}

// =============================================================================
// La cabecera
// =============================================================================

export function CabeceraPanelMonitoreo({
  titulo,
  resumen,
  acciones,
}: {
  titulo: string;
  /**
   * Lo que hay que saber del panel, en una frase. Va DESPUÉS de la hora y del
   * separador, que los pone esta cabecera.
   *
   * Es `ReactNode` porque Preparación mete ahí su cuenta regresiva, que es un
   * componente vivo. Lo que entre acá hereda la tipografía mono de la línea: no
   * le pongas fuente propia o vuelve el renglón de dos tipografías.
   */
  resumen: ReactNode;
  /** Los distintivos de la derecha: «Solo lectura», «En vivo», pantalla completa. */
  acciones?: ReactNode;
}) {
  const hora = useSyncExternalStore(suscribir, leerReloj, sinReloj);

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-semibold">{titulo}</h1>
        {/* Una sola línea corrida, toda en mono (`rx-num`). NO es flex: en flex
            cada trozo es un ítem independiente y el separador se queda solo al
            final del renglón cuando parte. */}
        <p className="rx-num mt-0.5 text-xs leading-relaxed text-fg-muted">
          {hora ? (
            <>
              {hora}
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          {resumen}
        </p>
      </div>
      {acciones ? <div className="flex flex-wrap items-center gap-2">{acciones}</div> : null}
    </div>
  );
}
