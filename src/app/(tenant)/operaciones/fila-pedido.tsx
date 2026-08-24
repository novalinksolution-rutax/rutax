"use client";

/**
 * La fila de pedido en la tabla (escritorio y tablet).
 * =============================================================================
 *
 * Vive aparte de `page.tsx` desde que la lista se separó para transmitir: la usa
 * `seccion-lista.tsx`, y la ficha de teléfono —`ficha-pedido-movil.tsx`— es su
 * hermana para 390 px. Las dos comparten la regla de qué motivo gana, que está
 * en `motivo-fila.ts` y tiene pruebas.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ ES DE CLIENTE PORQUE TOCAR LA FILA ABRE LA VISTA PREVIA
 * -----------------------------------------------------------------------------
 * Era un componente de servidor y no podía seguir siéndolo: la regla nueva es
 * que **tocar una fila abre su vista previa** y el detalle completo es un
 * segundo paso explícito. Eso necesita un manejador de clic.
 *
 * Con él desaparece el enlace que envolvía al destinatario. Tenerlo sería peor
 * que redundante: dos destinos distintos en la misma fila —el nombre navega, el
 * resto previsualiza— y el coordinador acertaría o no según dónde cayó el dedo.
 */

import { ChevronRight, MapPinOff } from "lucide-react";

import { BadgeEstado } from "@/components/ui/badge-estado";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import { formatearFechaCivilCorta } from "@/lib/formato-cl";
import {
  BADGE_COBERTURA_ESTADO,
  BADGE_ESTADO_PEDIDO,
  BADGE_GEO_ESTADO,
  requiereRevisionGeo,
  traducirCoberturaEstado,
  traducirEstadoPedido,
  traducirGeoEstado,
} from "@/lib/ui/traduccion-estados";
import { etiquetaConductorAusente } from "@/lib/ui/etiqueta-conductor-ausente";
import type { Pedido, TipoIncidencia } from "@/modules/operacion/tipos";

import { MarcaFilaActualizada } from "./cambios-en-vivo";
import { useVistaPrevia } from "./vista-previa";
import { motivoDeFila } from "./motivo-fila";

// =============================================================================
// Fila de pedido en la tabla
// =============================================================================

export function FilaPedido({
  pedido,
  tieneAcciones,
  modoBandeja = false,
  origen = null,
  sellerNombre = null,
  conductorNombre = null,
  tipoIncidencia = null,
}: {
  pedido: Pedido;
  tieneAcciones: boolean;
  modoBandeja?: boolean;
  origen?: string | null;
  sellerNombre?: string | null;
  conductorNombre?: string | null;
  tipoIncidencia?: TipoIncidencia | null;
}) {
  const vistaPrevia = useVistaPrevia();
  const motivo = motivoDeFila(pedido, tipoIncidencia);
  // Determinar si requiere revisión para mostrar badge discreto en la lista normal
  const requiereRevision = requiereRevisionGeo(pedido.geoEstado, pedido.coberturaEstado);
  const estaPendienteGeo = pedido.geoEstado === "pendiente" && !requiereRevision;

  /**
   * ⚠️ **La fila cancelada se raya, y no es decoración.**
   *
   * Es el mismo recurso del distintivo fuera de juego aplicado a la fila
   * completa: trama diagonal de fondo y el texto apagado. **Sigue siendo
   * consultable, pero deja de competir** — un pedido cancelado en medio de la
   * lista con el mismo peso visual que uno en ruta se lee como trabajo por
   * hacer, y el coordinador lo mira dos veces cada vez que barre la pantalla.
   *
   * La trama es lo que lo distingue en monocromo y para quien no ve el color;
   * bajarle solo la opacidad no lo lograría.
   */
  const fueraDeJuego = pedido.estado === "cancelado";

  return (
    <TableRow
      // 52 px con el dedo, la densidad normal con el puntero. Va por
      // `pointer-coarse` y no por ancho: un iPad de 1024 px es táctil y un
      // portátil del mismo ancho no. Mismo criterio que la casilla de asignar.
      onClick={() => vistaPrevia?.abrir(pedido.id)}
      // La fila entera es el objetivo. `cursor-pointer` es lo único que lo
      // anuncia en escritorio; en táctil el chevrón hace ese trabajo.
      className={cn(
        "group pointer-coarse:[&>td]:h-row-touch",
        vistaPrevia && "cursor-pointer",
        // La fila abierta se marca en el borde, no con fondo: la tabla ya está
        // atenuada y un fondo teñido al 45 % no se distingue de nada.
        vistaPrevia?.pedidoId === pedido.id && "[&>td:first-child]:border-l-2 [&>td:first-child]:border-l-brand",
        fueraDeJuego && "rx-inert-row text-fg-muted",
      )}
    >
      {/* El borde de «cambió recién» lo pinta la celda cuando la marca está
          dentro. Con `:has()` no hace falta tocar el `<tr>` desde JavaScript —
          una clase puesta a mano sobre un nodo de React se pierde en el
          siguiente render, que es justo el que trae los datos nuevos. */}
      <TableCell className="flex items-center gap-2 px-4 has-[[data-actualizada]]:border-l-2 has-[[data-actualizada]]:border-l-progress-line">
        <BadgeEstado
          variante={BADGE_ESTADO_PEDIDO[pedido.estado]}
          texto={traducirEstadoPedido(pedido.estado)}
          eje="pedido"
          valor={pedido.estado}
        />
        <MarcaFilaActualizada id={pedido.id} />
      </TableCell>
      <TableCell className="px-4">
        <span className="font-medium">{pedido.destinatarioNombre}</span>
        {/* ⚠️ **Lo que se pierde al caer las columnas se recupera acá, no se
            pierde.** Seller cae en `sm`, fecha en `md` y conductor en `lg`: sin
            esto, en un teléfono el coordinador ve un nombre y una comuna, y para
            saber de qué seller es o cuándo vence tiene que abrir el pedido.
            El **código en monoespaciada** es lo que se dicta por teléfono y lo
            que se busca en un manifiesto impreso; en escritorio vive en la
            página de detalle, pero acá es la única forma de identificar la fila
            sin abrirla. */}
        <div className="flex flex-wrap items-center gap-1 mt-0.5">
          {pedido.codigoInterno && (
            <p className="rx-num font-mono text-xs text-fg-muted">{pedido.codigoInterno}</p>
          )}
          {/* El motivo desplaza a la comuna mientras su columna esté caída: si
              un pedido no se entregó, **por qué** manda sobre **dónde**. */}
          {motivo ? (
            <p className="text-xs text-muted-foreground xl:hidden">{motivo.texto}</p>
          ) : null}
          <p className={cn("text-xs text-muted-foreground", motivo && "xl:inline hidden")}>
            {pedido.destinatarioComuna}
          </p>
          {/* ⚠️ **El seller NO reaparece acá, la procedencia sí**, y la
              distinción es de uso, no de espacio: la procedencia son tres letras
              que cambian cómo se trata el pedido —un Flex se cierra en la app de
              Mercado Envíos, un same-day no—, mientras que el seller es un
              nombre largo que se usa para **filtrar**, no para barrer fila a
              fila. Los dos dibujos del tablero omiten el seller; se les hace
              caso. */}
          {/* La fuente **ya no va acá**: tiene columna propia desde que hay tres
              conviviendo. Repetirla bajo el nombre era decir dos veces lo mismo
              en la fila más apretada de la pantalla. En táctil, donde la columna
              cae, vuelve — ahí sí es la única forma de saberlo. */}
          <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground xl:hidden">
            {etiquetaFuentePedido(pedido.fuente)}
          </span>
          {/* Badge discreto de geocoding: solo cuando hay problema, no en modo bandeja (ya tiene columna) */}
          {!modoBandeja && requiereRevision && (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-destructive-subtle px-1.5 py-px text-[10px] font-medium text-destructive-subtle-foreground">
              <MapPinOff className="size-2.5" aria-hidden="true" />
              Por revisar
            </span>
          )}
          {/* Indicador sutil de geocoding en curso */}
          {!modoBandeja && estaPendienteGeo && (
            <span className="text-[10px] text-muted-foreground/70 italic">Ubicando…</span>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden px-4 text-muted-foreground xl:table-cell">
        {sellerNombre ?? pedido.sellerId}
      </TableCell>
      <TableCell className="rx-num hidden px-4 text-right font-mono text-fg-muted xl:table-cell">
        {/* `24-08`, no `2026-08-24`: son cincuenta filas de la misma semana y el
            año no distingue ninguna.

            ⚠️ Y **`formatearFechaCivilCorta`, no `formatearFechaCorta`**:
            `fecha_compromiso` es una columna `date`, así que `new Date` la lee
            como medianoche UTC y en Santiago retrocede un día. La columna decía
            `23-08` con los pedidos de hoy, 24 — se ve razonable y por eso nadie
            lo mira dos veces. */}
        {pedido.fechaCompromiso ? formatearFechaCivilCorta(pedido.fechaCompromiso) : "Sin fecha"}
      </TableCell>
      <TableCell className="hidden px-4 xl:table-cell">
        {/* ⚠️ Texto normal, **no monoespaciada en versalitas**: ese tratamiento
            era para un código de tres letras (`SD`), y aplicado a «Mercado
            Libre Flex» lo vuelve un cartel que compite con el destinatario. Un
            nombre propio se escribe como un nombre propio. */}
        <span className="text-xs text-fg-muted">
          {etiquetaFuentePedido(pedido.fuente)}
        </span>
        {/* La cuenta de ML solo si el seller tiene más de una conectada: con una
            sola, repetir su nombre en cada fila no informa de nada. */}
        {origen ? <span className="block text-xs text-fg-subtle">{origen}</span> : null}
      </TableCell>
      <TableCell className="hidden px-4 xl:table-cell">
        <CeldaMotivo pedido={pedido} tipoIncidencia={tipoIncidencia} />
      </TableCell>
      <TableCell className="hidden px-4 text-muted-foreground md:table-cell">
        {pedido.driverIdAsignado ? (
          (conductorNombre ?? pedido.driverIdAsignado)
        ) : (
          <CeldaSinConductor pedido={pedido} />
        )}
      </TableCell>
      {tieneAcciones && (
        <TableCell className="px-4 text-right">
          {/* Un chevrón, no «Ver detalle». La fila entera ya es un enlace al
              pedido —el nombre del destinatario lo es— así que el texto repetía
              cincuenta veces una instrucción que nadie necesita leer dos veces.
              El glifo dice «acá se entra» y devuelve el ancho a las columnas que
              sí llevan dato. El nombre accesible se conserva entero: para un
              lector de pantalla «›» no significa nada. */}
          {/* El chevrón abre la MISMA vista previa que la fila: es su
              afordancia, no un segundo destino. El detalle completo se alcanza
              desde el pie del panel. */}
          <button
            type="button"
            aria-label={`Ver ${pedido.destinatarioNombre}`}
            className="inline-flex size-7 items-center justify-center text-fg-muted hover:text-fg"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </TableCell>
      )}
    </TableRow>
  );
}

/**
 * Columna CONDUCTOR de un pedido sin conductor asignado. El texto y el tono los
 * decide `etiquetaConductorAusente`, que vive aparte y con pruebas: acá solo
 * queda pintarlo.
 */
function CeldaSinConductor({ pedido }: { pedido: Pedido }) {
  const { texto, tono, detalle } = etiquetaConductorAusente(pedido.estado);

  return (
    <span
      className={tono === "pendiente" ? "text-warning-subtle-foreground" : "text-muted-foreground"}
      {...(detalle ? { title: detalle } : {})}
    >
      {texto}
    </span>
  );
}

// =============================================================================
// Badges de motivo de revisión para la bandeja
// =============================================================================

/**
 * La celda MOTIVO: **por qué este pedido está como está**.
 *
 * Antes eran solo los distintivos de geocodificación, y por eso las dos filas
 * que el tablero dibuja con motivo —«Nadie recibió» y «Seller canceló»— salían
 * vacías. La regla de qué gana vive en `motivoDeFila`, con pruebas; acá solo se
 * pinta, y el tono lo decide de dónde vino:
 *
 * · **cancelación** → fuera de juego. El pedido ya no se va a entregar.
 * · **incidencia** → atención. Hay algo que alguien tiene que resolver hoy.
 * · **dirección** → los distintivos de siempre, que llevan su propio eje.
 */
function CeldaMotivo({
  pedido,
  tipoIncidencia,
}: {
  pedido: Pedido;
  tipoIncidencia?: TipoIncidencia | null;
}) {
  const motivo = motivoDeFila(pedido, tipoIncidencia);
  if (!motivo) return <span className="text-xs text-muted-foreground">—</span>;

  // Los problemas de dirección conservan sus distintivos: llevan eje propio y se
  // filtran desde la bandeja «por revisar».
  if (motivo.origen === "geo" || motivo.origen === "cobertura") {
    return <BadgesMotivoGeo pedido={pedido} />;
  }

  return (
    <span
      className={cn(
        "text-xs",
        motivo.origen === "cancelacion" ? "text-fg-subtle" : "text-attention-fg",
      )}
      title={motivo.texto}
    >
      {motivo.texto}
    </span>
  );
}

function BadgesMotivoGeo({ pedido }: { pedido: Pedido }) {
  const tieneGeoProblema =
    pedido.geoEstado === "no_resuelto" || pedido.geoEstado === "fuera_cobertura";
  const tieneCoberturaProblema =
    pedido.coberturaEstado === "sin_tarifa_zona" ||
    pedido.coberturaEstado === "requiere_revision";

  if (!tieneGeoProblema && !tieneCoberturaProblema) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {tieneGeoProblema && (
        <BadgeEstado
          variante={BADGE_GEO_ESTADO[pedido.geoEstado]}
          texto={traducirGeoEstado(pedido.geoEstado)}
          eje="geo"
          valor={pedido.geoEstado}
        />
      )}
      {tieneCoberturaProblema && (
        <BadgeEstado
          variante={BADGE_COBERTURA_ESTADO[pedido.coberturaEstado]}
          texto={traducirCoberturaEstado(pedido.coberturaEstado)}
          eje="cobertura"
          valor={pedido.coberturaEstado}
        />
      )}
    </div>
  );
}
