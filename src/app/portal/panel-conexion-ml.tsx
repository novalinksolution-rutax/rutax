"use client";

/**
 * Pantalla O — Panel de estado de conexión (§3.2, RF-048).
 *
 * Traduce `estado_salud` a lenguaje humano — "el seller no debe ver jamás los
 * strings internos (sana/atencion/desvinculada/pendiente) ni términos
 * técnicos (token, OAuth, refresh, callback)" (§3.3). El ÚNICO control es el
 * botón "Reconectar" (acción de servidor que reinicia el flujo OAuth,
 * reutilizando Pantallas M→N) — coherente con "el seller nunca edita tokens".
 *
 * Estados de la pantalla en su conjunto (no solo de la conexión):
 *   - Sin conexión todavía → tarjeta neutra + CTA "Conectar mi cuenta"
 *   - sana / pendiente / atencion / desvinculada → tabla de traducción §3.2
 *   - Backfill en curso → mensaje informativo transitorio (solo si hay datos
 *     reales que lo respalden — `desconectada_desde`; el sistema NO expone
 *     todavía progreso de backfill (RF-017 es de Fase B), así que no se
 *     inventa una barra de progreso, solo el contexto de fecha)
 *   - Error al cargar → reintento simple (criterio: "no debe quedar en
 *     blanco silenciosamente")
 */

import { useState } from "react";
import { CheckCircle2, Clock, Loader2, ShieldAlert, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EstadoError } from "@/components/onboarding/estado-pantalla";
import { formatearFecha, formatearTiempoRelativo } from "@/lib/formato-cl";
import { iniciarConexionMl } from "./conectar-ml/actions";
import { obtenerEstadoConexionPropia, type ConexionMlSeller } from "./actions";

interface Props {
  estadoInicial: ConexionMlSeller | null;
  errorInicial: string | null;
}

export function PanelConexionMl({ estadoInicial, errorInicial }: Props) {
  const [conexion, setConexion] = useState<ConexionMlSeller | null>(estadoInicial);
  const [error, setError] = useState<string | null>(errorInicial);
  const [cargando, setCargando] = useState(false);
  const [reconectando, setReconectando] = useState(false);
  const [errorReconexion, setErrorReconexion] = useState<string | null>(null);

  async function recargar() {
    setCargando(true);
    setError(null);
    const resultado = await obtenerEstadoConexionPropia();
    setCargando(false);

    if (!resultado.ok) {
      setError(resultado.mensaje);
      return;
    }
    setConexion(resultado.conexion);
  }

  async function manejarReconectar() {
    if (reconectando) return;
    setErrorReconexion(null);
    setReconectando(true);

    const resultado = await iniciarConexionMl(conexion ? "reconexion" : "conexion_inicial");
    if (!resultado.ok || !resultado.urlAutorizacion) {
      setReconectando(false);
      setErrorReconexion(
        resultado.mensaje ?? "No pudimos iniciar la reconexión por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
      );
      return;
    }

    window.location.assign(resultado.urlAutorizacion);
  }

  if (error) {
    return <EstadoError descripcion={error} onReintentar={recargar} reintentando={cargando} />;
  }

  // -----------------------------------------------------------------------
  // Sin conexión todavía — el seller aceptó la invitación pero no completó
  // OAuth (no hay fila en `conexiones_seller_ml`). Mismo flujo que el
  // onboarding inicial: "conectar y reconectar son la misma acción con
  // distinto punto de entrada" (§3.2).
  // -----------------------------------------------------------------------
  if (!conexion) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Clock className="size-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="font-medium text-foreground">Todavía no conectaste tu cuenta de Mercado Libre</p>
            <p className="text-sm text-muted-foreground">
              Conéctala para que tus pedidos empiecen a sincronizarse automáticamente en este portal.
            </p>
          </div>
          <Button onClick={manejarReconectar} disabled={reconectando} size="lg">
            {reconectando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {reconectando ? "Te llevamos a Mercado Libre…" : "Conectar mi cuenta de Mercado Libre"}
          </Button>
          {errorReconexion ? (
            <Alert variant="destructive" className="text-left">
              <ShieldAlert />
              <AlertDescription>{errorReconexion}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  const presentacion = traducirEstadoSalud(conexion);

  return (
    <div className="space-y-4">
      <Card className={presentacion.bordeTarjeta}>
        <CardContent className="flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 text-left">
            <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${presentacion.fondoIcono}`}>
              {presentacion.icono}
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">{presentacion.titulo}</p>
              {presentacion.detalle ? <p className="text-sm text-muted-foreground">{presentacion.detalle}</p> : null}
            </div>
          </div>

          {presentacion.mostrarBotonReconectar ? (
            <Button onClick={manejarReconectar} disabled={reconectando} variant={presentacion.tono === "critico" ? "default" : "outline"}>
              {reconectando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {reconectando ? "Te llevamos a Mercado Libre…" : "Reconectar"}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {errorReconexion ? (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertDescription>{errorReconexion}</AlertDescription>
        </Alert>
      ) : null}

      {/* Backfill en curso — solo se muestra si hay un dato real que lo
          respalde (`desconectada_desde`). El sistema no expone todavía
          progreso de backfill (RF-017, Fase B) — no se inventa una barra de
          progreso; solo se gestiona la expectativa con la fecha real. */}
      {conexion.estadoSalud === "sana" && conexion.desconectadaDesde ? (
        <Alert>
          <Clock />
          <AlertDescription>
            Estamos recuperando los pedidos del período en que tu cuenta estuvo desconectada (desde el{" "}
            {formatearFecha(conexion.desconectadaDesde)}). Esto puede tomar un momento — no necesitas hacer nada.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

interface PresentacionEstado {
  icono: React.ReactNode;
  titulo: string;
  detalle: string | null;
  fondoIcono: string;
  bordeTarjeta: string;
  tono: "ok" | "neutro" | "atencion" | "critico";
  mostrarBotonReconectar: boolean;
}

/**
 * Tabla de traducción §3.2 — "un solo indicador de estado, traducido a
 * lenguaje humano". Jamás expone `estado_salud` ni jerga técnica.
 */
function traducirEstadoSalud(conexion: ConexionMlSeller): PresentacionEstado {
  switch (conexion.estadoSalud) {
    case "sana":
      return {
        icono: <CheckCircle2 className="size-5" aria-hidden="true" />,
        titulo: "Tu cuenta está conectada y sincronizando con normalidad",
        detalle: conexion.ultimaSyncExitosaEn
          ? `Última sincronización: ${formatearTiempoRelativo(conexion.ultimaSyncExitosaEn)}`
          : null,
        fondoIcono: "bg-success/15 text-success",
        bordeTarjeta: "border-success/30",
        tono: "ok",
        mostrarBotonReconectar: false,
      };

    case "pendiente":
      return {
        icono: <Clock className="size-5" aria-hidden="true" />,
        titulo: "Estamos terminando de configurar tu conexión",
        detalle: "Esto es transitorio — no necesitas hacer nada por ahora.",
        fondoIcono: "bg-muted text-muted-foreground",
        bordeTarjeta: "border-border",
        tono: "neutro",
        mostrarBotonReconectar: false,
      };

    case "atencion":
      return {
        icono: <TriangleAlert className="size-5" aria-hidden="true" />,
        titulo: "Tu conexión necesita atención — estamos trabajando en resolverlo",
        detalle: "Es un problema operativo de nuestro lado o de Mercado Libre, no algo que tengas que resolver tú.",
        fondoIcono: "bg-warning/15 text-warning",
        bordeTarjeta: "border-warning/30",
        tono: "atencion",
        // Aunque la tabla §3.2 marca "Ver más" como opcional para `atencion`
        // y reserva "Reconectar" como prominente para `desvinculada`, ofrecer
        // el mismo botón aquí (en tono secundario) es coherente con "el único
        // control disponible es Reconectar" — no se inventa una acción
        // distinta ("Ver más") que no tiene contenido propio definido.
        mostrarBotonReconectar: true,
      };

    case "desvinculada":
    default:
      return {
        icono: <ShieldAlert className="size-5" aria-hidden="true" />,
        titulo: "Tu cuenta de Mercado Libre se desconectó",
        detalle: conexion.desconectadaDesde
          ? `Desde el ${formatearFecha(conexion.desconectadaDesde)}. Reconéctala para seguir recibiendo tus pedidos.`
          : "Reconéctala para seguir recibiendo tus pedidos.",
        fondoIcono: "bg-destructive/15 text-destructive",
        bordeTarjeta: "border-destructive/30",
        tono: "critico",
        mostrarBotonReconectar: true,
      };
  }
}
