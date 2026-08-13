"use client";

/**
 * Pestaña "Bodegas de sellers". Selector de seller → carga bajo demanda (mismo
 * patrón que `SeccionVentanasCorte` en configuracion/zonas/panel-zonas.tsx).
 */

import { useState } from "react";
import { Warehouse } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EstadoCargando, EstadoError } from "@/components/onboarding/estado-pantalla";
import { etiquetaSellerConEstado } from "@/lib/ui/traduccion-estados";
import type { SellerFiltro } from "@/lib/datos-tenant/sellers";
import { accionListarBodegasSeller, type BodegaFila } from "./actions";
import { DialogBodega } from "./dialog-bodega";
import { TarjetaBodega } from "./tarjeta-bodega";
import { alternativasActivas, principalDistintaDe } from "./utilidades";

interface Props {
  sellers: SellerFiltro[];
}

export function SeccionBodegasSellers({ sellers }: Props) {
  const [sellerId, setSellerId] = useState("");
  const [bodegas, setBodegas] = useState<BodegaFila[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargar(id: string) {
    setCargando(true);
    setError(null);
    const resultado = await accionListarBodegasSeller(id);
    setCargando(false);
    if (resultado.ok) {
      setBodegas(resultado.datos);
    } else {
      setError(resultado.mensaje);
    }
  }

  function seleccionarSeller(id: string) {
    setSellerId(id);
    setBodegas([]);
    setError(null);
    if (id) cargar(id);
  }

  const activas = bodegas.filter((b) => b.activa);
  const inactivas = bodegas.filter((b) => !b.activa);
  const principal = bodegas.find((b) => b.esPrincipal) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bodegas de sellers</CardTitle>
        <CardDescription>
          Dónde retira el conductor los pedidos de cada seller. Un seller puede tener varias.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sellers.length === 0 ? (
          <EmptyState
            icon={Warehouse}
            tono="arranque"
            titulo="Todavía no tienes sellers"
            descripcion="Agrega un seller antes de registrar sus bodegas de retiro."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="w-full space-y-1.5 sm:max-w-xs">
                <Label htmlFor="bodegas-seller-select">Seller</Label>
                <Select value={sellerId} onValueChange={seleccionarSeller}>
                  <SelectTrigger id="bodegas-seller-select" className="w-full">
                    <SelectValue placeholder="Selecciona un seller" />
                  </SelectTrigger>
                  <SelectContent>
                    {sellers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {etiquetaSellerConEstado(s.nombre, s.estado)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {sellerId && !cargando && !error && (
                <DialogBodega
                  tipo="seller"
                  sellerId={sellerId}
                  esPrimera={bodegas.length === 0}
                  principalActual={principal ? { id: principal.id, nombre: principal.nombre } : null}
                  onGuardada={() => cargar(sellerId)}
                />
              )}
            </div>

            {!sellerId && (
              <p className="text-sm text-muted-foreground">
                Selecciona un seller para ver y gestionar sus bodegas de retiro.
              </p>
            )}

            {sellerId && cargando && <EstadoCargando mensaje="Cargando bodegas…" />}

            {sellerId && !cargando && error && (
              <EstadoError descripcion={error} onReintentar={() => cargar(sellerId)} />
            )}

            {sellerId && !cargando && !error && bodegas.length === 0 && (
              <EmptyState
                icon={Warehouse}
                tono="arranque"
                titulo="Este seller no tiene bodegas registradas"
                descripcion="Agrega la primera bodega para coordinar sus retiros."
                accion={
                  <DialogBodega
                    tipo="seller"
                    sellerId={sellerId}
                    esPrimera
                    principalActual={null}
                    onGuardada={() => cargar(sellerId)}
                  />
                }
              />
            )}

            {sellerId && !cargando && !error && bodegas.length > 0 && (
              <div className="space-y-4">
                {activas.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">
                    Todas las bodegas de este seller están desactivadas.
                  </p>
                )}
                {activas.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {activas.map((b) => (
                      <TarjetaBodega
                        key={b.id}
                        bodega={b}
                        tipo="seller"
                        principalActual={principalDistintaDe(bodegas, b.id)}
                        alternativasActivas={alternativasActivas(bodegas, b.id)}
                        onCambiado={() => cargar(sellerId)}
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
                          tipo="seller"
                          principalActual={null}
                          alternativasActivas={[]}
                          onCambiado={() => cargar(sellerId)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
