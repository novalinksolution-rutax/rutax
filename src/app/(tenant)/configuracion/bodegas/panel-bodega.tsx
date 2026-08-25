"use client";

/**
 * Detalle de bodega — el tercero de los siete del segundo nivel.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * CUATRO BLOQUES Y NINGUNO DE RELLENO
 * -----------------------------------------------------------------------------
 * **Dónde queda · a quién llamar · cómo entrar · cuánto se paga por ir.** Eran
 * los mismos campos, pero en una lista plana de siete filas: rotulados, se lee
 * de un vistazo qué falta por completar y qué es cada cosa.
 *
 * -----------------------------------------------------------------------------
 * 🔴 «CÓMO ENTRAR» DECLARA QUIÉN LO LEE Y DÓNDE NO VA
 * -----------------------------------------------------------------------------
 * *«Esto lo lee el conductor en su app. No va en la etiqueta del paquete.»*
 *
 * Sin esa frase el campo es ambiguo de la peor manera: quien escribe «portón
 * lateral, timbre 2, preguntar por Marcela» no sabe si eso va a terminar impreso
 * en un bulto que ve el destinatario. Y si lo cree, escribe menos de lo que el
 * conductor necesita — que es justo el dato que evita la llamada desde la calle.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL PAGO POR VISITA ES DE LAS BODEGAS DEL SELLER, Y EL TABLERO LO DICE AL REVÉS
 * -----------------------------------------------------------------------------
 * B3b afirma que «en la bodega de un seller es la misma pantalla sin el pago por
 * visita: esa es del courier». **Es al revés, y no es una interpretación**: el
 * retiro se paga por visitar la bodega DEL SELLER, que es adonde el conductor va
 * a buscar los bultos. De la bodega propia del courier sale la flota — pagarle a
 * alguien por «visitar» su propia base no significa nada.
 *
 * El modelo de datos ya lo impone: `monto_visita_clp` y los campos de contacto
 * viven en `identidad.seller_bodegas` y **no existen** en
 * `identidad.courier_bodegas`. Son dos tablas hermanas justamente para que un
 * bug no pueda pagar una visita a la bodega propia.
 *
 * -----------------------------------------------------------------------------
 * ES UN PANEL LATERAL, NO UN MODAL
 * -----------------------------------------------------------------------------
 * 430 px a la derecha, con el listado a la vista: casi siempre se abre para
 * comparar con otra bodega o para copiar unas instrucciones de acceso.
 */

import { useState, useTransition, type FormEvent } from "react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import {
  accionCrearBodegaCourier,
  accionCrearBodegaSeller,
  accionEditarBodegaCourier,
  accionEditarBodegaSeller,
  type TipoBodega,
} from "./actions";

export interface BodegaParaEditar {
  id: string;
  nombre: string;
  direccion: string;
  comuna: string;
  instruccionesAcceso: string | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  esPrincipal: boolean;
  /** Solo tiene sentido para `tipo === "seller"` — `null` = hereda el monto general. */
  montoVisitaClp: number | null;
}

interface Props {
  tipo: TipoBodega;
  /** Requerido al CREAR una bodega de seller (edición no lo necesita). */
  sellerId?: string;
  bodegaExistente?: BodegaParaEditar;
  /** Solo relevante al crear: ¿será la primera bodega de este seller/courier? */
  esPrimera?: boolean;
  /** La OTRA bodega principal (si existe), para avisar "esto la reemplazará". */
  principalActual?: { id: string; nombre: string } | null;
  /**
   * Monto general del courier (`courier_config_retiro.monto_visita_bodega_clp`),
   * solo para mostrarlo en el placeholder del override — nunca se envía en el
   * formulario. `null` si el courier todavía no lo configuró. Ignorado cuando
   * `tipo === "courier"` (esa tabla no tiene el campo).
   */
  montoVisitaDefaultClp?: number | null;
  trigger?: React.ReactNode;
  onGuardada: () => void;
}

export function PanelBodega({
  tipo,
  sellerId,
  bodegaExistente,
  esPrimera = false,
  principalActual = null,
  montoVisitaDefaultClp = null,
  trigger,
  onGuardada,
}: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [esPrincipal, setEsPrincipal] = useState(
    bodegaExistente?.esPrincipal ?? false,
  );

  const esEdicion = !!bodegaExistente;
  const conContacto = tipo === "seller";
  const muestraLineaPrimera = esPrimera && !esEdicion;

  function alCambiarApertura(v: boolean) {
    setOpen(v);
    if (v) {
      setError(null);
      setEsPrincipal(bodegaExistente?.esPrincipal ?? false);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!esEdicion && tipo === "seller" && !sellerId) {
      setError("Falta el seller.");
      return;
    }

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const resultado = esEdicion
        ? tipo === "seller"
          ? await accionEditarBodegaSeller(bodegaExistente.id, formData)
          : await accionEditarBodegaCourier(bodegaExistente.id, formData)
        : tipo === "seller"
          ? await accionCrearBodegaSeller(sellerId as string, formData)
          : await accionCrearBodegaCourier(formData);

      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setOpen(false);
      onGuardada();
    });
  }

  return (
    <Sheet open={open} onOpenChange={alCambiarApertura}>
      <SheetTrigger asChild>
        {trigger ?? <Button size="sm">Agregar bodega</Button>}
      </SheetTrigger>
      {/* ⚠️ El `!` en el ancho: `SheetContent` trae
          `data-[side=right]:sm:max-w-sm` en su clase base y un selector con
          atributo de datos le gana a una utilidad suelta. */}
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:w-[430px] sm:max-w-[430px]!"
      >
        <SheetHeader className="gap-1 border-b-2 border-fg px-4 py-3.5">
          <SheetTitle className="text-base font-semibold">
            {esEdicion
              ? (bodegaExistente?.nombre ?? "Editar bodega")
              : "Nueva bodega"}
          </SheetTitle>
          <SheetDescription className="text-xs text-fg-muted">
            {tipo === "seller"
              ? "Dónde retira el conductor los pedidos de este seller."
              : "De dónde sale tu flota a repartir."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-4 py-4">
          {/* Respaldo del checkbox de más abajo — siempre presente, aunque la
              UI no lo muestre cuando es la primera bodega. */}
          <input
            type="hidden"
            name="es_principal"
            value={esPrincipal ? "true" : "false"}
          />

          {/* ── 1 · DÓNDE QUEDA ── */}
          <div className="space-y-3 border border-line bg-bg-inset p-3.5">
            <p className="font-mono text-[9px] leading-normal tracking-[0.12em] text-fg-muted uppercase">
              Dónde queda
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="nombre">Nombre de la bodega</Label>
              <Input
                id="nombre"
                name="nombre"
                required
                placeholder="Ej: Bodega Quilicura"
                defaultValue={bodegaExistente?.nombre ?? ""}
                disabled={isPending}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="direccion">Dirección</Label>
                <Input
                  id="direccion"
                  name="direccion"
                  required
                  placeholder="Calle y número"
                  defaultValue={bodegaExistente?.direccion ?? ""}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="comuna">Comuna</Label>
                <Select
                  name="comuna"
                  required
                  defaultValue={bodegaExistente?.comuna}
                  disabled={isPending}
                >
                  <SelectTrigger id="comuna" className="h-9 w-full">
                    <SelectValue placeholder="Selecciona una comuna" />
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
            </div>
          </div>

          {/* ── 2 · A QUIÉN LLAMAR ── */}
          {conContacto && (
            <div className="space-y-3 border border-line bg-bg-inset p-3.5">
              <p className="font-mono text-[9px] leading-normal tracking-[0.12em] text-fg-muted uppercase">
                A quién llamar
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="contacto_nombre">Nombre</Label>
                  <Input
                    id="contacto_nombre"
                    name="contacto_nombre"
                    placeholder="Nombre del jefe de bodega"
                    defaultValue={bodegaExistente?.contactoNombre ?? ""}
                    disabled={isPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contacto_telefono">Teléfono</Label>
                  <Input
                    id="contacto_telefono"
                    name="contacto_telefono"
                    type="tel"
                    placeholder="+56 9 1234 5678"
                    defaultValue={bodegaExistente?.contactoTelefono ?? ""}
                    disabled={isPending}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── 3 · CÓMO ENTRAR ── */}
          <div className="space-y-3 border border-line bg-bg-inset p-3.5">
            <p className="font-mono text-[9px] leading-normal tracking-[0.12em] text-fg-muted uppercase">
              Cómo entrar
            </p>
            <div className="space-y-1.5">
              <Textarea
                id="instrucciones_acceso"
                name="instrucciones_acceso"
                rows={3}
                placeholder="Portón lateral, timbre 2. Preguntar por Marcela."
                defaultValue={bodegaExistente?.instruccionesAcceso ?? ""}
                disabled={isPending}
              />
              {/* 🔴 Declara quién lo lee y dónde NO va. Sin esto, quien escribe
                  «preguntar por Marcela» no sabe si va a terminar impreso en un
                  bulto que ve el destinatario — y si lo cree, escribe menos de
                  lo que el conductor necesita. */}
              <p className="text-xs text-fg-subtle">
                Esto lo lee el conductor en su app.{" "}
                <span className="font-medium text-fg-muted">
                  No va en la etiqueta del paquete.
                </span>
              </p>
            </div>
          </div>

          {/* ── 4 · CUÁNTO SE PAGA POR IR ──
              ⚠️ Solo en las bodegas del SELLER. El tablero lo dice al revés; el
              porqué está en la cabecera del archivo. */}
          {conContacto && (
            <div className="space-y-3 border border-line bg-bg-inset p-3.5">
              <p className="font-mono text-[9px] leading-normal tracking-[0.12em] text-fg-muted uppercase">
                Pago por visita a esta bodega
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="monto_visita_clp">
                  Monto por visita cerrada
                </Label>
                <Input
                  id="monto_visita_clp"
                  name="monto_visita_clp"
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={bodegaExistente?.montoVisitaClp ?? ""}
                  placeholder="Vacío = usa el monto general del courier"
                  disabled={isPending}
                />
                <p className="text-xs text-muted-foreground">
                  Lo que le pagas al conductor por cerrar una visita en ESTA
                  bodega.{" "}
                  {montoVisitaDefaultClp !== null
                    ? `Vacío = usa el monto general del courier (${formatearCLP(montoVisitaDefaultClp)}).`
                    : "Vacío = usa el monto general del courier — todavía no lo configuras en Configuración → Retiro."}
                </p>
              </div>
            </div>
          )}

          {muestraLineaPrimera ? (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Esta será tu bodega principal (es la primera).
            </p>
          ) : (
            <div className="space-y-1.5">
              <label
                htmlFor="es_principal_check"
                className="flex cursor-pointer items-start gap-2.5 text-sm"
              >
                <Checkbox
                  id="es_principal_check"
                  checked={esPrincipal}
                  onCheckedChange={(v) => setEsPrincipal(v === true)}
                  disabled={isPending}
                  className="mt-0.5"
                />
                <span className="text-foreground">
                  Marcar como{" "}
                  {tipo === "seller"
                    ? "bodega principal de este seller"
                    : "tu bodega principal"}
                </span>
              </label>
              {esPrincipal && principalActual && (
                <p className="pl-6 text-xs text-muted-foreground">
                  Reemplazará a «{principalActual.nombre}» como principal.
                </p>
              )}
              {!esPrincipal && bodegaExistente?.esPrincipal && (
                <p className="pl-6 text-xs text-muted-foreground">
                  Si guardas sin marcarla, quedará sin bodega principal hasta
                  que elijas otra.
                </p>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {/* Guardado explícito al pie. La acción destructiva NO va acá: vive
              en la tarjeta del listado, separada, que es la regla del bloque —
              nunca junto a «Guardar». */}
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" loading={isPending}>
              {esEdicion ? "Guardar" : "Crear la bodega"}
            </Button>
            <SheetClose asChild>
              <Button type="button" variant="outline" disabled={isPending}>
                Volver
              </Button>
            </SheetClose>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
