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
  Clock,
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
import { etiquetaTipoEntrega } from "@/lib/ui/etiqueta-fuente-pedido";
import type { Zona, ZonaComuna, VentanaCorte } from "@/modules/operacion/tipos";
import {
  actionCrearZona,
  actionToggleZona,
  actionObtenerComunasDeZona,
  actionAsignarComunas,
  actionObtenerVentanasSeller,
  actionGuardarVentanaCorte,
  actionToggleVentanaCorte,
  actionRenombrarZona,
  type EstadoZonas,
  type Seller,
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
  const sellers = estadoInicial.sellers;

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

      {/* 3. Ventanas de corte por seller */}
      <SeccionVentanasCorte sellers={sellers} zonas={zonas.filter((z) => z.activa)} />
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

// =============================================================================
// Sección 3: Ventanas de corte por seller
// =============================================================================

function SeccionVentanasCorte({
  sellers,
  zonas,
}: {
  sellers: Seller[];
  zonas: Zona[];
}) {
  const [expandida, setExpandida] = useState(false);
  const [sellerId, setSellerId] = useState<string>("");
  const [ventanas, setVentanas] = useState<VentanaCorte[]>([]);
  const [cargando, setCargando] = useState(false);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  // Cuál ventana se está editando. `null` = una nueva. Se pasa al formulario
  // como valor inicial Y como `key`, para que React lo remonte al cambiar de
  // ventana: sin eso, abrir la segunda mostraría los campos de la primera.
  const [editando, setEditando] = useState<VentanaCorte | null>(null);

  function onEditar(v: VentanaCorte) {
    setEditando(v);
    setMostrarFormulario(true);
  }

  async function seleccionarSeller(id: string) {
    setSellerId(id);
    setVentanas([]);
    setMostrarFormulario(false);
    setEditando(null);
    if (!id) return;
    setCargando(true);
    const resultado = await actionObtenerVentanasSeller(id);
    setCargando(false);
    if (resultado.ok) setVentanas(resultado.datos);
  }

  function onVentanaGuardada(v: VentanaCorte) {
    setVentanas((prev) => {
      const idx = prev.findIndex(
        (x) => x.sellerId === v.sellerId && x.tipoEntrega === v.tipoEntrega && x.zonaId === v.zonaId,
      );
      if (idx >= 0) {
        const copia = [...prev];
        copia[idx] = v;
        return copia;
      }
      return [...prev, v];
    });
    setMostrarFormulario(false);
    setEditando(null);
  }

  if (sellers.length === 0) {
    return null;
  }

  return (
    <Card>
      <button
        type="button"
        onClick={() => setExpandida((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
        aria-expanded={expandida}
      >
        <div className="space-y-1">
          <p className="font-medium text-foreground">Horario de corte y objetivo de SLA por seller</p>
          <p className="text-sm text-muted-foreground">
            Define la hora límite de recepción de pedidos y el % de SLA pactado con cada seller.
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
          {/* Selector seller */}
          <div className="space-y-2">
            <Label htmlFor="corte-seller">Seller</Label>
            <Select value={sellerId} onValueChange={seleccionarSeller}>
              <SelectTrigger id="corte-seller" className="w-full sm:max-w-xs">
                <SelectValue placeholder="Selecciona un seller" />
              </SelectTrigger>
              <SelectContent>
                {sellers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {sellerId && (
            <>
              {cargando ? (
                <p className="text-sm text-muted-foreground">Cargando configuración…</p>
              ) : (
                <>
                  {/* Ventanas existentes */}
                  {ventanas.length > 0 ? (
                    <div className="overflow-hidden rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/40">
                            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Tipo</th>
                            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Zona</th>
                            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Corte</th>
                            <th className="px-4 py-2 text-left font-medium text-muted-foreground">SLA objetivo</th>
                            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Estado</th>
                            <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                              <span className="sr-only">Acciones</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {ventanas.map((v) => (
                            <tr key={v.id}>
                              <td className="px-4 py-2 font-medium">
                                {etiquetaTipoEntrega(v.tipoEntrega)}
                              </td>
                              <td className="px-4 py-2 text-muted-foreground">
                                {v.zonaId
                                  ? zonas.find((z) => z.id === v.zonaId)?.nombre ?? "Zona"
                                  : "Por defecto"}
                              </td>
                              <td className="px-4 py-2 tabular-nums">
                                <span className="flex items-center gap-1">
                                  <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                                  {v.horaCorte}
                                </span>
                              </td>
                              <td className="px-4 py-2 tabular-nums">{v.slaObjetivoPct}%</td>
                              <td className="px-4 py-2">
                                <Badge variant={v.activa ? "success" : "neutral"}>
                                  {v.activa ? "Activa" : "Inactiva"}
                                </Badge>
                              </td>
                              {/* 🐞 «Editar» no existía: el único camino al
                                  formulario era un botón «Agregar / editar» que
                                  lo abría EN BLANCO, con 14:00/30/60/97, y
                                  guardarlo pisaba la ventana vigente con esos
                                  valores. Ahora cada fila abre la suya. */}
                              <td className="px-4 py-2 text-right">
                                <div className="flex flex-wrap items-center justify-end gap-3">
                                  <button
                                    type="button"
                                    onClick={() => onEditar(v)}
                                    className="text-xs font-medium text-accent-text hover:underline"
                                  >
                                    Editar
                                  </button>
                                  <BotonToggleVentana ventana={v} onCambiada={onVentanaGuardada} />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Este seller aún no tiene ventanas de corte configuradas.
                    </p>
                  )}

                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditando(null);
                      setMostrarFormulario((v) => !v);
                    }}
                  >
                    {mostrarFormulario ? "Cancelar" : "Agregar una ventana de corte"}
                  </Button>

                  {mostrarFormulario && (
                    <FormularioVentanaCorte
                      key={editando?.id ?? "nueva"}
                      sellerId={sellerId}
                      zonas={zonas}
                      ventana={editando}
                      onGuardada={onVentanaGuardada}
                    />
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// =============================================================================
// Formulario ventana de corte
// =============================================================================

/**
 * El formulario de ventana de corte.
 *
 * -----------------------------------------------------------------------------
 * 🐞 EL BUG QUE CORROMPÍA CONFIGURACIÓN
 * -----------------------------------------------------------------------------
 * Los cinco campos arrancaban en constantes literales —`useState("14:00")`,
 * `"30"`, `"60"`, `"97"`— y el mismo formulario servía para crear y para
 * «editar». Como `guardarVentanaCorte` hace un upsert por
 * `(tenant, seller, zona, tipo)`, **abrir «editar» y guardar sobrescribía la
 * ventana vigente con esos valores por defecto**, sin avisar.
 *
 * No es cosmético: la hora de corte y el objetivo de SLA gobiernan el semáforo
 * de cumplimiento y el cálculo de riesgo del día. Un courier que cortaba a las
 * 17:30 y entraba a mirar su configuración salía cortando a las 14:00.
 *
 * Ahora el formulario recibe la ventana que edita y arranca en ella. Cuando
 * `ventana` es `null` es una nueva, y ahí sí los valores por defecto son lo
 * correcto.
 */
function FormularioVentanaCorte({
  sellerId,
  zonas,
  ventana,
  onGuardada,
}: {
  sellerId: string;
  zonas: Zona[];
  /** La ventana que se está editando, o `null` para una nueva. */
  ventana: VentanaCorte | null;
  onGuardada: (v: VentanaCorte) => void;
}) {
  const [tipoEntrega, setTipoEntrega] = useState<"flex" | "same_day">(
    ventana ? (ventana.tipoEntrega as "flex" | "same_day") : "same_day",
  );
  const [horaCorte, setHoraCorte] = useState(ventana?.horaCorte ?? "14:00");
  const [minutosPreparacion, setMinutosPreparacion] = useState(
    ventana ? String(ventana.minutosPreparacion) : "30",
  );
  const [minutosRutaEstimado, setMinutosRutaEstimado] = useState(
    ventana ? String(ventana.minutosRutaEstimado) : "60",
  );
  const [slaObjetivoPct, setSlaObjetivoPct] = useState(
    ventana ? String(ventana.slaObjetivoPct) : "97",
  );
  const [zonaId, setZonaId] = useState<string>(ventana?.zonaId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function manejarEnvio(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("sellerId", sellerId);
    fd.set("tipoEntrega", tipoEntrega);
    fd.set("horaCorte", horaCorte);
    fd.set("minutosPreparacion", minutosPreparacion);
    fd.set("minutosRutaEstimado", minutosRutaEstimado);
    fd.set("slaObjetivoPct", slaObjetivoPct);
    if (zonaId) fd.set("zonaId", zonaId);

    iniciarTransicion(async () => {
      const resultado = await actionGuardarVentanaCorte(fd);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      onGuardada(resultado.datos);
    });
  }

  return (
    <form
      onSubmit={manejarEnvio}
      className="space-y-4 rounded-lg border border-border bg-muted/30 p-4"
    >
      {/* Qué se está editando, con nombre. Antes decía «Nueva ventana de corte»
          también al editar una existente — el título mentía sobre lo que iba a
          pasar al guardar. */}
      <p className="text-sm font-medium text-foreground">
        {ventana
          ? `Ventana vigente · ${etiquetaTipoEntrega(ventana.tipoEntrega)}${
              ventana.zonaId
                ? ` · ${zonas.find((z) => z.id === ventana.zonaId)?.nombre ?? "zona"}`
                : " · todas las zonas"
            }`
          : "Nueva ventana de corte"}
      </p>
      {ventana ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Estás editando la ventana que está rigiendo hoy. Al guardar, el cambio aplica a los
          pedidos que entren desde ese momento — los que ya están en curso conservan su corte.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ventana-tipo">Tipo de entrega</Label>
          <Select value={tipoEntrega} onValueChange={(v) => setTipoEntrega(v as "flex" | "same_day")}>
            <SelectTrigger id="ventana-tipo" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="same_day">Same-day</SelectItem>
              <SelectItem value="flex">Flex</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ventana-hora">Hora de corte</Label>
          <Input
            id="ventana-hora"
            type="time"
            value={horaCorte}
            onChange={(e) => setHoraCorte(e.target.value)}
            required
          />
          {/* Cada campo dice qué produce, no qué es. «Hora local» no explica
              qué pasa con un pedido que entra a las 14:05. */}
          <p className="text-xs text-muted-foreground">
            Hora de Santiago. Después de esta hora el pedido se crea igual y sale mañana.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ventana-prep">Minutos de preparación</Label>
          <Input
            id="ventana-prep"
            type="number"
            min="0"
            max="240"
            value={minutosPreparacion}
            onChange={(e) => setMinutosPreparacion(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Lo que toma retirar y clasificar antes de salir. Entra en el cálculo de si una
            entrega llega a tiempo.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ventana-ruta">Minutos de ruta estimado</Label>
          <Input
            id="ventana-ruta"
            type="number"
            min="0"
            max="480"
            value={minutosRutaEstimado}
            onChange={(e) => setMinutosRutaEstimado(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Cuánto dura la ruta desde que sale la flota. Con la preparación, define a qué hora
            se compromete la entrega.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ventana-sla">Objetivo de SLA (%)</Label>
          <Input
            id="ventana-sla"
            type="number"
            min="0"
            max="100"
            value={slaObjetivoPct}
            onChange={(e) => setSlaObjetivoPct(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            El porcentaje de entregas a tiempo que te propones. Es contra esto que se pinta el
            semáforo de cumplimiento del seller. 97% es lo recomendado para Flex.
          </p>
        </div>

        {zonas.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="ventana-zona">Override por zona (opcional)</Label>
            <Select value={zonaId} onValueChange={setZonaId}>
              <SelectTrigger id="ventana-zona" className="w-full">
                <SelectValue placeholder="Por defecto (todas las zonas)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Por defecto</SelectItem>
                {zonas.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Deja vacío para aplicar a todas las zonas del seller.
            </p>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={pendiente}>
        {pendiente ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : null}
        {pendiente ? "Guardando…" : ventana ? "Guardar los cambios" : "Crear la ventana"}
      </Button>
    </form>
  );
}


// =============================================================================
// Activar / desactivar una ventana de corte
// =============================================================================

/**
 * La transición que le faltaba al estado «Inactiva».
 *
 * La tabla pintaba el distintivo y **ninguna acción llevaba a ese estado ni
 * salía de él**. La única salida era accidental: `guardarVentanaCorte` fuerza
 * `activa: true` en su upsert, así que volver a guardar la reactivaba de
 * rebote — algo que nadie va a adivinar.
 */
function BotonToggleVentana({
  ventana,
  onCambiada,
}: {
  ventana: VentanaCorte;
  onCambiada: (v: VentanaCorte) => void;
}) {
  const [pendiente, iniciarTransicion] = useTransition();

  return (
    <button
      type="button"
      disabled={pendiente}
      onClick={() =>
        iniciarTransicion(async () => {
          const r = await actionToggleVentanaCorte(ventana.id, !ventana.activa);
          if (r.ok) onCambiada(r.datos);
        })
      }
      aria-label={
        ventana.activa
          ? `Desactivar la ventana de ${etiquetaTipoEntrega(ventana.tipoEntrega)}`
          : `Reactivar la ventana de ${etiquetaTipoEntrega(ventana.tipoEntrega)}`
      }
      className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
    >
      {pendiente ? "…" : ventana.activa ? "Desactivar" : "Reactivar"}
    </button>
  );
}
