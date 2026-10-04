"use client";

/**
 * La hora de corte del seller, dentro de su ficha.
 * =============================================================================
 *
 * Es un campo del seller y no un destino de configuración: cada seller tiene el
 * plazo que su courier le prometió. La hora de corte y el objetivo de SLA
 * **deciden si una entrega llegó a tiempo** (semáforo de cumplimiento y riesgo
 * del día).
 *
 * -----------------------------------------------------------------------------
 * EL FORMULARIO MUESTRA EL RESULTADO, NO LA MECÁNICA (rediseño 2026-09-27)
 * -----------------------------------------------------------------------------
 * La hora comprometida es `corte + preparación + ruta` (ver
 * `modules/operacion/ventanas-corte.ts`). Antes había tres párrafos explicando
 * ese cálculo y nunca se mostraba el resultado. Ahora los minutos se eligen con
 * botones de valores típicos (con «Otro» para el resto) y el formulario dice una
 * sola cosa: **hasta qué hora queda comprometida la entrega**.
 *
 * -----------------------------------------------------------------------------
 * 🔴 GUARDAR ES UN UPSERT POR (seller, zona, tipo)
 * -----------------------------------------------------------------------------
 * `guardarVentanaCorte` reemplaza la ventana que ya exista para esa
 * combinación. Si al crear una se elige una combinación que ya existe, el
 * formulario carga sus valores y lo dice: pisarla en silencio era el defecto.
 *
 * El acuse vive en la sección y no en el formulario, porque el formulario se
 * cierra al guardar.
 */

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { MoreHorizontal, RefreshCw, ShieldAlert } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { etiquetaTipoEntrega } from "@/lib/ui/etiqueta-fuente-pedido";
import type { Zona, VentanaCorte } from "@/modules/operacion/tipos";
import {
  actionObtenerVentanasSeller,
  actionGuardarVentanaCorte,
  actionToggleVentanaCorte,
} from "@/app/(tenant)/configuracion/zonas/actions";

/** Radix no acepta `value=""` en un SelectItem: «Todas» viaja como centinela. */
const TODAS_LAS_ZONAS = "__todas__";

type Tipo = "flex" | "same_day";

const OPCIONES_PREPARACION = [15, 30, 45, 60].map((m) => ({ valor: m, etiqueta: String(m) }));
const OPCIONES_RUTA = [60, 120, 240, 360].map((m) => ({ valor: m, etiqueta: `${m / 60} h` }));
const OPCIONES_SLA = [90, 95, 97, 99].map((p) => ({ valor: p, etiqueta: `${p} %` }));

/** `HH:MM` + minutos → `HH:MM`, marcando si pasa al día siguiente. */
export function sumarMinutos(hora: string, minutos: number): string {
  const partes = /^(\d{1,2}):(\d{2})/.exec(hora);
  if (!partes) return "—";
  const h = Number(partes[1]);
  const m = Number(partes[2]);
  const total = h * 60 + m + minutos;
  const dias = Math.floor(total / 1440);
  const enDia = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(enDia / 60)).padStart(2, "0");
  const mm = String(enDia % 60).padStart(2, "0");
  return dias > 0 ? `${hh}:${mm} del día siguiente` : `${hh}:${mm}`;
}

function nombreZona(zonas: Zona[], zonaId: string | null): string {
  if (!zonaId) return "Todas las zonas";
  return zonas.find((z) => z.id === zonaId)?.nombre ?? "Zona";
}

export function VentanasCorteSeller({ sellerId, zonas }: { sellerId: string; zonas: Zona[] }) {
  const [ventanas, setVentanas] = useState<VentanaCorte[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<{ ventana: VentanaCorte | null } | null>(null);
  const [acuse, setAcuse] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    actionObtenerVentanasSeller(sellerId).then((resultado) => {
      if (!vigente) return;
      setCargando(false);
      if (resultado.ok) setVentanas(resultado.datos);
      else setErrorCarga(resultado.mensaje);
    });
    return () => {
      vigente = false;
    };
  }, [sellerId]);

  function alGuardar(v: VentanaCorte, acuseNuevo: string) {
    setAcuse(acuseNuevo);
    setVentanas((prev) => {
      const i = prev.findIndex((x) => x.tipoEntrega === v.tipoEntrega && x.zonaId === v.zonaId);
      if (i < 0) return [...prev, v];
      const copia = [...prev];
      copia[i] = v;
      return copia;
    });
    setFormulario(null);
  }

  if (cargando) return <p className="text-sm text-fg-muted">Cargando…</p>;

  return (
    <div className="space-y-3">
      {errorCarga ? (
        <p role="alert" className="text-sm text-fault-fg">
          {errorCarga}
        </p>
      ) : null}
      {acuse ? (
        <p role="status" className="text-sm text-balanced-fg">
          {acuse}
        </p>
      ) : null}

      {ventanas.length > 0 ? (
        <ul className="divide-y divide-line-subtle">
          {ventanas.map((v) => (
            <li
              key={v.id}
              className={cn("flex items-center gap-2 py-1.5", !v.activa && "text-fg-subtle")}
            >
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", v.activa ? "text-fg" : "text-fg-subtle")}>
                  {etiquetaTipoEntrega(v.tipoEntrega)} · {nombreZona(zonas, v.zonaId)}
                  {!v.activa ? <span className="font-normal"> · inactiva</span> : null}
                </p>
                <p className="rx-num text-xs text-fg-muted">
                  Corta {v.horaCorte} · entrega hasta{" "}
                  {sumarMinutos(v.horaCorte, v.minutosPreparacion + v.minutosRutaEstimado)} · SLA{" "}
                  {v.slaObjetivoPct} %
                </p>
              </div>
              <MenuVentana
                ventana={v}
                onEditar={() => {
                  setAcuse(null);
                  setFormulario({ ventana: v });
                }}
                onCambiada={alGuardar}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">Sin hora de corte.</p>
      )}

      {formulario ? (
        <FormularioVentanaCorte
          key={formulario.ventana?.id ?? "nueva"}
          sellerId={sellerId}
          zonas={zonas}
          existentes={ventanas}
          ventana={formulario.ventana}
          onGuardada={alGuardar}
          onCancelar={() => setFormulario(null)}
        />
      ) : (
        <Button
          variant="outline"
          className="min-h-11 w-full md:min-h-9"
          onClick={() => {
            setAcuse(null);
            setFormulario({ ventana: null });
          }}
        >
          Agregar hora de corte
        </Button>
      )}
    </div>
  );
}

function MenuVentana({
  ventana,
  onEditar,
  onCambiada,
}: {
  ventana: VentanaCorte;
  onEditar: () => void;
  onCambiada: (v: VentanaCorte, acuse: string) => void;
}) {
  const [pendiente, iniciar] = useTransition();
  const tipo = etiquetaTipoEntrega(ventana.tipoEntrega);

  function alternar() {
    iniciar(async () => {
      const r = await actionToggleVentanaCorte(ventana.id, !ventana.activa);
      if (r.ok) {
        onCambiada(r.datos, r.datos.activa ? `${tipo} vuelve a cortar a las ${r.datos.horaCorte}.` : `${tipo} queda sin hora de corte.`);
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={pendiente}
          aria-label={`Acciones de la hora de corte de ${tipo}`}
          className="size-11 shrink-0 md:size-8"
        >
          {pendiente ? (
            <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <MoreHorizontal className="size-4" aria-hidden="true" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem className="min-h-11 md:min-h-0" onSelect={onEditar}>
          Editar
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11 md:min-h-0" onSelect={alternar}>
          {ventana.activa ? "Desactivar" : "Reactivar"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Botones de selección simple con valores típicos y un «Otro» que abre un campo
 * numérico. Un valor que no está en la lista (una ventana guardada con 50 min)
 * arranca en «Otro» con su número.
 */
function Opciones({
  rotulo,
  opciones,
  valor,
  onCambio,
  unidadOtro,
  min,
  max,
}: {
  rotulo: string;
  opciones: { valor: number; etiqueta: string }[];
  valor: number;
  onCambio: (v: number) => void;
  unidadOtro: string;
  min: number;
  max: number;
}) {
  const [otro, setOtro] = useState(!opciones.some((o) => o.valor === valor));

  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 text-sm font-medium">{rotulo}</legend>
      <div className="grid grid-cols-5 gap-1.5">
        {opciones.map((o) => {
          const activo = !otro && o.valor === valor;
          return (
            <button
              key={o.valor}
              type="button"
              aria-pressed={activo}
              onClick={() => {
                setOtro(false);
                onCambio(o.valor);
              }}
              className={cn(
                "rx-num min-h-11 rounded-md border px-1 text-sm md:min-h-8",
                activo
                  ? "border-accent-text bg-accent-bg text-accent-text"
                  : "border-line bg-bg-raised text-fg hover:border-line-strong",
              )}
            >
              {o.etiqueta}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={otro}
          onClick={() => setOtro(true)}
          className={cn(
            "min-h-11 rounded-md border px-1 text-sm md:min-h-8",
            otro
              ? "border-accent-text bg-accent-bg text-accent-text"
              : "border-line bg-bg-raised text-fg hover:border-line-strong",
          )}
        >
          Otro
        </button>
      </div>
      {otro ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={Number.isNaN(valor) ? "" : valor}
            onChange={(e) => onCambio(e.target.valueAsNumber)}
            aria-label={`${rotulo} (${unidadOtro})`}
            className="min-h-11 w-24 md:min-h-9"
            autoFocus
          />
          <span className="text-sm text-fg-muted">{unidadOtro}</span>
        </div>
      ) : null}
    </fieldset>
  );
}

function FormularioVentanaCorte({
  sellerId,
  zonas,
  existentes,
  ventana,
  onGuardada,
  onCancelar,
}: {
  sellerId: string;
  zonas: Zona[];
  existentes: VentanaCorte[];
  /** La ventana que se edita, o `null` para una nueva. */
  ventana: VentanaCorte | null;
  onGuardada: (v: VentanaCorte, acuse: string) => void;
  onCancelar: () => void;
}) {
  // ⚠️ Arranca en la ventana que se edita: arrancar en valores fijos pisaba la
  // configuración vigente al guardar «editar».
  const [tipo, setTipo] = useState<Tipo>((ventana?.tipoEntrega as Tipo) ?? "same_day");
  const [zonaId, setZonaId] = useState<string>(ventana?.zonaId ?? "");
  const [hora, setHora] = useState(ventana?.horaCorte ?? "14:00");
  const [prep, setPrep] = useState(ventana?.minutosPreparacion ?? 30);
  const [ruta, setRuta] = useState(ventana?.minutosRutaEstimado ?? 120);
  const [sla, setSla] = useState(ventana?.slaObjetivoPct ?? 97);
  /** La ventana vigente para la combinación elegida, si la hay. */
  const [reemplaza, setReemplaza] = useState<VentanaCorte | null>(ventana);
  /** Cambia al cargar otra ventana, para que los botones «Otro» se recalculen. */
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  /** Si la combinación ya existe, se carga: guardar la reemplaza. */
  function elegirCombinacion(nuevoTipo: Tipo, nuevaZona: string) {
    setTipo(nuevoTipo);
    setZonaId(nuevaZona);
    const existente =
      existentes.find((v) => v.tipoEntrega === nuevoTipo && (v.zonaId ?? "") === nuevaZona) ?? null;
    setReemplaza(existente);
    if (existente && existente.id !== ventana?.id) {
      setHora(existente.horaCorte);
      setPrep(existente.minutosPreparacion);
      setRuta(existente.minutosRutaEstimado);
      setSla(existente.slaObjetivoPct);
      setVersion((n) => n + 1);
    }
  }

  const valido = Boolean(hora) && prep >= 0 && ruta >= 0 && sla >= 0 && sla <= 100;
  const compromete = valido ? sumarMinutos(hora, prep + ruta) : null;

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setError(null);
    const fd = new FormData();
    fd.set("sellerId", sellerId);
    fd.set("tipoEntrega", tipo);
    fd.set("horaCorte", hora);
    fd.set("minutosPreparacion", String(prep));
    fd.set("minutosRutaEstimado", String(ruta));
    fd.set("slaObjetivoPct", String(sla));
    if (zonaId) fd.set("zonaId", zonaId);

    iniciar(async () => {
      const r = await actionGuardarVentanaCorte(fd);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      onGuardada(r.datos, `${etiquetaTipoEntrega(tipo)} corta a las ${hora}.`);
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-4 rounded-md border border-line bg-bg-sunken/40 p-3">
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-medium">Tipo</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {(["same_day", "flex"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tipo === t}
              onClick={() => elegirCombinacion(t, zonaId)}
              className={cn(
                "min-h-11 rounded-md border text-sm md:min-h-9",
                tipo === t
                  ? "border-accent-text bg-accent-bg text-accent-text"
                  : "border-line bg-bg-raised text-fg hover:border-line-strong",
              )}
            >
              {etiquetaTipoEntrega(t)}
            </button>
          ))}
        </div>
      </fieldset>

      {zonas.length > 0 ? (
        <div className="space-y-1.5">
          <label htmlFor="ventana-zona" className="block text-sm font-medium">
            Zona
          </label>
          <Select
            value={zonaId || TODAS_LAS_ZONAS}
            onValueChange={(v) => elegirCombinacion(tipo, v === TODAS_LAS_ZONAS ? "" : v)}
          >
            <SelectTrigger id="ventana-zona" className="min-h-11 w-full md:min-h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS_LAS_ZONAS}>Todas</SelectItem>
              {zonas.map((z) => (
                <SelectItem key={z.id} value={z.id}>
                  {z.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {!ventana && reemplaza ? (
        <p className="text-sm text-attention-fg">Ya existe. Guardar la reemplaza.</p>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="ventana-hora" className="block text-sm font-medium">
          Hora de corte
        </label>
        <Input
          id="ventana-hora"
          type="time"
          value={hora}
          onChange={(e) => setHora(e.target.value)}
          required
          className="min-h-11 w-36 md:min-h-9"
        />
      </div>

      <Opciones
        key={`prep-${version}`}
        rotulo="Preparación · min"
        opciones={OPCIONES_PREPARACION}
        valor={prep}
        onCambio={setPrep}
        unidadOtro="min"
        min={0}
        max={240}
      />
      <Opciones
        key={`ruta-${version}`}
        rotulo="Ruta"
        opciones={OPCIONES_RUTA}
        valor={ruta}
        onCambio={setRuta}
        unidadOtro="min"
        min={0}
        max={480}
      />

      {/* Lo único que se dice: el resultado de los tres campos de arriba. */}
      <p className="rounded-md border border-line bg-bg-raised px-3 py-2 text-sm">
        Entrega comprometida hasta las{" "}
        <strong className="rx-num font-semibold">{compromete ?? "—"}</strong>
      </p>

      <Opciones
        key={`sla-${version}`}
        rotulo="Objetivo SLA"
        opciones={OPCIONES_SLA}
        valor={sla}
        onCambio={setSla}
        unidadOtro="%"
        min={0}
        max={100}
      />

      {error ? (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pendiente || !valido} className="min-h-11 flex-1 md:min-h-9">
          {pendiente ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pendiente ? "Guardando…" : "Guardar"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancelar}
          disabled={pendiente}
          className="min-h-11 md:min-h-9"
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
