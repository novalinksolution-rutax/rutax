"use client";

/**
 * Pestaña "Mis bodegas" (courier_bodegas). Sin selector — es una lista única
 * por tenant, cargada de entrada desde el server component y refrescada por
 * Server Action tras cada mutación.
 */

import { useState } from "react";
import { Warehouse } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EstadoCargando, EstadoError } from "@/components/onboarding/estado-pantalla";
import { accionListarBodegasCourier, type BodegaFila } from "./actions";
import { PanelBodega } from "./panel-bodega";
import { TarjetaBodega } from "./tarjeta-bodega";
import { alternativasActivas, principalDistintaDe } from "./utilidades";

interface Props {
  bodegasIniciales: BodegaFila[];
  errorInicial?: string | null;
}

export function SeccionMisBodegas({ bodegasIniciales, errorInicial = null }: Props) {
  const [bodegas, setBodegas] = useState<BodegaFila[]>(bodegasIniciales);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(errorInicial);

  async function recargar() {
    setCargando(true);
    setError(null);
    const resultado = await accionListarBodegasCourier();
    setCargando(false);
    if (resultado.ok) {
      setBodegas(resultado.datos);
    } else {
      setError(resultado.mensaje);
    }
  }

  const activas = bodegas.filter((b) => b.activa);
  const inactivas = bodegas.filter((b) => !b.activa);
  const principal = bodegas.find((b) => b.esPrincipal) ?? null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">Mis bodegas</CardTitle>
          <CardDescription>De dónde sale tu flota a repartir — el punto de partida de las rutas del día.</CardDescription>
        </div>
        {!cargando && !error && (
          <PanelBodega
            tipo="courier"
            esPrimera={bodegas.length === 0}
            principalActual={principal ? { id: principal.id, nombre: principal.nombre } : null}
            onGuardada={recargar}
          />
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {cargando && <EstadoCargando mensaje="Cargando bodegas…" />}

        {!cargando && error && <EstadoError descripcion={error} onReintentar={recargar} />}

        {!cargando && !error && bodegas.length === 0 && (
          <EmptyState
            icon={Warehouse}
            tono="arranque"
            titulo="Todavía no registraste ninguna bodega"
            descripcion="Agrega la bodega desde la que sale tu flota a repartir."
            accion={<PanelBodega tipo="courier" esPrimera principalActual={null} onGuardada={recargar} />}
          />
        )}

        {!cargando && !error && bodegas.length > 0 && (
          <div className="space-y-4">
            {activas.length === 0 && (
              <p className="text-sm text-muted-foreground italic">Todas tus bodegas están desactivadas.</p>
            )}
            {activas.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {activas.map((b) => (
                  <TarjetaBodega
                    key={b.id}
                    bodega={b}
                    tipo="courier"
                    principalActual={principalDistintaDe(bodegas, b.id)}
                    alternativasActivas={alternativasActivas(bodegas, b.id)}
                    onCambiado={recargar}
                  />
                ))}
              </div>
            )}
            {inactivas.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Inactivas ({inactivas.length})
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {inactivas.map((b) => (
                    <TarjetaBodega
                      key={b.id}
                      bodega={b}
                      tipo="courier"
                      principalActual={null}
                      alternativasActivas={[]}
                      onCambiado={recargar}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
