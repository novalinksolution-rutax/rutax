"use client";

/**
 * Indicador + motor de actualización EN VIVO (Supabase Realtime).
 * =====================================================================
 * Se suscribe por Realtime a los cambios (INSERT/UPDATE) de una o más tablas del
 * tenant y, ante cualquier cambio, refresca la vista con `router.refresh()` —
 * que re-ejecuta el Server Component en el servidor (vía service-role). Realtime
 * es SOLO una señal:
 *   - La RLS de cada tabla ya filtra los eventos al tenant del usuario, así que
 *     nunca llegan cambios de otro courier.
 *   - Del payload solo se leen el `id` y el tipo de evento. El aislamiento se mantiene
 *     en el servidor, como en el resto de la app.
 *
 * Los eventos se agrupan para no refrescar en ráfaga durante la ingesta masiva,
 * pero **con tope máximo de espera**: un debounce puro se reprograma para
 * siempre bajo flujo sostenido y deja la pantalla congelada diciendo "En vivo"
 * (ver `programador-refresco.ts`, que es donde vive esa regla y su prueba).
 * Solo INSERT/UPDATE (DELETE no aplica RLS en Realtime).
 *
 * Reutilizable: por defecto escucha `operacion.pedidos`; pásale otras tablas
 * (p. ej. incidencias) para otras superficies. Cada tabla que se escuche debe
 * estar en la publicación `supabase_realtime` (ver migraciones realtime_*).
 *
 * `onSenal` (opcional): si se entrega, se llama en vez de `router.refresh()`
 * al recibir una señal (ya pasado el debounce/techo de `programador-refresco`).
 * Existe para pantallas donde refrescar solo — mientras hay una selección
 * activa bajo el dedo del usuario — sería dañino: las filas se recolocan y el
 * clic siguiente cae sobre el elemento equivocado
 * (docs/ux/etapa-6-asignacion-en-bloque.md §8: "aquí copiar ese patrón sería
 * dañino"). El llamador decide cuándo refrescar de verdad (p. ej. un botón
 * "Actualizar" en un aviso discreto). Sin `onSenal`, el comportamiento es
 * IDÉNTICO al de siempre — ningún llamador existente cambia.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { crearClienteConRealtimeAutenticado } from "@/lib/supabase/client";
import { crearProgramadorRefresco } from "./programador-refresco";
import { filtroTenant } from "./filtro-tenant";
import {
  interpretarEstadoCanal,
  type EstadoCanalRealtime,
} from "./estado-canal";

/**
 * Lo que cambió, para que la pantalla decida qué hacer con ello.
 *
 * ⚠️ **El payload se lee, pero solo el `id` y el tipo de evento.** Nunca los
 * campos de la fila: el aislamiento entre couriers lo impone RLS del lado del
 * servidor, y construir la pantalla con datos que llegaron por el socket sería
 * abrir una segunda fuente de verdad que RLS no vuelve a mirar. Con el `id` basta
 * para lo único que hace falta acá — distinguir **una fila que ya está en
 * pantalla** de **una que entraría nueva**—, y los datos siguen viniendo del
 * servidor.
 */
export interface SenalRealtime {
  tipo: "INSERT" | "UPDATE";
  tabla: string;
  /** `id` de la fila. `null` si el payload no lo trae. */
  id: string | null;
}

export interface TablaRealtime {
  schema: string;
  tabla: string;
}

const PREDETERMINADO: TablaRealtime[] = [{ schema: "operacion", tabla: "pedidos" }];

/**
 * La conexión, sin pintura.
 *
 * ⚠️ **Está separada del indicador a propósito, y no por prolijidad.** El canal
 * tiene que vivir **por encima del límite de Suspense**: si se monta dentro de
 * una página que tiene `loading.tsx`, cada `router.refresh()` la suspende, el
 * canal se cierra y se vuelve a unir, y **lo que ocurra en esa ida y vuelta no
 * llega nunca** — mudo, con el indicador diciendo «En vivo».
 *
 * El punto verde, en cambio, se dibuja donde tenga sentido leerlo (la cabecera).
 * Por eso son dos piezas: `useCanalEnVivo` donde sobrevive, `IndicadorEnVivo`
 * donde se ve.
 */
export function useCanalEnVivo({
  tenantId,
  tablas = PREDETERMINADO,
  onSenal,
}: {
  tenantId: string;
  tablas?: TablaRealtime[];
  onSenal?: (senales: SenalRealtime[]) => void;
}) {
  const router = useRouter();
  const [estadoCanal, setEstadoCanal] = useState<EstadoCanalRealtime | null>(null);
  const [autenticado, setAutenticado] = useState(true);

  // Clave estable de las tablas para el array de dependencias (evita re-suscribir
  // en cada render cuando se pasa `tablas` como literal inline).
  const clave = tablas.map((t) => `${t.schema}.${t.tabla}`).join(",");

  // `onSenal` se lee por ref, NUNCA como dependencia del efecto de abajo: si el
  // llamador la pasa como arrow function inline (`onSenal={() => setX(true)}`),
  // su identidad cambia en cada render, y ponerla en el array de dependencias
  // resuscribiría el canal Realtime completo en cada render — el mismo defecto
  // de fondo que `programador-refresco.ts` ya documenta para el debounce.
  const onSenalRef = useRef(onSenal);
  useEffect(() => {
    onSenalRef.current = onSenal;
  }, [onSenal]);

  useEffect(() => {
    let desmontado = false;
    // Las señales de la ráfaga se juntan y se entregan de una vez, en el mismo
    // disparo que ya estaba debounceado. Sin esto habría que elegir entre avisar
    // por cada evento —y renderizar cincuenta veces— o perder cuál cambió.
    let acumuladas: SenalRealtime[] = [];
    const programador = crearProgramadorRefresco(() => {
      const lote = acumuladas;
      acumuladas = [];
      if (onSenalRef.current) onSenalRef.current(lote);
      else router.refresh();
    });
    const anotar = (tipo: "INSERT" | "UPDATE", tabla: string) => (payload: unknown) => {
      const fila = (payload as { new?: { id?: unknown } } | null)?.new;
      const id = typeof fila?.id === "string" ? fila.id : null;
      acumuladas.push({ tipo, tabla, id });
      programador.programar();
    };
    let limpiar: (() => void) | null = null;

    void (async () => {
      // ⚠️ SE ESPERA EL TOKEN ANTES DE SUSCRIBIR, y ese orden es el arreglo
      // entero. La autorización de una suscripción se resuelve en el join del
      // canal: si el socket todavía va con la clave anónima cuando se une, el
      // servidor descarta la suscripción por RLS y ya no hay vuelta atrás —
      // el canal igual reporta SUBSCRIBED. Ver el comentario largo en
      // `src/lib/supabase/client.ts`.
      const { cliente, autenticado: hayToken } = await crearClienteConRealtimeAutenticado();
      if (desmontado) return;

      setAutenticado(hayToken);
      if (!hayToken) return; // Suscribirse sin token no traería un solo evento.

      const pares = clave.split(",").map((s) => {
        const [schema, tabla] = s.split(".");
        return { schema, tabla };
      });

      // 🔴 **Sin un tenant casteable a uuid NO se suscribe, y la razón es de
      // disponibilidad, no de higiene.** Un `tenantId` nulo se interpola como la
      // cadena «null»; del otro lado `walrus` la castea a uuid al evaluar RLS,
      // revienta, y **se lleva el lote de cambios de todos los suscriptores del
      // proyecto** — no solo el de esta pestaña. Nadie se entera, porque el canal
      // sí queda suscrito y el indicador sigue diciendo «En vivo».
      //
      // Se corta acá y no en cada pantalla que monta el indicador: basta que una
      // se olvide para tumbar el tiempo real de todos.
      const filtro = filtroTenant(tenantId);
      if (!filtro) {
        setAutenticado(false);
        return;
      }
      let canal = cliente.channel(`en-vivo-${tenantId}-${clave}`);
      for (const { schema, tabla } of pares) {
        canal = canal
          .on("postgres_changes", { event: "INSERT", schema, table: tabla, filter: filtro }, anotar("INSERT", tabla))
          .on("postgres_changes", { event: "UPDATE", schema, table: tabla, filter: filtro }, anotar("UPDATE", tabla));
      }
      canal.subscribe((status) => {
        if (!desmontado) setEstadoCanal(status as EstadoCanalRealtime);
      });

      limpiar = () => {
        void cliente.removeChannel(canal);
      };
    })();

    return () => {
      desmontado = true;
      programador.cancelar();
      limpiar?.();
    };
  }, [tenantId, clave, router]);

  return interpretarEstadoCanal(estadoCanal, autenticado);
}

/** El punto y su etiqueta. Solo pinta; no sabe de canales. */
export function PuntoEnVivo({
  presentacion,
}: {
  presentacion: ReturnType<typeof interpretarEstadoCanal>;
}) {
  const esEnVivo = presentacion.estado === "en_vivo";
  const esFallo = presentacion.estado === "sin_actualizacion";

  return (
    <span
      // `shrink-0` y `whitespace-nowrap`: en un encabezado apretado el punto
      // quedaba encima del texto y «En vivo» se partía en dos líneas — el
      // indicador de que la pantalla está viva, ilegible.
      className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground"
      title={presentacion.detalle}
    >
      <span
        className={`inline-block size-2 rounded-full ${
          esEnVivo ? "animate-pulse bg-success" : esFallo ? "bg-warning" : "bg-muted-foreground/40"
        }`}
        aria-hidden="true"
      />
      <span aria-live="polite">{presentacion.etiqueta}</span>
    </span>
  );
}

/**
 * El indicador completo: se conecta y se dibuja en el mismo sitio.
 *
 * Sirve para las pantallas **sin `loading.tsx`** en su segmento. Donde lo haya,
 * usa `useCanalEnVivo` arriba (en el layout) y `PuntoEnVivo` abajo.
 */
export function IndicadorEnVivo(props: {
  tenantId: string;
  tablas?: TablaRealtime[];
  onSenal?: (senales: SenalRealtime[]) => void;
}) {
  const presentacion = useCanalEnVivo(props);
  return <PuntoEnVivo presentacion={presentacion} />;
}
