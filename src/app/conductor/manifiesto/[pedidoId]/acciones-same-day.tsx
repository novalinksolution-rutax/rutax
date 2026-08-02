"use client";

/**
 * AccionesSameDay — Botones "Entregar" y "No entregado" para pedidos same-day.
 *
 * FRONTERA DURA: este componente solo se monta cuando tipoPedido==='same_day'
 * Y estado==='en_ruta'. El Server Component padre lo decide; aquí no se
 * vuelve a verificar (la verificación real está en el backend).
 *
 * Flujo "Entregar" (2 toques):
 *   1. El conductor toca "Entregar" → bottom sheet con cámara + GPS.
 *   2. Captura foto (input file capture=environment), comprime client-side.
 *   3. Captura GPS con navigator.geolocation.
 *   4. Envía todo al Server Action actionEntregarPedido.
 *
 * Flujo "No entregado":
 *   1. Bottom sheet con selector de incidencia + foto opcional + GPS.
 *   2. Envía a actionNoEntregarPedido.
 *
 * PRIVACIDAD: lat/long y foto se envían directamente al server action,
 * nunca se loguean en consola del cliente.
 */

import { useState, useRef, useTransition, useCallback } from "react";
import { Camera, MapPin, CheckCircle2, AlertTriangle, X, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIPOS_INCIDENCIA, type TipoIncidencia } from "@/modules/operacion/tipos";
import { traducirTipoIncidencia } from "@/lib/ui/traduccion-estados";
import {
  actionEntregarPedido,
  actionNoEntregarPedido,
  type ResultadoAccionPod,
} from "./actions";

// =============================================================================
// Tipos
// =============================================================================

interface Props {
  pedidoId: string;
}

type VistaModal = "cerrado" | "entregar" | "no_entregar";
type EstadoCaptura = "idle" | "capturando_foto" | "capturando_gps" | "enviando" | "exito" | "aviso" | "error";

// =============================================================================
// Utilidades de compresión de imagen (client-side)
// =============================================================================

const MAX_LADO_PX = 1280;
const CALIDAD_JPEG = 0.72;

async function comprimirImagen(archivo: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(archivo);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const factor = Math.min(1, MAX_LADO_PX / Math.max(img.width, img.height));
      const w = Math.round(img.width * factor);
      const h = Math.round(img.height * factor);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("No canvas context")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("No se pudo comprimir la imagen."));
        },
        "image/jpeg",
        CALIDAD_JPEG,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Error cargando la imagen.")); };
    img.src = url;
  });
}

// =============================================================================
// Hook de captura GPS
// =============================================================================

interface GeoCapturada {
  lat: number;
  long: number;
  precisionM?: number;
}

async function capturarGps(): Promise<GeoCapturada | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        long: pos.coords.longitude,
        precisionM: pos.coords.accuracy,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });
}

// =============================================================================
// Componente principal
// =============================================================================

export function AccionesSameDay({ pedidoId }: Props) {
  const [vista, setVista] = useState<VistaModal>("cerrado");
  const [estado, setEstado] = useState<EstadoCaptura>("idle");
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [tipoIncidencia, setTipoIncidencia] = useState<TipoIncidencia>("destinatario_ausente");
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [fotoBlobEntrega, setFotoBlobEntrega] = useState<Blob | null>(null);
  const [fotoBlobFallo, setFotoBlobFallo] = useState<Blob | null>(null);
  const [, startTransition] = useTransition();

  const inputFotoEntregaRef = useRef<HTMLInputElement>(null);
  const inputFotoFalloRef = useRef<HTMLInputElement>(null);

  // --- Resetear estado al cerrar ---
  const cerrarModal = useCallback(() => {
    if (estado === "enviando") return;
    setVista("cerrado");
    setEstado("idle");
    setMensajeError(null);
    setFotoPreview(null);
    setFotoBlobEntrega(null);
    setFotoBlobFallo(null);
  }, [estado]);

  // --- Capturar foto para entrega ---
  const handleFotoEntrega = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setEstado("capturando_foto");
    try {
      const blob = await comprimirImagen(archivo);
      setFotoBlobEntrega(blob);
      const preview = URL.createObjectURL(blob);
      setFotoPreview(preview);
    } catch {
      setMensajeError("No se pudo procesar la foto. Intenta de nuevo.");
    } finally {
      setEstado("idle");
    }
  }, []);

  // --- Capturar foto para fallo ---
  const handleFotoFallo = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setEstado("capturando_foto");
    try {
      const blob = await comprimirImagen(archivo);
      setFotoBlobFallo(blob);
      const preview = URL.createObjectURL(blob);
      setFotoPreview(preview);
    } catch {
      setMensajeError("No se pudo procesar la foto. Intenta de nuevo.");
    } finally {
      setEstado("idle");
    }
  }, []);

  // --- Confirmar entrega ---
  const handleConfirmarEntrega = useCallback(() => {
    startTransition(async () => {
      setEstado("capturando_gps");
      setMensajeError(null);

      const geo = await capturarGps();

      setEstado("enviando");

      const formData = new FormData();
      formData.set("pedidoId", pedidoId);
      if (fotoBlobEntrega) formData.set("foto", fotoBlobEntrega, "pod.jpg");
      if (geo) {
        formData.set("lat", String(geo.lat));
        formData.set("long", String(geo.long));
        if (geo.precisionM !== undefined) formData.set("precisionM", String(geo.precisionM));
      }

      const resultado: ResultadoAccionPod = await actionEntregarPedido(formData);

      if (resultado.error) {
        setEstado("error");
        setMensajeError(resultado.error);
      } else if (resultado.avisoPendienteRevision) {
        setEstado("aviso");
      } else {
        setEstado("exito");
      }
    });
  }, [pedidoId, fotoBlobEntrega]);

  // --- Confirmar no entregado ---
  const handleConfirmarFallo = useCallback(() => {
    startTransition(async () => {
      setEstado("capturando_gps");
      setMensajeError(null);

      const geo = await capturarGps();

      setEstado("enviando");

      const formData = new FormData();
      formData.set("pedidoId", pedidoId);
      formData.set("tipoIncidencia", tipoIncidencia);
      if (fotoBlobFallo) formData.set("foto", fotoBlobFallo, "pod_fallo.jpg");
      if (geo) {
        formData.set("lat", String(geo.lat));
        formData.set("long", String(geo.long));
        if (geo.precisionM !== undefined) formData.set("precisionM", String(geo.precisionM));
      }

      const resultado: ResultadoAccionPod = await actionNoEntregarPedido(formData);

      if (resultado.error) {
        setEstado("error");
        setMensajeError(resultado.error);
      } else {
        setEstado("exito");
      }
    });
  }, [pedidoId, tipoIncidencia, fotoBlobFallo]);

  // --- Estado final: éxito ---
  if (estado === "exito") {
    const esEntrega = vista === "entregar" || (vista === "cerrado" && !mensajeError);
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg bg-success p-4 text-center text-success-foreground"
      >
        <CheckCircle2 className="mx-auto mb-2 size-8" aria-hidden="true" />
        <p className="font-semibold text-base">
          {esEntrega ? "Entrega registrada correctamente" : "No entregado registrado"}
        </p>
        <p className="mt-1 text-sm opacity-80">
          El coordinador verá el cambio de inmediato.
        </p>
      </div>
    );
  }

  // --- Estado final: aviso geocerca ---
  if (estado === "aviso") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg bg-warning-subtle p-4 text-warning-subtle-foreground"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Entrega registrada — revisión pendiente</p>
            <p className="mt-1 text-sm opacity-80">
              La ubicación no coincide exactamente con el destino. El coordinador revisará la evidencia. Tu entrega quedó guardada.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Botones de acción */}
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          onClick={() => setVista("entregar")}
          className="min-h-[56px] w-full rounded-lg text-base font-bold"
          aria-haspopup="dialog"
        >
          <CheckCircle2 className="mr-2 size-5" aria-hidden="true" />
          Entregar
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setVista("no_entregar")}
          className="min-h-[56px] w-full rounded-lg text-base font-semibold border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
          aria-haspopup="dialog"
        >
          <X className="mr-2 size-5" aria-hidden="true" />
          No entregado
        </Button>
      </div>

      {/* ===== MODAL ENTREGAR ===== */}
      {vista === "entregar" && (
        <BottomSheet
          titulo="Registrar entrega"
          onCerrar={cerrarModal}
          deshabilitarCierre={estado === "enviando" || estado === "capturando_gps"}
        >
          <div className="space-y-4">
            {/* Foto obligatoria */}
            <div>
              <p className="mb-2 text-sm font-medium">
                Foto del paquete entregado
                <span className="text-destructive" aria-hidden="true"> *</span>
              </p>
              <input
                ref={inputFotoEntregaRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                aria-label="Capturar foto del paquete entregado"
                onChange={handleFotoEntrega}
              />
              {fotoPreview ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={fotoPreview}
                    alt="Vista previa de la foto capturada"
                    className="h-40 w-full rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (fotoPreview) URL.revokeObjectURL(fotoPreview);
                      setFotoPreview(null);
                      setFotoBlobEntrega(null);
                    }}
                    className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                    aria-label="Eliminar foto y volver a capturar"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => inputFotoEntregaRef.current?.click()}
                  className="flex min-h-[48px] w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-muted/30 py-6 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <Camera className="size-6" aria-hidden="true" />
                  Toca para sacar una foto
                </button>
              )}
            </div>

            {/* Aviso de GPS */}
            <div className="flex items-start gap-2 rounded-lg bg-info-subtle px-3 py-2 text-xs text-info-subtle-foreground">
              <MapPin className="mt-0.5 size-3.5 flex-shrink-0" aria-hidden="true" />
              <p>Tu ubicación se capturará automáticamente al confirmar para verificar que estás en el destino.</p>
            </div>

            {/* Error */}
            {mensajeError && (
              <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">
                {mensajeError}
              </p>
            )}

            {/* CTA */}
            <Button
              type="button"
              onClick={handleConfirmarEntrega}
              disabled={!fotoBlobEntrega || estado === "enviando" || estado === "capturando_gps"}
              className="min-h-[56px] w-full rounded-lg text-base font-bold"
            >
              {estado === "capturando_gps" && (
                <><Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />Obteniendo ubicación…</>
              )}
              {estado === "enviando" && (
                <><Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />Registrando entrega…</>
              )}
              {(estado === "idle" || estado === "capturando_foto" || estado === "error") && "Confirmar entrega"}
            </Button>
          </div>
        </BottomSheet>
      )}

      {/* ===== MODAL NO ENTREGADO ===== */}
      {vista === "no_entregar" && (
        <BottomSheet
          titulo="Registrar no entregado"
          onCerrar={cerrarModal}
          deshabilitarCierre={estado === "enviando" || estado === "capturando_gps"}
        >
          <div className="space-y-4">
            {/* Selector de motivo */}
            <div>
              <label htmlFor="motivo-fallo" className="mb-2 block text-sm font-medium">
                Motivo
                <span className="text-destructive" aria-hidden="true"> *</span>
              </label>
              {/* Select del sistema (no <select> nativo) — mismo componente que
                  el resto del producto. Se conserva el alto táctil de 48px y el
                  texto base porque esto lo usa el conductor en la calle. */}
              <Select
                value={tipoIncidencia}
                onValueChange={(v) => setTipoIncidencia(v as TipoIncidencia)}
              >
                <SelectTrigger
                  id="motivo-fallo"
                  className="min-h-12 w-full px-4 text-base data-[size=default]:h-12"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_INCIDENCIA.map((tipo) => (
                    <SelectItem key={tipo} value={tipo} className="min-h-11 text-base">
                      {traducirTipoIncidencia(tipo)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Foto opcional */}
            <div>
              <p className="mb-2 text-sm font-medium">Foto de evidencia (opcional)</p>
              <input
                ref={inputFotoFalloRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                aria-label="Capturar foto de evidencia del no entregado"
                onChange={handleFotoFallo}
              />
              {fotoPreview ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={fotoPreview}
                    alt="Vista previa de la foto de evidencia"
                    className="h-32 w-full rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (fotoPreview) URL.revokeObjectURL(fotoPreview);
                      setFotoPreview(null);
                      setFotoBlobFallo(null);
                    }}
                    className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                    aria-label="Eliminar foto y volver a capturar"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => inputFotoFalloRef.current?.click()}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 py-4 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <Camera className="size-5" aria-hidden="true" />
                  Agregar foto (opcional)
                </button>
              )}
            </div>

            {/* GPS info */}
            <div className="flex items-start gap-2 rounded-lg bg-info-subtle px-3 py-2 text-xs text-info-subtle-foreground">
              <MapPin className="mt-0.5 size-3.5 flex-shrink-0" aria-hidden="true" />
              <p>Tu ubicación se capturará al confirmar para el registro de la incidencia.</p>
            </div>

            {/* Error */}
            {mensajeError && (
              <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">
                {mensajeError}
              </p>
            )}

            {/* CTA */}
            <Button
              type="button"
              onClick={handleConfirmarFallo}
              disabled={estado === "enviando" || estado === "capturando_gps"}
              variant="destructive"
              className="min-h-[56px] w-full rounded-lg text-base font-bold"
            >
              {estado === "capturando_gps" && (
                <><Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />Obteniendo ubicación…</>
              )}
              {estado === "enviando" && (
                <><Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />Registrando…</>
              )}
              {(estado === "idle" || estado === "capturando_foto" || estado === "error") && "Confirmar no entregado"}
            </Button>
          </div>
        </BottomSheet>
      )}
    </>
  );
}

// =============================================================================
// BottomSheet — bottom sheet accesible mobile-first
// =============================================================================

function BottomSheet({
  titulo,
  children,
  onCerrar,
  deshabilitarCierre = false,
}: {
  titulo: string;
  children: React.ReactNode;
  onCerrar: () => void;
  deshabilitarCierre?: boolean;
}) {
  const tituloId = `bs-${titulo.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
        onClick={() => !deshabilitarCierre && onCerrar()}
        aria-hidden="true"
      />

      {/* Panel — se acota a la altura del viewport; solo el cuerpo scrollea
          (header y handle fijos) para no perder el CTA en viewport bajo. */}
      <div className="relative z-10 flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-xl border border-border bg-popover shadow-lg pb-safe">
        {/* Handle bar */}
        <div className="flex shrink-0 justify-center pt-3 pb-1" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header fijo */}
        <div className="flex shrink-0 items-center justify-between px-5 pb-3">
          <h2 id={tituloId} className="text-lg font-semibold">
            {titulo}
          </h2>
          {!deshabilitarCierre && (
            <button
              type="button"
              onClick={onCerrar}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Cerrar"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Cuerpo scrolleable */}
        <div className="overflow-y-auto px-5 pb-6">{children}</div>
      </div>
    </div>
  );
}

// =============================================================================
// BannerFlexSoloLectura — para pedidos Flex (no same-day)
// =============================================================================

/**
 * Banner permanente para pedidos Flex. El conductor no puede hacer nada —
 * debe usar la app de Mercado Envíos Flex.
 */
export function BannerFlexSoloLectura() {
  return (
    <div
      role="note"
      aria-label="Instrucción obligatoria para pedidos Flex"
      className="rounded-lg bg-info px-4 py-4 text-info-foreground"
    >
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 size-5 flex-shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold text-sm">Pedido Flex</p>
          <p className="mt-0.5 text-sm opacity-90">
            Para registrar esta entrega, usa la app de{" "}
            <strong>Mercado Envíos Flex</strong>. Esta pantalla es solo de referencia.
          </p>
        </div>
      </div>
    </div>
  );
}
