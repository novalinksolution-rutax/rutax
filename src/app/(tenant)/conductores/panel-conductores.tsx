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
 * Patrón reutilizado de panel-zonas.tsx: estado local inicializado desde
 * server component, server actions para mutaciones, diseño de cards.
 */

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MapPin,
  RefreshCw,
  ShieldAlert,
  ToggleLeft,
  ToggleRight,
  Truck,
  UserPlus,
  Users,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { semaforoSla } from "@/lib/ui/semaforo-sla";
import { esRutValido } from "@/modules/identidad/rut";
import type { Conductor, ConductorZona, Zona, ImpactoSla } from "@/modules/operacion/tipos";
import {
  actionToggleDisponibilidadConductor,
  actionActualizarCapacidadConductor,
  actionActualizarZonasConductor,
  actionActualizarDatosBancarios,
  actionCrearConductor,
  obtenerZonasConductor,
  type EstadoConductores,
} from "./actions";
import {
  actionAutoAsignarPendientes,
  actionMarcarConductorNoDisponible,
} from "../manifiestos/actions";

// =============================================================================
// Panel principal
// =============================================================================

interface Props {
  estadoInicial: EstadoConductores;
  fechaHoy: string;
  puedeEditarBanco: boolean;
}

export function PanelConductores({ estadoInicial, fechaHoy, puedeEditarBanco }: Props) {
  const [conductores, setConductores] = useState<Conductor[]>(estadoInicial.conductores);
  const zonas = estadoInicial.zonas;

  function onConductorActualizado(c: Conductor) {
    setConductores((prev) => prev.map((x) => (x.id === c.id ? c : x)));
  }

  function onConductorCreado(c: Conductor) {
    setConductores((prev) =>
      [...prev, c].sort((a, b) => a.nombre.localeCompare(b.nombre, "es-CL")),
    );
  }

  return (
    <div className="space-y-6">
      {/* Nuevo conductor */}
      <div className="flex justify-end">
        <DialogNuevoConductor onCreado={onConductorCreado} />
      </div>

      {/* Botón auto-asignar — acción rápida del día */}
      <BotonAutoAsignar fechaHoy={fechaHoy} />

      {/* Lista de conductores */}
      {conductores.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Users className="size-10 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Todavía no tienes conductores</p>
              <p className="text-sm text-muted-foreground">
                Crea el primero con &ldquo;Nuevo conductor&rdquo; arriba para empezar a armar tu
                pool del día.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {conductores.map((conductor) => (
            <TarjetaConductor
              key={conductor.id}
              conductor={conductor}
              zonasTenant={zonas}
              fechaHoy={fechaHoy}
              puedeEditarBanco={puedeEditarBanco}
              onActualizado={onConductorActualizado}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Dialog — Nuevo conductor (F2 "Ola 1", ítem G)
// =============================================================================

function DialogNuevoConductor({ onCreado }: { onCreado: (c: Conductor) => void }) {
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
          Nuevo conductor
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo conductor</DialogTitle>
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
// Botón auto-asignar pendientes del día
// =============================================================================

function BotonAutoAsignar({ fechaHoy }: { fechaHoy: string }) {
  const [dialogAbierto, setDialogAbierto] = useState(false);
  const [pendiente, iniciarTransicion] = useTransition();
  const [resultado, setResultado] = useState<{
    tipo: "exito" | "vacio";
    totalAsignados: number;
    totalSinAsignar: number;
    conductoresAfectados: number;
    sinAsignarDetalle: Array<{ motivo: string; cantidad: number }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function abrir() {
    setResultado(null);
    setError(null);
    setDialogAbierto(true);
  }

  function confirmar() {
    setError(null);
    iniciarTransicion(async () => {
      const resp = await actionAutoAsignarPendientes(fechaHoy);
      if (!resp.ok) {
        setError(resp.mensaje);
        return;
      }

      const datos = resp.datos;
      const totalAsignados = datos.asignados.reduce(
        (acc, a) => acc + a.pedidosAsignados.length,
        0,
      );

      // Agrupar sin-asignar por motivo.
      const porMotivo = new Map<string, number>();
      for (const p of datos.sinAsignar) {
        porMotivo.set(p.motivo, (porMotivo.get(p.motivo) ?? 0) + 1);
      }

      setResultado({
        tipo: totalAsignados > 0 ? "exito" : "vacio",
        totalAsignados,
        totalSinAsignar: datos.sinAsignar.length,
        conductoresAfectados: datos.conductoresAfectados.length,
        sinAsignarDetalle: [...porMotivo.entries()].map(([motivo, cantidad]) => ({
          motivo: traducirMotivoSinAsignar(motivo),
          cantidad,
        })),
      });
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-lg border bg-card px-5 py-4">
        <div>
          <p className="font-semibold">Auto-asignar pendientes del día</p>
          <p className="text-sm text-muted-foreground">
            Asigna automáticamente los pedidos sin conductor usando la heurística de zonas y cupo.
          </p>
        </div>
        <Button onClick={abrir} className="shrink-0">
          <Truck className="size-4" aria-hidden="true" />
          Auto-asignar
        </Button>
      </div>

      {dialogAbierto && (
        <DialogAutoAsignar
          pendiente={pendiente}
          resultado={resultado}
          error={error}
          onConfirmar={confirmar}
          onCerrar={() => setDialogAbierto(false)}
        />
      )}
    </>
  );
}

// =============================================================================
// Dialog auto-asignar
// =============================================================================

interface PropsDialogAutoAsignar {
  pendiente: boolean;
  resultado: {
    tipo: "exito" | "vacio";
    totalAsignados: number;
    totalSinAsignar: number;
    conductoresAfectados: number;
    sinAsignarDetalle: Array<{ motivo: string; cantidad: number }>;
  } | null;
  error: string | null;
  onConfirmar: () => void;
  onCerrar: () => void;
}

function DialogAutoAsignar({
  pendiente,
  resultado,
  error,
  onConfirmar,
  onCerrar,
}: PropsDialogAutoAsignar) {
  const mostrarConfirmacion = !resultado && !error;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="dialog-autoasig-titulo"
      aria-describedby="dialog-autoasig-desc"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <div
        className="absolute inset-0 bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
        onClick={() => !pendiente && onCerrar()}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-md rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <h2 id="dialog-autoasig-titulo" className="font-semibold text-lg">
          Auto-asignar pedidos pendientes
        </h2>

        {mostrarConfirmacion && (
          <p id="dialog-autoasig-desc" className="mt-2 text-sm text-muted-foreground">
            Se asignarán automáticamente todos los pedidos en estado{" "}
            <strong className="text-foreground">pendiente de asignación</strong> del día de hoy
            a los conductores disponibles según sus zonas y cupo.
          </p>
        )}

        {pendiente && (
          <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            Ejecutando auto-asignación…
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="mt-4">
            <ShieldAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {resultado && (
          <div className="mt-4 space-y-4">
            <Alert className={resultado.tipo === "exito" ? "bg-success-subtle text-success-subtle-foreground" : ""}>
              {resultado.tipo === "exito" ? (
                <CheckCircle2 className="text-success" />
              ) : (
                <AlertTriangle className="text-warning" />
              )}
              <AlertDescription>
                {resultado.tipo === "exito"
                  ? `${resultado.totalAsignados} pedido${resultado.totalAsignados !== 1 ? "s" : ""} asignado${resultado.totalAsignados !== 1 ? "s" : ""} a ${resultado.conductoresAfectados} conductor${resultado.conductoresAfectados !== 1 ? "es" : ""}.`
                  : "No hay pedidos pendientes de asignación para hoy."}
              </AlertDescription>
            </Alert>

            {resultado.sinAsignarDetalle.length > 0 && (
              <div className="rounded-lg border border-border p-4 space-y-2">
                <p className="text-sm font-medium text-foreground">
                  {resultado.totalSinAsignar} pedido{resultado.totalSinAsignar !== 1 ? "s" : ""} sin asignar
                </p>
                <ul className="space-y-1">
                  {resultado.sinAsignarDetalle.map(({ motivo, cantidad }) => (
                    <li key={motivo} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{motivo}</span>
                      <Badge variant="neutral">{cantidad}</Badge>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Puedes reasignarlos manualmente desde la vista de manifiestos.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onCerrar}
            disabled={pendiente}
          >
            {resultado || error ? "Cerrar" : "Cancelar"}
          </Button>
          {mostrarConfirmacion && (
            <Button onClick={onConfirmar} disabled={pendiente}>
              {pendiente ? (
                <>
                  <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                  Asignando…
                </>
              ) : (
                "Confirmar auto-asignación"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Tarjeta de conductor — toggle disponibilidad, capacidad, zonas, redistribución
// =============================================================================

interface PropsTarjetaConductor {
  conductor: Conductor;
  zonasTenant: Zona[];
  fechaHoy: string;
  puedeEditarBanco: boolean;
  onActualizado: (c: Conductor) => void;
}

function TarjetaConductor({
  conductor,
  zonasTenant,
  fechaHoy,
  puedeEditarBanco,
  onActualizado,
}: PropsTarjetaConductor) {
  const [expandida, setExpandida] = useState(false);
  const [pendienteToggle, iniciarToggle] = useTransition();
  const [msgToggle, setMsgToggle] = useState<string | null>(null);

  function toggleDisponibilidad() {
    setMsgToggle(null);
    iniciarToggle(async () => {
      const resp = await actionToggleDisponibilidadConductor(
        conductor.id,
        !conductor.disponible,
      );
      if (!resp.ok) {
        setMsgToggle(resp.mensaje);
        return;
      }
      onActualizado(resp.datos);
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        {/* Nombre + badges */}
        <div className="flex items-center gap-3">
          <Truck className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            {puedeEditarBanco ? (
              <Link
                href={`/conductores/${conductor.id}`}
                className="font-medium hover:underline"
              >
                {conductor.nombre}
              </Link>
            ) : (
              <p className="font-medium">{conductor.nombre}</p>
            )}
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <Badge variant={conductor.estado === "activo" ? "outline" : "neutral"}>
                {conductor.estado === "activo" ? "Activo" : "Inactivo"}
              </Badge>
              <Badge variant={conductor.disponible ? "success" : "warning"}>
                {conductor.disponible ? "Disponible" : "No disponible"}
              </Badge>
              <span className="text-xs text-muted-foreground tabular-nums">
                Cupo: {conductor.capacidadParadas} paradas
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Toggle disponibilidad rápida */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleDisponibilidad}
            disabled={pendienteToggle}
            aria-label={
              conductor.disponible
                ? `Marcar a ${conductor.nombre} como no disponible`
                : `Marcar a ${conductor.nombre} como disponible`
            }
          >
            {pendienteToggle ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : conductor.disponible ? (
              <ToggleRight className="size-5 text-success" />
            ) : (
              <ToggleLeft className="size-5 text-muted-foreground" />
            )}
          </Button>

          {/* Expandir configuración */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpandida((v) => !v)}
            aria-expanded={expandida}
            aria-label={expandida ? "Cerrar configuración" : "Abrir configuración"}
          >
            {expandida ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {msgToggle && (
        <div className="px-5 pb-2">
          <p className="text-xs text-destructive">{msgToggle}</p>
        </div>
      )}

      {expandida && (
        <CardContent className="border-t pt-5 space-y-6">
          {/* Capacidad */}
          <EditorCapacidad
            conductor={conductor}
            onActualizado={onActualizado}
          />

          {/* Zonas preferentes */}
          <EditorZonasConductor
            conductor={conductor}
            zonasTenant={zonasTenant}
          />

          {/* Datos bancarios */}
          <EditorDatosBancarios
            conductor={conductor}
            puedeEditar={puedeEditarBanco}
            onActualizado={onActualizado}
          />

          {/* Redistribución */}
          {conductor.disponible && (
            <SeccionRedistribucion
              conductor={conductor}
              fechaHoy={fechaHoy}
              onActualizado={onActualizado}
            />
          )}
        </CardContent>
      )}
    </Card>
  );
}

// =============================================================================
// Editor de capacidad de paradas
// =============================================================================

function EditorCapacidad({
  conductor,
  onActualizado,
}: {
  conductor: Conductor;
  onActualizado: (c: Conductor) => void;
}) {
  const [valor, setValor] = useState(String(conductor.capacidadParadas));
  const [pendiente, iniciarTransicion] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setExito(null);
    const cap = parseInt(valor, 10);
    if (isNaN(cap) || cap < 1) {
      setError("La capacidad debe ser un número entero mayor a 0.");
      return;
    }
    iniciarTransicion(async () => {
      const resp = await actionActualizarCapacidadConductor(conductor.id, cap);
      if (!resp.ok) {
        setError(resp.mensaje);
        return;
      }
      onActualizado(resp.datos);
      setExito(`Capacidad actualizada a ${cap} paradas.`);
    });
  }

  return (
    <form onSubmit={guardar} className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="space-y-2 flex-1 max-w-xs">
          <Label htmlFor={`capacidad-${conductor.id}`}>
            Cupo máximo de paradas por turno
          </Label>
          <Input
            id={`capacidad-${conductor.id}`}
            type="number"
            min={1}
            max={200}
            value={valor}
            onChange={(e) => {
              setValor(e.target.value);
              setError(null);
              setExito(null);
            }}
            disabled={pendiente}
          />
        </div>
        <Button type="submit" variant="outline" disabled={pendiente} className="shrink-0">
          {pendiente ? (
            <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {pendiente ? "Guardando…" : "Guardar"}
        </Button>
      </div>
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
    </form>
  );
}

// =============================================================================
// Editor de zonas preferentes del conductor
// =============================================================================

function EditorZonasConductor({
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

function EditorDatosBancarios({
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

function SeccionRedistribucion({
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

  function abrir() {
    setImpactoSla(null);
    setResumen(null);
    setError(null);
    setDialogAbierto(true);
  }

  function confirmar() {
    setError(null);
    iniciarTransicion(async () => {
      const resp = await actionMarcarConductorNoDisponible(conductor.id, fechaHoy);
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
              <p id="dialog-redistrib-desc" className="mt-2 text-sm text-muted-foreground">
                Se marcará al conductor como no disponible y sus paradas abiertas de hoy se
                redistribuirán automáticamente entre los conductores restantes del pool.
                Las paradas en ruta o terminales no se tocan.
              </p>
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
              disabled={pendiente}
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

// =============================================================================
// Helpers de traducción
// =============================================================================

function traducirMotivoSinAsignar(motivo: string): string {
  switch (motivo) {
    case "sin_conductor_disponible":
      return "Sin conductor disponible";
    case "sin_cupo":
      return "Conductores sin cupo";
    case "sin_conductor_en_zona":
      return "Sin conductor en la zona";
    default:
      return motivo;
  }
}
