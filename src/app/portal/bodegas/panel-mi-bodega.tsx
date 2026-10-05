"use client";

/**
 * Alta y edición de una bodega, desde el portal del seller.
 * =============================================================================
 * Es el mismo panel lateral que usa el courier —`PanelAccion`, hoja inferior en
 * teléfono y lateral desde tablet— con dos diferencias que vienen del rol:
 *
 * · **No existe el pago por visita.** Es lo que el courier le paga al conductor
 *   por venir hasta acá; el seller ni lo ve ni lo escribe. Ver `actions.ts`.
 * · **No hay selector de seller.** Él es el seller: el `seller_id` sale de la
 *   sesión en el servidor y no viaja en el formulario.
 *
 * ⚠️ El campo de contacto NO es opcional de adorno: es «a quién llama el
 * conductor cuando llega y el portón está cerrado». Por eso su ayuda dice eso y
 * no «contacto», que no le dice a nadie para qué sirve.
 */

import { useState, useTransition } from "react";
import { CampoDireccion } from "@/components/ui/campo-direccion";
import { comunaDelCatalogo } from "@/app/(tenant)/operaciones/nuevo/reglas-alta";
import {
  actionResolverDireccion,
  actionSugerirDirecciones,
} from "@/app/(tenant)/operaciones/nuevo/actions";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PanelAccion } from "@/components/ui/panel-accion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { accionCrearMiBodega, accionEditarMiBodega } from "./actions";
import { formatearTelefonoMientrasEscribe } from "@/lib/telefono-cl";

export interface BodegaEditable {
  id: string;
  nombre: string;
  direccion: string;
  comuna: string;
  instruccionesAcceso: string | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
}

export function PanelMiBodega({
  bodega,
  abierto,
  onOpenChange,
  disparador,
}: {
  /** `undefined` = alta. */
  bodega?: BodegaEditable;
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
  disparador?: React.ReactNode;
}) {
  const router = useRouter();
  const esEdicion = !!bodega;
  const [error, setError] = useState<string | null>(null);
  const [comuna, setComuna] = useState(bodega?.comuna ?? "");
  // La comuna sale de la dirección elegida en la lista; el selector solo
  // aparece cuando no se pudo saber así (escrita a mano o fuera del catálogo).
  const [comunaDesdeDireccion, setComunaDesdeDireccion] = useState(false);
  /**
   * Misma búsqueda de direcciones que el alta same-day (encargo del usuario,
   * 26-08-2026): acá es adonde el conductor va a buscar los bultos, así que una
   * coordenada mala manda a alguien a la calle equivocada con la van vacía.
   */
  const [direccion, setDireccion] = useState(bodega?.direccion ?? "");
  const [direccionElegida, setDireccionElegida] = useState(false);
  const [coordenada, setCoordenada] = useState<{ lat: number; long: number } | null>(null);
  const [guardando, iniciar] = useTransition();

  function guardar(fd: FormData) {
    // El `Select` de shadcn no es un control nativo: su valor no entra solo en
    // el FormData. Se inyecta acá o el servidor recibe la comuna vacía.
    fd.set("comuna", comuna);
    // La coordenada de la dirección elegida viaja con el formulario para que la
    // acción no vuelva a preguntarle al proveedor: más rápido para quien espera,
    // exacto, y una llamada facturada menos. Si se escribió a mano no van, y la
    // acción geocodifica como siempre.
    if (coordenada) {
      fd.set("lat", String(coordenada.lat));
      fd.set("long", String(coordenada.long));
    }
    setError(null);
    iniciar(async () => {
      const r = esEdicion
        ? await accionEditarMiBodega(bodega.id, fd)
        : await accionCrearMiBodega(fd);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <PanelAccion
      abierto={abierto}
      onOpenChange={(a) => {
        if (!a) setError(null);
        onOpenChange(a);
      }}
      disparador={disparador}
      titulo={esEdicion ? bodega.nombre : "Nueva bodega"}
      pie={
        <div className="flex items-center gap-2">
          <Button type="submit" form="form-mi-bodega" disabled={guardando}>
            {guardando ? "Guardando…" : esEdicion ? "Guardar" : "Agregar la bodega"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={guardando}
            onClick={() => onOpenChange(false)}
          >
            Volver
          </Button>
        </div>
      }
    >
      <form id="form-mi-bodega" action={guardar} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="nombre">Nombre</Label>
          <Input
            id="nombre"
            name="nombre"
            defaultValue={bodega?.nombre ?? ""}
            placeholder="Ej: Bodega Quilicura"
            required
            disabled={guardando}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="direccion">Dirección</Label>
          <CampoDireccion
            id="direccion"
            name="direccion"
            valor={direccion}
            elegida={direccionElegida}
            placeholder="Calle, número, y el detalle que haga falta"
            required
            onCambio={(v) => {
              setDireccion(v);
              // Reescribir a mano suelta la coordenada: conservarla dejaría la
              // bodega apuntando al sitio anterior con una dirección nueva.
              if (direccionElegida) {
                setDireccionElegida(false);
                setCoordenada(null);
                setComunaDesdeDireccion(false);
              }
            }}
            onElegir={(d) => {
              setDireccion(d.direccion);
              setDireccionElegida(true);
              const delCatalogo = comunaDelCatalogo(d.comuna);
              if (delCatalogo) setComuna(delCatalogo);
              setComunaDesdeDireccion(Boolean(delCatalogo));
              setCoordenada(
                d.lat != null && d.long != null ? { lat: d.lat, long: d.long } : null,
              );
            }}
            buscar={actionSugerirDirecciones}
            resolver={actionResolverDireccion}
          />
          {comunaDesdeDireccion ? <p className="text-xs text-fg-muted">{comuna}</p> : null}
        </div>

        {comunaDesdeDireccion ? null : (
        <div className="space-y-1.5">
          <Label htmlFor="comuna">Comuna</Label>
          <Select value={comuna} onValueChange={setComuna} disabled={guardando}>
            <SelectTrigger id="comuna" className="w-full">
              <SelectValue placeholder="Elige una comuna" />
            </SelectTrigger>
            <SelectContent>
              {COMUNAS_RM.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="contacto_nombre">A quién llamar</Label>
          <Input
            id="contacto_nombre"
            name="contacto_nombre"
            defaultValue={bodega?.contactoNombre ?? ""}
            placeholder="Nombre de quien recibe al conductor"
            disabled={guardando}
          />
          <Input
            name="contacto_telefono"
            defaultValue={formatearTelefonoMientrasEscribe(bodega?.contactoTelefono ?? "")}
            onChange={(e) => {
              e.currentTarget.value = formatearTelefonoMientrasEscribe(e.currentTarget.value);
            }}
            placeholder="+56 9 1234 5678"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-label="Teléfono de contacto"
            disabled={guardando}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="instrucciones_acceso">Cómo se entra</Label>
          <Textarea
            id="instrucciones_acceso"
            name="instrucciones_acceso"
            defaultValue={bodega?.instruccionesAcceso ?? ""}
            rows={3}
            placeholder="Portón, andén, horarios de retiro, dónde estacionar…"
            disabled={guardando}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg"
          >
            {error}
          </p>
        )}
      </form>
    </PanelAccion>
  );
}
