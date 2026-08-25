"use client";

/**
 * Panel de configuración de zonas, comunas y ventanas de corte (F7, ítem 1.2).
 *
 * Sigue el mismo patrón que PanelTarifas:
 *   - Estado local inicializado desde el server component.
 *   - Server actions para mutaciones.
 *   - Tres secciones: Zonas · Comunas por zona · Ventanas de corte por seller.
 *
 * Decisión UX: tres cards separadas y colapsables para no abrumar al operador
 * que solo quiere configurar el corte de un seller sin tocar zonas.
 */

import { useState, useTransition, type FormEvent } from "react";
import {
  ChevronDown,
  ChevronUp,
  Map,
  MapPin,
  RefreshCw,
  ShieldAlert,
  CheckCircle2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import type { Zona, ZonaComuna } from "@/modules/operacion/tipos";
import {
  actionCrearZona,
  actionToggleZona,
  actionObtenerComunasDeZona,
  actionAsignarComunas,
  actionRenombrarZona,
  type EstadoZonas,
} from "./actions";

// =============================================================================
// Tipos locales
// =============================================================================

// =============================================================================
// Panel principal
// =============================================================================

interface Props {
  estadoInicial: EstadoZonas;
}

export function PanelZonas({ estadoInicial }: Props) {
  const [zonas, setZonas] = useState<Zona[]>(estadoInicial.zonas);

  function onZonaCreada(zona: Zona) {
    setZonas((prev) => [...prev, zona]);
  }

  function onToggleZona(id: string, activa: boolean) {
    setZonas((prev) => prev.map((z) => (z.id === id ? { ...z, activa } : z)));
  }

  function onZonaRenombrada(id: string, nombre: string) {
    setZonas((prev) => prev.map((z) => (z.id === id ? { ...z, nombre } : z)));
  }

  return (
    <div className="space-y-6">
      {/* 1. Crear y gestionar zonas */}
      <SeccionZonas
        zonas={zonas}
        onCreada={onZonaCreada}
        onToggle={onToggleZona}
        onRenombrada={onZonaRenombrada}
      />

      {/* 2. Asignar comunas a zona */}
      <SeccionComunasPorZona zonas={zonas.filter((z) => z.activa)} />

      {/* 🔴 Acá vivía la ventana de corte, y se fue a la ficha del seller.
          B3b: «la ventana de corte no es un destino de configuración: es un
          campo del seller, porque cada seller tiene el plazo que su courier le
          prometió». Estaba detrás de un acordeón y un selector de seller, o sea
          que para cambiarle la hora a Vega Norte había que entrar a una
          pantalla llamada «Zonas» y volver a elegir el seller que uno ya estaba
          mirando. Ver `sellers/[sellerId]/ventanas-corte-seller.tsx`. */}
    </div>
  );
}

// =============================================================================
// Sección 1: Zonas
// =============================================================================

function SeccionZonas({
  zonas,
  onCreada,
  onToggle,
  onRenombrada,
}: {
  zonas: Zona[];
  onCreada: (z: Zona) => void;
  onToggle: (id: string, activa: boolean) => void;
  onRenombrada: (id: string, nombre: string) => void;
}) {
  const [expandida, setExpandida] = useState(false);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function manejarCrear(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setExito(null);
    if (!nombre.trim()) {
      setError("El nombre de la zona es obligatorio.");
      return;
    }
    const fd = new FormData();
    fd.set("nombre", nombre.trim());
    iniciarTransicion(async () => {
      const resultado = await actionCrearZona(fd);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      onCreada(resultado.datos);
      setExito(`Zona "${resultado.datos.nombre}" creada.`);
      setNombre("");
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Map className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-base">Zonas de cobertura</CardTitle>
          <CardDescription>
            Agrupa comunas en zonas para aplicar ventanas de corte distintas por área geográfica.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Formulario crear zona */}
        <form onSubmit={manejarCrear} className="flex items-end gap-3">
          <div className="flex-1 space-y-2">
            <Label htmlFor="zona-nombre">Nombre de la nueva zona</Label>
            <Input
              id="zona-nombre"
              value={nombre}
              onChange={(e) => { setNombre(e.target.value); setError(null); }}
              placeholder="Ej: Santiago Centro"
              disabled={pendiente}
            />
          </div>
          <Button type="submit" disabled={pendiente || !nombre.trim()} className="shrink-0">
            {pendiente ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : null}
            {pendiente ? "Creando…" : "Crear zona"}
          </Button>
        </form>

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

        {/* Listado de zonas */}
        {zonas.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setExpandida((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              aria-expanded={expandida}
            >
              {expandida ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              {zonas.length} zona{zonas.length !== 1 ? "s" : ""} configurada{zonas.length !== 1 ? "s" : ""}
            </button>
            {expandida && (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {zonas.map((zona) => (
                  <FilaZona
                    key={zona.id}
                    zona={zona}
                    onToggle={onToggle}
                    onRenombrada={onRenombrada}
                  />
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Aún no tienes zonas — crea una para empezar a agrupar comunas.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function FilaZona({
  zona,
  onToggle,
  onRenombrada,
}: {
  zona: Zona;
  onToggle: (id: string, activa: boolean) => void;
  onRenombrada: (id: string, nombre: string) => void;
}) {
  const [pendiente, iniciarTransicion] = useTransition();
  // Renombrar se edita EN LA FILA y no en un modal: es un campo, y abrir un
  // diálogo para cambiar un texto de dos palabras cuesta más que el cambio.
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(zona.nombre);
  const [errorNombre, setErrorNombre] = useState<string | null>(null);

  function guardarNombre() {
    const limpio = nombre.trim();
    if (limpio === zona.nombre) {
      setEditando(false);
      return;
    }
    setErrorNombre(null);
    iniciarTransicion(async () => {
      const r = await actionRenombrarZona(zona.id, limpio);
      if (!r.ok) {
        setErrorNombre(r.mensaje);
        return;
      }
      onRenombrada(zona.id, r.datos.nombre);
      setEditando(false);
    });
  }

  function toggle() {
    iniciarTransicion(async () => {
      const resultado = await actionToggleZona(zona.id, !zona.activa);
      if (resultado.ok) {
        onToggle(zona.id, resultado.datos.activa);
      }
    });
  }

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {editando ? (
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <Input
              value={nombre}
              autoFocus
              disabled={pendiente}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") guardarNombre();
                if (e.key === "Escape") {
                  setNombre(zona.nombre);
                  setEditando(false);
                }
              }}
              onBlur={guardarNombre}
              aria-label={`Nombre de la zona ${zona.nombre}`}
              className="h-8 max-w-xs"
            />
            {errorNombre ? <span className="text-xs text-destructive">{errorNombre}</span> : null}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="min-w-0 truncate text-left text-sm font-medium hover:underline"
            title="Cambiar el nombre"
          >
            {zona.nombre}
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Badge variant={zona.activa ? "success" : "neutral"}>
          {zona.activa ? "Activa" : "Inactiva"}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          disabled={pendiente}
          aria-label={zona.activa ? `Desactivar zona ${zona.nombre}` : `Activar zona ${zona.nombre}`}
        >
          {pendiente ? (
            <RefreshCw className="size-4 animate-spin" />
          ) : zona.activa ? (
            <ToggleRight className="size-5 text-success" />
          ) : (
            <ToggleLeft className="size-5 text-muted-foreground" />
          )}
        </Button>
      </div>
    </li>
  );
}

// =============================================================================
// Sección 2: Comunas por zona
// =============================================================================

function SeccionComunasPorZona({ zonas }: { zonas: Zona[] }) {
  const [expandida, setExpandida] = useState(false);
  const [zonaId, setZonaId] = useState<string>("");
  const [comunasSeleccionadas, setComunasSeleccionadas] = useState<string[]>([]);
  const [comunasActuales, setComunasActuales] = useState<ZonaComuna[]>([]);
  const [cargandoComunas, setCargandoComunas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();
  const [busqueda, setBusqueda] = useState("");

  async function seleccionarZona(id: string) {
    setZonaId(id);
    setError(null);
    setExito(null);
    if (!id) {
      setComunasSeleccionadas([]);
      setComunasActuales([]);
      return;
    }
    setCargandoComunas(true);
    const resultado = await actionObtenerComunasDeZona(id);
    setCargandoComunas(false);
    if (resultado.ok) {
      setComunasActuales(resultado.datos);
      setComunasSeleccionadas(resultado.datos.map((c) => c.comuna));
    } else {
      setError(resultado.mensaje);
    }
  }

  function toggleComuna(comuna: string) {
    setError(null);
    setComunasSeleccionadas((prev) =>
      prev.includes(comuna) ? prev.filter((c) => c !== comuna) : [...prev, comuna],
    );
  }

  function guardar() {
    setError(null);
    setExito(null);
    if (!zonaId) return;
    iniciarTransicion(async () => {
      const resultado = await actionAsignarComunas(zonaId, comunasSeleccionadas);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setComunasActuales(resultado.datos);
      setExito(`${comunasSeleccionadas.length} comuna${comunasSeleccionadas.length !== 1 ? "s" : ""} asignada${comunasSeleccionadas.length !== 1 ? "s" : ""} correctamente.`);
    });
  }

  const comunasFiltradas = COMUNAS_RM.filter((c) =>
    c.toLowerCase().includes(busqueda.toLowerCase()),
  );

  if (zonas.length === 0) return null;

  return (
    <Card>
      <button
        type="button"
        onClick={() => setExpandida((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
        aria-expanded={expandida}
      >
        <div className="space-y-1">
          <p className="font-medium text-foreground">Comunas por zona</p>
          <p className="text-sm text-muted-foreground">
            Asigna las comunas de la Región Metropolitana a cada zona. Una comuna solo puede
            pertenecer a una zona.
          </p>
        </div>
        {expandida ? (
          <ChevronUp className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {expandida && (
        <CardContent className="space-y-4 border-t pt-5">
          {/* Selector de zona */}
          <div className="space-y-2">
            <Label htmlFor="zona-select">Zona a editar</Label>
            <Select value={zonaId} onValueChange={seleccionarZona}>
              <SelectTrigger id="zona-select" className="w-full sm:max-w-xs">
                <SelectValue placeholder="Selecciona una zona" />
              </SelectTrigger>
              <SelectContent>
                {zonas.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {zonaId && (
            <>
              {cargandoComunas ? (
                <p className="text-sm text-muted-foreground">Cargando comunas…</p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="busqueda-comuna">
                      Comunas RM{" "}
                      <span className="text-muted-foreground font-normal">
                        ({comunasSeleccionadas.length} seleccionadas)
                      </span>
                    </Label>
                    <Input
                      id="busqueda-comuna"
                      placeholder="Filtrar comunas…"
                      value={busqueda}
                      onChange={(e) => setBusqueda(e.target.value)}
                    />
                  </div>

                  <div
                    className="grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border border-border p-3 sm:grid-cols-3"
                    role="group"
                    aria-label="Comunas de la Región Metropolitana"
                  >
                    {comunasFiltradas.map((comuna) => {
                      const checked = comunasSeleccionadas.includes(comuna);
                      return (
                        <label
                          key={comuna}
                          className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                            checked
                              ? "bg-primary/10 text-primary"
                              : "text-foreground hover:bg-muted"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleComuna(comuna)}
                            className="size-3.5 accent-primary"
                          />
                          {comuna}
                        </label>
                      );
                    })}
                  </div>

                  {/* Comunas actualmente en la zona para referencia */}
                  {comunasActuales.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Antes de guardar: {comunasActuales.map((c) => c.comuna).join(", ")}.
                    </p>
                  )}

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

                  <Button onClick={guardar} disabled={pendiente}>
                    {pendiente ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : null}
                    {pendiente ? "Guardando…" : "Guardar comunas de la zona"}
                  </Button>
                </>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
