"use client";

/**
 * Alta de un courier nuevo desde el backstage (un solo acto).
 * =============================================================================
 *
 * Crea el courier, invita al dueño por correo, enciende sus áreas y le asigna
 * el plan — todo en `accionCrearCourier`. La pantalla solo recoge datos y
 * cuenta lo que pasó.
 *
 * ⚠️ Sobre la precarga: los datos que llegan por `/agendar` viven solo en un
 * correo al equipo, no en una tabla, así que hoy no hay de dónde precargar y el
 * formulario arranca en blanco. El día que exista una bandeja de leads, este es
 * el sitio donde entraría.
 *
 * ⚠️ El RUT se valida en el cliente con el MISMO mensaje que produce el backend
 * (`normalizarYValidarRut`), como en `/registro`: el dueño no debería ver un
 * mensaje distinto según dónde se dé de alta.
 *
 * ⚠️ El diálogo tiene muchos campos: el contenido scrollea dentro de sí mismo
 * (`max-h` + `overflow-y-auto`) para que en un viewport bajo el botón de crear
 * siga siendo alcanzable — ver la lección de modales que no caben.
 */

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { esRutValido } from "@/modules/identidad/rut";
import { enmascararRut, limpiarMascaraRut } from "@/lib/formato-cl";
import type { Plan } from "@/modules/plataforma/tipos";
import { textoTarifaPlan } from "../tarifa-plan";
import { accionCrearCourier } from "./alta-actions";

const MENSAJE_RUT_INVALIDO = "El dígito verificador no corresponde a este RUT.";
const MENSAJE_RUT_FORMATO = "Ingresa el RUT con el formato 12.345.678-9.";
/** Valor centinela del select cuando todavía no se le pone plan. Radix Select
 *  no admite un `SelectItem` con `value=""`, así que se usa una etiqueta y se
 *  traduce a "" antes de enviar. */
const SIN_PLAN = "__sin_plan__";

interface Props {
  planes: Plan[];
}

export function DialogNuevoCourier({ planes }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rut, setRut] = useState("");
  const [errorRut, setErrorRut] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string>(planes[0]?.id ?? SIN_PLAN);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reiniciar() {
    setRut("");
    setErrorRut(null);
    setPlanId(planes[0]?.id ?? SIN_PLAN);
    setError(null);
    setAviso(null);
  }

  function validarRutAlPerderFoco() {
    const limpio = limpiarMascaraRut(rut);
    if (!limpio) return;
    if (!/^[0-9]{1,8}-[0-9kK]$/.test(limpio)) {
      setErrorRut(MENSAJE_RUT_FORMATO);
      return;
    }
    if (!esRutValido(limpio)) setErrorRut(MENSAJE_RUT_INVALIDO);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setAviso(null);

    const rutLimpio = limpiarMascaraRut(rut);
    if (!rutLimpio || !/^[0-9]{1,8}-[0-9kK]$/.test(rutLimpio) || !esRutValido(rutLimpio)) {
      setErrorRut(rutLimpio ? MENSAJE_RUT_INVALIDO : "El RUT del courier es obligatorio.");
      return;
    }

    const formData = new FormData(e.currentTarget);
    formData.set("rut", rutLimpio);
    // El centinela «sin plan» viaja como cadena vacía, que es lo que la acción
    // interpreta como «créalo sin plan».
    if (formData.get("plan_id") === SIN_PLAN) formData.set("plan_id", "");

    startTransition(async () => {
      const r = await accionCrearCourier(formData);
      if (!r.ok) {
        setError(r.mensaje ?? "No se pudo crear el courier.");
        return;
      }
      router.refresh();
      if (r.planAsignado) {
        // Éxito limpio: se cierra y se deja ver el courier ya en la lista.
        setOpen(false);
        reiniciar();
      } else {
        // Creado pero sin plan: NO se cierra, se muestra el aviso para que el
        // admin sepa que le falta un paso y no crea que quedó todo listo.
        setAviso(r.aviso ?? "El courier se creó, pero sin plan.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reiniciar();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Building2 className="size-4" aria-hidden="true" />
          Nuevo courier
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dar de alta un courier</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Se crea el courier, se invita al dueño por correo (define su propia
          contraseña al aceptar) y se le asigna el plan. El resto de los datos de
          la empresa los completa el dueño en su puesta en marcha.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset className="space-y-3" disabled={isPending}>
            <div className="space-y-1.5">
              <Label htmlFor="nc-fantasia">Nombre del courier</Label>
              <Input id="nc-fantasia" name="nombre_fantasia" required maxLength={120} placeholder="Despachos del Centro" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nc-razon">Razón social</Label>
              <Input id="nc-razon" name="razon_social" required maxLength={160} placeholder="Despachos del Centro SpA" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nc-rut">RUT de la empresa</Label>
              <Input
                id="nc-rut"
                name="rut"
                required
                inputMode="text"
                autoComplete="off"
                placeholder="76.543.210-9"
                value={rut}
                onChange={(e) => {
                  setRut(enmascararRut(e.target.value));
                  setErrorRut(null);
                }}
                onBlur={validarRutAlPerderFoco}
                aria-invalid={errorRut ? true : undefined}
                aria-describedby={errorRut ? "nc-rut-error" : undefined}
              />
              {errorRut ? (
                <p id="nc-rut-error" className="text-xs text-destructive">
                  {errorRut}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nc-dueno">Nombre del dueño</Label>
                <Input id="nc-dueno" name="nombre_dueno" required maxLength={120} placeholder="María Pérez" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nc-email">Correo del dueño</Label>
                <Input id="nc-email" name="email_dueno" type="email" required placeholder="dueno@courier.cl" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nc-plan">Plan</Label>
              <Select name="plan_id" value={planId} onValueChange={setPlanId}>
                <SelectTrigger id="nc-plan" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {planes.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre} — {textoTarifaPlan(p)}
                    </SelectItem>
                  ))}
                  {/* Nunca bloquea el alta: si no hay plan a mano, se crea sin
                      uno y se asigna después desde Suscripciones. */}
                  <SelectItem value={SIN_PLAN}>Sin plan por ahora</SelectItem>
                </SelectContent>
              </Select>
              {planes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No hay planes activos. Crea uno en Planes para poder cobrarle, o crea el
                  courier sin plan y asígnalo después.
                </p>
              ) : null}
            </div>

            {planId !== SIN_PLAN ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nc-estado">Estado inicial</Label>
                  <Select name="estado" defaultValue="trial">
                    <SelectTrigger id="nc-estado" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trial">Prueba</SelectItem>
                      <SelectItem value="activa">Activa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nc-trial">Prueba hasta (opcional)</Label>
                  <Input id="nc-trial" name="trial_hasta" type="date" />
                </div>
              </div>
            ) : null}
          </fieldset>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>No se pudo crear el courier</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {aviso ? (
            <Alert>
              <AlertTitle>Courier creado, con un paso pendiente</AlertTitle>
              <AlertDescription>{aviso}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            {aviso ? (
              // Tras un alta parcial, el formulario ya no sirve para reintentar
              // (el courier existe): el único botón sensato es cerrar.
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Entendido
                </Button>
              </DialogClose>
            ) : (
              <>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={isPending}>
                    Cancelar
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Creando…
                    </>
                  ) : (
                    "Crear e invitar"
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
