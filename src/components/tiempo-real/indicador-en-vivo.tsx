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
import { createClient } from "@/lib/supabase/client";
import { crearProgramadorRefresco } from "./programador-refresco";

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
  const [enVivo, setEnVivo] = useState(false);

  // Clave estable de las tablas para el array de dependencias (evita re-suscribir
  // en cada render cuando se pasa `tablas` como literal inline).
  const clave = tablas.map((t) => `${t.schema}.${t.tabla}`).join(",");

  useEffect(() => {
    const supabase = createClient();
    const pares = clave.split(",").map((s) => {
      const [schema, tabla] = s.split(".");
      return { schema, tabla };
    });

    const programador = crearProgramadorRefresco(() => router.refresh());
    const programarRefresco = programador.programar;

    const filtro = `tenant_id=eq.${tenantId}`;
    let canal = supabase.channel(`en-vivo-${tenantId}-${clave}`);
    for (const { schema, tabla } of pares) {
      canal = canal
        .on("postgres_changes", { event: "INSERT", schema, table: tabla, filter: filtro }, programarRefresco)
        .on("postgres_changes", { event: "UPDATE", schema, table: tabla, filter: filtro }, programarRefresco);
    }
    canal.subscribe((status) => setEnVivo(status === "SUBSCRIBED"));

    return () => {
      programador.cancelar();
      void supabase.removeChannel(canal);
    };
  }, [tenantId, clave, router]);

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
      title={enVivo ? "Actualización automática activa" : "Conectando…"}
    >
      <span
        className={`inline-block size-2 rounded-full ${
          enVivo ? "animate-pulse bg-success" : "bg-muted-foreground/40"
        }`}
        aria-hidden="true"
      />
      <span aria-live="polite">{enVivo ? "En vivo" : "Conectando…"}</span>
    </span>
  );
}
