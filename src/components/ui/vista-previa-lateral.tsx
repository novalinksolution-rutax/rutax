"use client";

/**
 * `vista previa lateral` — mirar una fila sin perder el sitio.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * DE DÓNDE SALE
 * -----------------------------------------------------------------------------
 * Es la cáscara de `operaciones/vista-previa.tsx`, extraída para que Períodos,
 * Liquidaciones y Sellers no la copien tres veces. **La de Pedidos no se migró
 * en el mismo movimiento**, y el portal del seller tiene la suya: eran tres
 * copias en camino de ser cinco, así que lo que se comparte a partir de acá es
 * el chasis. Migrar las dos existentes es un cambio aparte y sin riesgo.
 *
 * Lo que la cáscara aporta —y es todo lo que se rompe si cada pantalla lo
 * reescribe— es el movimiento, el gesto de cierre y los tres estados. Lo que
 * cada pantalla pone es su contenido.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ NO ES UN MODAL, Y ESA ES LA DECISIÓN DEL ARCHIVO
 * -----------------------------------------------------------------------------
 * Un `Dialog`/`Sheet` de Radix trae velo, atrapa el foco y **bloquea los clics
 * de fuera**. Eso rompe las dos reglas de este patrón de una sola vez:
 *
 * · **la lista no se va, se atenúa** — hay que poder seguir leyendo las filas de
 *   arriba y abajo para comparar;
 * · **tocar otra fila cambia el contenido sin cerrar el panel**.
 *
 * Con un modal la segunda es imposible: el clic ni siquiera llega a la fila. Por
 * eso esto es un `aside` posicionado, sin velo y sin trampa de foco. Lo que sí
 * se conserva de un modal es lo que hace falta: `Escape` cierra, y el panel es
 * una región con nombre para lectores de pantalla.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL PROVEEDOR VA EN EL `layout.tsx`, NUNCA EN LA PÁGINA
 * -----------------------------------------------------------------------------
 * Los segmentos que usan esto tienen `loading.tsx`, así que **cada
 * `router.refresh()` desmonta la página**. Con el estado ahí adentro, el panel
 * se cerraría solo cada vez que algo cambia — o sea, justo mientras alguien lo
 * está mirando.
 *
 * ⚠️ Y el proveedor concreto de cada pantalla tiene que ser **un componente de
 * cliente propio** que traiga su lector y sus render adentro. Pasarle la función
 * `cargar` desde el `layout.tsx` de servidor tumba todo lo que el layout
 * envuelve, y ni el typecheck ni las pruebas lo notan: solo aparece al abrir la
 * pantalla.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { destinoAlSoltar } from "@/lib/ui/hoja-inferior";

/**
 * Los tiempos. Están acá y no repartidos por el marcado porque **el desfase es
 * la firma del movimiento**: el encabezado entra 60 ms después del panel, y si
 * alguien iguala los dos números la animación deja de ser reconocible sin que
 * nada parezca roto.
 */
export const MS_ENTRADA = 240;
export const MS_DESFASE_ENCABEZADO = 60;
/** Cambiar de fila cruza el contenido; no repite la entrada del panel. */
export const MS_CRUCE_CONTENIDO = 120;

interface Ctx {
  id: string | null;
  abrir: (id: string) => void;
  cerrar: () => void;
}

const VistaPreviaCtx = createContext<Ctx | null>(null);

/** `null` fuera del proveedor: las filas no revientan si alguien las reusa sueltas. */
export function useVistaPreviaLateral(): Ctx | null {
  return useContext(VistaPreviaCtx);
}

export type RespuestaVistaPrevia<D> = { ok: true; datos: D } | { ok: false };

export interface RenderVistaPrevia<D> {
  /** El lado izquierdo del encabezado. La ✕ la pone la cáscara. */
  encabezado: (datos: D) => ReactNode;
  /** El cuerpo con desplazamiento. */
  cuerpo: (datos: D, cerrar: () => void) => ReactNode;
  /** Opcional, fijo al pie: el paso al detalle completo. */
  pie?: (datos: D, cerrar: () => void) => ReactNode;
}

/**
 * El proveedor. Cada pantalla crea el suyo pasándole su lector y sus render.
 */
export function ProveedorVistaPreviaLateral<D>({
  etiqueta,
  cargar,
  render,
  tituloFalla,
  textoFalla,
  children,
}: {
  /** `aria-label` de la región. «Vista previa del período», etc. */
  etiqueta: string;
  cargar: (id: string) => Promise<RespuestaVistaPrevia<D>>;
  render: RenderVistaPrevia<D>;
  tituloFalla: string;
  textoFalla: string;
  children: ReactNode;
}) {
  const [id, setId] = useState<string | null>(null);

  const abrir = useCallback((siguiente: string) => setId(siguiente), []);
  const cerrar = useCallback(() => setId(null), []);

  // Escape cierra. Va en el proveedor y no en el panel para que funcione aunque
  // el foco esté en la tabla — que es donde va a estar, porque el panel no lo
  // atrapa a propósito.
  useEffect(() => {
    if (!id) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setId(null);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [id]);

  const valor = useMemo(() => ({ id, abrir, cerrar }), [id, abrir, cerrar]);

  return (
    <VistaPreviaCtx.Provider value={valor}>
      {children}
      {id && (
        <Panel
          id={id}
          etiqueta={etiqueta}
          cargar={cargar}
          render={render}
          tituloFalla={tituloFalla}
          textoFalla={textoFalla}
          onCerrar={cerrar}
        />
      )}
    </VistaPreviaCtx.Provider>
  );
}

/**
 * Envuelve la lista y la atenúa mientras el panel está abierto.
 *
 * ⚠️ **Atenuar, no tapar.** Sin velo oscuro: hay que poder seguir leyendo las
 * filas de arriba y abajo para comparar, y tocar otra fila tiene que cambiar el
 * panel — con un velo encima, el clic ni llegaría.
 *
 * ⚠️ `rx-lista-atenuada`, declarada en `rx-puente.css`, y NO `opacity-55` ni
 * `opacity-[0.55]`: **ninguna de las dos emite regla**. La clase se queda en el
 * nodo y la opacidad calculada sigue en 1, sin un solo error en ninguna parte.
 */
export function ListaAtenuable({ children }: { children: ReactNode }) {
  const ctx = useVistaPreviaLateral();
  const abierto = Boolean(ctx?.id);
  return (
    <div
      className={cn(
        "motion-safe:transition-opacity motion-safe:duration-slow",
        abierto && "rx-lista-atenuada",
      )}
    >
      {children}
    </div>
  );
}

/**
 * 🔴 Todo enlace que salga del panel lo CIERRA al pulsarse.
 *
 * El proveedor vive en el `layout.tsx`, que también envuelve al detalle: navegar
 * al detalle **no lo desmonta**, así que el panel seguiría flotando sobre la
 * pantalla a la que acabas de llegar.
 *
 * Es un componente y no un `onClick` repetido a propósito: con un `<Link>`
 * suelto, el próximo que alguien agregue vuelve a olvidarlo; acá la regla viaja
 * con el elemento.
 *
 * ⚠️ NO se resuelve cerrando por cambio de ruta. Esa versión reabre el panel al
 * pulsar «atrás» —el estado sigue vivo en el proveedor y la ruta vuelve a
 * coincidir—, o sea que deshace una salida que la persona ya hizo.
 */
export function EnlaceQueCierra({
  href,
  onCerrar,
  className,
  children,
}: {
  href: string;
  onCerrar: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} onClick={onCerrar} className={className}>
      {children}
    </Link>
  );
}

/** Un bloque rotulado dentro del cuerpo. */
export function BloqueVistaPrevia({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">{titulo}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

/** Una fila «rótulo · valor» dentro de un bloque. El valor a la derecha. */
export function DatoVistaPrevia({
  rotulo,
  children,
  tono,
}: {
  rotulo: string;
  children: ReactNode;
  tono?: "normal" | "atencion";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-xs text-fg-muted">{rotulo}</span>
      <span
        className={cn(
          "min-w-0 text-right text-sm",
          tono === "atencion" ? "font-medium text-attention-fg" : "text-fg",
        )}
      >
        {children}
      </span>
    </div>
  );
}

// =============================================================================
// El panel
// =============================================================================

type Fase<D> = { fase: "cargando" } | { fase: "listo"; datos: D } | { fase: "falla" };

/**
 * El contenedor. **Se monta una vez y no se vuelve a montar al cambiar de fila.**
 *
 * ⚠️ De eso depende una regla del patrón: al saltar de una fila a otra el panel
 * **no vuelve a entrar** —sería un parpadeo lateral en cada toque— sino que solo
 * su contenido se cruza. Por eso el `key={id}` va en el hijo y nunca acá: puesto
 * en el `aside`, React lo destruiría y lo recrearía, y la animación de entrada
 * se repetiría en cada fila.
 */
function Panel<D>({
  id,
  etiqueta,
  cargar,
  render,
  tituloFalla,
  textoFalla,
  onCerrar,
}: {
  id: string;
  etiqueta: string;
  cargar: (id: string) => Promise<RespuestaVistaPrevia<D>>;
  render: RenderVistaPrevia<D>;
  tituloFalla: string;
  textoFalla: string;
  onCerrar: () => void;
}) {
  const { alTomar, estilo } = useArrastreParaCerrar(onCerrar);

  return (
    <aside
      style={estilo}
      role="region"
      aria-label={etiqueta}
      className={cn(
        // Teléfono: hoja inferior al 85 % del alto, anclada abajo.
        "fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col border-t border-line bg-bg-raised shadow-2xl",
        // Desde `lg` vuelve a ser el panel lateral: 380 px en tablet, 430 en
        // escritorio, tal como los fija el tablero.
        "lg:inset-y-0 lg:right-0 lg:left-auto lg:h-auto lg:w-[380px] lg:border-t-0 lg:border-l xl:w-[430px]",
        "motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:lg:slide-in-from-right",
      )}
    >
      {/* ⚠️ **El asa solo existe en teléfono** (`lg:hidden`): es el agarre del
          arrastre, y en escritorio esto no es una hoja sino un panel lateral que
          no se arrastra. Dibujarla igual prometería un gesto que no ocurre. */}
      <div
        onPointerDown={alTomar}
        className="flex shrink-0 cursor-grab touch-none justify-center py-2.5 active:cursor-grabbing lg:hidden"
      >
        <span className="h-1 w-10 rounded-full bg-line-strong" aria-hidden="true" />
        <span className="sr-only">Arrastra hacia abajo para cerrar</span>
      </div>

      <Contenido
        key={id}
        id={id}
        cargar={cargar}
        render={render}
        tituloFalla={tituloFalla}
        textoFalla={textoFalla}
        onCerrar={onCerrar}
      />
    </aside>
  );
}

/**
 * El contenido de UNA fila. Se remonta con cada `id` —de ahí el `key` del
 * padre— y por eso arranca en «cargando» sin tener que escribir estado dentro de
 * un efecto.
 *
 * Cruza en 120 ms: es un cambio de contenido, no una entrada.
 */
function Contenido<D>({
  id,
  cargar,
  render,
  tituloFalla,
  textoFalla,
  onCerrar,
}: {
  id: string;
  cargar: (id: string) => Promise<RespuestaVistaPrevia<D>>;
  render: RenderVistaPrevia<D>;
  tituloFalla: string;
  textoFalla: string;
  onCerrar: () => void;
}) {
  const [estado, setEstado] = useState<Fase<D>>({ fase: "cargando" });

  useEffect(() => {
    let vigente = true;
    void cargar(id).then(
      (r) => {
        if (vigente) setEstado(r.ok ? { fase: "listo", datos: r.datos } : { fase: "falla" });
      },
      () => {
        if (vigente) setEstado({ fase: "falla" });
      },
    );
    // Si alguien salta de fila más rápido que la consulta, la respuesta vieja
    // llega después: `vigente` la descarta en vez de pintar la fila equivocada
    // en el panel de la fila nueva.
    return () => {
      vigente = false;
    };
    // `cargar` es estable (viene de un módulo, no de un render), y meterla en
    // las dependencias haría que un llamador descuidado dispare la consulta en
    // cada render del proveedor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden motion-safe:animate-in motion-safe:fade-in"
      style={{ animationDuration: `${MS_CRUCE_CONTENIDO}ms` }}
    >
      {estado.fase === "cargando" && <PanelCargando onCerrar={onCerrar} />}
      {estado.fase === "falla" && (
        <PanelFalla titulo={tituloFalla} texto={textoFalla} onCerrar={onCerrar} />
      )}
      {estado.fase === "listo" && (
        <>
          {/* ── Encabezado ─────────────────────────────────────────────────
              Entra 60 ms después que el panel. El desfase es lo que hace la
              entrada reconocible; igualarlo la vuelve genérica sin romper nada. */}
          <header
            className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 motion-safe:animate-in motion-safe:fade-in"
            style={{
              animationDuration: `${MS_ENTRADA}ms`,
              animationDelay: `${MS_DESFASE_ENCABEZADO}ms`,
              animationFillMode: "backwards",
            }}
          >
            <div className="min-w-0">{render.encabezado(estado.datos)}</div>
            <BotonCerrar onCerrar={onCerrar} />
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {render.cuerpo(estado.datos, onCerrar)}
          </div>

          {render.pie ? (
            <div className="shrink-0 border-t border-line px-5 py-3">
              {render.pie(estado.datos, onCerrar)}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function PanelCargando({ onCerrar }: { onCerrar: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <BotonCerrar onCerrar={onCerrar} />
      </div>
      <div className="flex-1 space-y-4 p-5">
        {[64, 44, 72].map((alto, i) => (
          <div key={i} className="animate-pulse rounded bg-muted" style={{ height: alto }} />
        ))}
      </div>
    </div>
  );
}

function PanelFalla({
  titulo,
  texto,
  onCerrar,
}: {
  titulo: string;
  texto: string;
  onCerrar: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <p className="font-heading text-sm font-medium">{titulo}</p>
        <BotonCerrar onCerrar={onCerrar} />
      </div>
      <p className="p-5 text-sm text-fg-muted">{texto}</p>
    </div>
  );
}

function BotonCerrar({ onCerrar }: { onCerrar: () => void }) {
  return (
    <button
      type="button"
      onClick={onCerrar}
      aria-label="Cerrar la vista previa"
      className="-mr-1 flex size-8 shrink-0 items-center justify-center text-fg-muted hover:text-fg"
    >
      <X className="size-4" aria-hidden="true" />
    </button>
  );
}

/**
 * Arrastrar la hoja hacia abajo para cerrarla.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NO ALCANZA CON LA ✕
 * -----------------------------------------------------------------------------
 * La ✕ vive **arriba a la derecha**, que en un teléfono de 390 px sostenido con
 * una mano es la esquina más lejos del pulgar. El arrastre hacia abajo se hace
 * desde donde ya está el dedo.
 *
 * El «¿esto fue un arrastre o un roce?» no se decide acá: lo decide
 * `destinoAlSoltar`, que ya existe, tiene pruebas y **mira la velocidad además
 * de la distancia**.
 *
 * ⚠️ El movimiento va por `transform`, no por `height`: animar el alto obliga al
 * navegador a recalcular la disposición de todo el contenido en cada fotograma.
 */
function useArrastreParaCerrar(onCerrar: () => void) {
  const [desplazamiento, setDesplazamiento] = useState(0);
  const arrastrando = useRef<{ y0: number; t0: number } | null>(null);

  const alTomar = useCallback((e: React.PointerEvent) => {
    // Solo donde la hoja ES una hoja. En escritorio el asa está oculta, pero un
    // lector de pantalla o un teclado podrían llegar igual al nodo.
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    arrastrando.current = { y0: e.clientY, t0: performance.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  useEffect(() => {
    const alMover = (e: PointerEvent) => {
      if (!arrastrando.current) return;
      // Solo hacia abajo: tirar hacia arriba no agranda la hoja —no hay un
      // segundo punto de apoyo acá— y dejar que se mueva sugeriría que sí.
      setDesplazamiento(Math.max(0, e.clientY - arrastrando.current.y0));
    };
    const alSoltar = (e: PointerEvent) => {
      const inicio = arrastrando.current;
      arrastrando.current = null;
      if (!inicio) return;
      const recorrido = e.clientY - inicio.y0;
      const ms = Math.max(performance.now() - inicio.t0, 1);
      // ⚠️ **`punto: "media"`, no `"completa"`.** Desde `completa` un tirón hacia
      // abajo NO cierra: baja al punto intermedio, que es una protección
      // deliberada de la hoja de dos alturas. Ésta tiene **una sola** —85 %—,
      // así que se le pasa el punto desde el cual bajar sí significa cerrar. Con
      // `"completa"` la hoja no se cierra nunca y nada falla: se queda puesta.
      const destino = destinoAlSoltar({
        punto: "media",
        desplazamiento: recorrido,
        velocidad: recorrido / ms,
        altoVentana: window.innerHeight,
      });
      setDesplazamiento(0);
      if (destino === "cerrar") onCerrar();
    };
    window.addEventListener("pointermove", alMover);
    window.addEventListener("pointerup", alSoltar);
    window.addEventListener("pointercancel", alSoltar);
    return () => {
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSoltar);
      window.removeEventListener("pointercancel", alSoltar);
    };
  }, [onCerrar]);

  return {
    alTomar,
    estilo: {
      animationDuration: `${MS_ENTRADA}ms`,
      ...(desplazamiento > 0
        ? { transform: `translateY(${desplazamiento}px)`, transition: "none" }
        : null),
    } as React.CSSProperties,
  };
}
