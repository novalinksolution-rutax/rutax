"use client";

/**
 * La bandeja de incidencias — tabla agrupada + panel de caso (tablero B1b).
 *
 * -----------------------------------------------------------------------------
 * SE AGRUPA POR TIEMPO SIN GESTIONAR, NO POR TIPO
 * -----------------------------------------------------------------------------
 * Es *la* decisión del tablero, y no es de presentación. Al supervisor no le
 * sirve saber que hay cuatro «no estaba en casa»: le sirve saber cuál lleva
 * cinco horas sin que nadie la mire, porque **esa ya disparó un aviso** al
 * centro de avisos y al correo de los internos, y es la que el seller va a
 * reclamar. El grupo lo dice en su cabecera, para que nadie tenga que saberlo de
 * memoria.
 *
 * El umbral —4 h— ya existía en el repo; lo que no existía era usarlo para
 * ordenar la pantalla.
 *
 * -----------------------------------------------------------------------------
 * EL PANEL ES DEL CASO SELECCIONADO, NO DE UN BOTÓN POR FILA
 * -----------------------------------------------------------------------------
 * Antes cada fila traía su botón «Gestionar» y el panel era un cajón de
 * acciones. Acá la fila **se selecciona** y el panel muestra el caso completo:
 * lo que reportó el conductor, el efecto en el dinero, las transiciones válidas
 * y las dos salidas de cierre. Es el mismo patrón de P3 y del cajón de
 * conductores: listado a la izquierda, caso al costado.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BarraCajones } from "@/components/ui/barra-cajones";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { FichaFila390 } from "@/components/ui/ficha-fila-390";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckCircle2, ChevronRight } from "lucide-react";
import {
  BADGE_ESTADO_INCIDENCIA,
  UMBRAL_INCIDENCIA_SIN_GESTION_HORAS,
  esIncidenciaSinGestion,
  horasDesde,
  traducirEstadoIncidencia,
  traducirTipoIncidencia,
} from "@/lib/ui/traduccion-estados";
import type { EstadoIncidencia, Incidencia } from "@/modules/operacion/tipos";
import type { ContextoIncidencia, ConteosBandeja } from "@/modules/operacion/bandeja-incidencias";
import { PanelCaso } from "./panel-incidencia";

/** Las cinco columnas de datos; el chevrón va fuera de la grilla. */
const COLUMNAS = "grid-cols-[1.6fr_.9fr_.8fr_1fr_1fr_.7fr]";

export function Bandeja({
  incidencias,
  contexto,
  conteos,
  nombreSellerPorId,
  cajonActivo,
  puedeGestionar,
}: {
  incidencias: Incidencia[];
  contexto: Record<string, ContextoIncidencia>;
  conteos: ConteosBandeja;
  nombreSellerPorId: Record<string, string>;
  cajonActivo: EstadoIncidencia | null;
  puedeGestionar: boolean;
}) {
  const router = useRouter();
  const [seleccionadaId, setSeleccionadaId] = useState<string | null>(null);
  const [, iniciar] = useTransition();

  const seleccionada = incidencias.find((i) => i.id === seleccionadaId) ?? null;

  // El corte que ordena la pantalla. Se calcula acá y no en el servidor a
  // propósito: depende de la hora ACTUAL, y una incidencia cruza el umbral
  // mientras la pantalla está abierta.
  const sinGestionar = incidencias.filter((i) => esIncidenciaSinGestion(i.estado, i.abiertaEn));
  const recientes = incidencias.filter((i) => !esIncidenciaSinGestion(i.estado, i.abiertaEn));

  /**
   * 🐞 **«Recién abiertas» rotulaba una resuelta hace diez días.**
   *
   * Visto en producción (26-08-2026) al abrir el cajón «Resueltas»: el segundo
   * grupo no es «las recientes», es **todo lo que no está sin gestionar**, y su
   * título solo es cierto mientras la bandeja mezcla los dos. Filtrada por
   * resueltas —o por cerradas— `sinGestionar` queda vacío por construcción
   * (`esIncidenciaSinGestion` mira el estado), TODO cae en el segundo grupo, y
   * el encabezado afirma algo falso sobre cada fila.
   *
   * Los dos títulos se muestran solo cuando el corte separa algo de verdad. Con
   * un solo grupo no hay contraste que señalar: el encabezado no aporta nada y
   * puede mentir, así que la lista va sola.
   */
  const hayContraste = sinGestionar.length > 0 && recientes.length > 0;

  function irAlCajon(clave: string | null) {
    const url = new URL(window.location.href);
    if (clave) url.searchParams.set("estado", clave);
    else url.searchParams.delete("estado");
    setSeleccionadaId(null);
    iniciar(() => router.push(url.pathname + url.search));
  }

  return (
    <div className="space-y-4">
      <BarraCajones
        cajones={[
          { clave: "abierta", etiqueta: "Abiertas", conteo: conteos.abierta },
          { clave: "en_gestion", etiqueta: "En gestión", conteo: conteos.en_gestion },
          { clave: "resuelta", etiqueta: "Resueltas", conteo: conteos.resuelta },
        ]}
        // `cerrada` no pertenece al conjunto operativo: va tras el separador, en
        // tono inerte, y la barra declara que la suma no cuadra con el total.
        excluido={{ clave: "cerrada", etiqueta: "Cerradas", conteo: conteos.cerrada }}
        activo={cajonActivo}
        onSeleccionar={irAlCajon}
        // «Activas» y no «Todos»: sin cajón elegido esta pantalla muestra lo
        // que sigue VIVO, que es lo que necesita quien la abre. El rótulo
        // anterior prometía todas y no mostraba las resueltas ni las cerradas.
        etiquetaTodos="Activas"
        total={conteos.abierta + conteos.en_gestion}
      />

      {incidencias.length === 0 ? (
        // El vacío habla del CAJÓN que se está mirando. Antes decía siempre
        // «sin incidencias abiertas», así que abrir «Cerradas» y no tener
        // ninguna respondía por otra pregunta.
        <EmptyState icon={CheckCircle2} {...vacioDelCajon(cajonActivo)} />
      ) : (
        <div className="border border-line">
          <div
            className={`hidden px-3 sm:flex sm:items-center sm:gap-2 border-b border-line bg-bg-sunken text-[10px] font-medium tracking-[0.08em] text-fg-muted uppercase`}
          >
            <span className={`grid flex-1 ${COLUMNAS}`}>
              <span className="py-2 pr-3">Tipo y pedido</span>
              <span className="py-2 pr-3">Estado</span>
              <span className="py-2 pr-3">Abierta hace</span>
              <span className="py-2 pr-3">Conductor</span>
              <span className="py-2 pr-3">Seller</span>
              <span className="py-2 pr-3">Afecta</span>
            </span>
            <span className="w-4 shrink-0" />
          </div>

          {sinGestionar.length > 0 ? (
            <>
              {/* El de urgencia se mantiene aunque sea el único grupo: ahí el
                  título no describe una posición en la lista, describe que esas
                  incidencias ya dispararon un aviso. Eso es cierto siempre. */}
              <CabeceraGrupo
                titulo={`Sin gestionar · más de ${UMBRAL_INCIDENCIA_SIN_GESTION_HORAS} h`}
                conteo={sinGestionar.length}
                nota="Genera aviso al centro de avisos y al correo de los internos."
                urgente
              />
              {sinGestionar.map((i) => (
                <FilaIncidencia
                  key={i.id}
                  incidencia={i}
                  contexto={contexto[i.pedidoId]}
                  seller={nombreSellerPorId[i.sellerId] ?? i.sellerId}
                  seleccionada={i.id === seleccionadaId}
                  onSeleccionar={() => setSeleccionadaId(i.id)}
                />
              ))}
            </>
          ) : null}

          {recientes.length > 0 ? (
            <>
              {hayContraste ? (
                <CabeceraGrupo titulo="Recién abiertas" conteo={recientes.length} />
              ) : null}
              {recientes.map((i) => (
                <FilaIncidencia
                  key={i.id}
                  incidencia={i}
                  contexto={contexto[i.pedidoId]}
                  seller={nombreSellerPorId[i.sellerId] ?? i.sellerId}
                  seleccionada={i.id === seleccionadaId}
                  onSeleccionar={() => setSeleccionadaId(i.id)}
                />
              ))}
            </>
          ) : null}
        </div>
      )}

      <PanelCaso
        incidencia={seleccionada}
        contexto={seleccionada ? contexto[seleccionada.pedidoId] : undefined}
        seller={seleccionada ? (nombreSellerPorId[seleccionada.sellerId] ?? "") : ""}
        puedeGestionar={puedeGestionar}
        onCerrar={() => setSeleccionadaId(null)}
      />
    </div>
  );
}

function CabeceraGrupo({
  titulo,
  conteo,
  nota,
  urgente,
}: {
  titulo: string;
  conteo: number;
  nota?: string;
  urgente?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-3 py-2 ${
        urgente ? "bg-fault-bg text-fault-fg" : "bg-bg-sunken text-fg-muted"
      }`}
    >
      <span className="text-[10px] font-medium tracking-[0.12em] uppercase">{titulo}</span>
      <span className="rx-num text-[10px] font-semibold">{conteo}</span>
      {/* La nota explica por qué este grupo va primero. Sin ella, el supervisor
          tendría que saber de memoria que las de más de 4 h ya avisaron. */}
      {nota ? <span className="text-[11px] font-normal opacity-90">{nota}</span> : null}
    </div>
  );
}

function FilaIncidencia({
  incidencia,
  contexto,
  seller,
  seleccionada,
  onSeleccionar,
}: {
  incidencia: Incidencia;
  contexto: ContextoIncidencia | undefined;
  seller: string;
  seleccionada: boolean;
  onSeleccionar: () => void;
}) {
  const tipo = traducirTipoIncidencia(incidencia.tipo);
  const referencia = contexto?.referencia ?? incidencia.pedidoId.slice(0, 8);
  // La comuna ubica sin exponer a nadie. Nunca la dirección ni el destinatario.
  const pedido = contexto?.comuna ? `${referencia} · ${contexto.comuna}` : referencia;
  const conductor = contexto?.conductorNombre ?? "Sin asignar";
  const antiguedad = formatearAntiguedad(incidencia.abiertaEn);
  // Por `BadgeEstado` con su `eje` y su `valor`, no por `DistintivoEstado` con
  // un tono adivinado: la tabla de correcciones del sistema de diseño es por
  // `eje:valor`, y un tono escrito a mano acá se saltaría esa corrección sin que
  // nada avise.
  const distintivo = (
    <BadgeEstado
      variante={BADGE_ESTADO_INCIDENCIA[incidencia.estado]}
      eje="incidencia"
      valor={incidencia.estado}
      texto={traducirEstadoIncidencia(incidencia.estado)}
    />
  );

  return (
    <button
      type="button"
      onClick={onSeleccionar}
      className={[
        "flex w-full items-center gap-2 border-b border-line-subtle px-3 text-left last:border-b-0",
        "hover:bg-bg-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-text",
        seleccionada ? "bg-bg-sunken shadow-[inset_2px_0_0_var(--rx-accent-text)]" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-current={seleccionada ? "true" : undefined}
    >
      <FichaFila390
        className="flex-1 py-2 sm:hidden"
        estado={distintivo}
        titulo={tipo}
        detalle={`${pedido} · ${antiguedad} · ${conductor}`}
      />

      <span className={`hidden flex-1 sm:grid ${COLUMNAS} sm:items-center`}>
        <span className="min-w-0 py-2.5 pr-3">
          <span className="block truncate text-sm font-medium text-fg">{tipo}</span>
          <span className="rx-num block truncate text-xs text-fg-muted">{pedido}</span>
        </span>
        <span className="py-2.5 pr-3">{distintivo}</span>
        <span className="rx-num py-2.5 pr-3 text-sm">{antiguedad}</span>
        <span className="min-w-0 truncate py-2.5 pr-3 text-sm text-fg-muted">{conductor}</span>
        <span className="min-w-0 truncate py-2.5 pr-3 text-sm text-fg-muted">{seller}</span>
        <span className="flex gap-1 py-2.5 pr-3">
          <Bandera activa={incidencia.afectaCobro} texto="COBRO" />
          <Bandera activa={incidencia.afectaLiquidacion} texto="LIQ" />
        </span>
      </span>

      <span className="shrink-0 text-fg-subtle">
        <ChevronRight className="size-4" aria-hidden="true" />
      </span>
    </button>
  );
}

/**
 * Las banderas del dinero.
 *
 * ⚠️ Se llaman **COBRO** y **LIQ**, nunca `FACT`/`PAGO`: esas son las de la
 * excepción de conciliación, que es otro objeto. Un vocabulario por objeto.
 *
 * La apagada no desaparece: se dibuja en gris con la misma letra. Que falte una
 * bandera y que una bandera diga «no» son cosas distintas, y si la apagada no se
 * viera, las dos se leerían igual.
 */
export function Bandera({ activa, texto }: { activa: boolean; texto: string }) {
  return (
    <span
      className={`rx-num border px-1 py-px text-[10px] leading-none ${
        activa
          ? "border-attention-line bg-attention-bg text-attention-fg"
          : "border-line text-fg-subtle"
      }`}
      title={activa ? `Afecta el ${texto.toLowerCase()}` : `No afecta el ${texto.toLowerCase()}`}
    >
      {texto}
    </span>
  );
}

/** `35 min` · `4 h 20` · `3 días`. */
export function formatearAntiguedad(desde: string): string {
  const minutos = Math.max(0, Math.floor(horasDesde(desde) * 60));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas >= 48) return `${Math.floor(horas / 24)} días`;
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${String(resto).padStart(2, "0")}`;
}

/**
 * Qué dice el estado vacío según el cajón abierto.
 *
 * Un vacío que responde por otra pregunta hace dudar de si el filtro funcionó.
 */
function vacioDelCajon(cajon: EstadoIncidencia | null): {
  titulo: string;
  descripcion: string;
} {
  switch (cajon) {
    case "abierta":
      return {
        titulo: "Ninguna incidencia abierta",
        descripcion:
          "Cuando un conductor reporte un problema en una entrega, aparece acá y te llega un aviso.",
      };
    case "en_gestion":
      return {
        titulo: "Ninguna en gestión",
        descripcion: "Acá aparecen las incidencias que alguien de tu equipo ya tomó.",
      };
    case "resuelta":
      return {
        titulo: "Ninguna resuelta todavía",
        descripcion: "Las incidencias que se cierran con una solución aparecen acá.",
      };
    case "cerrada":
      return {
        titulo: "Ninguna cerrada",
        descripcion: "Acá quedan las que se archivaron sin resolver.",
      };
    default:
      return {
        titulo: "Sin incidencias activas",
        descripcion:
          "Las entregas cerraron sin problemas reportados. Cuando un conductor reporte algo, aparece acá y te llega un aviso.",
      };
  }
}
