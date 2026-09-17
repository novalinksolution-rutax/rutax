"use client";

/**
 * «Enlace para tus sellers» — REEMPLAZA a «Invitar seller» (RF-010 rediseño).
 * =============================================================================
 * Antes el courier invitaba de a uno, con el correo de cada seller. Ahora hay
 * UN enlace permanente por courier: se pega en el WhatsApp propio del courier
 * y cada seller que lo abre entra solo (Google + wizard), sin que nadie tenga
 * que escribir su correo a mano.
 *
 * Vive en un `PanelAccion` (mismo molde que el viejo «Invitar seller»): la
 * pregunta que trae a alguien acá suele ser «¿cuál es mi enlace?», y conviene
 * no perder de vista la lista de sellers de atrás.
 *
 * Estados cuidados: cargando (skeleton), error (con reintento), sin enlace
 * vivo (anulado — botón para generar uno) y enlace activo (caja + copiar +
 * texto sugerido de WhatsApp + regenerar/anular con ceremonia explícita).
 *
 * ⚠️ **`cargado` en vez de `cargando`**, mismo molde que
 * `configuracion/zonas/panel-zona.tsx`: poner `setEstado("cargando")` en el
 * cuerpo del efecto dispara un render en cascada
 * (`react-hooks/set-state-in-effect`). Con un `cargado` que arranca en
 * `false` y solo se toca en la respuesta, el efecto no toca estado de forma
 * síncrona y "cargando" se deriva de `abierto && !cargado`.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PanelAccion } from "@/components/ui/panel-accion";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BotonConfirmado } from "@/components/ui/boton-confirmado";
import {
  anularEnlaceSellerAction,
  obtenerEnlaceSellerAction,
  regenerarEnlaceSellerAction,
} from "./actions";

export function PanelEnlaceSeller({ nombreFantasia }: { nombreFantasia: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [cargado, setCargado] = useState(false);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [activo, setActivo] = useState(false);
  const [pendiente, startTransition] = useTransition();
  const [copiadoQue, setCopiadoQue] = useState<"enlace" | "whatsapp" | null>(null);

  // Se lee al abrir, y solo mientras no haya respuesta todavía (`!cargado`).
  // Volver a abrir el panel (tras cerrarlo) resetea `cargado` en
  // `onOpenChange` para releer — así no queda un token viejo mostrándose como
  // vigente si se anuló/regeneró desde otra pestaña.
  useEffect(() => {
    if (!abierto || cargado) return;
    let vigente = true;
    obtenerEnlaceSellerAction().then((r) => {
      if (!vigente) return;
      setCargado(true);
      if (!r.ok) {
        setMensajeError(r.mensaje);
        return;
      }
      setMensajeError(null);
      setToken(r.token);
      setActivo(r.activo);
    });
    return () => {
      vigente = false;
    };
  }, [abierto, cargado]);

  const cargando = abierto && !cargado;

  const url = token && typeof window !== "undefined" ? `${window.location.origin}/registro-seller/${token}` : "";
  const textoWhatsapp = url
    ? `Hola 👋 Te paso el enlace para sumarte como cliente de ${nombreFantasia} en Rutax. Entra con tu cuenta de Google y completa tus datos, quedas activo al tiro: ${url}`
    : "";

  function copiar(texto: string, que: "enlace" | "whatsapp") {
    if (!texto) return;
    navigator.clipboard.writeText(texto).then(
      () => {
        setCopiadoQue(que);
        toast.success(que === "enlace" ? "Enlace copiado." : "Mensaje copiado.");
        setTimeout(() => setCopiadoQue((actual) => (actual === que ? null : actual)), 2000);
      },
      () => toast.error("No pudimos copiar. Selecciona el texto y cópialo a mano."),
    );
  }

  /** Fuerza una nueva lectura — botones "Reintentar" y "Generar enlace". */
  function recargar() {
    setCargado(false);
  }

  function regenerar() {
    startTransition(async () => {
      const r = await regenerarEnlaceSellerAction();
      if (!r.ok) {
        toast.error(r.mensaje);
        return;
      }
      setToken(r.token);
      setActivo(r.activo);
      toast.success("Enlace regenerado.", {
        description: "El enlace anterior dejó de funcionar — si ya lo compartiste, vuelve a enviarlo.",
      });
    });
  }

  function anular() {
    startTransition(async () => {
      const r = await anularEnlaceSellerAction();
      if (!r.ok) {
        toast.error(r.mensaje);
        return;
      }
      setActivo(false);
      setToken(null);
      toast.success("Enlace anulado.", {
        description: "Nadie puede registrarse con él. Puedes generar uno nuevo cuando quieras.",
      });
    });
  }

  return (
    <PanelAccion
      abierto={abierto}
      onOpenChange={(v) => {
        setAbierto(v);
        if (!v) {
          // Al cerrar, se limpia para releer en la próxima apertura — y la
          // lista de atrás puede haber sumado un seller nuevo mientras el
          // panel estuvo abierto (alguien completó el wizard en paralelo).
          setCargado(false);
          router.refresh();
        }
      }}
      titulo="Enlace de registro"
      subtitulo="Tus sellers entran solos con este enlace — sin que invites a nadie de a uno."
      disparador={
        <Button size="sm" className="shrink-0">
          <Link2 className="size-4 shrink-0" aria-hidden="true" />
          Enlace para sellers
        </Button>
      }
    >
      {cargando ? (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : mensajeError ? (
        <div className="space-y-3">
          <Alert variant="destructive">
            <AlertDescription>{mensajeError}</AlertDescription>
          </Alert>
          <Button variant="outline" size="sm" onClick={recargar}>
            Reintentar
          </Button>
        </div>
      ) : !activo || !token ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            No tienes un enlace activo — nadie puede registrarse hasta que generes uno.
          </p>
          <Button size="sm" onClick={recargar}>
            Generar enlace
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Tu enlace</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full min-w-0 truncate rounded-md border border-input bg-muted/40 px-2.5 py-2 font-mono text-xs text-foreground"
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="shrink-0"
                aria-label="Copiar enlace"
                onClick={() => copiar(url, "enlace")}
              >
                {copiadoQue === "enlace" ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Para pegar en tu WhatsApp</p>
            <div className="rounded-md border border-input bg-muted/40 p-2.5 text-sm leading-relaxed text-foreground">
              {textoWhatsapp}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => copiar(textoWhatsapp, "whatsapp")}>
              {copiadoQue === "whatsapp" ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              Copiar mensaje
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <BotonConfirmado
              etiqueta={
                <>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Regenerar
                </>
              }
              variant="outline"
              size="sm"
              titulo="Vas a regenerar el enlace de registro"
              consecuencia="El enlace actual deja de funcionar de inmediato. Si ya lo compartiste con algún seller, tendrás que enviarle el nuevo — el anterior no lo va a dejar entrar."
              textoConfirmar="Regenerar enlace"
              cargando={pendiente}
              onConfirmar={regenerar}
            />
            <BotonConfirmado
              etiqueta="Anular enlace"
              variant="outline"
              size="sm"
              varianteModal="destructive"
              titulo="Vas a anular tu enlace de registro"
              consecuencia="Nadie va a poder registrarse como tu seller hasta que generes uno nuevo. Los sellers que ya se registraron no se ven afectados."
              textoConfirmar="Anular enlace"
              cargando={pendiente}
              onConfirmar={anular}
            />
          </div>
        </div>
      )}
    </PanelAccion>
  );
}
