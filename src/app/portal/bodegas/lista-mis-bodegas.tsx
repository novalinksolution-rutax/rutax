"use client";

/**
 * Las bodegas del seller, con sus acciones.
 * =============================================================================
 * Antes esto era una tarjeta muerta: el seller veía su bodega y no podía hacer
 * NADA con ella —ni agregar otra, ni corregir un teléfono, ni dar de baja la
 * que cerró—. Decisión del usuario (25-08-2026): la administra él.
 *
 * ⚠️ **La baja es `activa = false`, nunca un borrado.** Detrás de una bodega
 * cuelgan actas de retiro que respaldan pagos a conductores; borrarla dejaría
 * esos pagos sin el sitio al que fueron. El servidor además impide desactivar
 * la última activa: sin ninguna, el courier no tiene dónde retirar y el seller
 * no se enteraría hasta que un retiro no ocurriera.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, Plus, Warehouse } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { accionCambiarEstadoMiBodega, accionMarcarMiBodegaPrincipal } from "./actions";
import { PanelMiBodega, type BodegaEditable } from "./panel-mi-bodega";

export interface BodegaSeller extends BodegaEditable {
  esPrincipal: boolean;
  activa: boolean;
}

export function ListaMisBodegas({ bodegas }: { bodegas: BodegaSeller[] }) {
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const [editando, setEditando] = useState<BodegaSeller | null>(null);

  const activas = bodegas.filter((b) => b.activa);
  const inactivas = bodegas.filter((b) => !b.activa);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <PanelMiBodega
          abierto={nuevaAbierta}
          onOpenChange={setNuevaAbierta}
          disparador={
            <Button size="sm">
              <Plus className="size-4" aria-hidden="true" />
              Agregar una bodega
            </Button>
          }
        />
      </div>

      {activas.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {activas.map((b) => (
            <TarjetaBodega key={b.id} bodega={b} onEditar={() => setEditando(b)} />
          ))}
        </div>
      )}

      {inactivas.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Inactivas ({inactivas.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {inactivas.map((b) => (
              <TarjetaBodega key={b.id} bodega={b} onEditar={() => setEditando(b)} />
            ))}
          </div>
        </div>
      )}

      {/* `key` por bodega: sin esto, abrir la segunda mostraría los campos de la
          primera — el panel conserva su estado entre aperturas. */}
      {editando && (
        <PanelMiBodega
          key={editando.id}
          bodega={editando}
          abierto
          onOpenChange={(a) => {
            if (!a) setEditando(null);
          }}
        />
      )}
    </div>
  );
}

function TarjetaBodega({
  bodega,
  onEditar,
}: {
  bodega: BodegaSeller;
  onEditar: () => void;
}) {
  const router = useRouter();
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tieneContacto = !!(bodega.contactoNombre || bodega.contactoTelefono);

  async function correr(fn: () => Promise<{ ok: boolean; mensaje?: string }>) {
    setTrabajando(true);
    setError(null);
    const r = await fn();
    setTrabajando(false);
    if (!r.ok) setError(r.mensaje ?? "No se pudo hacer.");
    else router.refresh();
  }

  return (
    <Card className={cn(!bodega.activa && "opacity-60")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Warehouse className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium text-foreground">{bodega.nombre}</p>
          </div>
          {bodega.esPrincipal && <Badge>Principal</Badge>}
        </div>

        <p className="text-sm text-muted-foreground">
          {bodega.direccion}, {bodega.comuna}
        </p>

        {tieneContacto && (
          <div className="flex items-start gap-2 text-sm">
            <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-xs text-muted-foreground">A quién llamar</p>
              <p className="text-foreground">
                {bodega.contactoNombre}
                {bodega.contactoNombre && bodega.contactoTelefono && " · "}
                {bodega.contactoTelefono && (
                  <a href={`tel:${bodega.contactoTelefono}`} className="text-primary hover:underline">
                    {bodega.contactoTelefono}
                  </a>
                )}
              </p>
            </div>
          </div>
        )}

        {bodega.instruccionesAcceso && (
          <p className="text-xs text-muted-foreground">{bodega.instruccionesAcceso}</p>
        )}

        {error && (
          <p role="alert" className="text-xs text-fault-fg">
            {error}
          </p>
        )}

        {/* Las acciones al pie y en `ghost`: la tarjeta es para leer la
            dirección, no para operarla. Solo «Editar» está siempre; el resto
            aparece cuando tiene sentido. */}
        <div className="flex flex-wrap items-center gap-1 border-t border-line pt-2">
          <Button variant="ghost" size="sm" onClick={onEditar} disabled={trabajando}>
            Editar
          </Button>

          {bodega.activa && !bodega.esPrincipal && (
            <Button
              variant="ghost"
              size="sm"
              disabled={trabajando}
              onClick={() => correr(() => accionMarcarMiBodegaPrincipal(bodega.id))}
            >
              Hacerla principal
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            disabled={trabajando}
            onClick={() => correr(() => accionCambiarEstadoMiBodega(bodega.id, !bodega.activa))}
          >
            {bodega.activa ? "Desactivar" : "Reactivar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
