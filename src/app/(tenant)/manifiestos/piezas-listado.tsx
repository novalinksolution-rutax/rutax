"use client";

/**
 * Las dos piezas de cliente del listado de manifiestos.
 *
 * La página es un Server Component y el filtro viaja por la URL, así que lo
 * único que necesita cliente es el manejador del clic. Se aísla acá en vez de
 * convertir la página entera en cliente: el resto se sigue renderizando en el
 * servidor y no viaja al navegador.
 */

import type { ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { BarraCajones, type Cajon } from "@/components/ui/barra-cajones";
import { TableRow } from "@/components/ui/table";
import { hrefConRetorno } from "@/components/app-shell/retorno";
import type { EstadoManifiesto } from "@/modules/operacion/tipos";
import {
  avanceEnFalla,
  type AvanceManifiesto,
  type RedistribucionManifiesto,
} from "@/modules/operacion/listado-manifiestos";

export function CajonesManifiestos({
  cajones,
  excluido,
  activo,
  total,
}: {
  cajones: Cajon[];
  excluido: Cajon;
  activo: string | null;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <BarraCajones
      cajones={cajones}
      excluido={excluido}
      activo={activo}
      total={total}
      onSeleccionar={(clave) => {
        // Se conserva el resto de la URL: el cajón elige el estado y no puede
        // llevarse por delante el filtro de fecha que alguien acaba de poner.
        const siguiente = new URLSearchParams(params.toString());
        if (clave) siguiente.set("estado", clave);
        else siguiente.delete("estado");
        const qs = siguiente.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname);
      }}
    />
  );
}

/**
 * La celda de avance, que dice tres cosas distintas según el estado de la fila.
 *
 * -----------------------------------------------------------------------------
 * BORRADOR: QUÉ VE EL CONDUCTOR
 * -----------------------------------------------------------------------------
 * Una ruta en borrador no tiene avance que mostrar, y la celda quedaba vacía. Se
 * usa para responder la pregunta que hoy llega por teléfono a las 15:50: **qué
 * le aparece al conductor mientras su ruta no está confirmada**. Sin esto, el
 * coordinador no tiene forma de saberlo desde ninguna pantalla.
 *
 * -----------------------------------------------------------------------------
 * COMPLETADO: SI QUEDÓ ALGO ABIERTO, ESO ES LO QUE HAY QUE DECIR
 * -----------------------------------------------------------------------------
 * Una ruta cerrada no está «atrasada»: está cerrada. Pintarla de rojo porque su
 * porcentaje es bajo dice «este conductor no va a llegar» de alguien que terminó
 * hace dos horas — y era lo que pasaba. Lo que sí importa de una ruta cerrada es
 * si el conductor la terminó o si el coordinador la cerró a la fuerza, y eso se
 * lee en las paradas que quedaron sin cerrar. Va en ámbar, no en rojo.
 *
 * -----------------------------------------------------------------------------
 * CANCELADO: DÓNDE QUEDARON SUS PARADAS
 * -----------------------------------------------------------------------------
 * Lo que uno quiere saber al ver un manifiesto cancelado no es que está
 * cancelado —eso ya lo dice el distintivo— sino si sus paradas quedaron con
 * alguien. Las huérfanas van en tono de atención: son bultos que nadie va a
 * llevar y que no aparecen en la ruta de nadie.
 */
export function CeldaAvance({
  estado,
  avance,
  redistribucion,
  horaActual,
}: {
  estado: EstadoManifiesto;
  avance: AvanceManifiesto | null;
  redistribucion: RedistribucionManifiesto | null;
  horaActual: number;
}) {
  if (estado === "borrador") {
    return (
      <span className="text-xs leading-snug text-muted-foreground">
        Sin confirmar. El conductor ve «tu ruta todavía no está lista».
      </span>
    );
  }

  if (estado === "cancelado") {
    if (!redistribucion || redistribucion.paradas === 0) {
      return <span className="text-xs text-muted-foreground">Sin paradas que redistribuir.</span>;
    }
    return (
      <span className="text-xs leading-snug text-muted-foreground">
        Redistribuido · {redistribucion.paradas}{" "}
        {redistribucion.paradas === 1 ? "parada" : "paradas"} a {redistribucion.conductores}{" "}
        {redistribucion.conductores === 1 ? "conductor" : "conductores"}
        {redistribucion.huerfanas > 0 ? (
          <span className="block text-attention-fg">
            {redistribucion.huerfanas}{" "}
            {redistribucion.huerfanas === 1 ? "quedó" : "quedaron"} sin conductor
          </span>
        ) : null}
      </span>
    );
  }

  if (!avance || avance.porcentaje === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const enFalla = avanceEnFalla(avance.porcentaje, horaActual, estado);
  const abiertas = avance.paradas - avance.cerradas;

  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <span
          className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted"
          aria-hidden="true"
        >
          <span
            className={`block h-full rounded-full ${enFalla ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${avance.porcentaje}%` }}
          />
        </span>
        {/* El porcentaje escrito, y el conteo al lado: la barra sola no se
            compara entre dos filas de un vistazo, y el color no puede ser el
            único canal. */}
        <span
          className={`text-xs tabular-nums ${enFalla ? "text-destructive" : "text-muted-foreground"}`}
        >
          {avance.porcentaje}%
          <span className="ms-1">
            ({avance.cerradas}/{avance.paradas})
          </span>
        </span>
      </span>

      {/* Una ruta cerrada con paradas abiertas: el dato que distingue «terminó»
          de «lo cerraron». Es lo mismo que `completarManifiesto` deja escrito en
          la bitácora como `paradas_abiertas`, dicho donde se mira. */}
      {estado === "completado" && abiertas > 0 ? (
        <span className="text-[11px] leading-snug text-attention-fg">
          {abiertas} sin cerrar al terminar la ruta
        </span>
      ) : null}

      {/* Por qué esta cifra puede ir por delante de la de Pedidos. En Flex el
          estado oficial lo escribe Mercado Libre y llega con la sincronización;
          el conductor ya cerró la parada en la app. Decirlo evita que se lea
          como un descuadre. */}
      {avance.cerradasSoloEnApp > 0 ? (
        <span className="text-[11px] leading-snug text-fg-subtle">
          {avance.cerradasSoloEnApp} según el conductor, sin confirmar aún
        </span>
      ) : null}
    </span>
  );
}


/**
 * La fila del manifiesto, entera pulsable.
 * =============================================================================
 *
 * Hasta ahora solo el nombre del conductor navegaba, con un chevrón al final que
 * **prometía que la fila entraba**. El objetivo real medía el ancho de un nombre
 * en una fila de mil píxeles, y en la tablet de la bodega —que es donde se mira
 * esta pantalla— eso es fallar el toque una y otra vez.
 *
 * ⚠️ **El enlace del conductor NO se retira**, aunque ahora sea redundante con
 * el clic. Es lo único que da acceso por teclado, clic medio y «abrir en pestaña
 * nueva»: la fila con `onClick` es un `<tr>`, no un ancla, y nada de eso
 * funciona sobre ella. Por eso el manejador **se aparta cuando el clic cayó
 * sobre un control**: sin ese guardia, un clic en el nombre navegaría dos veces
 * al mismo sitio y el clic medio abriría la pestaña Y movería esta.
 *
 * Se lleva el filtro puesto, igual que `EnlaceDetalle`: volver de un detalle no
 * pierde la vista desde la que se entró.
 */
export function FilaManifiesto({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const actual = query ? `${pathname}?${query}` : pathname;

  return (
    <TableRow
      onClick={(evento) => {
        if ((evento.target as HTMLElement).closest("a,button,input,select,[role='button']")) {
          return;
        }
        router.push(hrefConRetorno(href, actual));
      }}
      // 52 px con el dedo, densidad normal con el puntero. Mismo criterio que la
      // fila de Pedidos: por `pointer-coarse`, no por ancho — un iPad de 1024 px
      // es táctil y un portátil del mismo ancho no.
      className="cursor-pointer pointer-coarse:[&>td]:h-row-touch"
    >
      {children}
    </TableRow>
  );
}
