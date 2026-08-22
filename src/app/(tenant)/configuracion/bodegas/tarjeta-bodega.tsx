"use client";

/**
 * Tarjeta de una bodega — jerarquía fija: nombre + badge Principal → dirección
 * y comuna → contacto ("A quién llamar") → instrucciones → aviso de no
 * ubicada. Inactiva: mismo cuerpo con `opacity-60` y una sola acción
 * ("Reactivar") — igual que `FilaTarifaInactiva`, sin eliminar nunca.
 */

import { useState, useTransition } from "react";
import { HandCoins, MapPin, Phone, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { traducirGeoEstado } from "@/lib/ui/traduccion-estados";
import {
  accionDesactivarBodega,
  accionMarcarPrincipal,
  accionReactivarBodega,
  accionReintentarUbicacion,
  type BodegaFila,
  type TipoBodega,
} from "./actions";
import { DialogBodega } from "./dialog-bodega";
import { DialogDesactivarPrincipal } from "./dialog-desactivar-principal";

interface Props {
  bodega: BodegaFila;
  tipo: TipoBodega;
  /** La OTRA bodega principal (si existe) — nunca la propia. */
  principalActual: { id: string; nombre: string } | null;
  /** Otras bodegas activas — opciones de reemplazo si esta es la principal. */
  alternativasActivas: { id: string; nombre: string }[];
  /**
   * Monto general del courier por visita — solo se usa (y se muestra) cuando
   * `tipo === "seller"`. `null` = el courier todavía no lo configuró en
   * Configuración → Retiro.
   */
  montoVisitaDefaultClp?: number | null;
  /** El padre vuelve a pedir la lista completa tras cualquier mutación. */
  onCambiado: () => void;
}

export function TarjetaBodega({
  bodega,
  tipo,
  principalActual,
  alternativasActivas,
  montoVisitaDefaultClp = null,
  onCambiado,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [mostrarConfirmarPrincipal, setMostrarConfirmarPrincipal] = useState(false);
  const [mostrarDesactivarPrincipal, setMostrarDesactivarPrincipal] = useState(false);

  const tieneContacto = !!(bodega.contactoNombre || bodega.contactoTelefono);
  const noUbicada = bodega.geoEstado !== "resuelto";

  // Solo aplica a bodegas de seller — courier_bodegas no tiene la columna, así
  // que `bodega.montoVisitaClp` siempre llega `null` para `tipo === "courier"`
  // y esta sección no se renderiza.
  const esHeredado = bodega.montoVisitaClp === null;
  const montoVisitaEfectivo = bodega.montoVisitaClp ?? montoVisitaDefaultClp;

  // Los tres estados que no son `resuelto` significan cosas distintas y no
  // pueden compartir el mismo texto: decirle "revisa que la dirección esté bien
  // escrita" a quien tiene una dirección correcta pero fuera de la zona lo manda
  // a corregir algo que no está malo. Y "Ubicando dirección…" junto a ese mismo
  // texto se contradice solo — uno dice "en curso" y el otro "falló".
  const explicacionNoUbicada: Record<string, string> = {
    no_resuelto: "Puedes seguir usándola, pero conviene revisar que la dirección esté bien escrita.",
    pendiente: "Puedes seguir usándola. Todavía no la ubicamos en el mapa.",
    fuera_cobertura: "La dirección es válida, pero queda fuera de la zona que cubre tu operación.",
  };

  // Reintentar vuelve a consultar LA MISMA dirección, así que solo tiene sentido
  // donde el resultado puede cambiar. En `fuera_cobertura` ya se ubicó bien: lo
  // que correspondería es editar la dirección, no reintentarla.
  const puedeReintentarUbicacion = bodega.geoEstado !== "fuera_cobertura";

  function ejecutar(accion: () => Promise<{ ok: boolean; mensaje?: string }>) {
    setError(null);
    startTransition(async () => {
      const resultado = await accion();
      if (!resultado.ok) {
        setError(resultado.mensaje ?? "No se pudo completar la acción.");
        return;
      }
      onCambiado();
    });
  }

  function clickDesactivar() {
    if (bodega.esPrincipal) {
      setMostrarDesactivarPrincipal(true);
      return;
    }
    ejecutar(() => accionDesactivarBodega(tipo, bodega.id));
  }

  function clickMarcarPrincipal() {
    if (principalActual) {
      setMostrarConfirmarPrincipal(true);
      return;
    }
    ejecutar(() => accionMarcarPrincipal(tipo, bodega.id));
  }

  function confirmarMarcarPrincipal() {
    setMostrarConfirmarPrincipal(false);
    ejecutar(() => accionMarcarPrincipal(tipo, bodega.id));
  }

  return (
    <>
      <Card className={cn(!bodega.activa && "opacity-60")}>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Warehouse className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium text-foreground">{bodega.nombre}</p>
            </div>
            {bodega.esPrincipal && <Badge>Principal</Badge>}
          </div>

          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {bodega.direccion}, {bodega.comuna}
            </span>
          </div>

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

          {tipo === "seller" && (
            <div className="flex items-start gap-2 text-sm">
              <HandCoins className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-xs text-muted-foreground">Pago por visita</p>
                {montoVisitaEfectivo !== null ? (
                  <p className="text-foreground">
                    {formatearCLP(montoVisitaEfectivo)}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {esHeredado ? "· monto general del courier" : "· monto propio de esta bodega"}
                    </span>
                  </p>
                ) : (
                  <span
                    className="text-warning-subtle-foreground"
                    title="Configura el monto general en Configuración → Retiro, o uno propio para esta bodega."
                  >
                    Sin configurar
                  </span>
                )}
              </div>
            </div>
          )}

          {bodega.instruccionesAcceso && (
            <p className="text-xs text-muted-foreground">{bodega.instruccionesAcceso}</p>
          )}

          {bodega.activa && noUbicada && (
            <div className="space-y-1.5 rounded-md bg-warning-subtle px-2.5 py-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <DistintivoEstado tono="attention" etiqueta={traducirGeoEstado(bodega.geoEstado)} />
                {puedeReintentarUbicacion && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => ejecutar(() => accionReintentarUbicacion(tipo, bodega.id))}
                    disabled={isPending}
                    className="h-auto px-1.5 py-0.5 text-xs"
                  >
                    Reintentar ubicación
                  </Button>
                )}
              </div>
              <p className="text-xs text-warning-subtle-foreground">
                {explicacionNoUbicada[bodega.geoEstado] ?? explicacionNoUbicada.no_resuelto}
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1 border-t border-border pt-2">
            {bodega.activa ? (
              <>
                <DialogBodega
                  tipo={tipo}
                  bodegaExistente={{
                    id: bodega.id,
                    nombre: bodega.nombre,
                    direccion: bodega.direccion,
                    comuna: bodega.comuna,
                    instruccionesAcceso: bodega.instruccionesAcceso,
                    contactoNombre: bodega.contactoNombre,
                    contactoTelefono: bodega.contactoTelefono,
                    esPrincipal: bodega.esPrincipal,
                    montoVisitaClp: bodega.montoVisitaClp,
                  }}
                  principalActual={principalActual}
                  montoVisitaDefaultClp={montoVisitaDefaultClp}
                  trigger={
                    <Button type="button" variant="ghost" size="sm">
                      Editar
                    </Button>
                  }
                  onGuardada={onCambiado}
                />
                {!bodega.esPrincipal && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clickMarcarPrincipal}
                    disabled={isPending}
                  >
                    Marcar como principal
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clickDesactivar}
                  disabled={isPending}
                  className="text-muted-foreground hover:text-destructive"
                >
                  Desactivar
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => ejecutar(() => accionReactivarBodega(tipo, bodega.id))}
                disabled={isPending}
              >
                Reactivar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Marcar como principal reemplazando a otra — un clic si no hay ninguna. */}
      <Dialog open={mostrarConfirmarPrincipal} onOpenChange={setMostrarConfirmarPrincipal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cambiar la bodega principal</DialogTitle>
            <DialogDescription>
              «{bodega.nombre}» pasará a ser {tipo === "seller" ? "la bodega principal de este seller" : "tu bodega principal"}.
              {principalActual && <> «{principalActual.nombre}» dejará de serlo.</>} Puedes cambiarlo cuando quieras.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="button" loading={isPending} onClick={confirmarMarcarPrincipal}>
              Marcar como principal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Desactivar la principal — siempre con diálogo. */}
      <DialogDesactivarPrincipal
        open={mostrarDesactivarPrincipal}
        onOpenChange={setMostrarDesactivarPrincipal}
        bodega={bodega}
        tipo={tipo}
        alternativas={alternativasActivas}
        onDesactivada={onCambiado}
      />
    </>
  );
}
