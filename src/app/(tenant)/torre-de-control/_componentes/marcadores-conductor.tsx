'use client';

/**
 * Marcadores de conductor — la capa HTML del nivel 3.
 * =============================================================================
 *
 * Cuadrado de 12 px rotado 45°, con la inicial dentro. Es lo que fija el tablero
 * en §13.4, y la forma importa: **es la única cosa del mapa que no es un
 * círculo**, así que un conductor no se confunde con una entrega ni siquiera de
 * reojo. El color no lo distingue — la forma sí, y eso cumple la regla 5.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ HOY NO DIBUJA NADA, Y ESO ES LO CORRECTO
 * -----------------------------------------------------------------------------
 * `operacion.ubicacion_conductor` **dejó de escribirse el 2026-08-14**: el
 * rastreo en vivo del conductor se apagó tras una revisión de privacidad que lo
 * marcó de **severidad ALTA** — podía estar guardando el domicilio del conductor
 * sin consentimiento para esa finalidad y sin límite de tiempo. La tabla existe
 * con cero filas, así que `posicion` llega siempre en `null` y esta capa se
 * queda vacía.
 *
 * Se construyó igual, por decisión del usuario (23-08-2026), para que la pieza
 * esté el día que exista una fuente legítima. Y **no se le conectó ninguna**:
 * `ubicacion-conductor-retirado.test.ts` es un candado que impide que el código
 * de aplicación vuelva a tocar esa tabla, para leerla o para escribirla. La
 * primera versión de este marcador la leía y **el candado la atajó**, que es
 * exactamente para lo que estaba puesto.
 *
 * La fuente legítima llega con la etapa 7: `operacion.punto_termino_conductor`
 * es OTRA tabla, con su propia finalidad y su propio consentimiento. Ahí se
 * enchufa `posicion` y este componente empieza a dibujar sin tocarse.
 *
 * **No usar este componente como excusa para reencender el ping.** Ver
 * `docs/seguridad/punto-de-termino-conductor.md` §1.
 *
 * -----------------------------------------------------------------------------
 * UNA SOLA POSICIÓN, NUNCA UN RECORRIDO
 * -----------------------------------------------------------------------------
 * El modelo guarda una fila por conductor —la última posición, sin histórico— y
 * eso es deliberado: la Ley 21.431 no permite el seguimiento continuo, y aquí no
 * hay de dónde sacar una traza aunque se quisiera. Este componente **no acepta**
 * una lista de puntos por conductor, a propósito.
 *
 * Va en HTML y no en una capa de MapLibre por dos razones: el estilo del mapa
 * **no tiene sprite** —no hay un solo icono— y un cuadrado rotado a tamaño fijo
 * no se puede dibujar sin uno; y son decenas de conductores, la misma escala a
 * la que las placas de comuna ya viven en HTML sin costo medible.
 */

import { useCallback, useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';

import type { ConductorEnTorre } from '@/modules/contexto/contrato-torre';

/** La inicial que va dentro del rombo. Una sola letra: a 12 px no cabe más. */
function inicial(nombre: string): string {
  return nombre.trim().charAt(0).toUpperCase() || '?';
}

export function MarcadoresConductor({
  mapa,
  conductores,
  visible,
}: {
  mapa: maplibregl.Map | null;
  conductores: readonly ConductorEnTorre[];
  visible: boolean;
}) {
  const nodos = useRef(new Map<string, HTMLDivElement>());
  const contenedor = useRef<HTMLDivElement>(null);

  // Solo los que tienen posición. Hoy son cero.
  const ubicados = conductores.filter(
    (c): c is ConductorEnTorre & { posicion: NonNullable<ConductorEnTorre['posicion']> } =>
      c.posicion !== null,
  );
  // El bucle de colocación se registra una sola vez en el mapa, así que lee la
  // lista por referencia. Se actualiza en un efecto y no en el render: tocar
  // `.current` durante el render es lo que el lint del proyecto ataja.
  const ultimos = useRef(ubicados);
  useEffect(() => {
    ultimos.current = ubicados;
  });

  const colocar = useCallback(() => {
    // Con el contenedor apagado no se coloca: `project` sigue siendo válido,
    // pero mover nodos invisibles es trabajo tirado en cada frame del `move`.
    if (!mapa || !contenedor.current || contenedor.current.style.display === 'none') return;
    for (const conductor of ultimos.current) {
      const nodo = nodos.current.get(conductor.id);
      if (!nodo) continue;
      const p = mapa.project([conductor.posicion.long, conductor.posicion.lat]);
      nodo.style.display = 'block';
      // El centrado va en el `translate` y no depende de ninguna medida: el
      // rombo tiene tamaño fijo, así que no hay nada que medir.
      nodo.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    }
  }, [mapa]);

  useEffect(() => {
    if (!mapa) return;
    mapa.on('move', colocar);
    mapa.on('zoom', colocar);
    colocar();
    return () => {
      mapa.off('move', colocar);
      mapa.off('zoom', colocar);
    };
  }, [mapa, colocar]);

  useEffect(() => {
    colocar();
  }, [colocar, ubicados.length, visible]);

  return (
    <div
      ref={contenedor}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ display: visible ? 'block' : 'none' }}
      aria-hidden="true"
    >
      {ubicados.map((conductor) => (
        <div
          key={conductor.id}
          ref={(nodo) => {
            if (nodo) nodos.current.set(conductor.id, nodo);
            else nodos.current.delete(conductor.id);
          }}
          title={conductor.nombre}
          className="absolute top-0 left-0 flex size-3 rotate-45 items-center justify-center border border-line bg-bg-raised"
          style={{ display: 'none', willChange: 'transform' }}
        >
          {/* La inicial se contra-rota: el rombo gira, la letra no. */}
          <span className="-rotate-45 font-mono text-[7px] leading-none font-semibold text-fg">
            {inicial(conductor.nombre)}
          </span>
        </div>
      ))}
    </div>
  );
}
