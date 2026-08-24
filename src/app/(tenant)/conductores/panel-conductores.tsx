"use client";

/**
 * Panel de configuración de conductores (F6, ítem 1.3).
 *
 * Permite al coordinador/supervisor gestionar por conductor:
 *   - Disponibilidad (toggle activo/no-disponible).
 *   - Capacidad de paradas (número).
 *   - Zonas preferentes (multiselect).
 *   - Marcar no disponible + redistribuir paradas.
 *
 * El botón "Auto-asignar pendientes del día" que vivía aquí (duplicado del
 * que tenía la vista de manifiestos) se retiró el 2026-08-12 — Etapa 0 de
 * `docs/arquitectura/retiro-y-ruteo-plan.md` — y todo el camino de
 * auto-asignación en bloque se eliminó por completo el 2026-08-14. Ver el
 * comentario de cabecera de `src/modules/operacion/auto-asignacion.ts` para
 * el porqué. "Marcar no disponible + redistribuir" es una función DISTINTA y
 * sigue activa: solo mueve las paradas de un conductor puntual, no barre
 * pedidos sueltos del día.
 *
 * Patrón reutilizado de panel-zonas.tsx: estado local inicializado desde
 * server component, server actions para mutaciones, diseño de cards.
 */

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  MapPin,
  RefreshCw,
  ShieldAlert,
  UserPlus,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { semaforoSla } from "@/lib/ui/semaforo-sla";
import { esRutValido } from "@/modules/identidad/rut";
import type { Conductor, ConductorZona, Zona, ImpactoSla } from "@/modules/operacion/tipos";
import {
  actionActualizarZonasConductor,
  actionActualizarDatosBancarios,
  actionCrearConductor,
  obtenerZonasConductor,
} from "./actions";
import { actionMarcarConductorNoDisponible } from "../manifiestos/actions";

// =============================================================================
// Panel principal
// =============================================================================


// =============================================================================
// Dialog — Nuevo conductor (F2 "Ola 1", ítem G)
// =============================================================================

export function DialogNuevoConductor({ onCreado }: { onCreado: (c: Conductor) => void }) {
  const [open, setOpen] = useState(false);
  const [nombreCompleto, setNombreCompleto] = useState("");
  const [rut, setRut] = useState("");
  const [tipoRelacion, setTipoRelacion] = useState<"dependiente" | "independiente">("dependiente");
  const [errorRut, setErrorRut] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avisoLimite, setAvisoLimite] = useState<{
    mensaje: string;
    usoActual: number;
    limite: number;
  } | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function resetear() {
    setNombreCompleto("");
    setRut("");
    setTipoRelacion("dependiente");
    setErrorRut(null);
    setError(null);
    setAvisoLimite(null);
  }

  function validarRutInline(valor: string) {
    if (!valor.trim()) {
      setErrorRut(null);
      return;
    }
    setErrorRut(esRutValido(valor) ? null : "RUT inválido. Verifica el número y el dígito verificador.");
  }

  function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAvisoLimite(null);

    const nombreLimpio = nombreCompleto.trim();
    if (nombreLimpio.length < 2) {
      setError("El nombre completo debe tener al menos 2 caracteres.");
      return;
    }
    if (!esRutValido(rut)) {
      setErrorRut("RUT inválido. Verifica el número y el dígito verificador.");
      return;
    }

    const formData = new FormData();
    formData.set("nombre_completo", nombreLimpio);
    formData.set("rut", rut);
    formData.set("tipo_relacion", tipoRelacion);

    iniciarTransicion(async () => {
      const resp = await actionCrearConductor(formData);
      if (!resp.ok) {
        if (resp.motivo === "limite_alcanzado") {
          setAvisoLimite({ mensaje: resp.mensaje, usoActual: resp.usoActual, limite: resp.limite });
        } else {
          setError(resp.mensaje);
        }
        return;
      }
      onCreado(resp.conductor);
      setOpen(false);
      resetear();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetear();
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="size-4" aria-hidden="true" />
          Crear conductor
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crear conductor</DialogTitle>
        </DialogHeader>

        <form onSubmit={guardar} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nuevo-conductor-nombre">Nombre completo</Label>
            <Input
              id="nuevo-conductor-nombre"
              value={nombreCompleto}
              onChange={(e) => {
                setNombreCompleto(e.target.value);
                setError(null);
              }}
              placeholder="Ej: Juan Pérez Soto"
              disabled={pendiente}
              autoComplete="off"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="nuevo-conductor-rut">RUT</Label>
            <Input
              id="nuevo-conductor-rut"
              value={rut}
              onChange={(e) => {
                setRut(e.target.value);
                validarRutInline(e.target.value);
                setError(null);
              }}
              placeholder="12345678-9"
              disabled={pendiente}
              autoComplete="off"
              aria-invalid={Boolean(errorRut)}
              aria-describedby={errorRut ? "nuevo-conductor-rut-error" : undefined}
              required
            />
            {errorRut && (
              <p id="nuevo-conductor-rut-error" className="text-xs text-destructive">
                {errorRut}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="nuevo-conductor-relacion">Tipo de relación</Label>
            <Select
              value={tipoRelacion}
              onValueChange={(v) => setTipoRelacion(v as "dependiente" | "independiente")}
              disabled={pendiente}
            >
              <SelectTrigger id="nuevo-conductor-relacion">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dependiente">Dependiente (contrato de trabajo)</SelectItem>
                <SelectItem value="independiente">Independiente (boleta de honorarios)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {avisoLimite && (
            <Alert className="border-warning bg-warning-subtle text-warning-subtle-foreground">
              <AlertTriangle className="text-warning" />
              <AlertDescription>
                <p>{avisoLimite.mensaje}</p>
                <p className="mt-1 text-xs tabular-nums opacity-80">
                  {avisoLimite.usoActual} de {avisoLimite.limite} conductores en tu plan actual.
                </p>
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link href="/configuracion/plan">Ver mi plan</Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pendiente}>
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pendiente || Boolean(errorRut)}>
              {pendiente ? (
                <>
                  <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                  Creando…
                </>
              ) : (
                "Crear conductor"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Botón auto-asignar pendientes del día — RETIRADO (2026-08-12), y todo el
// camino de auto-asignación en bloque ELIMINADO (2026-08-14)
// =============================================================================
//
// Vivía aquí un botón duplicado del que tenía la vista de manifiestos (mismo
// resultado, dos lugares); se retiró primero por quedar sin consumidor. El
// resto del camino (Server Action, guarda y motor) se desactivó en la
// Etapa 0 de docs/arquitectura/retiro-y-ruteo-plan.md y se eliminó por
// completo al quedar inalcanzable — ver el comentario de cabecera de
// src/modules/operacion/auto-asignacion.ts para el porqué.

// =============================================================================
// Tarjeta de conductor — toggle disponibilidad, capacidad, zonas, redistribución
// =============================================================================

export function EditorZonasConductor({
  conductor,
  zonasTenant,
}: {
  conductor: Conductor;
  zonasTenant: Zona[];
}) {
  const [zonasSeleccionadas, setZonasSeleccionadas] = useState<string[]>([]);
  const [cargado, setCargado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [pendiente, iniciarTransicion] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  async function cargar() {
    if (cargado) return;
    setCargando(true);
    const resp = await obtenerZonasConductor(conductor.id);
    setCargando(false);
    if (resp.ok) {
      setZonasSeleccionadas(resp.datos.map((z: ConductorZona) => z.zonaId));
      setCargado(true);
    } else {
      setError(resp.mensaje);
    }
  }

  function toggleZona(zonaId: string) {
    setError(null);
    setExito(null);
    setZonasSeleccionadas((prev) =>
      prev.includes(zonaId) ? prev.filter((z) => z !== zonaId) : [...prev, zonaId],
    );
  }

  function guardar() {
    setError(null);
    setExito(null);
    iniciarTransicion(async () => {
      const resp = await actionActualizarZonasConductor(conductor.id, zonasSeleccionadas);
      if (!resp.ok) {
        setError(resp.mensaje);
        return;
      }
      setExito(
        zonasSeleccionadas.length > 0
          ? `${zonasSeleccionadas.length} zona${zonasSeleccionadas.length !== 1 ? "s" : ""} preferente${zonasSeleccionadas.length !== 1 ? "s" : ""} guardada${zonasSeleccionadas.length !== 1 ? "s" : ""}.`
          : "Conductor sin preferencia de zona (acepta cualquier pedido).",
      );
    });
  }

  if (zonasTenant.length === 0) {
    return (
      <div>
        <p className="text-sm font-medium text-foreground mb-1">Zonas preferentes</p>
        <p className="text-sm text-muted-foreground">
          Aún no tienes zonas configuradas.{" "}
          <a href="/configuracion/zonas" className="underline hover:text-foreground">
            Configúralas aquí.
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Zonas preferentes</p>
        {!cargado && (
          <Button variant="ghost" size="sm" onClick={cargar} disabled={cargando}>
            {cargando ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {cargando ? "Cargando…" : "Ver y editar zonas"}
          </Button>
        )}
      </div>

      {cargado && (
        <>
          <div
            className="grid grid-cols-2 gap-1.5 rounded-lg border border-border p-3 sm:grid-cols-3"
            role="group"
            aria-label="Zonas preferentes del conductor"
          >
            {zonasTenant.map((zona) => {
              const checked = zonasSeleccionadas.includes(zona.id);
              return (
                <label
                  key={zona.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                    checked ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                  } ${!zona.activa ? "opacity-50" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => zona.activa && toggleZona(zona.id)}
                    disabled={!zona.activa || pendiente}
                    className="size-3.5 accent-primary"
                  />
                  <MapPin className="size-3 shrink-0" aria-hidden="true" />
                  {zona.nombre}
                </label>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            Sin selección = el conductor acepta pedidos de cualquier zona.
          </p>

          {error && (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {exito && (
            <Alert className="bg-success-subtle text-success-subtle-foreground">
              <CheckCircle2 className="text-success" />
              <AlertDescription>{exito}</AlertDescription>
            </Alert>
          )}

          <Button onClick={guardar} disabled={pendiente} variant="outline" size="sm">
            {pendiente ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {pendiente ? "Guardando…" : "Guardar zonas"}
          </Button>
        </>
      )}
    </div>
  );
}

// =============================================================================
// Editor de datos bancarios del conductor
// =============================================================================

const BANCOS_CHILE = [
  "Banco de Chile",
  "BCI",
  "Banco Estado",
  "Santander Chile",
  "Scotiabank Chile",
  "Itaú Chile",
  "BICE",
] as const;

const ETIQUETAS_TIPO_CUENTA: Record<string, string> = {
  corriente: "Cuenta corriente",
  vista: "Cuenta vista",
  ahorro: "Cuenta de ahorro",
};

export function EditorDatosBancarios({
  conductor,
  puedeEditar,
  onActualizado,
}: {
  conductor: Conductor;
  puedeEditar: boolean;
  onActualizado: (c: Conductor) => void;
}) {
  const tieneDatos = Boolean(conductor.banco && conductor.tipoCuenta && conductor.numeroCuenta);
  const [editando, setEditando] = useState(false);
  const [banco, setBanco] = useState(conductor.banco ?? "");
  const [tipoCuenta, setTipoCuenta] = useState(conductor.tipoCuenta ?? "");
  const [numeroCuenta, setNumeroCuenta] = useState("");
  const [pendiente, iniciarTransicion] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  function abrirEditor() {
    setBanco(conductor.banco ?? "");
    setTipoCuenta(conductor.tipoCuenta ?? "");
    setNumeroCuenta(""); // no pre-cargar el número completo por seguridad
    setError(null);
    setExito(null);
    setEditando(true);
  }

  function cancelar() {
    setEditando(false);
    setError(null);
    setExito(null);
  }

  function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setExito(null);

    if (!banco) {
      setError("Selecciona un banco.");
      return;
    }
    if (!tipoCuenta) {
      setError("Selecciona el tipo de cuenta.");
      return;
    }
    if (!numeroCuenta || numeroCuenta.length < 4) {
      setError("El número de cuenta debe tener al menos 4 dígitos.");
      return;
    }
    if (!/^\d+$/.test(numeroCuenta)) {
      setError("El número de cuenta debe contener solo dígitos.");
      return;
    }

    iniciarTransicion(async () => {
      const resp = await actionActualizarDatosBancarios(conductor.id, {
        banco,
        tipoCuenta,
        numeroCuenta,
      });
      if (!resp.ok) {
        setError(resp.mensaje);
        return;
      }
      onActualizado(resp.datos);
      setExito("Datos bancarios guardados correctamente.");
      setEditando(false);
    });
  }

  return (
    <div className="space-y-3">
      {/* Encabezado de sección */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Banknote className="size-4 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">Datos bancarios</p>
        </div>
        {puedeEditar && !editando && (
          <Button variant="ghost" size="sm" onClick={abrirEditor}>
            {tieneDatos ? "Editar" : "Agregar"}
          </Button>
        )}
      </div>

      {/* Estado actual — sin editar */}
      {!editando && (
        <>
          {tieneDatos ? (
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                <span className="font-medium text-foreground">{conductor.banco}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  {conductor.tipoCuenta ? ETIQUETAS_TIPO_CUENTA[conductor.tipoCuenta] : ""}
                </span>
              </div>
              <p className="text-sm text-muted-foreground pl-6 font-mono tracking-wide">
                {conductor.numeroCuenta
                  ? `••••${conductor.numeroCuenta.slice(-4)}`
                  : ""}
              </p>
            </div>
          ) : (
            <Badge
              variant="warning"
              className="gap-1.5 text-xs"
              aria-label="Conductor sin datos bancarios — no puede recibir pagos"
            >
              <AlertTriangle className="size-3" aria-hidden="true" />
              Sin datos bancarios — el conductor no puede recibir pagos
            </Badge>
          )}
          {exito && (
            <Alert className="bg-success-subtle text-success-subtle-foreground">
              <CheckCircle2 className="text-success" />
              <AlertDescription>{exito}</AlertDescription>
            </Alert>
          )}
        </>
      )}

      {/* Formulario de edición */}
      {editando && (
        <form onSubmit={guardar} className="space-y-4 rounded-lg border border-border p-4">
          {/* Banco */}
          <div className="space-y-2">
            <Label htmlFor={`banco-${conductor.id}`}>Banco</Label>
            <Select
              value={banco}
              onValueChange={(v) => {
                setBanco(v);
                setError(null);
                setExito(null);
              }}
              disabled={pendiente}
            >
              <SelectTrigger id={`banco-${conductor.id}`}>
                <SelectValue placeholder="Selecciona un banco…" />
              </SelectTrigger>
              <SelectContent>
                {BANCOS_CHILE.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tipo de cuenta */}
          <div className="space-y-2">
            <Label htmlFor={`tipo-cuenta-${conductor.id}`}>Tipo de cuenta</Label>
            <Select
              value={tipoCuenta}
              onValueChange={(v) => {
                setTipoCuenta(v);
                setError(null);
                setExito(null);
              }}
              disabled={pendiente}
            >
              <SelectTrigger id={`tipo-cuenta-${conductor.id}`}>
                <SelectValue placeholder="Selecciona tipo…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="corriente">Cuenta corriente</SelectItem>
                <SelectItem value="vista">Cuenta vista</SelectItem>
                <SelectItem value="ahorro">Cuenta de ahorro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Número de cuenta */}
          <div className="space-y-2">
            <Label htmlFor={`numero-cuenta-${conductor.id}`}>Número de cuenta</Label>
            <Input
              id={`numero-cuenta-${conductor.id}`}
              type="text"
              inputMode="numeric"
              pattern="\d*"
              placeholder="Ingresa el número de cuenta"
              value={numeroCuenta}
              onChange={(e) => {
                setNumeroCuenta(e.target.value.replace(/\D/g, ""));
                setError(null);
                setExito(null);
              }}
              disabled={pendiente}
              autoComplete="off"
              aria-describedby={`numero-cuenta-hint-${conductor.id}`}
            />
            <p
              id={`numero-cuenta-hint-${conductor.id}`}
              className="text-xs text-muted-foreground"
            >
              Solo dígitos. El número se guardará de forma segura; solo verás los últimos 4.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pendiente}>
              {pendiente ? (
                <>
                  <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                  Guardando…
                </>
              ) : (
                "Guardar datos bancarios"
              )}
            </Button>
            <Button type="button" variant="ghost" onClick={cancelar} disabled={pendiente}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// =============================================================================
// Sección redistribución — marcar no disponible + panel de impacto SLA
// =============================================================================

export function SeccionRedistribucion({
  conductor,
  fechaHoy,
  onActualizado,
}: {
  conductor: Conductor;
  fechaHoy: string;
  onActualizado: (c: Conductor) => void;
}) {
  const [dialogAbierto, setDialogAbierto] = useState(false);
  const [pendiente, iniciarTransicion] = useTransition();
  const [impactoSla, setImpactoSla] = useState<ImpactoSla[] | null>(null);
  const [resumen, setResumen] = useState<{
    reasignadas: number;
    sinConductor: number;
    idempotente: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Redistribuir mueve las paradas de un conductor a otros y no se deshace. El
  // motivo va a la bitácora junto al hecho: es lo que hace legible mañana ese
  // movimiento, y lo pide igual la misma acción desde el detalle del manifiesto.
  const [motivo, setMotivo] = useState("");

  function abrir() {
    setImpactoSla(null);
    setResumen(null);
    setError(null);
    setMotivo("");
    setDialogAbierto(true);
  }

  function confirmar() {
    setError(null);
    iniciarTransicion(async () => {
      const resp = await actionMarcarConductorNoDisponible(conductor.id, motivo, fechaHoy);
      if (!resp.ok) {
        setError(resp.mensaje);
        return;
      }
      const datos = resp.datos;
      setImpactoSla(datos.impactoSla);
      setResumen({
        reasignadas: datos.paradasReasignadas.length,
        sinConductor: datos.paradasSinConductor.length,
        idempotente: datos.idempotente,
      });
      // Actualizar estado local del conductor
      onActualizado({ ...conductor, disponible: false });
    });
  }

  const mostrarConfirmacion = !resumen && !error;

  return (
    <>
      <div className="rounded-lg border border-warning bg-warning-subtle/30 px-4 py-3 flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-warning-subtle-foreground">
            Marcar como no disponible
          </p>
          <p className="text-xs text-muted-foreground">
            Desactiva al conductor para hoy y redistribuye sus paradas abiertas.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={abrir} className="shrink-0 border-warning">
          <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
          Marcar y redistribuir
        </Button>
      </div>

      {dialogAbierto && (
        <DialogRedistribucion
          conductor={conductor}
          pendiente={pendiente}
          motivo={motivo}
          onMotivo={setMotivo}
          mostrarConfirmacion={mostrarConfirmacion}
          error={error}
          resumen={resumen}
          impactoSla={impactoSla}
          onConfirmar={confirmar}
          onCerrar={() => setDialogAbierto(false)}
        />
      )}
    </>
  );
}

// =============================================================================
// Dialog redistribución con panel de impacto SLA
// =============================================================================

interface PropsDialogRedistribucion {
  conductor: Conductor;
  pendiente: boolean;
  motivo: string;
  onMotivo: (valor: string) => void;
  mostrarConfirmacion: boolean;
  error: string | null;
  resumen: { reasignadas: number; sinConductor: number; idempotente: boolean } | null;
  impactoSla: ImpactoSla[] | null;
  onConfirmar: () => void;
  onCerrar: () => void;
}

function DialogRedistribucion({
  conductor,
  pendiente,
  motivo,
  onMotivo,
  mostrarConfirmacion,
  error,
  resumen,
  impactoSla,
  onConfirmar,
  onCerrar,
}: PropsDialogRedistribucion) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="dialog-redistrib-titulo"
      aria-describedby="dialog-redistrib-desc"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <div
        className="absolute inset-0 bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
        onClick={() => !pendiente && onCerrar()}
        aria-hidden="true"
      />
      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          <div className="flex-1">
            <h2 id="dialog-redistrib-titulo" className="font-semibold">
              Marcar a {conductor.nombre} como no disponible
            </h2>

            {mostrarConfirmacion && (
              <>
                <p id="dialog-redistrib-desc" className="mt-2 text-sm text-muted-foreground">
                  Se marcará al conductor como no disponible y sus paradas abiertas de hoy se
                  redistribuirán automáticamente entre los conductores restantes del pool.
                  Las paradas en ruta o terminales no se tocan.
                </p>
                <div className="mt-4 space-y-1.5">
                  <Label htmlFor="motivo-redistribuir">Motivo</Label>
                  <Textarea
                    id="motivo-redistribuir"
                    rows={2}
                    value={motivo}
                    onChange={(e) => onMotivo(e.target.value)}
                    placeholder="Se accidentó y no puede seguir la ruta."
                  />
                  <p className="text-xs text-muted-foreground">
                    Queda en la bitácora con tu nombre, junto a la redistribución.
                  </p>
                </div>
              </>
            )}

            {pendiente && (
              <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                Redistribuyendo paradas…
              </div>
            )}

            {error && (
              <Alert variant="destructive" className="mt-4">
                <ShieldAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {resumen && (
              <div className="mt-4 space-y-4">
                <Alert className="bg-success-subtle text-success-subtle-foreground">
                  <CheckCircle2 className="text-success" />
                  <AlertDescription>
                    {resumen.idempotente
                      ? "El conductor ya estaba no disponible. No había paradas que redistribuir."
                      : `${resumen.reasignadas} parada${resumen.reasignadas !== 1 ? "s" : ""} redistribuida${resumen.reasignadas !== 1 ? "s" : ""}${resumen.sinConductor > 0 ? ` · ${resumen.sinConductor} sin receptor` : ""}.`}
                  </AlertDescription>
                </Alert>

                {impactoSla && impactoSla.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      Impacto en SLA por seller
                    </p>
                    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                      {impactoSla.map((item) => {
                        const semaforo = semaforoSla(item.slaPctActual, item.objetivoPct);
                        return (
                          <div key={item.sellerId} className="flex items-center justify-between gap-4 px-4 py-3">
                            <div>
                              <p className="text-sm font-medium">{item.sellerNombre}</p>
                              {item.paradasSinConductor > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  {item.paradasSinConductor} parada{item.paradasSinConductor !== 1 ? "s" : ""} sin conductor
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <span className="tabular-nums text-muted-foreground">
                                {item.slaPctActual !== null ? `${item.slaPctActual.toFixed(1)}%` : "—"}
                              </span>
                              <span className="text-muted-foreground">/</span>
                              <span className="tabular-nums text-muted-foreground">
                                obj. {item.objetivoPct}%
                              </span>
                              <span
                                className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${semaforo.color === "verde" ? "bg-success-subtle text-success-subtle-foreground" : semaforo.color === "amarillo" ? "bg-warning-subtle text-warning-subtle-foreground" : "bg-destructive-subtle text-destructive-subtle-foreground"}`}
                                aria-label={semaforo.etiqueta}
                              >
                                {semaforo.etiqueta}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {resumen.sinConductor > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Las paradas sin receptor quedaron en estado{" "}
                    <strong>pendiente de asignación</strong> y pueden reasignarse manualmente.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={onCerrar} disabled={pendiente}>
            {resumen || error ? "Cerrar" : "Cancelar"}
          </Button>
          {mostrarConfirmacion && (
            <Button
              onClick={onConfirmar}
              disabled={pendiente || motivo.trim().length < 3}
              className="bg-warning text-warning-foreground hover:bg-warning/90"
            >
              {pendiente ? (
                <>
                  <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                  Procesando…
                </>
              ) : (
                "Confirmar y redistribuir"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
