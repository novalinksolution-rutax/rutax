'use client';

/**
 * La ficha del punto y las previsualizaciones del nivel 3.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * LA FICHA SALE DE DONDE LA LLAMARON
 * -----------------------------------------------------------------------------
 * Va **anclada a su punto**, en coordenadas de pantalla, con cola triangular que
 * lo apunta. Antes aparecía clavada en la esquina inferior derecha y de golpe:
 * con varios puntos en pantalla eso obligaba a saltar la vista del punto a la
 * esquina y de vuelta, sin forma de saber a cuál se refería.
 *
 * · **Arriba del punto por defecto** —donde no tapa lo que el usuario acaba de
 *   mirar—; si no cabe, cae debajo y la cola se da vuelta.
 * · **Se recorta contra los bordes de la caja**: una ficha que asoma media fuera
 *   se lee como error de render. La cola sigue apuntando al punto aunque la
 *   tarjeta se haya recortado.
 * · **Sigue al mapa**: se reposiciona en cada `move`. Si no, se despega.
 * · **Entrada de 160 ms y no más.** Una consola se mira muchas veces al día: la
 *   animación que encanta la primera vez estorba la vigésima. Respeta
 *   `prefers-reduced-motion`.
 * · **Es del nivel 3 y solo del nivel 3.** Al salir se cierra sola: si
 *   sobreviviera quedaría señalando un punto que dejó de dibujarse.
 *
 * -----------------------------------------------------------------------------
 * PREVISUALIZACIONES — dos tratamientos, y la diferencia es de fondo
 * -----------------------------------------------------------------------------
 * · **Pedido normal:** la misma ficha a la mitad y translúcida. No inventa un
 *   componente — es la ficha, más chica, así que el clic no cambia de lenguaje.
 * · **Incidencia:** su ETIQUETA, no una tarjeta. Una píldora roja con el tipo, a
 *   tamaño completo y sin translucidez. La tarjeta contesta «quién lo lleva»;
 *   ante una incidencia eso es secundario y lo primero es **de qué se trata**,
 *   porque decide qué se hace: un domicilio cerrado se reintenta, un paquete
 *   dañado no. Va sin escalar a propósito: es lo único accionable de la pantalla
 *   y no puede competir en desventaja con lo que no lo es.
 *
 * Cinco reglas, todas aprendidas rompiéndolas:
 *   1. Los **entregados no se previsualizan**: ya no piden atención.
 *   2. **Solo lo estrictamente dentro del encuadre**, sin margen de tolerancia.
 *      Un margen de 60 px le daba tarjeta a puntos fuera de la caja y salían
 *      recortadas señalando algo que no se ve.
 *   3. El conjunto se recalcula al **asentarse** la vista (`moveend`); durante el
 *      movimiento solo se reposiciona lo ya montado.
 *   4. Se **des-solapan por caja**, y el orden decide quién sobrevive. Ocultar
 *      una previsualización no esconde carga —el punto se sigue dibujando y
 *      sigue siendo clicable—: lo que se pierde es un atajo, no un pedido.
 *   5. Se **voltean bajo el punto** cuando arriba no caben, midiendo su alto
 *      **escalado**; y si no caben ni arriba ni abajo, **no se dibujan**.
 *      Moverlas hasta que quepan las despegaría de su punto, y una tarjeta que
 *      señala a otra cosa es peor que ninguna.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { PedidoEnPunto, PuntoEntrega } from '@/modules/contexto/contrato-torre';
import { celdaDe } from '../_lib/derivar';

// =============================================================================
// Geometría de la ficha
// =============================================================================
//
// Las medidas son CONSTANTES y no se leen del DOM, y eso es deliberado: medir
// con `offsetHeight` dentro del bucle de colocación es el layout thrash que se
// midió como el 91 % del costo de esta capa. Con alturas fijas, todo el
// des-solape se resuelve en JS y solo se montan los que sobreviven.
//
// La contrapartida honesta: si alguien cambia el tipografiado de la ficha, hay
// que mover estos números. Solo afectan al des-solape —qué previsualización se
// dibuja—, nunca a qué dato se muestra.

const ANCHO_FICHA = 224;
const ALTO_LINEA = 17;
const ALTO_BASE = 46; // código + paddings
// El radio incluye el halo: `circle-stroke-width` se dibuja HACIA AFUERA del
// radio, así que un pendiente a z17 ocupa 6 + 1,6 px y no 6. Dimensionar contra
// el núcleo deja la tarjeta montada sobre el halo.
const RADIO_PUNTO = 9;
// La separación tiene que despejar además la etiqueta `+N`, que MapLibre dibuja
// con `text-offset: [0.9, -0.9]` — o sea unos 14 px por encima del centro del
// punto. Con menos, la tarjeta le pisa el número al edificio que representa.
const SEPARACION = 16;
const ESCALA_PREVIA = 0.5;
const ESCALA_PREVIA_HOVER = 0.62;

/**
 * Alto de la ficha según cuántas líneas trae (conductor, seller, intento).
 *
 * Se mide sobre el pedido MÁS LARGO del punto, no sobre el representante: con el
 * paginador la tarjeta cambia de contenido sin moverse, y si se dimensionara con
 * el primero, pasar a un pedido con una línea más la haría crecer hacia el punto
 * y taparlo. Reservar el máximo la deja quieta.
 */
function altoDe(punto: PuntoEntrega): number {
  const lineasDe = (p: PedidoEnPunto) =>
    (p.conductorNombre ? 1 : 0) + (p.sellerNombre ? 1 : 0) + (p.intentosPrevios > 0 ? 1 : 0);
  const lineas = Math.max(...punto.pedidos.map(lineasDe));
  // La fila del paginador solo existe cuando hay más de uno que paginar.
  const paginador = punto.pedidos.length > 1 ? 1 : 0;
  return ALTO_BASE + (lineas + paginador) * ALTO_LINEA;
}

/** Ancho estimado de la píldora de incidencia. Solo se usa para des-solapar. */
function anchoPildora(etiqueta: string): number {
  return Math.round(etiqueta.length * 6.6) + 24;
}

const ALTO_PILDORA = 26;

interface Caja {
  x: number;
  y: number;
  ancho: number;
  alto: number;
  /** La cola apunta hacia abajo cuando la tarjeta está arriba del punto. */
  abajo: boolean;
  /** Posición horizontal de la cola dentro de la caja, ya recortada. */
  colaX: number;
}

/**
 * Coloca una tarjeta respecto de su punto, o devuelve `null` si no cabe.
 *
 * `null` no es un caso de error: es la regla 5. Si no entra ni arriba ni abajo,
 * la tarjeta no se dibuja.
 */
function colocar(
  px: number,
  py: number,
  ancho: number,
  alto: number,
  lienzo: { ancho: number; alto: number },
): Caja | null {
  const arribaY = py - RADIO_PUNTO - SEPARACION - alto;
  const abajoY = py + RADIO_PUNTO + SEPARACION;

  let y: number;
  let abajo: boolean;
  if (arribaY >= 0) {
    y = arribaY;
    abajo = true; // la cola sale por abajo, apuntando al punto
  } else if (abajoY + alto <= lienzo.alto) {
    y = abajoY;
    abajo = false;
  } else {
    return null;
  }

  // Recorte horizontal contra la caja. La cola conserva la posición del punto,
  // así que sigue apuntándolo aunque la tarjeta se haya corrido.
  const x = Math.min(Math.max(px - ancho / 2, 0), Math.max(0, lienzo.ancho - ancho));
  const colaX = Math.min(Math.max(px - x, 12), Math.max(12, ancho - 12));

  return { x, y, ancho, alto, abajo, colaX };
}

function seSolapan(a: Caja, b: Caja): boolean {
  return (
    a.x < b.x + b.ancho && a.x + a.ancho > b.x && a.y < b.y + b.alto && a.y + a.alto > b.y
  );
}

// =============================================================================
// Presentación
// =============================================================================

/**
 * La cola que apunta al punto.
 *
 * ⚠️ **Todo en línea, ni una utilidad de Tailwind.** El triángulo se hace con
 * bordes (`border-left/right: 6px transparent` + `border-top: 7px sólido`), y
 * Tailwind 4 no genera `border-x-6` por defecto: la clase se queda sin regla, el
 * triángulo colapsa a nada y la ficha aparece **sin cola, sin ningún error**. Ya
 * pasó una vez acá.
 *
 * Dos capas para conservar el borde de 1 px de la tarjeta: la de atrás pinta el
 * borde, la de adelante el relleno, desplazada un píxel hacia dentro.
 */
function Cola({ abajo, x, color = 'var(--card)' }: { abajo: boolean; x: number; color?: string }) {
  const triangulo = (relleno: string, desplazamiento: number): React.CSSProperties => ({
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeft: '6px solid transparent',
    borderRight: '6px solid transparent',
    ...(abajo
      ? { borderTop: `7px solid ${relleno}`, top: desplazamiento }
      : { borderBottom: `7px solid ${relleno}`, bottom: desplazamiento }),
  });

  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: x - 6,
        ...(abajo ? { top: '100%' } : { bottom: '100%' }),
        width: 12,
        height: 7,
      }}
    >
      <span style={triangulo('var(--border)', 0)} />
      <span style={triangulo(color, -1)} />
    </span>
  );
}

function Tarjeta({
  punto,
  indice,
  etiquetasIncidencia,
  completa,
  onIndice,
}: {
  punto: PuntoEntrega;
  /** Qué pedido del punto se muestra. Siempre 0 en las previsualizaciones. */
  indice: number;
  etiquetasIncidencia: ReadonlyMap<string, string>;
  completa: boolean;
  onIndice?: (indice: number) => void;
}) {
  const total = punto.pedidos.length;
  const pedido = punto.pedidos[Math.min(indice, total - 1)];
  const etiquetaIncidencia = etiquetasIncidencia.get(pedido.id) ?? null;
  // El paginador solo existe en la ficha abierta y solo si hay algo que paginar.
  const paginable = completa && total > 1 && onIndice !== undefined;

  /** Circular: del último se vuelve al primero. Con 2 o 3, ir y volver cansa. */
  const mover = (paso: number) => (evento: React.MouseEvent) => {
    evento.stopPropagation();
    onIndice?.((indice + paso + total) % total);
  };

  /**
   * Qué líneas opcionales RESERVA la tarjeta mientras se pagina.
   *
   * `altoDe()` ya calculaba el máximo del punto, pero solo para COLOCAR la
   * tarjeta: nada fijaba el alto del elemento, así que el alto real seguía al
   * contenido de cada página. Medido en el fixture: 118 px en la página con
   * conductor y 101 px en las dos sin él — la tarjeta se encogía sola bajo el
   * cursor. (No era la incidencia: ésa ya dejó de ocupar línea propia.)
   *
   * Se reserva con una línea en blanco y no con un `min-height` calculado, para
   * que el alto lo fije el DOM con las métricas reales de la fuente en vez de un
   * número que hay que mantener a mano cada vez que cambia un `text-[11px]`.
   *
   * Solo aplica con paginador: sin él la tarjeta muestra un pedido y ya, y una
   * línea vacía sería un hueco sin motivo.
   */
  const reserva = {
    conductor: paginable && punto.pedidos.some((p) => p.conductorNombre !== null),
    seller: paginable && punto.pedidos.some((p) => p.sellerNombre !== null),
    intento: paginable && punto.pedidos.some((p) => p.intentosPrevios > 0),
  };

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-2.5 py-2 shadow-md">
      <div className="flex items-center gap-1.5">
        <span className="truncate font-mono text-xs font-medium">
          {pedido.codigoEnvio ?? 'Sin código'}
        </span>
        {/* Punto rojo pegado al código cuando ESTE paquete tiene incidencia
            abierta. Va acá y no en una línea propia por dos razones:
            paginando, el marcador tiene que estar junto a lo que identifica al
            paquete —el código— para que se vea cuál de los tres es el que
            falló; y un chip aparte añadía una línea, así que la tarjeta
            cambiaba de alto al pasar de página y se movía sola sobre el mapa.
            Lleva `title` porque un color nunca informa solo (regla 2). */}
        {etiquetaIncidencia ? (
          <span
            className="size-1.5 shrink-0 rounded-full bg-destructive"
            title={etiquetaIncidencia}
            aria-label={`Incidencia abierta: ${etiquetaIncidencia}`}
          />
        ) : null}
        {/* Sin paginador, el `+N` sigue diciendo cuántos más hay acá. Con
            paginador sobra: lo reemplaza el «1/3», que además dice cuál miras. */}
        {total > 1 && !paginable ? (
          <span className="shrink-0 rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
            +{total - 1}
          </span>
        ) : null}
      </div>

      {pedido.conductorNombre ? (
        <p className="truncate text-[11px] leading-tight text-muted-foreground">
          {pedido.conductorNombre}
        </p>
      ) : reserva.conductor ? (
        <p className="text-[11px] leading-tight" aria-hidden="true">
          &nbsp;
        </p>
      ) : null}
      {pedido.sellerNombre ? (
        <p className="truncate text-[11px] leading-tight text-muted-foreground">
          {pedido.sellerNombre}
        </p>
      ) : reserva.seller ? (
        <p className="text-[11px] leading-tight" aria-hidden="true">
          &nbsp;
        </p>
      ) : null}
      {/* Callada cuando no hay historial: la mayoría de los paquetes va en su
          primer intento y un contador siempre presente deja de leerse. */}
      {pedido.intentosPrevios > 0 ? (
        <p className="text-[11px] leading-tight font-medium text-warning-subtle-foreground">
          {pedido.intentosPrevios + 1}º intento
        </p>
      ) : reserva.intento ? (
        <p className="text-[11px] leading-tight" aria-hidden="true">
          &nbsp;
        </p>
      ) : null}

      {/* Paginador de los pedidos del mismo portal.
          Nace de una pregunta concreta: el mapa decía «+2» y no había forma de
          ver cuáles eran esos dos sin salir a `/operaciones`. Es una fila, dos
          flechas y un «1/3» — deliberadamente mínimo: la tarjeta va anclada a un
          punto del mapa y cada píxel que crece tapa lo que el usuario vino a
          mirar. */}
      {paginable ? (
        <div className="mt-0.5 flex items-center gap-1 border-t border-border pt-1">
          <button
            type="button"
            onClick={mover(-1)}
            aria-label="Paquete anterior de esta dirección"
            className="flex size-4 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-ring"
          >
            <ChevronLeft className="size-3" aria-hidden="true" />
          </button>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {indice + 1}/{total}
          </span>
          <button
            type="button"
            onClick={mover(1)}
            aria-label="Siguiente paquete de esta dirección"
            className="flex size-4 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-ring"
          >
            <ChevronRight className="size-3" aria-hidden="true" />
          </button>
          <span className="ml-auto text-[10px] text-muted-foreground">en esta dirección</span>
        </div>
      ) : null}

      {completa ? (
        // Al DETALLE del pedido que se está viendo, no al del representante: con
        // el paginador abierto, el enlace tiene que seguir a la página.
        <Link
          href={`/operaciones/${pedido.id}`}
          className="mt-0.5 text-[11px] font-medium text-brand hover:underline"
        >
          Ver en Operaciones
        </Link>
      ) : null}
    </div>
  );
}

// =============================================================================
// La capa
// =============================================================================

interface Colocada {
  punto: PuntoEntrega;
  caja: Caja;
  incidencia: string | null;
}

export function CapaFichas({
  mapa,
  puntos,
  activo,
  etiquetasIncidencia,
  celdaAbierta = null,
  onCerrar,
  onAbrir,
}: {
  mapa: maplibregl.Map | null;
  puntos: readonly PuntoEntrega[];
  /** Id del punto con la ficha completa abierta, o `null`. */
  activo: string | null;
  /** `pedidoId → etiqueta traducida`, para la píldora y el chip. */
  etiquetasIncidencia: ReadonlyMap<string, string>;
  /**
   * Celda de la agrupación abierta, o `null`.
   *
   * Cuando hay una, **solo se previsualizan sus pedidos**. Es la contrapartida
   * de que el mapa atenúe los puntos ajenos: dejarles su tarjeta a plena fuerza
   * mientras el punto se apaga diría dos cosas contrarias a la vez. Y es lo que
   * permite contar «4 paquetes en 2 tarjetas, una dice +2» de un vistazo.
   */
  celdaAbierta?: string | null;
  onCerrar: () => void;
  onAbrir: (id: string) => void;
}) {
  const [colocadas, setColocadas] = useState<Colocada[]>([]);
  const [encima, setEncima] = useState<string | null>(null);
  /**
   * Qué pedido del punto abierto se muestra.
   *
   * Se guarda **junto al punto al que pertenece** en vez de reiniciarse con un
   * efecto: un `setState` dentro de un efecto encadena un render, y en el
   * intermedio la tarjeta alcanza a pintarse con la página del punto anterior.
   * Abrir un portal de 1 después de haber paginado hasta el 3 de otro mostraba
   * un parpadeo en una página que no existe.
   */
  const [pagina, setPagina] = useState<{ punto: string | null; indice: number }>({
    punto: null,
    indice: 0,
  });
  const indicePagina = pagina.punto === activo ? pagina.indice : 0;
  const irAPagina = useCallback(
    (indice: number) => setPagina({ punto: activo, indice }),
    [activo],
  );
  const contenedor = useRef<HTMLDivElement>(null);

  const porId = useMemo(() => new Map(puntos.map((p) => [p.id, p])), [puntos]);

  /**
   * Recalcula QUÉ se previsualiza. Solo en `moveend`: durante el movimiento el
   * conjunto no cambia, solo su posición.
   *
   * ⚠️ **No depende del punto abierto, y es deliberado.** Antes sí: la ficha
   * completa se colocaba primero y ocupaba su caja, así que abrir una tarjeta
   * re-maquetaba TODAS las demás y la pantalla daba un salto. La regla del
   * alcance es la contraria — al abrir una, «las demás siguen como contexto»,
   * porque si se movieran se perdería justo lo que se vino a mirar. La ficha
   * abierta se dibuja aparte y encima, sin tocar este conjunto.
   */
  const recalcular = useCallback(() => {
    if (!mapa) {
      setColocadas([]);
      return;
    }
    const caja = mapa.getCanvas().getBoundingClientRect();
    const lienzo = { ancho: caja.width, alto: caja.height };

    // Orden de supervivencia: primero las incidencias —lo único accionable—, y
    // después los que más historia tienen. El criterio original era «lo más
    // quieto», que se medía con el minutaje sin cambios; con esa línea retirada,
    // los intentos previos son la señal equivalente de «éste viene arrastrando
    // algo».
    const candidatos = puntos
      .filter((p) => p.estado !== 'entregado')
      .filter((p) => celdaAbierta === null || celdaDe(p.posicion) === celdaAbierta)
      .sort((a, b) => {
        const ia = etiquetasIncidencia.has(a.id) ? 1 : 0;
        const ib = etiquetasIncidencia.has(b.id) ? 1 : 0;
        if (ia !== ib) return ib - ia;
        return (b.pedidos[0]?.intentosPrevios ?? 0) - (a.pedidos[0]?.intentosPrevios ?? 0);
      });

    const salida: Colocada[] = [];
    const ocupadas: Caja[] = [];

    for (const punto of candidatos) {
      const p = mapa.project([punto.posicion.long, punto.posicion.lat]);
      // Regla 2: estrictamente dentro del encuadre, sin margen de tolerancia.
      if (p.x < 0 || p.y < 0 || p.x > lienzo.ancho || p.y > lienzo.alto) continue;

      const incidencia = etiquetasIncidencia.get(punto.id) ?? null;
      // La incidencia va a tamaño completo; el pedido normal, a la mitad.
      const ancho = incidencia ? anchoPildora(incidencia) : ANCHO_FICHA * ESCALA_PREVIA;
      const alto = incidencia ? ALTO_PILDORA : altoDe(punto) * ESCALA_PREVIA;

      const caja = colocar(p.x, p.y, ancho, alto, lienzo);
      if (!caja) continue; // regla 5: no cabe ni arriba ni abajo → no se dibuja
      if (ocupadas.some((o) => seSolapan(caja, o))) continue;

      ocupadas.push(caja);
      salida.push({ punto, caja, incidencia });
    }

    setColocadas(salida);
  }, [mapa, puntos, etiquetasIncidencia, celdaAbierta]);

  /**
   * La ficha abierta, colocada aparte del conjunto de previsualizaciones.
   *
   * Se recalcula en cada `move` porque es UNA sola caja: no hay des-solape que
   * resolver ni lista que recorrer, así que no vale la pena diferirlo a
   * `moveend` como las previas.
   */
  const [fichaAbierta, setFichaAbierta] = useState<Colocada | null>(null);
  const colocarAbierta = useCallback(() => {
    const punto = activo ? porId.get(activo) : null;
    if (!mapa || !punto) {
      setFichaAbierta(null);
      return;
    }
    const caja = mapa.getCanvas().getBoundingClientRect();
    const p = mapa.project([punto.posicion.long, punto.posicion.lat]);
    const incidencia = etiquetasIncidencia.get(punto.id) ?? null;
    // La ficha completa suma solo el enlace: la incidencia ya no ocupa línea
    // propia —es un punto junto al código— así que el alto no cambia al pasar
    // de página. Antes sí, y la tarjeta se movía sola sobre el mapa.
    const alto = altoDe(punto) + ALTO_LINEA;
    const colocada = colocar(p.x, p.y, ANCHO_FICHA, alto, {
      ancho: caja.width,
      alto: caja.height,
    });
    setFichaAbierta(colocada ? { punto, caja: colocada, incidencia } : null);
  }, [mapa, activo, porId, etiquetasIncidencia]);

  useEffect(() => {
    if (!mapa) return;
    mapa.on('move', colocarAbierta);
    // En el frame siguiente, no en el cuerpo del efecto: `setState` síncrono acá
    // encadena renders, y además el lienzo puede no tener su tamaño final.
    const frame = requestAnimationFrame(colocarAbierta);
    return () => {
      cancelAnimationFrame(frame);
      mapa.off('move', colocarAbierta);
    };
  }, [mapa, colocarAbierta]);

  /**
   * Reposiciona lo YA montado, sin recalcular el conjunto. Corre en cada frame
   * del movimiento, así que no toca React ni lee layout: solo escribe
   * `transform` sobre los nodos.
   */
  const reposicionar = useCallback(() => {
    const raiz = contenedor.current;
    if (!mapa || !raiz) return;
    for (const nodo of raiz.querySelectorAll<HTMLElement>('[data-punto]')) {
      const id = nodo.dataset.punto;
      const punto = id ? porId.get(id) : undefined;
      if (!punto) continue;
      const p = mapa.project([punto.posicion.long, punto.posicion.lat]);
      const dx = Number(nodo.dataset.dx ?? 0);
      const dy = Number(nodo.dataset.dy ?? 0);
      nodo.style.transform = `translate3d(${Math.round(p.x + dx)}px, ${Math.round(p.y + dy)}px, 0)`;
    }
  }, [mapa, porId]);

  useEffect(() => {
    if (!mapa) return;
    mapa.on('moveend', recalcular);
    mapa.on('move', reposicionar);
    // El primer cálculo va en el siguiente frame y no en el cuerpo del efecto:
    // llamarlo de forma síncrona dispara `setState` dentro del efecto y encadena
    // renders. Y además encaja con MapLibre, cuyo ciclo entero pasa por `rAF` —
    // en el mismo tick el lienzo todavía puede no tener su tamaño final y
    // `project()` devolvería coordenadas de una caja que ya cambió.
    const frame = requestAnimationFrame(recalcular);
    return () => {
      cancelAnimationFrame(frame);
      mapa.off('moveend', recalcular);
      mapa.off('move', reposicionar);
    };
  }, [mapa, recalcular, reposicionar]);

  // `Esc` cierra la ficha abierta antes de que el mapa haga nada con la tecla.
  useEffect(() => {
    if (!activo) return;
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [activo, onCerrar]);

  return (
    <div ref={contenedor} className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* --- Previsualizaciones. Este conjunto NO se toca al abrir una ficha --- */}
      {colocadas.map(({ punto, caja, incidencia }) => {
        // El pedido abierto no se previsualiza: ya tiene su tarjeta entera. Sin
        // esto se veían las DOS del mismo pedido —la completa y su previa
        // asomando debajo—, que se lee como un error de render.
        //
        // ⚠️ Se descarta al DIBUJAR, no al calcular. Si se filtrara en
        // `recalcular`, abrir una tarjeta liberaría su caja y las vecinas se
        // re-acomodarían: es exactamente el salto que se acaba de corregir. Acá
        // el hueco se queda vacío, que es lo correcto — la tarjeta abierta lo
        // está ocupando.
        if (punto.id === activo) return null;

        const esIncidencia = incidencia !== null;
        const escala = esIncidencia
          ? 1
          : encima === punto.id
            ? ESCALA_PREVIA_HOVER
            : ESCALA_PREVIA;

        // Se guarda el desplazamiento respecto del punto para que el
        // reposicionado por frame sea una suma y no un recálculo.
        const p = mapa?.project([punto.posicion.long, punto.posicion.lat]);
        const dx = p ? caja.x - p.x : 0;
        const dy = p ? caja.y - p.y : 0;

        return (
          <div
            key={punto.id}
            data-punto={punto.id}
            data-dx={dx}
            data-dy={dy}
            className="pointer-events-auto absolute top-0 left-0"
            style={{
              transform: p
                ? `translate3d(${Math.round(caja.x)}px, ${Math.round(caja.y)}px, 0)`
                : undefined,
              width: esIncidencia ? undefined : ANCHO_FICHA,
              // La incidencia se pinta encima de las previas normales: es lo
              // único accionable y no puede competir en desventaja.
              zIndex: esIncidencia ? 2 : 1,
              // Se atenúa cuando hay una ficha abierta que no es la suya: siguen
              // como contexto, sin robarle la atención a lo que se vino a mirar.
              opacity: activo && activo !== punto.id ? 0.55 : 1,
              transition: 'opacity 120ms linear',
            }}
            onMouseEnter={() => setEncima(punto.id)}
            onMouseLeave={() => setEncima((v) => (v === punto.id ? null : v))}
          >
            <div
              style={{
                transform: escala === 1 ? undefined : `scale(${escala})`,
                transformOrigin: `${caja.colaX}px ${caja.abajo ? '100%' : '0'}`,
                opacity: esIncidencia ? 1 : encima === punto.id ? 1 : 0.72,
                transition: 'transform 120ms var(--ease-standard), opacity 120ms linear',
              }}
            >
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => onAbrir(punto.id)}
              >
                {esIncidencia ? (
                  // La incidencia asoma con su ETIQUETA, no con una tarjeta.
                  <span className="relative block w-fit rounded-full bg-destructive px-2.5 py-1 text-xs font-medium whitespace-nowrap text-white shadow-md">
                    {incidencia}
                    {/* La cola de la píldora es roja, no del color de la card:
                        si no, saldría un pico gris colgando de una etiqueta
                        roja. */}
                    <Cola abajo={caja.abajo} x={caja.colaX} color="var(--destructive)" />
                  </span>
                ) : (
                  <span className="relative block">
                    <Tarjeta
                      punto={punto}
                      indice={0}
                      etiquetasIncidencia={etiquetasIncidencia}
                      completa={false}
                    />
                    <Cola abajo={caja.abajo} x={caja.colaX} />
                  </span>
                )}
              </button>
            </div>
          </div>
        );
      })}

      {/* --- La ficha abierta, aparte y encima de todo --- */}
      {fichaAbierta ? (
        <div
          className={cn(
            'pointer-events-auto absolute top-0 left-0',
            // La entrada crece DESDE la punta de la cola: se lee como «esto sale
            // de ahí» y no como «apareció algo». 160 ms y no más — una consola se
            // mira muchas veces al día.
            'motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-[0.94] motion-safe:duration-160',
          )}
          style={{
            transform: `translate3d(${Math.round(fichaAbierta.caja.x)}px, ${Math.round(fichaAbierta.caja.y)}px, 0)`,
            width: ANCHO_FICHA,
            transformOrigin: `${fichaAbierta.caja.colaX}px ${fichaAbierta.caja.abajo ? '100%' : '0'}`,
            zIndex: 3,
          }}
        >
          {/*
            ⚠️ **Un `<div>` y no un `<button>`.** La tarjeta abierta contiene las
            dos flechas del paginador y el enlace a Operaciones, y `<button>`
            dentro de `<button>` —o un `<a>` dentro de un `<button>`— es HTML
            inválido: React avisa de error de hidratación, y para teclado y
            lector de pantalla un control anidado no tiene semántica definida.

            Cerrar con el clic se conserva como atajo de ratón. La vía accesible
            es `Esc`, que ya cierra la ficha (ver el efecto de arriba), así que no
            hace falta que este contenedor sea enfocable — y si lo fuera, volvería
            a meter un control alrededor de otros dos.
          */}
          <div className="relative block w-full text-left" onClick={onCerrar}>
            <Tarjeta
              punto={fichaAbierta.punto}
              indice={indicePagina}
              etiquetasIncidencia={etiquetasIncidencia}
              completa
              onIndice={irAPagina}
            />
            <Cola abajo={fichaAbierta.caja.abajo} x={fichaAbierta.caja.colaX} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
