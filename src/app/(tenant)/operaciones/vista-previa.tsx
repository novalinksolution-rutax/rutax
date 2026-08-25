"use client";

/**
 * La vista previa al tocar la fila.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * EL GESTO QUE RESUELVE
 * -----------------------------------------------------------------------------
 * Es el más repetido del día: el coordinador necesita **mirar un pedido sin
 * perder su filtro, su selección ni su lugar en la lista**. Hasta ahora eso
 * costaba abrir el detalle, volver, y encontrarse la lista donde la dejó — o no.
 *
 * Tocar una fila abre este panel; el detalle completo es un **segundo paso
 * explícito**, al pie.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ NO ES UN MODAL, Y ESA ES LA DECISIÓN TÉCNICA DEL ARCHIVO
 * -----------------------------------------------------------------------------
 * Un `Dialog`/`Sheet` de Radix trae velo, atrapa el foco y **bloquea los clics
 * de fuera**. Eso rompe las dos reglas del tablero de una sola vez:
 *
 * · **la lista no se va, se atenúa** — se queda al 45 % y hay que poder seguir
 *   leyendo las filas de arriba y abajo para comparar;
 * · **tocar otra fila cambia el contenido sin cerrar el panel**.
 *
 * Con un modal la segunda es imposible: el clic ni siquiera llega a la fila. Por
 * eso esto es un `aside` posicionado, sin velo y sin trampa de foco. Lo que sí
 * se conserva de un modal es lo que hace falta: `Escape` cierra, y el panel es
 * una región con nombre para lectores de pantalla.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL ESTADO VIVE EN EL `layout.tsx`
 * -----------------------------------------------------------------------------
 * Mismo motivo que el proveedor de cambios en vivo: el segmento tiene
 * `loading.tsx`, así que **cada `router.refresh()` desmonta la página**. Si el
 * panel viviera ahí, se cerraría solo cada vez que un pedido cambia de estado —
 * o sea, justo cuando el coordinador está mirando un pedido en una operación
 * activa. Es el peor momento posible para que algo desaparezca de la pantalla.
 *
 * -----------------------------------------------------------------------------
 * QUÉ NO LLEVA, Y NO ES OLVIDO
 * -----------------------------------------------------------------------------
 * **Ninguna acción de consecuencia.** Anular el cobro, anular la liquidación y
 * cancelar el pedido viven en el detalle completo, con su zona de consecuencia y
 * su tarjeta de trazabilidad. Un panel que se abre con un toque —y que se abre
 * decenas de veces al día— no es lugar para algo que no se deshace.
 *
 * Los tres accesos rápidos son **peldaño 1**: reversibles, sin consecuencia.
 * «Reasignar» es peldaño 2 y por eso NO va en ese grupo: va pegado al conductor,
 * que es el dato que modifica.
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
import { Check, Copy, Download, Map, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { cn } from "@/lib/utils";
import { formatearClp, formatearHora } from "@/lib/formato-cl";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import { BADGE_ESTADO_PEDIDO, traducirEstadoPedido } from "@/lib/ui/traduccion-estados";
import type { VistaPreviaPedido } from "@/modules/operacion/vista-previa";

import { destinoAlSoltar } from "@/lib/ui/hoja-inferior";

import { accionVistaPreviaPedido } from "./vista-previa-actions";

/**
 * Los tiempos, tal como los fija el tablero. Están acá y no repartidos por el
 * marcado porque **el desfase es la firma del movimiento**: el encabezado entra
 * 60 ms después del panel, y si alguien iguala los dos números la animación deja
 * de ser reconocible sin que nada parezca roto.
 */
const MS_ENTRADA = 240;
const MS_DESFASE_ENCABEZADO = 60;
/** Cambiar de fila cruza el contenido; no repite la entrada del panel. */
const MS_CRUCE_CONTENIDO = 120;

interface Ctx {
  pedidoId: string | null;
  abrir: (pedidoId: string) => void;
  cerrar: () => void;
}

const VistaPreviaCtx = createContext<Ctx | null>(null);

/** `null` fuera del proveedor: las filas no revientan si alguien las reusa suelta. */
export function useVistaPrevia(): Ctx | null {
  return useContext(VistaPreviaCtx);
}

export function ProveedorVistaPrevia({ children }: { children: ReactNode }) {
  const [pedidoId, setPedidoId] = useState<string | null>(null);

  const abrir = useCallback((id: string) => setPedidoId(id), []);
  const cerrar = useCallback(() => setPedidoId(null), []);

  // Escape cierra. Va en el proveedor y no en el panel para que funcione aunque
  // el foco esté en la tabla — que es donde va a estar, porque el panel no lo
  // atrapa a propósito.
  useEffect(() => {
    if (!pedidoId) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPedidoId(null);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [pedidoId]);

  const valor = useMemo(() => ({ pedidoId, abrir, cerrar }), [pedidoId, abrir, cerrar]);

  return (
    <VistaPreviaCtx.Provider value={valor}>
      {children}
      {pedidoId && <PanelVistaPrevia pedidoId={pedidoId} onCerrar={cerrar} />}
    </VistaPreviaCtx.Provider>
  );
}

/**
 * 🔴 Todo enlace que salga del panel lo CIERRA al pulsarse.
 * =============================================================================
 * El proveedor vive en `operaciones/layout.tsx`, que también envuelve al
 * detalle: navegar a `/operaciones/[id]` **no lo desmonta**, así que el panel
 * seguía flotando sobre la pantalla a la que acababas de llegar. Reportado por
 * el usuario en «Abrir el detalle completo».
 *
 * Es un componente y no un `onClick` repetido a propósito: había tres enlaces y
 * el bug estaba en uno. Con un `<Link>` suelto, el cuarto que alguien agregue
 * vuelve a olvidarlo; acá la regla viaja con el elemento.
 *
 * ⚠️ NO se resuelve cerrando por cambio de ruta. Esa versión reabre el panel al
 * pulsar «atrás» —el estado sigue vivo en el proveedor y la ruta vuelve a
 * coincidir—, o sea que deshace una salida que la persona ya hizo.
 */
function EnlaceQueCierra({
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

/**
 * Envuelve la lista y la atenúa mientras el panel está abierto.
 *
 * ⚠️ **Atenuar, no tapar.** Sin velo oscuro: el coordinador tiene que poder
 * seguir leyendo las filas de arriba y abajo para comparar, y tocar otra fila
 * tiene que cambiar el panel — con un velo encima, el clic ni llegaría.
 *
 * En claro sube a 55 %: el 45 % que funciona sobre fondo oscuro se lee como
 * «deshabilitado» sobre papel.
 */
export function ListaAtenuable({ children }: { children: ReactNode }) {
  const ctx = useVistaPrevia();
  const abierto = Boolean(ctx?.pedidoId);
  return (
    <div
      className={cn(
        "motion-safe:transition-opacity motion-safe:duration-slow",
        // ⚠️ `rx-lista-atenuada`, declarada en `rx-puente.css`, y NO
        // `opacity-55` ni `opacity-[0.55]`: **ninguna de las dos emitía regla**.
        // La clase quedaba en el nodo y la opacidad calculada seguía en 1 — sin
        // un solo error en ninguna parte. Ver el comentario largo del CSS.
        abierto && "rx-lista-atenuada",
      )}
    >
      {children}
    </div>
  );
}

// =============================================================================
// El panel
// =============================================================================

type Estado =
  | { fase: "cargando" }
  | { fase: "listo"; datos: VistaPreviaPedido }
  | { fase: "falla" };

/**
 * El contenedor. **Se monta una vez y no se vuelve a montar al cambiar de fila.**
 *
 * ⚠️ De eso depende una regla del tablero: al saltar de un pedido a otro el panel
 * **no vuelve a entrar** —sería un parpadeo lateral en cada toque— sino que solo
 * su contenido se cruza. Por eso el `key={pedidoId}` va en el hijo y nunca acá:
 * puesto en el `aside`, React lo destruiría y lo recrearía, y la animación de
 * entrada se repetiría en cada fila.
 */
function PanelVistaPrevia({ pedidoId, onCerrar }: { pedidoId: string; onCerrar: () => void }) {
  const { alTomar, estilo } = useArrastreParaCerrar(onCerrar);

  return (
    <aside
      style={estilo}
      role="region"
      aria-label="Vista previa del pedido"
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

      <ContenidoDelPedido key={pedidoId} pedidoId={pedidoId} onCerrar={onCerrar} />
    </aside>
  );
}

/**
 * El contenido de UN pedido. Se remonta con cada `pedidoId` —de ahí el `key` del
 * padre— y por eso arranca en «cargando» sin tener que escribir estado dentro de
 * un efecto.
 *
 * Cruza en 120 ms: es un cambio de contenido, no una entrada.
 */
function ContenidoDelPedido({ pedidoId, onCerrar }: { pedidoId: string; onCerrar: () => void }) {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });

  useEffect(() => {
    let vigente = true;
    void accionVistaPreviaPedido(pedidoId).then(
      (r) => {
        if (vigente) setEstado(r.ok ? { fase: "listo", datos: r.datos } : { fase: "falla" });
      },
      () => {
        if (vigente) setEstado({ fase: "falla" });
      },
    );
    // Si el coordinador salta de fila más rápido que la consulta, la respuesta
    // vieja llega después: `vigente` la descarta en vez de pintar el pedido
    // equivocado en el panel del pedido nuevo.
    return () => {
      vigente = false;
    };
  }, [pedidoId]);

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden motion-safe:animate-in motion-safe:fade-in"
      style={{ animationDuration: `${MS_CRUCE_CONTENIDO}ms` }}
    >
      {estado.fase === "cargando" && <PanelCargando onCerrar={onCerrar} />}
      {estado.fase === "falla" && <PanelFalla onCerrar={onCerrar} />}
      {estado.fase === "listo" && <PanelContenido datos={estado.datos} onCerrar={onCerrar} />}
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

function PanelFalla({ onCerrar }: { onCerrar: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <p className="font-heading text-sm font-medium">No pudimos abrir el pedido</p>
        <BotonCerrar onCerrar={onCerrar} />
      </div>
      <p className="p-5 text-sm text-fg-muted">
        No es que el pedido no exista: no lo pudimos leer. Ciérralo y vuelve a tocarlo, o abre su
        detalle completo.
      </p>
    </div>
  );
}

function PanelContenido({
  datos,
  onCerrar,
}: {
  datos: VistaPreviaPedido;
  onCerrar: () => void;
}) {
  return (
    <>
      {/* ── Encabezado ─────────────────────────────────────────────────────
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
        <div className="min-w-0">
          <p className="truncate font-heading text-base font-semibold">{datos.destinatario}</p>
          {datos.codigo && (
            <p className="rx-num mt-0.5 font-mono text-xs text-fg-muted">{datos.codigo}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <BadgeEstado
              variante={BADGE_ESTADO_PEDIDO[datos.estado]}
              texto={traducirEstadoPedido(datos.estado)}
              eje="pedido"
              valor={datos.estado}
            />
            <span className="text-xs text-fg-muted">
              {etiquetaFuentePedido(datos.fuente)}
            </span>
            {datos.fechaCompromisoHora && (
              <span className="rx-num font-mono text-[11px] text-fg-muted">
                {formatearHora(datos.fechaCompromisoHora)}
              </span>
            )}
          </div>
        </div>
        <BotonCerrar onCerrar={onCerrar} />
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <Bloque titulo="Dónde va">
          <p className="text-sm text-fg">{datos.donde.direccion}</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {datos.donde.comuna}
            {/* Los bultos solo si de verdad se escanearon en el retiro. Sin
                retiro no se dibuja la cifra: «0 bultos» diría que se contaron. */}
            {datos.donde.bultos !== null &&
              ` · ${datos.donde.bultos} ${datos.donde.bultos === 1 ? "bulto" : "bultos"}`}
          </p>
        </Bloque>

        <Bloque titulo="Quién lo lleva">
          {datos.quien ? (
            <>
              <p className="text-sm text-fg">{datos.quien.conductorNombre ?? "Conductor asignado"}</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                {datos.quien.parada
                  ? `parada ${datos.quien.parada.numero} de ${datos.quien.parada.de}`
                  : "sin secuencia de ruta"}
                {datos.quien.asignadoEn && ` · asignado ${formatearHora(datos.quien.asignadoEn)}`}
              </p>
              {/* ⚠️ «Reasignar» va ACÁ y no con los accesos rápidos: es peldaño
                  2 —cambia a quién se le paga— y pertenece a este dato. Metido
                  en el grupo de abajo se leería como un gesto reversible más. */}
              <Button asChild variant="outline" size="sm" className="mt-2">
                <EnlaceQueCierra href={`/operaciones/${datos.id}#reasignar`} onCerrar={onCerrar}>
                  Reasignar
                </EnlaceQueCierra>
              </Button>
            </>
          ) : (
            <p className="text-sm text-fg-muted">Todavía nadie. Se asigna desde Preparación.</p>
          )}
        </Bloque>

        {datos.seguimiento.length > 0 && (
          <Bloque titulo="Seguimiento">
            <ul className="space-y-1">
              {datos.seguimiento.map((h) => (
                <li key={`${h.texto}-${h.en}`} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-fg">{h.texto}</span>
                  <span className="rx-num shrink-0 font-mono text-xs text-fg-muted">
                    {formatearHora(h.en)}
                  </span>
                </li>
              ))}
            </ul>
          </Bloque>
        )}

        <Bloque titulo="Accesos rápidos">
          <AccesosRapidos datos={datos} onCerrar={onCerrar} />
        </Bloque>

        {datos.dinero && (
          <Bloque titulo="Su dinero">
            <p className="text-sm text-fg">
              {datos.dinero.sellerNombre
                ? `Cobro a ${datos.dinero.sellerNombre}`
                : "Cobro al seller"}
              {datos.dinero.montoCobroClp !== null && (
                <>
                  {" · "}
                  <span className="rx-num font-medium tabular-nums">
                    {formatearClp(datos.dinero.montoCobroClp)}
                  </span>
                </>
              )}
            </p>
            {datos.dinero.periodoId && (
              <Link
                href={`/dinero/periodos/${datos.dinero.periodoId}`}
                className="mt-1 inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg hover:underline"
              >
                Período {datos.dinero.periodoEtiqueta ?? "de cobro"} ›
              </Link>
            )}
            {/* Lo que se le paga al conductor NO se muestra acá a propósito: son
                dos plata distintas y ponerlas juntas en un panel de un vistazo
                invita a restarlas mentalmente. Vive en el detalle completo. */}
            <p className="mt-2 text-xs text-fg-subtle">
              Lo que se le paga al conductor se ve en el detalle completo.
            </p>
          </Bloque>
        )}
      </div>

      {/* ── Pie ────────────────────────────────────────────────────────────
          Siempre en el mismo sitio, en todas las pantallas que reusen este
          patrón: la salida al detalle no se busca, se sabe dónde está. */}
      <footer className="border-t border-line px-5 py-4">
        <Button asChild className="w-full">
          <EnlaceQueCierra href={`/operaciones/${datos.id}`} onCerrar={onCerrar}>
            Abrir el detalle completo
          </EnlaceQueCierra>
        </Button>
        <p className="mt-1.5 text-center text-xs text-fg-subtle">
          Las acciones que no se deshacen viven allá
        </p>
      </footer>
    </>
  );
}

/**
 * Tres accesos rápidos y ni uno más.
 *
 * Son los tres gestos que el coordinador repite todo el día y los tres son
 * **peldaño 1**: reversibles, sin consecuencia. La lista es corta a propósito —
 * en cuanto entra un cuarto, el grupo deja de leerse de un vistazo y hay que
 * empezar a buscar dentro de él.
 */
function AccesosRapidos({
  datos,
  onCerrar,
}: {
  datos: VistaPreviaPedido;
  onCerrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiarSeguimiento() {
    if (!datos.trackingToken) return;
    const url = `${window.location.origin}/tracking/${datos.trackingToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin portapapeles (contexto no seguro, permiso denegado) no se finge que
      // funcionó: el botón simplemente no confirma.
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {/* 🔴 Solo cuando la etiqueta EXISTE. Mercado Libre deja de servirla en
          cuanto el bulto sale a la calle, y el botón se mostraba igual: el
          courier hacía clic, esperaba, y recibía un error por lo que era el
          estado normal de un pedido en ruta. Es la misma regla del enlace de
          seguimiento de acá al lado — un botón que no puede cumplir es peor que
          uno que no está. */}
      {datos.etiquetaDisponible && (
        <Button asChild variant="outline" size="sm">
          <a href={`/api/operaciones/${datos.id}/etiqueta`} target="_blank" rel="noreferrer">
            <Download className="size-3.5" aria-hidden="true" />
            Etiqueta
          </a>
        </Button>
      )}

      {/* Solo cuando hay token: en Flex el seguimiento lo da Mercado Envíos y
          un botón que copia una URL vacía es peor que no tenerlo. */}
      {datos.trackingToken && (
        <Button type="button" variant="outline" size="sm" onClick={copiarSeguimiento}>
          {copiado ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          {copiado ? "Copiado" : "Copiar seguimiento"}
        </Button>
      )}

      <Button asChild variant="outline" size="sm">
        <EnlaceQueCierra href="/torre-de-control" onCerrar={onCerrar}>
          <Map className="size-3.5" aria-hidden="true" />
          Ver en la Torre
        </EnlaceQueCierra>
      </Button>
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">{titulo}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
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
 * una mano es la esquina más lejos del pulgar. Y esta pantalla se usa **de pie
 * en la bodega, con una mano**: cerrar la hoja no puede exigir recolocar el
 * aparato. El arrastre hacia abajo se hace desde donde ya está el dedo.
 *
 * -----------------------------------------------------------------------------
 * DÓNDE VIVE LA DECISIÓN
 * -----------------------------------------------------------------------------
 * El «¿esto fue un arrastre o un roce?» no se decide acá: lo decide
 * `destinoAlSoltar`, que ya existe, tiene pruebas y **mira la velocidad además
 * de la distancia** — un empujón corto y rápido cierra, un desplazamiento lento
 * de la misma distancia no—. Acá solo se mueve el nodo mientras el dedo va.
 *
 * ⚠️ El movimiento va por `transform`, no por `height`: animar el alto obliga al
 * navegador a recalcular la disposición de todo el contenido de la hoja en cada
 * fotograma, y en un teléfono eso se nota.
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
      // ⚠️ Dos detalles del contrato de `destinoAlSoltar` que cuestan una
      // depuración si se dan por supuestos:
      //
      // 1 · **`desplazamiento` es positivo hacia abajo.** Pasarlo negado hace
      //     que un tirón hacia abajo se lea como uno hacia arriba.
      // 2 · **`punto: "media"`, no `"completa"`.** Desde `completa` un tirón
      //     hacia abajo NO cierra: baja al punto intermedio, que es una
      //     protección deliberada de la hoja de dos alturas. Ésta tiene **una
      //     sola** —85 %—, así que se le pasa el punto desde el cual bajar sí
      //     significa cerrar. Con `"completa"` la hoja no se cerraba nunca y
      //     nada fallaba: simplemente se quedaba puesta.
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
