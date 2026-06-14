/**
 * Pantalla C-1 — Mis liquidaciones (PWA del conductor).
 *
 * Server Component. Mobile-first (max-w-lg). Cards verticales, no tabla.
 * Criterios C-1 (monto en tipografía grande), C-2 (sin datos de cobros al seller),
 * C-3 (signed URL para PDF).
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Wallet } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarLiquidaciones } from "@/modules/dinero/index";
import type { Liquidacion } from "@/modules/dinero/tipos";
import {
  traducirEstadoLiquidacion,
  BADGE_ESTADO_LIQUIDACION,
} from "@/lib/ui/traduccion-estados";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { BotonDescargaLiquidacion } from "./boton-descarga-liquidacion";

export const metadata: Metadata = {
  title: "Mis liquidaciones",
};

function formatearFechaCorta(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 10) return fechaIso;
  const [anio, mes, dia] = fechaIso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

export default async function PaginaLiquidacionesConductor() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId || !sesion.usuario.driverId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "conductor") redirect("/conductor/manifiesto");

  const driverId = sesion.usuario.driverId;
  const tenantId = sesion.usuario.tenantId;

  const cliente = crearClienteServiceRole();
  let liquidaciones: Liquidacion[] = [];
  let errorCarga = false;

  try {
    liquidaciones = await listarLiquidaciones(cliente, tenantId, driverId);
    // Ordenar por fecha_fin DESC
    liquidaciones.sort((a, b) => b.fechaFin.localeCompare(a.fechaFin));
  } catch {
    errorCarga = true;
  }

  // Estado: error de red
  if (errorCarga) {
    return (
      <EmptyState
        icon={AlertTriangle}
        titulo="No se pudieron cargar tus liquidaciones"
        descripcion="Revisa tu conexión e inténtalo de nuevo."
        accion={
          <form action="/conductor/liquidaciones">
            <Button type="submit" size="lg">
              Reintentar
            </Button>
          </form>
        }
      />
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Encabezado con botón atrás */}
      <div className="flex items-center gap-3">
        <Link
          href="/conductor/manifiesto"
          aria-label="Volver al manifiesto"
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Manifiesto
        </Link>
        <h1 className="text-xl font-bold">Mis liquidaciones</h1>
      </div>

      {/* Estado: sin liquidaciones */}
      {liquidaciones.length === 0 ? (
        <EmptyState
          icon={Wallet}
          titulo="Aún no tienes liquidaciones"
          descripcion="Aparecerán aquí cuando tu empresa registre tus primeras entregas."
        />
      ) : (
        <ul className="space-y-3" aria-label="Lista de liquidaciones">
          {liquidaciones.map((liq) => (
            <li key={liq.id}>
              <CardLiquidacion liquidacion={liq} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// =============================================================================
// Card de liquidación — mobile-first
// =============================================================================

function CardLiquidacion({ liquidacion }: { liquidacion: Liquidacion }) {
  const textoEstado = traducirEstadoLiquidacion(liquidacion.estado);

  return (
    <article className="rounded-xl border bg-card p-4 shadow-sm">
      {/* Línea superior: fechas + badge estado */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground tabular-nums">
          {formatearFechaCorta(liquidacion.fechaInicio)} –{" "}
          {formatearFechaCorta(liquidacion.fechaFin)}
        </p>
        <Badge variant={BADGE_ESTADO_LIQUIDACION[liquidacion.estado]} className="shrink-0">
          {textoEstado}
        </Badge>
      </div>

      {/* Línea media: entregas + monto en tipografía grande */}
      <div className="mt-3 flex items-end justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            {liquidacion.totalEntregas}{" "}
            entrega{liquidacion.totalEntregas !== 1 ? "s" : ""}
          </p>
        </div>
        <p className="text-2xl font-bold tabular-nums text-foreground">
          {formatearCLPOGuion(liquidacion.montoTotalClp)}
        </p>
      </div>

      {/* Botón de descarga o mensaje si no hay PDF */}
      <div className="mt-3">
        {liquidacion.pdfRef ? (
          <BotonDescargaLiquidacion pdfRef={liquidacion.pdfRef} />
        ) : (
          <p className="text-xs text-muted-foreground">
            PDF disponible cuando la liquidación sea emitida.
          </p>
        )}
      </div>
    </article>
  );
}
