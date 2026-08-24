"use client";

/**
 * El refresco mixto: en sitio lo que ya está, en la franja lo que entraría.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ LA REGLA ES MIXTA Y NO «REFRESCA SIEMPRE» NI «NUNCA»
 * -----------------------------------------------------------------------------
 * La pantalla se refrescaba sola, y acá eso no es una virtud: **la lista se
 * reordena bajo el cursor**. El coordinador estaba leyendo la fila 12, entra un
 * pedido, y la fila 12 pasa a ser otra. Peor si iba a tocarla.
 *
 * Pero congelarlo todo tampoco sirve: un pedido que sale a ruta **mientras lo
 * miras** es exactamente lo que querías ver.
 *
 * Así que se parte en dos, según si la fila **ya está en pantalla**:
 *
 * · **A · Ya estaba** → se actualiza en su sitio, y la fila queda marcada 8 s
 *   con borde y glifo. **No se mueve de posición**.
 * · **B · No estaba** → espera afuera. La franja cuenta cuántos son y el
 *   coordinador decide cuándo incorporarlos.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ ESTO VIVE EN EL `layout.tsx`, Y ESA ES LA MITAD DEL ARREGLO
 * -----------------------------------------------------------------------------
 * Estaba dentro de `page.tsx` y ahí no podía funcionar: el segmento tiene
 * `loading.tsx`, así que **cada `router.refresh()` suspendía la página y
 * desmontaba este proveedor entero**. Se perdían los relojes de las marcas —la
 * marca duraba un fotograma en vez de 8 s, medido en el navegador— y, peor, se
 * caía el canal de Realtime, que se reunía de cero en cada cambio perdiendo lo
 * que llegara en medio. El layout sobrevive al Suspense; la página, no.
 *
 * Lo único que sigue viniendo de la página es **qué filas hay en pantalla**, con
 * `<ReportarIdsVisibles>`: eso sí depende del filtro y de la paginación.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL DATO NUEVO VIENE DEL SERVIDOR, NO DEL SOCKET
 * -----------------------------------------------------------------------------
 * «Actualizar en sitio» se resuelve con un `router.refresh()`: el servidor
 * vuelve a renderizar **con el mismo filtro y el mismo orden**, así que una fila
 * que cambió de estado se queda donde estaba. Lo único que se lee del socket es
 * **el `id`**, para saber de qué lado cae el cambio.
 *
 * Pintar la fila con los datos del socket sería más directo y está mal: esos
 * datos no vuelven a pasar por RLS al renderizar, y abriría una segunda fuente
 * de verdad para el estado de un pedido.
 *
 * (Que la fila se quede donde estaba depende además de que el servidor devuelva
 * siempre el mismo orden — ver el desempate por `id` en `listarPedidos`.)
 *
 * -----------------------------------------------------------------------------
 * EL SEGURO DE LA SELECCIÓN, QUE NO ESTÁ
 * -----------------------------------------------------------------------------
 * El tablero pide además que **con una selección activa no se aplique nada**.
 * Acá no se construyó porque **Pedidos no tiene selección**: ésa vive en la
 * bandeja de asignar. Entra el día que Pedidos tenga una acción en bloque.
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
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { FranjaCambiosPendientes } from "@/components/ui/cambios-pendientes";
import {
  PuntoEnVivo,
  useCanalEnVivo,
  type SenalRealtime,
} from "@/components/tiempo-real/indicador-en-vivo";
import type { interpretarEstadoCanal } from "@/components/tiempo-real/estado-canal";

/** Cuánto dura la marca de «esta fila acaba de cambiar». */
const MS_MARCA = 8000;

type Presentacion = ReturnType<typeof interpretarEstadoCanal>;

interface Ctx {
  /** Filas nuevas que entrarían (INSERT). */
  pendientes: number;
  /** Filas que ya existían y cambiaron fuera de la vista (UPDATE no visible). */
  cambiadosFuera: number;
  /** Ids que cambiaron en sitio hace menos de 8 s. */
  recientes: ReadonlySet<string>;
  presentacion: Presentacion;
  registrarVisibles: (ids: string[]) => void;
  incorporar: () => void;
}

const CambiosCtx = createContext<Ctx | null>(null);

function useCambios(): Ctx {
  const ctx = useContext(CambiosCtx);
  if (!ctx) throw new Error("useCambios debe usarse dentro de ProveedorCambiosEnVivo");
  return ctx;
}

const VACIO: ReadonlySet<string> = new Set();

export function ProveedorCambiosEnVivo({
  tenantId,
  children,
}: {
  tenantId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pendientes, setPendientes] = useState(0);
  const [cambiadosFuera, setCambiadosFuera] = useState(0);
  const [recientes, setRecientes] = useState<ReadonlySet<string>>(VACIO);

  // Los ids que hay ahora en la tabla: es lo que separa «ya estaba» de «nuevo».
  // Van en un ref porque el manejador de la señal corre fuera del render y
  // necesita la lista de ahora, no la del render en que se creó.
  const visibles = useRef<Set<string>>(new Set());
  const registrarVisibles = useCallback((ids: string[]) => {
    visibles.current = new Set(ids);
  }, []);

  const relojes = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const enCurso = relojes.current;
    return () => {
      enCurso.forEach(clearTimeout);
      enCurso.clear();
    };
  }, []);

  const anotar = useCallback(
    (senales: SenalRealtime[]) => {
      const enSitio: string[] = [];
      let nuevos = 0;
      let fuera = 0;

      for (const s of senales) {
        // ⚠️ Una fila que ya está en pantalla se actualiza donde está; **todo lo
        // demás espera**, incluido un UPDATE cuyo `id` no reconocemos: puede ser
        // un pedido que estaba fuera del filtro y ahora entra, y meterlo sin
        // avisar es exactamente lo que la franja viene a impedir.
        if (s.tipo === "UPDATE" && s.id && visibles.current.has(s.id)) enSitio.push(s.id);
        // ⚠️ Un INSERT y un UPDATE-fuera-de-vista NO son lo mismo, y por eso se
        // cuentan aparte: la franja dice «llegaron 6 pedidos nuevos y 2
        // cambiaron de estado». Con un solo contador habría que incorporar para
        // enterarse de cuál de los dos ocurrió.
        else if (s.tipo === "INSERT") nuevos += 1;
        else fuera += 1;
      }

      if (nuevos > 0) setPendientes((n) => n + nuevos);
      if (fuera > 0) setCambiadosFuera((n) => n + fuera);
      if (enSitio.length === 0) return;

      setRecientes((prev) => {
        const siguiente = new Set(prev);
        for (const id of enSitio) siguiente.add(id);
        return siguiente;
      });

      for (const id of enSitio) {
        clearTimeout(relojes.current.get(id));
        relojes.current.set(
          id,
          setTimeout(() => {
            relojes.current.delete(id);
            setRecientes((prev) => {
              if (!prev.has(id)) return prev;
              const siguiente = new Set(prev);
              siguiente.delete(id);
              return siguiente;
            });
          }, MS_MARCA),
        );
      }

      // El dato nuevo lo trae el servidor, con el mismo filtro y el mismo orden:
      // la fila se actualiza sin cambiar de sitio.
      router.refresh();
    },
    [router],
  );

  // 🔴 **El canal se monta ACÁ**, en el layout, no en la página. Ver la cabecera.
  const presentacion = useCanalEnVivo({ tenantId: tenantId ?? "", onSenal: anotar });

  const incorporar = useCallback(() => {
    setPendientes(0);
    setCambiadosFuera(0);
    router.refresh();
  }, [router]);

  const valor = useMemo(
    () => ({
      pendientes,
      cambiadosFuera,
      recientes,
      presentacion,
      registrarVisibles,
      incorporar,
    }),
    [pendientes, cambiadosFuera, recientes, presentacion, registrarVisibles, incorporar],
  );
  return <CambiosCtx.Provider value={valor}>{children}</CambiosCtx.Provider>;
}

/**
 * La página le dice al proveedor qué filas tiene delante.
 *
 * No pinta nada. Existe porque el proveedor vive en el layout —que no sabe de
 * filtros ni de paginación— y la lista de ids es justo lo que sí depende de
 * ellos. Mientras la página está suspendida se conserva la última reportada, que
 * es lo correcto: son las filas que el coordinador sigue teniendo delante.
 */
export function ReportarIdsVisibles({ ids }: { ids: string[] }) {
  const { registrarVisibles } = useCambios();
  const clave = ids.join(",");
  useEffect(() => {
    registrarVisibles(clave ? clave.split(",") : []);
  }, [clave, registrarVisibles]);
  return null;
}

/** El punto verde de la cabecera. Solo lee el estado del canal que vive arriba. */
export function IndicadorCambiosEnVivo() {
  const { presentacion } = useCambios();
  return <PuntoEnVivo presentacion={presentacion} />;
}

/** La franja, fija bajo los filtros. Con cero cambios no se dibuja. */
export function FranjaCambiosEnVivo() {
  const { pendientes, cambiadosFuera, incorporar } = useCambios();
  return (
    <>
      {/* La misma franja en dos formas: en 390 px la frase larga no entra, y
          recortarla dejaría media afirmación. CSS elige cuál se ve. */}
      <FranjaCambiosPendientes
        cantidad={pendientes}
        cambiados={cambiadosFuera}
        onIncorporar={incorporar}
        compacta
        className="sm:hidden"
      />
      <FranjaCambiosPendientes
        cantidad={pendientes}
        cambiados={cambiadosFuera}
        onIncorporar={incorporar}
        className="hidden sm:flex"
      />
    </>
  );
}

/**
 * La marca de «esta fila acaba de cambiar».
 *
 * Se dibuja **dentro de la primera celda** y el borde izquierdo lo pinta la celda
 * con `:has()`. Podría manipularse el `<tr>` desde JavaScript y sería peor: una
 * clase puesta a mano sobre un nodo que React controla se pierde en el siguiente
 * render, que es justo el que llega con los datos nuevos.
 *
 * ⚠️ **Con «reducir movimiento» el borde aparece sin transición**, tal como pide
 * el tablero. La marca dura lo mismo: es información —«esto cambió mientras
 * mirabas»— y no un adorno que se pueda suprimir.
 */
export function MarcaFilaActualizada({ id }: { id: string }) {
  const { recientes } = useCambios();
  if (!recientes.has(id)) return null;
  return (
    <span
      data-actualizada=""
      className="inline-flex items-center text-progress-fg"
      title="Cambió mientras mirabas"
    >
      <RefreshCw
        className="size-3.5 motion-safe:transition-opacity motion-safe:duration-base"
        aria-hidden="true"
      />
      <span className="sr-only">Esta fila cambió recién</span>
    </span>
  );
}
