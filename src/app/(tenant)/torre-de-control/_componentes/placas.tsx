'use client';

/**
 * Placas de comuna — la capa HTML del nivel 1.
 * =============================================================================
 *
 * Cada comuna con carga lleva su nombre y su fracción sobre el mapa. Es la
 * aplicación directa de la regla 2 del alcance: **el color nunca es el único
 * canal**, así que la rampa de relleno viene siempre acompañada de la cifra.
 *
 * -----------------------------------------------------------------------------
 * TRES REGLAS QUE PARECEN DETALLE Y SON LA DIFERENCIA ENTRE FLUIDO Y ROTO
 * -----------------------------------------------------------------------------
 * Las tres salen de comparar contra el prototipo, donde el alejar/acercar se
 * siente bien y acá no se sentía:
 *
 * 1. **Las placas NO se desmontan al salir del nivel 1.** Se esconden con
 *    `display` y el contenedor entero se apaga, pero los nodos viven mientras la
 *    comuna tenga carga. Desmontarlas tiraba la medida cacheada, y al volver del
 *    nivel 2 el bucle se encontraba sin medidas: **el nodo se quedaba con el
 *    `transform` viejo**, o sea la placa clavada donde estaba tres zooms atrás.
 *    Es exactamente el «quedan fijadas y se desordenan» que se reportó.
 *
 * 2. **La posición NO depende de la medida.** Se centra con
 *    `translate(-50%,-50%)`, así que aunque el ancho todavía no se haya medido,
 *    la placa cae donde tiene que caer. La medida solo decide **si choca con
 *    otra**, que es una degradación aceptable: en el peor caso se solapan un
 *    frame. Antes, sin medida, no se posicionaba en absoluto.
 *
 * 3. **La medida se toma con el contenedor VISIBLE.** Con `display: none`,
 *    `offsetWidth` devuelve 0 y el des-solape pasaría a creer que todas las
 *    placas miden nada y caben todas. Por eso el bucle sale temprano cuando la
 *    capa está apagada, igual que el prototipo.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTO ES HTML Y LOS PEDIDOS NO
 * -----------------------------------------------------------------------------
 * Está medido (`docs/arquitectura/mapa-torre-v2.md` §2): 600 anclas HTML cuestan
 * 31,77 ms por frame (≈31 fps). Acá son **~30 placas** y a esa escala el costo
 * desaparece; los pedidos, que son cientos, van por la fuente GeoJSON.
 *
 * ⚠️ Y el 91 % de aquel costo era **layout thrash**: leer `offsetWidth`
 * mezclado con escrituras de `transform` obliga a recalcular el layout en cada
 * lectura. Por eso la medida de cada placa se toma **una sola vez** y queda
 * cacheada; el bucle por frame solo proyecta y escribe `transform`.
 */

import { useCallback, useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import type { ComunaEnTorre } from '@/modules/contexto/contrato-torre';

interface Medida {
  ancho: number;
  alto: number;
}

/** Holgura entre placas al decidir si dos chocan. La usa también el prototipo. */
const HOLGURA = 4;

export function PlacasComuna({
  mapa,
  comunas,
  visible,
  onComuna,
}: {
  mapa: maplibregl.Map | null;
  comunas: readonly ComunaEnTorre[];
  visible: boolean;
  onComuna: (nombre: string) => void;
}) {
  const nodos = useRef(new Map<string, HTMLButtonElement>());
  const medidas = useRef(new Map<string, Medida>());
  const contenedor = useRef<HTMLDivElement>(null);

  // Solo las comunas con algo que mirar. Una placa que dice «faltan 0 de 0» es
  // ruido puro, y la regla 1 dice que el silencio es el estado normal.
  const conCarga = comunas.filter((c) => c.pendientes > 0);
  // Se lee desde el bucle de colocación, que se registra una sola vez en el
  // mapa: sin esta indirección habría que re-suscribir el `move` en cada render.
  const ultimas = useRef(conCarga);
  useEffect(() => {
    ultimas.current = conCarga;
  });

  const colocar = useCallback(() => {
    const raiz = contenedor.current;
    // Fuera del nivel 1 no se coloca NADA, y no es una optimización: con el
    // contenedor apagado `offsetWidth` da 0 y el des-solape creería que todas
    // las placas caben. Ver la regla 3 del encabezado.
    if (!mapa || !raiz || raiz.style.display === 'none') return;

    const lienzo = mapa.getCanvas().getBoundingClientRect();
    const { width, height } = lienzo;
    const puestas = new Set<string>();

    // Los controles que van ENCIMA del mapa —migas, pantalla completa,
    // atribución— entran al des-solape como cajas ya ocupadas. Sin esto, una
    // placa se coloca debajo de las migas y queda medio tapada: se lee como un
    // error de render, y encima es la única navegación de la pantalla.
    //
    // Se leen del DOM y no de constantes: las migas cambian de ancho según el
    // nombre de la comuna activa, así que cualquier número fijo mentiría.
    const colocadas: [number, number, number, number][] = [];
    const raizMapa = raiz.parentElement;
    if (raizMapa) {
      for (const nodo of raizMapa.querySelectorAll<HTMLElement>('[data-reserva-placas]')) {
        const r = nodo.getBoundingClientRect();
        if (r.width === 0) continue;
        colocadas.push([
          r.left - lienzo.left,
          r.top - lienzo.top,
          r.right - lienzo.left,
          r.bottom - lienzo.top,
        ]);
      }
    }

    // De mayor a menor carga: cuando dos placas chocan sobrevive la que más
    // pesa. Al revés escondería justo la comuna que duele.
    for (const comuna of [...ultimas.current].sort((a, b) => b.pendientes - a.pendientes)) {
      const nodo = nodos.current.get(comuna.nombre);
      if (!nodo) continue;

      // Medida perezosa: la primera vez que la placa se dibuja visible.
      let medida = medidas.current.get(comuna.nombre);
      if (!medida) {
        // Tiene que estar mostrada para poder medirse.
        nodo.style.display = 'flex';
        medida = { ancho: nodo.offsetWidth, alto: nodo.offsetHeight };
        if (medida.ancho > 0) medidas.current.set(comuna.nombre, medida);
      }

      const p = mapa.project([comuna.centro.long, comuna.centro.lat]);

      // Filtro ESTRICTO al encuadre, sin margen de tolerancia: un margen le daba
      // placa a comunas fuera de la caja y salían recortadas contra el borde.
      const mitadX = medida.ancho / 2;
      const mitadY = medida.alto / 2;
      if (
        p.x - mitadX < 0 ||
        p.y - mitadY < 0 ||
        p.x + mitadX > width ||
        p.y + mitadY > height
      ) {
        nodo.style.display = 'none';
        continue;
      }

      const caja: [number, number, number, number] = [
        p.x - mitadX,
        p.y - mitadY,
        p.x + mitadX,
        p.y + mitadY,
      ];
      const choca = colocadas.some(
        (o) =>
          !(
            caja[2] < o[0] - HOLGURA ||
            caja[0] > o[2] + HOLGURA ||
            caja[3] < o[1] - HOLGURA ||
            caja[1] > o[3] + HOLGURA
          ),
      );
      if (choca) {
        nodo.style.display = 'none';
        continue;
      }

      colocadas.push(caja);
      puestas.add(comuna.nombre);
      nodo.style.display = 'flex';
      // El centrado va en el propio `transform` y NO restando la mitad del ancho
      // en JS: así la posición es correcta aunque la medida todavía no exista.
      // Ver la regla 2 del encabezado.
      nodo.style.transform = `translate(-50%, -50%) translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    }

    // Las que no entraron en esta pasada se apagan explícitamente. Sin esto, una
    // placa que dejó de tener carga se quedaría dibujada para siempre.
    for (const [nombre, nodo] of nodos.current) {
      if (!puestas.has(nombre)) nodo.style.display = 'none';
    }
  }, [mapa]);

  // El contenedor se apaga entero al salir del nivel 1 — igual que el prototipo,
  // que conmuta `#placas`. Los nodos siguen vivos y con su medida.
  useEffect(() => {
    const raiz = contenedor.current;
    if (!raiz) return;
    raiz.style.display = visible ? 'block' : 'none';
    if (visible) colocar();
  }, [visible, colocar]);

  // Re-colocar cuando cambia la lista (realtime puede agregar o quitar comunas).
  useEffect(() => {
    if (visible) colocar();
  }, [comunas, visible, colocar]);

  useEffect(() => {
    if (!mapa) return;
    mapa.on('move', colocar);
    return () => {
      mapa.off('move', colocar);
    };
  }, [mapa, colocar]);

  return (
    // El contenedor no intercepta el puntero: el mapa de abajo tiene que seguir
    // recibiendo arrastre y rueda. Solo las placas reactivan `pointer-events`.
    <div
      ref={contenedor}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ display: visible ? 'block' : 'none' }}
    >
      {conCarga.map((comuna) => (
        <button
          key={comuna.nombre}
          type="button"
          ref={(nodo) => {
            if (nodo) nodos.current.set(comuna.nombre, nodo);
            else {
              nodos.current.delete(comuna.nombre);
              medidas.current.delete(comuna.nombre);
            }
          }}
          onClick={() => onComuna(comuna.nombre)}
          // ⚠️ Llevaba `shadow-xs` y `hover:shadow-sm`, contra la regla 4 —
          // la elevación se construye con escalón de fondo y borde, no con
          // sombra. Acá además la sombra no separaba nada: la placa ya flota
          // sobre el plano por su fondo opaco y su borde. Lo que sí necesita es
          // que el hover se note, y eso lo da el fondo, que pasa de 90 % a
          // opaco. Radio 3 px (`--rx-radius-ctrl`), no `rounded-md`.
          className="pointer-events-auto absolute top-0 left-0 flex items-center gap-1.5 rounded-ctrl border border-line bg-card/90 px-2 py-1 text-left backdrop-blur-[2px] transition-colors hover:border-fg-muted hover:bg-card focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          // Arranca oculta: hasta que `colocar()` la proyecte, su posición es
          // (0,0) y se vería amontonada en la esquina durante un frame.
          style={{ display: 'none', willChange: 'transform' }}
        >
          <span className="text-xs font-medium whitespace-nowrap">{comuna.nombre}</span>
          {comuna.incidenciasAbiertas > 0 ? (
            <span
              // Regla 67: el rojo es de la incidencia abierta y de nada más.
            className="size-1.5 shrink-0 rounded-full bg-fault-fg"
              aria-label={`${comuna.incidenciasAbiertas} con incidencia`}
            />
          ) : null}
          <span className="text-xs whitespace-nowrap tabular-nums text-muted-foreground">
            faltan {comuna.pendientes} de {comuna.total}
          </span>
        </button>
      ))}
    </div>
  );
}
