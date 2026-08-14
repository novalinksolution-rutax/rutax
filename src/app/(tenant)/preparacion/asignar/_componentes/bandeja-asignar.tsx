"use client";

/**
 * BandejaAsignar — el orquestador de `/preparacion/asignar` (Etapa 6).
 * Dueño de TODO el estado interactivo: la selección (`Map`), el conductor
 * elegido, los diálogos, el panel lateral y el aviso de tiempo real. El
 * resto de componentes de `_componentes/` son hojas de presentación
 * controladas desde acá.
 *
 * Server Component + `searchParams` (§2.1): los filtros navegan por URL —
 * `page.tsx` vuelve a leer y filtrar en el servidor, y esta pantalla recibe
 * los datos ya filtrados como props en cada re-render. La selección
 * SOBREVIVE a esos re-renders porque vive en el estado de ESTE componente,
 * que React preserva mientras su posición en el árbol no cambie — es lo que
 * hace posible la promesa de §6.2 ("un pedido seleccionado bajo otro filtro
 * se sigue viendo, en otro lado, pero se ve").
 *
 * `../actions.ts` (`actionAsignarPedidosEnBloque`) lo construyó `backend` en
 * paralelo a este trabajo — no es archivo de esta etapa de frontend. Firma
 * real, confirmada: `(conductorId: string, pedidoIds: string[]) =>
 * Promise<{ok:true, datos:ResultadoAsignacionEnBloque} | {ok:false,
 * mensaje:string}>`. `fecha` no viaja como parámetro: la Server Action la
 * calcula del lado del servidor con `fechaLocalEnSantiago`, igual que la
 * función SQL — nunca se confía en el reloj del navegador.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Boxes, SearchX } from "lucide-react";
import { toast } from "sonner";
import type { EstadoAsignable, PedidoAsignable } from "@/modules/operacion/asignacion";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { IndicadorEnVivo } from "@/components/tiempo-real/indicador-en-vivo";
import { actionAsignarPedidosEnBloque } from "../actions";
import { actionResolverSeleccionCompleta } from "../seleccion-completa";
import {
  agruparAdvertenciaReasignacion,
  fotoDeSeleccion,
  type PedidoSeleccionado,
} from "../_lib/seleccion";
import { clasificarResultado, idsQueSiguenSeleccionados, type ResultadoAsignacionEnBloque } from "../_lib/resultado";
import { textoCabecera, textoExitoSinOmisiones, textoSubLineaVeniaDeOtro } from "../_lib/textos";
import { FiltrosBandeja, type SellerOpcion } from "./filtros-bandeja";
import type { ComunaOpcion } from "./selector-comuna";
import { AvisoNovedades } from "./aviso-novedades";
import { AvisoTruncamiento } from "./aviso-truncamiento";
import { TablaPedidos } from "./tabla-pedidos";
import { BarraSeleccion, type ConductorOpcion } from "./barra-seleccion";
import { PanelSeleccion } from "./panel-seleccion";
import { DialogoReasignacion } from "./dialogo-reasignacion";
import { DialogoResultado } from "./dialogo-resultado";

export interface BandejaAsignarProps {
  tenantId: string;
  totalRetiradosHoy: number;
  totalSinAsignar: number;
  pedidos: PedidoAsignable[];
  totalFiltro: number;
  pagina: number;
  porPagina: number;
  origenPorPedido: Record<string, string | null>;
  comunasCatalogo: ComunaOpcion[];
  comunasSeleccionadas: string[];
  sellers: SellerOpcion[];
  sellerId: string | null;
  texto: string;
  estado: EstadoAsignable | null;
  hayFiltros: boolean;
  conductores: ConductorOpcion[];
  conductorInicialId: string | null;
}

export function BandejaAsignar({
  tenantId,
  totalRetiradosHoy,
  totalSinAsignar,
  pedidos,
  totalFiltro,
  pagina,
  porPagina,
  origenPorPedido,
  comunasCatalogo,
  comunasSeleccionadas,
  sellers,
  sellerId,
  texto,
  estado,
  hayFiltros,
  conductores,
  conductorInicialId,
}: BandejaAsignarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [seleccion, setSeleccion] = useState<Map<string, PedidoSeleccionado>>(new Map());
  const [conductorElegidoId, setConductorElegidoId] = useState<string | null>(conductorInicialId);
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [dialogoReasignacionAbierto, setDialogoReasignacionAbierto] = useState(false);
  const [resultado, setResultado] = useState<ResultadoAsignacionEnBloque | null>(null);
  const [fotosDelUltimoEnvio, setFotosDelUltimoEnvio] = useState<Map<string, PedidoSeleccionado>>(new Map());
  const [hayNovedades, setHayNovedades] = useState(false);
  const [idsCompletosDelFiltro, setIdsCompletosDelFiltro] = useState<string[] | null>(null);
  const [cargandoSeleccionCompleta, setCargandoSeleccionCompleta] = useState(false);
  const [pending, startTransition] = useTransition();

  // Cualquier navegación (cambio de filtro, de página, o el propio botón
  // "Actualizar") trae props nuevas del servidor: el aviso de novedades y la
  // caché de "seleccionar todos" dejan de tener sentido con datos viejos.
  //
  // Ajuste de estado DURANTE EL RENDER (no en un `useEffect`): mismo patrón
  // que `DialogConfirmacionDinero` (`src/components/ui/dialog-confirmacion-dinero.tsx`)
  // — comparar contra un espejo del valor anterior y corregir en la misma
  // pasada evita el "cascading render" de llamar `setState` sincrónicamente
  // dentro de un efecto (`react-hooks/set-state-in-effect`).
  const claveUrl = searchParams.toString();
  const [claveUrlPrevia, setClaveUrlPrevia] = useState(claveUrl);
  if (claveUrl !== claveUrlPrevia) {
    setClaveUrlPrevia(claveUrl);
    setHayNovedades(false);
    setIdsCompletosDelFiltro(null);
  }

  const idsVisibles = new Set(pedidos.map((p) => p.pedidoId));
  const totalPaginas = Math.max(1, Math.ceil(totalFiltro / porPagina));
  const conductorElegido = conductores.find((c) => c.id === conductorElegidoId) ?? null;

  function hrefPagina(p: number): string {
    const params = new URLSearchParams();
    for (const comuna of comunasSeleccionadas) params.append("comuna", comuna);
    if (sellerId) params.set("seller", sellerId);
    if (texto) params.set("q", texto);
    if (estado) params.set("estado", estado);
    if (p > 1) params.set("pagina", String(p));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  // ---------------------------------------------------------------------------
  // Selección — SIEMPRE contra el Map, nunca contra la lista visible (§6.2)
  // ---------------------------------------------------------------------------

  function alternarUno(pedido: PedidoAsignable) {
    setSeleccion((prev) => {
      const next = new Map(prev);
      if (next.has(pedido.pedidoId)) next.delete(pedido.pedidoId);
      else next.set(pedido.pedidoId, fotoDeSeleccion(pedido));
      return next;
    });
  }

  function alternarPagina(marcar: boolean) {
    setSeleccion((prev) => {
      const next = new Map(prev);
      for (const pedido of pedidos) {
        if (marcar) next.set(pedido.pedidoId, fotoDeSeleccion(pedido));
        else next.delete(pedido.pedidoId);
      }
      return next;
    });
  }

  function quitarUno(pedidoId: string) {
    setSeleccion((prev) => {
      const next = new Map(prev);
      next.delete(pedidoId);
      return next;
    });
  }

  function vaciarSeleccion() {
    setSeleccion(new Map());
  }

  const todosDelFiltroSeleccionados =
    idsCompletosDelFiltro !== null && idsCompletosDelFiltro.every((id) => seleccion.has(id));

  async function seleccionarTodosDelFiltro() {
    setCargandoSeleccionCompleta(true);
    try {
      const respuesta = await actionResolverSeleccionCompleta({
        comunas: comunasSeleccionadas.length > 0 ? comunasSeleccionadas : undefined,
        sellerId,
        texto: texto || null,
        estado,
      });
      if (!respuesta.ok) {
        toast.error("No pudimos seleccionar todos los pedidos de este filtro", {
          description: respuesta.mensaje,
        });
        return;
      }
      setIdsCompletosDelFiltro(respuesta.pedidos.map((p) => p.pedidoId));
      setSeleccion((prev) => {
        const next = new Map(prev);
        for (const pedido of respuesta.pedidos) next.set(pedido.pedidoId, fotoDeSeleccion(pedido));
        return next;
      });
    } finally {
      setCargandoSeleccionCompleta(false);
    }
  }

  function deseleccionarTodosDelFiltro() {
    if (!idsCompletosDelFiltro) return;
    setSeleccion((prev) => {
      const next = new Map(prev);
      for (const id of idsCompletosDelFiltro) next.delete(id);
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Envío — §7
  // ---------------------------------------------------------------------------

  function alHacerClicAsignar() {
    if (!conductorElegidoId || seleccion.size === 0 || pending) return;
    const grupos = agruparAdvertenciaReasignacion(seleccion, conductorElegidoId);
    if (grupos.length > 0) {
      setDialogoReasignacionAbierto(true);
      return;
    }
    ejecutarAsignacion();
  }

  function ejecutarAsignacion() {
    if (!conductorElegidoId) return;
    const idConductor = conductorElegidoId;
    const nombreConductor = conductores.find((c) => c.id === idConductor)?.nombre ?? "el conductor";
    // Foto ANTES de mutar el estado: `clasificarResultado` y el diálogo de
    // resultado necesitan la selección tal como estaba AL ENVIAR, no la que
    // quede después de depurarla (§7.5).
    const fotosAlEnviar = new Map(seleccion);
    const idsAEnviar = [...fotosAlEnviar.keys()];

    startTransition(async () => {
      const respuesta = await actionAsignarPedidosEnBloque(idConductor, idsAEnviar);
      setDialogoReasignacionAbierto(false);

      if (!respuesta.ok) {
        toast.error("No se pudieron asignar los pedidos", { description: respuesta.mensaje });
        return;
      }

      const clasificado = clasificarResultado(respuesta.datos, fotosAlEnviar);
      const idsQueQuedan = idsQueSiguenSeleccionados(respuesta.datos);
      setSeleccion(() => {
        const next = new Map<string, PedidoSeleccionado>();
        for (const id of idsQueQuedan) {
          const foto = fotosAlEnviar.get(id);
          if (foto) next.set(id, foto);
        }
        return next;
      });

      if (!clasificado.huboOmisiones) {
        toast.success(textoExitoSinOmisiones(clasificado.totalQuedaronCon, nombreConductor), {
          description:
            clasificado.totalReasignadosDesdeOtro > 0
              ? textoSubLineaVeniaDeOtro(clasificado.totalReasignadosDesdeOtro)
              : undefined,
        });
      } else {
        setFotosDelUltimoEnvio(fotosAlEnviar);
        setResultado(respuesta.datos);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Asignar pedidos</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Solo se muestran pedidos ya retirados en bodega. Lo que todavía no se escaneó no aparece
            acá.
          </p>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">
            {textoCabecera(totalRetiradosHoy, totalSinAsignar)}
          </p>
        </div>
        <IndicadorEnVivo
          tenantId={tenantId}
          tablas={[
            { schema: "operacion", tabla: "sesiones_retiro" },
            { schema: "operacion", tabla: "bultos_retiro" },
            { schema: "operacion", tabla: "pedidos" },
          ]}
          onSenal={() => setHayNovedades(true)}
        />
      </div>

      {totalRetiradosHoy === 0 ? (
        <EmptyState
          icon={Boxes}
          tono="arranque"
          titulo="Todavía no hay pedidos para asignar"
          descripcion="Los conductores están retirando en bodega. En cuanto cierren una visita, sus pedidos van a aparecer acá."
          accion={
            <Button asChild variant="outline" size="sm">
              <Link href="/preparacion">Volver a Preparación del día</Link>
            </Button>
          }
        />
      ) : (
        <>
          <FiltrosBandeja
            comunasCatalogo={comunasCatalogo}
            sellers={sellers}
            comunasSeleccionadas={comunasSeleccionadas}
            sellerId={sellerId}
            texto={texto}
            estado={estado}
            hayFiltros={hayFiltros}
          />

          {hayNovedades && <AvisoNovedades onActualizar={() => router.refresh()} />}

          {pedidos.length === 0 ? (
            <EmptyState
              icon={SearchX}
              tono="filtro"
              titulo="Ningún pedido retirado coincide con estos filtros"
              descripcion="Prueba ampliando la comuna, el seller o el texto de búsqueda."
              accion={
                <Button asChild variant="outline" size="sm">
                  <Link href={pathname}>Limpiar filtros</Link>
                </Button>
              }
            />
          ) : (
            <>
              {totalFiltro > porPagina && (
                <AvisoTruncamiento
                  mostrados={pedidos.length}
                  total={totalFiltro}
                  seleccionCompleta={todosDelFiltroSeleccionados}
                  cargando={cargandoSeleccionCompleta}
                  onSeleccionarTodo={seleccionarTodosDelFiltro}
                  onDeseleccionarTodo={deseleccionarTodosDelFiltro}
                />
              )}

              <TablaPedidos
                pedidos={pedidos}
                origenPorPedido={origenPorPedido}
                seleccion={seleccion}
                onAlternarUno={alternarUno}
                onAlternarPagina={alternarPagina}
                footer={
                  totalPaginas > 1 ? (
                    <Pagination pagina={pagina} totalPaginas={totalPaginas} hrefPagina={hrefPagina} />
                  ) : undefined
                }
              />
            </>
          )}
        </>
      )}

      {seleccion.size > 0 && (
        <BarraSeleccion
          seleccion={seleccion}
          idsVisibles={idsVisibles}
          conductores={conductores}
          conductorElegidoId={conductorElegidoId}
          onCambiarConductor={setConductorElegidoId}
          onVerSeleccion={() => setPanelAbierto(true)}
          onVaciarSeleccion={vaciarSeleccion}
          onAsignar={alHacerClicAsignar}
          pending={pending}
        />
      )}

      <PanelSeleccion
        abierto={panelAbierto}
        onOpenChange={setPanelAbierto}
        seleccion={seleccion}
        idsVisibles={idsVisibles}
        onQuitar={quitarUno}
        onVaciarTodo={() => {
          vaciarSeleccion();
          setPanelAbierto(false);
        }}
      />

      <DialogoReasignacion
        abierto={dialogoReasignacionAbierto}
        onOpenChange={setDialogoReasignacionAbierto}
        grupos={conductorElegidoId ? agruparAdvertenciaReasignacion(seleccion, conductorElegidoId) : []}
        conductorElegidoNombre={conductorElegido?.nombre ?? "el conductor elegido"}
        onConfirmar={ejecutarAsignacion}
        pending={pending}
      />

      <DialogoResultado
        resultado={resultado}
        fotos={fotosDelUltimoEnvio}
        conductorNombre={conductorElegido?.nombre ?? "el conductor"}
        onClose={() => setResultado(null)}
      />
    </div>
  );
}
