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
 *   - No se lee el payload; solo dispara el refetch. El aislamiento se mantiene
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
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { crearClienteConRealtimeAutenticado } from "@/lib/supabase/client";
import { crearProgramadorRefresco } from "./programador-refresco";
import {
  interpretarEstadoCanal,
  type EstadoCanalRealtime,
} from "./estado-canal";

export interface TablaRealtime {
  schema: string;
  tabla: string;
}

const PREDETERMINADO: TablaRealtime[] = [{ schema: "operacion", tabla: "pedidos" }];

export function IndicadorEnVivo({
  tenantId,
  tablas = PREDETERMINADO,
}: {
  tenantId: string;
  tablas?: TablaRealtime[];
}) {
  const router = useRouter();
  const [estadoCanal, setEstadoCanal] = useState<EstadoCanalRealtime | null>(null);
  const [autenticado, setAutenticado] = useState(true);

  // Clave estable de las tablas para el array de dependencias (evita re-suscribir
  // en cada render cuando se pasa `tablas` como literal inline).
  const clave = tablas.map((t) => `${t.schema}.${t.tabla}`).join(",");

  useEffect(() => {
    let desmontado = false;
    const programador = crearProgramadorRefresco(() => router.refresh());
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

      const filtro = `tenant_id=eq.${tenantId}`;
      let canal = cliente.channel(`en-vivo-${tenantId}-${clave}`);
      for (const { schema, tabla } of pares) {
        canal = canal
          .on("postgres_changes", { event: "INSERT", schema, table: tabla, filter: filtro }, programador.programar)
          .on("postgres_changes", { event: "UPDATE", schema, table: tabla, filter: filtro }, programador.programar);
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

  const presentacion = interpretarEstadoCanal(estadoCanal, autenticado);
  const esEnVivo = presentacion.estado === "en_vivo";
  const esFallo = presentacion.estado === "sin_actualizacion";

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
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
