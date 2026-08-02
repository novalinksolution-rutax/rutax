"use client";

/**
 * PanelDetalleExcepcion — Sheet de detalle de una excepción de conciliación
 * (D-4, §1.1 P1). Componente CONTROLADO (recibe `open`/`onOpenChange` desde
 * afuera — el disparador es la fila completa en `fila-evento-conciliacion.tsx`,
 * no un `SheetTrigger` propio, para que "clic en cualquier parte de la fila"
 * la abra).
 *
 * Secciones, de arriba a abajo (diseño de `ux-ui`):
 *   1. Título (tipo de diferencia + categoría) + contexto (seller/pedido/monto).
 *   2. Estado — botones de transición derivados SIEMPRE de `TRANSICIONES_VALIDAS`
 *      (nunca hardcodeados). Un estado terminal solo ofrece "Reabrir" (un único
 *      botón, destino calculado por `reabrirEventoConciliacion`).
 *   3. Asignado a + fecha límite.
 *   4. Bloqueos de facturación/pago (con motivo obligatorio).
 *   5. Descripción (tal cual la generó el detector).
 *   6. Acción sugerida.
 *   7. Historial cronológico + agregar comentario libre.
 *
 * Cada mutación exitosa llama a `onMutated` (el padre hace `router.refresh()`
 * para traer el evento actualizado) y refresca el historial localmente.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
  CalendarClock,
  Lightbulb,
  Lock,
  MessageSquare,
  RotateCcw,
  Search,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Nodo, type NodoTono } from "@/components/dinero/trazador-lazo";

import { TRANSICIONES_VALIDAS, esEstadoTerminal } from "@/modules/dinero/conciliacion-clasificacion";
import type {
  AccionSugeridaConciliacion,
  EstadoEventoConciliacion,
  EventoConciliacionHistorial,
  TipoCambioConciliacion,
} from "@/modules/dinero/tipos";
import type { UsuarioInterno } from "@/modules/identidad/consultas";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { formatearFecha, formatearFechaHora, formatearTiempoRelativo } from "@/lib/formato-cl";
import {
  BADGE_CATEGORIA_NEGOCIO_CONCILIACION,
  BADGE_ESTADO_CONCILIACION,
  TEXTO_ACCION_SUGERIDA_CONCILIACION,
  traducirAccionSugeridaConciliacion,
  traducirCategoriaNegocioConciliacion,
  traducirEstadoConciliacion,
  traducirTipoDiferencia,
} from "@/lib/ui/traduccion-estados";
import type { EventoConciliacionUI } from "./tipos-ui";
import { DESTINOS_QUE_EXIGEN_COMENTARIO } from "./reglas-nota";
import {
  accionAgregarComentario,
  accionAsignarEvento,
  accionCambiarAccionSugerida,
  accionFijarBloqueos,
  accionFijarFechaLimite,
  accionListarHistorialEvento,
  accionReabrirEvento,
  accionTransicionarEvento,
} from "./actions";

const SIN_ASIGNAR = "__sin_asignar__";

const ETIQUETA_TRANSICION: Partial<Record<EstadoEventoConciliacion, string>> = {
  en_analisis: "Marcar en análisis",
  esperando_info: "Marcar esperando información",
  requiere_ajuste: "Marcar que requiere ajuste",
  resuelta_manual: "Marcar como resuelta",
  aceptada_justificada: "Revisar (sin cambios)",
  ignorada: "Descartar",
  pendiente: "Volver a pendiente",
};

const OPCIONES_ACCION_SUGERIDA = Object.keys(
  TEXTO_ACCION_SUGERIDA_CONCILIACION,
) as AccionSugeridaConciliacion[];

interface Props {
  evento: EventoConciliacionUI;
  usuariosInternos: UsuarioInterno[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutated: () => void;
}

export function PanelDetalleExcepcion({ evento, usuariosInternos, open, onOpenChange, onMutated }: Props) {
  // ---------------------------------------------------------------------
  // Historial
  // ---------------------------------------------------------------------
  const [historial, setHistorial] = useState<EventoConciliacionHistorial[] | null>(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [errorHistorial, setErrorHistorial] = useState<string | null>(null);

  const cargarHistorial = useCallback(() => {
    setCargandoHistorial(true);
    setErrorHistorial(null);
    void (async () => {
      const resultado = await accionListarHistorialEvento(evento.id);
      if (resultado.ok) {
        setHistorial(resultado.historial);
      } else {
        setErrorHistorial(resultado.mensaje);
      }
      setCargandoHistorial(false);
    })();
  }, [evento.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) cargarHistorial();
  }, [open, cargarHistorial]);

  // ---------------------------------------------------------------------
  // Estado / transiciones
  // ---------------------------------------------------------------------
  const [isPendingTransicion, startTransicion] = useTransition();
  const [destinoEnConfirmacion, setDestinoEnConfirmacion] = useState<
    EstadoEventoConciliacion | "reabrir" | null
  >(null);
  const [comentarioTransicion, setComentarioTransicion] = useState("");

  const enTerminal = esEstadoTerminal(evento.estado);
  const destinosDirectos = enTerminal ? [] : (TRANSICIONES_VALIDAS[evento.estado] ?? []);

  function iniciarTransicion(destino: EstadoEventoConciliacion) {
    if (DESTINOS_QUE_EXIGEN_COMENTARIO.has(destino)) {
      setDestinoEnConfirmacion(destino);
      setComentarioTransicion("");
      return;
    }
    confirmarTransicion(destino);
  }

  function confirmarTransicion(destino: EstadoEventoConciliacion, comentario?: string) {
    startTransicion(async () => {
      const resultado = await accionTransicionarEvento(evento.id, destino, comentario);
      if (resultado.ok) {
        toast.success(`Excepción actualizada a "${traducirEstadoConciliacion(destino)}"`);
        setDestinoEnConfirmacion(null);
        setComentarioTransicion("");
        onMutated();
        cargarHistorial();
      } else {
        toast.error("No se pudo actualizar la excepción", { description: resultado.mensaje });
      }
    });
  }

  function confirmarReapertura() {
    const comentario = comentarioTransicion.trim();
    if (!comentario) return;
    startTransicion(async () => {
      const resultado = await accionReabrirEvento(evento.id, comentario);
      if (resultado.ok) {
        toast.success("Excepción reabierta");
        setDestinoEnConfirmacion(null);
        setComentarioTransicion("");
        onMutated();
        cargarHistorial();
      } else {
        toast.error("No se pudo reabrir la excepción", { description: resultado.mensaje });
      }
    });
  }

  // ---------------------------------------------------------------------
  // Asignado a / fecha límite
  // ---------------------------------------------------------------------
  const [isPendingAsignar, startAsignar] = useTransition();
  const [isPendingFecha, startFecha] = useTransition();
  const [fechaLimiteInput, setFechaLimiteInput] = useState(evento.fechaLimite ?? "");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFechaLimiteInput(evento.fechaLimite ?? "");
  }, [evento.fechaLimite]);

  function cambiarAsignado(valor: string) {
    const nuevo = valor === SIN_ASIGNAR ? null : valor;
    startAsignar(async () => {
      const resultado = await accionAsignarEvento(evento.id, nuevo);
      if (resultado.ok) {
        toast.success(nuevo ? "Excepción asignada" : "Excepción desasignada");
        onMutated();
        cargarHistorial();
      } else {
        toast.error("No se pudo asignar la excepción", { description: resultado.mensaje });
      }
    });
  }

  function cambiarFechaLimite(valor: string) {
    setFechaLimiteInput(valor);
    startFecha(async () => {
      const resultado = await accionFijarFechaLimite(evento.id, valor || null);
      if (resultado.ok) {
        toast.success("Fecha límite actualizada");
        onMutated();
        cargarHistorial();
      } else {
        toast.error("No se pudo actualizar la fecha límite", { description: resultado.mensaje });
      }
    });
  }

  // ---------------------------------------------------------------------
  // Bloqueos
  // ---------------------------------------------------------------------
  const puedeBloquearFacturacion = !!(evento.periodoCobroidId || evento.sellerId);
  const puedeBloquearPago = !!(evento.liquidacionId || evento.driverId);

  const [isPendingBloqueo, startBloqueo] = useTransition();
  const [bloqueaFacturacionLocal, setBloqueaFacturacionLocal] = useState(evento.bloqueaFacturacion);
  const [bloqueaPagoLocal, setBloqueaPagoLocal] = useState(evento.bloqueaPago);
  const [motivoBloqueoLocal, setMotivoBloqueoLocal] = useState(evento.motivoBloqueo ?? "");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBloqueaFacturacionLocal(evento.bloqueaFacturacion);
    setBloqueaPagoLocal(evento.bloqueaPago);
    setMotivoBloqueoLocal(evento.motivoBloqueo ?? "");
  }, [evento.bloqueaFacturacion, evento.bloqueaPago, evento.motivoBloqueo]);

  const motivoBloqueoFaltante =
    (bloqueaFacturacionLocal || bloqueaPagoLocal) && !motivoBloqueoLocal.trim();
  const bloqueoSinCambios =
    bloqueaFacturacionLocal === evento.bloqueaFacturacion &&
    bloqueaPagoLocal === evento.bloqueaPago &&
    motivoBloqueoLocal.trim() === (evento.motivoBloqueo ?? "");

  function guardarBloqueos() {
    if (motivoBloqueoFaltante) return;
    startBloqueo(async () => {
      const resultado = await accionFijarBloqueos(evento.id, {
        bloqueaFacturacion: bloqueaFacturacionLocal,
        bloqueaPago: bloqueaPagoLocal,
        motivoBloqueo: motivoBloqueoLocal.trim() || null,
      });
      if (resultado.ok) {
        toast.success("Bloqueos actualizados");
        onMutated();
        cargarHistorial();
      } else {
        toast.error("No se pudieron actualizar los bloqueos", { description: resultado.mensaje });
      }
    });
  }

  // ---------------------------------------------------------------------
  // Acción sugerida
  // ---------------------------------------------------------------------
  const [isPendingAccion, startAccion] = useTransition();

  function cambiarAccionSugerida(valor: AccionSugeridaConciliacion) {
    startAccion(async () => {
      const resultado = await accionCambiarAccionSugerida(evento.id, valor);
      if (resultado.ok) {
        toast.success("Acción sugerida actualizada");
        onMutated();
        cargarHistorial();
      } else {
        toast.error("No se pudo actualizar la acción sugerida", { description: resultado.mensaje });
      }
    });
  }

  // ---------------------------------------------------------------------
  // Agregar comentario libre
  // ---------------------------------------------------------------------
  const [comentarioNuevo, setComentarioNuevo] = useState("");
  const [isPendingComentario, startComentario] = useTransition();

  function enviarComentario() {
    const texto = comentarioNuevo.trim();
    if (!texto) return;
    startComentario(async () => {
      const resultado = await accionAgregarComentario(evento.id, texto);
      if (resultado.ok) {
        setComentarioNuevo("");
        toast.success("Comentario agregado");
        cargarHistorial();
      } else {
        toast.error("No se pudo agregar el comentario", { description: resultado.mensaje });
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{traducirTipoDiferencia(evento.tipoDiferencia)}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <Badge variant={BADGE_CATEGORIA_NEGOCIO_CONCILIACION[evento.categoriaNegocio]}>
              {traducirCategoriaNegocioConciliacion(evento.categoriaNegocio)}
            </Badge>
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-6">
          {/* Contexto rápido */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Seller</dt>
              <dd className="truncate">{evento.sellerNombre ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Pedido</dt>
              <dd>
                {evento.pedidoId ? (
                  <Link
                    href={`/operaciones/${evento.pedidoId}`}
                    className="font-mono text-primary hover:underline"
                  >
                    #{evento.pedidoId.slice(0, 8)}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Diferencia</dt>
              <dd className="font-mono font-semibold tabular-nums">
                {evento.montoDiferenciaClp !== null ? formatearCLP(evento.montoDiferenciaClp) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Detectada</dt>
              <dd title={formatearFechaHora(evento.creadoEn)}>{formatearFecha(evento.creadoEn)}</dd>
            </div>
          </dl>

          {/* 2. Estado */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Estado
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <BadgeEstado variante={BADGE_ESTADO_CONCILIACION[evento.estado]} texto={traducirEstadoConciliacion(evento.estado)} />
              {evento.resueltaEn && (
                <span className="text-xs text-muted-foreground">
                  Cerrada {formatearTiempoRelativo(evento.resueltaEn)}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {enTerminal ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPendingTransicion}
                  onClick={() => {
                    setDestinoEnConfirmacion("reabrir");
                    setComentarioTransicion("");
                  }}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Reabrir excepción
                </Button>
              ) : (
                destinosDirectos.map((destino) => (
                  <Button
                    key={destino}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPendingTransicion}
                    onClick={() => iniciarTransicion(destino)}
                  >
                    {ETIQUETA_TRANSICION[destino] ?? `Marcar como "${traducirEstadoConciliacion(destino)}"`}
                  </Button>
                ))
              )}
            </div>

            {destinoEnConfirmacion && (
              <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                <label htmlFor="nota-transicion" className="text-xs font-medium text-foreground">
                  {destinoEnConfirmacion === "reabrir"
                    ? "Motivo de la reapertura (obligatorio)"
                    : "Nota (obligatoria)"}
                </label>
                <Textarea
                  id="nota-transicion"
                  value={comentarioTransicion}
                  onChange={(e) => setComentarioTransicion(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Explica brevemente el motivo…"
                  disabled={isPendingTransicion}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPendingTransicion}
                    onClick={() => setDestinoEnConfirmacion(null)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    loading={isPendingTransicion}
                    disabled={!comentarioTransicion.trim()}
                    onClick={() =>
                      destinoEnConfirmacion === "reabrir"
                        ? confirmarReapertura()
                        : confirmarTransicion(destinoEnConfirmacion, comentarioTransicion.trim())
                    }
                  >
                    Confirmar
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* 3. Asignado a + fecha límite */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sel-asignado" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Asignado a
              </label>
              <Select
                value={evento.asignadoAUsuarioId ?? SIN_ASIGNAR}
                onValueChange={cambiarAsignado}
                disabled={isPendingAsignar}
              >
                <SelectTrigger id="sel-asignado" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_ASIGNAR}>Sin asignar</SelectItem>
                  {usuariosInternos.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nombreCompleto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="fecha-limite" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Fecha límite (SLA)
              </label>
              <Input
                id="fecha-limite"
                type="date"
                value={fechaLimiteInput}
                onChange={(e) => cambiarFechaLimite(e.target.value)}
                disabled={isPendingFecha || enTerminal}
              />
            </div>
          </section>

          {/* 4. Bloqueos */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Bloqueos de acciones financieras
            </h3>
            <div className="space-y-2">
              <FilaBloqueo
                id="chk-bloquea-facturacion"
                etiqueta="Bloquea facturación"
                checked={bloqueaFacturacionLocal}
                disabled={!puedeBloquearFacturacion || isPendingBloqueo}
                tooltipDeshabilitado="Esta excepción no está asociada a un período de cobro ni a un seller."
                onCheckedChange={setBloqueaFacturacionLocal}
              />
              <FilaBloqueo
                id="chk-bloquea-pago"
                etiqueta="Bloquea pago al conductor"
                checked={bloqueaPagoLocal}
                disabled={!puedeBloquearPago || isPendingBloqueo}
                tooltipDeshabilitado="Esta excepción no está asociada a una liquidación ni a un conductor."
                onCheckedChange={setBloqueaPagoLocal}
              />
            </div>

            {(bloqueaFacturacionLocal || bloqueaPagoLocal) && (
              <div className="mt-2 flex flex-col gap-1.5">
                <label htmlFor="motivo-bloqueo" className="text-xs font-medium text-foreground">
                  Motivo del bloqueo (obligatorio)
                </label>
                <Textarea
                  id="motivo-bloqueo"
                  value={motivoBloqueoLocal}
                  onChange={(e) => setMotivoBloqueoLocal(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="¿Por qué se bloquea esta acción financiera?"
                  disabled={isPendingBloqueo}
                />
              </div>
            )}

            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={isPendingBloqueo}
                disabled={bloqueoSinCambios || motivoBloqueoFaltante}
                onClick={guardarBloqueos}
              >
                <Lock className="size-3.5" aria-hidden="true" />
                Guardar bloqueos
              </Button>
            </div>
          </section>

          {/* 5. Descripción */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Descripción
            </h3>
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground">
              {evento.descripcion}
            </p>
          </section>

          {/* 6. Acción sugerida */}
          <section className="flex flex-col gap-1.5">
            <label htmlFor="sel-accion-sugerida" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Acción sugerida
            </label>
            <Select
              value={evento.accionSugerida}
              onValueChange={(v) => cambiarAccionSugerida(v as AccionSugeridaConciliacion)}
              disabled={isPendingAccion}
            >
              <SelectTrigger id="sel-accion-sugerida" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPCIONES_ACCION_SUGERIDA.map((opcion) => (
                  <SelectItem key={opcion} value={opcion}>
                    {traducirAccionSugeridaConciliacion(opcion)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          {/* 7. Historial */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Historial
            </h3>

            {cargandoHistorial && (
              <div className="space-y-2" role="status" aria-live="polite">
                <span className="sr-only">Cargando historial…</span>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}

            {!cargandoHistorial && errorHistorial && (
              <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                No se pudo cargar el historial.
                <Button type="button" variant="link" size="sm" className="ml-1 h-auto p-0" onClick={cargarHistorial}>
                  Reintentar
                </Button>
              </div>
            )}

            {!cargandoHistorial && !errorHistorial && historial && historial.length === 0 && (
              <p className="text-sm text-muted-foreground">Aún no hay actividad registrada.</p>
            )}

            {!cargandoHistorial && !errorHistorial && historial && historial.length > 0 && (
              <ol>
                {[...historial].reverse().map((entrada, indice, arr) => (
                  <EntradaHistorial
                    key={entrada.id}
                    entrada={entrada}
                    usuarios={usuariosInternos}
                    ultimo={indice === arr.length - 1}
                  />
                ))}
              </ol>
            )}

            <div className="mt-4 flex flex-col gap-1.5">
              <label htmlFor="nuevo-comentario" className="text-xs font-medium text-foreground">
                Agregar comentario
              </label>
              <Textarea
                id="nuevo-comentario"
                value={comentarioNuevo}
                onChange={(e) => setComentarioNuevo(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Deja una nota para el equipo…"
                disabled={isPendingComentario}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={isPendingComentario}
                  disabled={!comentarioNuevo.trim()}
                  onClick={enviarComentario}
                >
                  <MessageSquare className="size-3.5" aria-hidden="true" />
                  Comentar
                </Button>
              </div>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// =============================================================================
// Sub-componentes
// =============================================================================

function FilaBloqueo({
  id,
  etiqueta,
  checked,
  disabled,
  tooltipDeshabilitado,
  onCheckedChange,
}: {
  id: string;
  etiqueta: string;
  checked: boolean;
  disabled: boolean;
  tooltipDeshabilitado: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  const fila = (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border p-2.5 text-sm text-foreground has-disabled:cursor-not-allowed has-disabled:opacity-60"
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
      />
      <span className="flex items-center gap-1.5">
        <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
        {etiqueta}
      </span>
    </label>
  );

  if (!disabled || checked) return fila;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{fila}</TooltipTrigger>
      <TooltipContent>{tooltipDeshabilitado}</TooltipContent>
    </Tooltip>
  );
}

const ICONO_TIPO_CAMBIO: Record<TipoCambioConciliacion, typeof ArrowRightLeft> = {
  deteccion: Search,
  cambio_estado: ArrowRightLeft,
  asignacion: UserCheck,
  fecha_limite: CalendarClock,
  bloqueo: Lock,
  accion_sugerida: Lightbulb,
  comentario: MessageSquare,
};

function esRecordJson(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function nombreUsuario(id: string | null, usuarios: UsuarioInterno[]): string {
  if (!id) return "Sistema";
  return usuarios.find((u) => u.id === id)?.nombreCompleto ?? "Usuario";
}

function tituloEntradaHistorial(entrada: EventoConciliacionHistorial, usuarios: UsuarioInterno[]): string {
  const datos = esRecordJson(entrada.datos) ? entrada.datos : null;

  switch (entrada.tipoCambio) {
    case "cambio_estado": {
      const anterior = entrada.estadoAnterior
        ? traducirEstadoConciliacion(entrada.estadoAnterior as EstadoEventoConciliacion)
        : null;
      const nuevo = entrada.estadoNuevo
        ? traducirEstadoConciliacion(entrada.estadoNuevo as EstadoEventoConciliacion)
        : null;
      if (anterior && nuevo) return `Estado cambiado de "${anterior}" a "${nuevo}"`;
      if (nuevo) return `Estado fijado en "${nuevo}"`;
      return "Estado actualizado";
    }
    case "asignacion": {
      const nuevo = typeof datos?.asignado_a === "string" ? datos.asignado_a : null;
      const anterior = typeof datos?.asignado_a_anterior === "string" ? datos.asignado_a_anterior : null;
      if (nuevo && anterior) return `Reasignado de ${nombreUsuario(anterior, usuarios)} a ${nombreUsuario(nuevo, usuarios)}`;
      if (nuevo) return `Asignado a ${nombreUsuario(nuevo, usuarios)}`;
      if (anterior) return `Desasignado (antes ${nombreUsuario(anterior, usuarios)})`;
      return "Asignación actualizada";
    }
    case "fecha_limite": {
      const valor = typeof datos?.valor === "string" ? datos.valor : null;
      return valor ? `Fecha límite fijada al ${formatearFecha(valor)}` : "Fecha límite eliminada";
    }
    case "bloqueo": {
      const bf = !!datos?.bloquea_facturacion;
      const bp = !!datos?.bloquea_pago;
      if (!bf && !bp) return "Bloqueos liberados";
      const partes = [bf && "facturación", bp && "pago"].filter(Boolean);
      return `Bloqueo activo — ${partes.join(" y ")}`;
    }
    case "accion_sugerida": {
      const valor = typeof datos?.valor === "string" ? (datos.valor as AccionSugeridaConciliacion) : null;
      return valor
        ? `Acción sugerida cambiada a "${traducirAccionSugeridaConciliacion(valor)}"`
        : "Acción sugerida actualizada";
    }
    case "comentario":
      return "Comentario agregado";
    case "deteccion":
    default:
      return "Detectado por el sistema";
  }
}

function EntradaHistorial({
  entrada,
  usuarios,
  ultimo,
}: {
  entrada: EventoConciliacionHistorial;
  usuarios: UsuarioInterno[];
  ultimo: boolean;
}) {
  const Icono = ICONO_TIPO_CAMBIO[entrada.tipoCambio] ?? Search;
  const datos = esRecordJson(entrada.datos) ? entrada.datos : null;
  const esBloqueoActivo =
    entrada.tipoCambio === "bloqueo" && (!!datos?.bloquea_facturacion || !!datos?.bloquea_pago);
  const tono: NodoTono = esBloqueoActivo ? "atencion" : "hecho";
  const actor =
    entrada.actorTipo === "sistema" || !entrada.actorUsuarioId
      ? "Sistema"
      : nombreUsuario(entrada.actorUsuarioId, usuarios);

  return (
    <Nodo icono={Icono} titulo={tituloEntradaHistorial(entrada, usuarios)} tono={tono} ultimo={ultimo}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span>{actor}</span>
        <span aria-hidden="true">·</span>
        <span title={formatearFechaHora(entrada.creadoEn)}>{formatearTiempoRelativo(entrada.creadoEn)}</span>
      </div>
      {entrada.comentario && (
        <p className="mt-1 border-l-2 border-border pl-2 text-xs text-foreground italic">
          &ldquo;{entrada.comentario}&rdquo;
        </p>
      )}
    </Nodo>
  );
}
