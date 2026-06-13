"use client";

/**
 * Onboarding "Conectar banco para cobranza" — formulario de cliente.
 *
 * Estructura idéntica al patrón "secreto guardado" del onboarding DTE:
 *   estado vacío explicativo → botón que abre el widget de Fintoc → al volver con
 *   el `exchange_token`, Server Action que canjea + guarda → tarjeta de
 *   solo-lectura con el alias de la cuenta + "Reconectar".
 *
 * REGLA DE ORO: el `link_token` NUNCA llega al cliente. Esta pantalla solo
 * conoce metadatos (alias de la cuenta, estado de conexión) — jamás el secreto.
 * El widget de Fintoc usa la PUBLIC key (`pk_test_…`/`pk_live_…`), segura para
 * el cliente; devuelve un `exchange_token` de un solo uso que el servidor canjea.
 *
 * TODO copy: textos pendientes de pulido por `copywriter`.
 */

import { useState, useTransition, useCallback, useRef } from "react";
import Script from "next/script";
import { Banknote, CheckCircle2, Landmark, RefreshCw, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoError } from "@/components/onboarding/estado-pantalla";
import {
  conectarBancoCobranza,
  type EstadoConfiguracionCobranza,
} from "./actions";

// URL del widget de Fintoc (script oficial). El SDK expone `window.Fintoc`.
const FINTOC_WIDGET_SRC = "https://js.fintoc.com/v1/";

// Forma mínima del SDK de Fintoc que usamos (evita `any` suelto).
interface FintocWidgetHandler {
  open: () => void;
  destroy?: () => void;
}
interface FintocSdk {
  create: (opciones: {
    publicKey: string;
    /** Para conexión de cuenta / conciliación, el producto es "movements". */
    product: "movements" | string;
    holderType?: "individual" | "business";
    /** Obligatorio para "movements": a dónde Fintoc envía los movimientos. */
    webhookUrl?: string;
    country?: string;
    onSuccess: (datos: { exchangeToken?: string; exchange_token?: string }) => void;
    onExit?: () => void;
    onEvent?: (evento: unknown) => void;
    onError?: (error: unknown) => void;
  }) => FintocWidgetHandler;
}
declare global {
  interface Window {
    Fintoc?: FintocSdk;
  }
}

interface Props {
  estadoInicial: EstadoConfiguracionCobranza | null;
  errorInicial: string | null;
  /** PUBLIC key de Fintoc (`pk_test_…`). Segura para el cliente; null si falta. */
  publicKey: string | null;
  /** URL de webhook por-tenant que el widget "movements" exige. */
  webhookUrl: string | null;
  /** Tipo de titular para el widget de Fintoc. `business` en producción. */
  holderType: "business" | "individual";
}

export function FormularioConexionCobranza({ estadoInicial, errorInicial, publicKey, webhookUrl, holderType }: Props) {
  const [estado, setEstado] = useState<EstadoConfiguracionCobranza | null>(estadoInicial);
  const [errorCarga, setErrorCarga] = useState<string | null>(errorInicial);
  const [recargando, setRecargando] = useState(false);

  async function recargar() {
    setRecargando(true);
    try {
      const { obtenerEstadoConfiguracionCobranza } = await import("./actions");
      const resultado = await obtenerEstadoConfiguracionCobranza();
      if (resultado.ok) {
        setEstado(resultado.estado);
        setErrorCarga(null);
      } else {
        setErrorCarga(resultado.mensaje);
      }
    } finally {
      setRecargando(false);
    }
  }

  if (errorCarga && !estado) {
    return <EstadoError descripcion={errorCarga} onReintentar={recargar} reintentando={recargando} />;
  }

  if (!estado) {
    return (
      <EstadoError
        descripcion="No pudimos preparar esta pantalla. Recarga para intentarlo de nuevo."
        onReintentar={recargar}
        reintentando={recargando}
      />
    );
  }

  return (
    <>
      <Script src={FINTOC_WIDGET_SRC} strategy="lazyOnload" />
      <SeccionConexion
        estado={estado}
        onActualizar={setEstado}
        publicKey={publicKey}
        webhookUrl={webhookUrl}
        holderType={holderType}
      />
    </>
  );
}

function SeccionConexion({
  estado,
  onActualizar,
  publicKey,
  webhookUrl,
  holderType,
}: {
  estado: EstadoConfiguracionCobranza;
  onActualizar: (estado: EstadoConfiguracionCobranza) => void;
  publicKey: string | null;
  webhookUrl: string | null;
  holderType: "business" | "individual";
}) {
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [abriendoWidget, setAbriendoWidget] = useState(false);
  const [pendiente, iniciarTransicion] = useTransition();
  // Handler del widget abierto, para poder cerrarlo si el usuario cancela
  // (escape cuando el widget se cuelga, p. ej. bloqueado por un adblocker).
  const widgetRef = useRef<FintocWidgetHandler | null>(null);

  const cancelarConexion = useCallback(() => {
    widgetRef.current?.destroy?.();
    widgetRef.current = null;
    setAbriendoWidget(false);
    setError(null);
  }, []);

  const procesarExchangeToken = useCallback(
    (exchangeToken: string) => {
      setAbriendoWidget(false);
      iniciarTransicion(async () => {
        const resultado = await conectarBancoCobranza(exchangeToken);
        if (!resultado.ok) {
          setError(resultado.mensaje);
          return;
        }
        setExito(true);
        onActualizar(resultado.estado);
      });
    },
    [onActualizar],
  );

  const abrirWidget = useCallback(() => {
    setError(null);
    setExito(false);

    if (!publicKey) {
      setError(
        "La conexión con tu banco no está disponible en este momento. Falta configurar el proveedor de pagos — contacta a soporte.",
      );
      return;
    }
    if (typeof window === "undefined" || !window.Fintoc) {
      setError("Aún estamos cargando el conector del banco. Espera unos segundos y vuelve a intentar.");
      return;
    }
    if (!webhookUrl) {
      setError(
        "La conexión con tu banco no está disponible en este momento. Falta configurar la URL de notificaciones — contacta a soporte.",
      );
      return;
    }

    try {
      setAbriendoWidget(true);
      const widget = window.Fintoc.create({
        publicKey,
        product: "movements",
        holderType,
        country: "cl",
        webhookUrl,
        onEvent: (evento) => {
          // Diagnóstico de los estados del widget (sin datos sensibles del banco).
          console.debug("[Fintoc] evento:", evento);
        },
        onSuccess: (datos) => {
          // El exchange token viene como `linkIntent.exchangeToken` (camelCase),
          // pero toleramos variantes por si el SDK cambia el shape.
          const d = (datos ?? {}) as Record<string, unknown>;
          const anidado = (d.linkIntent ?? d.link ?? {}) as Record<string, unknown>;
          const token =
            (d.exchangeToken as string | undefined) ??
            (d.exchange_token as string | undefined) ??
            (d.token as string | undefined) ??
            (anidado.exchangeToken as string | undefined) ??
            (anidado.exchange_token as string | undefined) ??
            "";
          if (token) {
            procesarExchangeToken(token);
          } else {
            // No vino el token donde lo esperábamos: registramos el shape real
            // para diagnóstico (es el linkIntent, no credenciales del banco).
            try {
              console.warn("[Fintoc] onSuccess SIN exchangeToken — claves:", Object.keys(d));
              console.warn("[Fintoc] onSuccess SIN exchangeToken — json:", JSON.stringify(datos));
            } catch {
              console.warn("[Fintoc] onSuccess SIN exchangeToken — payload:", datos);
            }
            setAbriendoWidget(false);
            setError(
              "No recibimos la confirmación del banco. Si en la ventana de Fintoc quedaron cuentas con permisos faltantes, vuelve a conectar habilitándolos todos.",
            );
          }
        },
        onExit: () => {
          widgetRef.current = null;
          setAbriendoWidget(false);
        },
        onError: () => {
          widgetRef.current = null;
          setAbriendoWidget(false);
          setError("Hubo un problema al conectar con tu banco. Vuelve a intentarlo.");
        },
      });
      widgetRef.current = widget;
      widget.open();
    } catch {
      setAbriendoWidget(false);
      setError("No pudimos abrir el conector del banco. Recarga la página e intenta de nuevo.");
    }
  }, [publicKey, webhookUrl, holderType, procesarExchangeToken]);

  const trabajando = abriendoWidget || pendiente;

  // Tarjeta de solo-lectura tras conectar (patrón "secreto guardado" del DTE).
  if (estado.bancoConectado) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Banco conectado para cobranza</CardTitle>
          <CardDescription>
            Leemos los movimientos de esta cuenta para detectar los pagos de tus sellers y conciliarlos
            automáticamente. No movemos dinero — solo consultamos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {exito ? (
            <Alert className="bg-success-subtle text-success-subtle-foreground">
              <CheckCircle2 className="text-success" />
              <AlertDescription className="text-success-subtle-foreground">
                Banco conectado de forma segura.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-subtle text-success-subtle-foreground">
                <Landmark className="size-5" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">
                    {estado.cuentaBancoAlias ?? "Cuenta bancaria conectada"}
                  </p>
                  <BadgeEstadoConexion estado={estado.estadoConexion} />
                </div>
                <p className="text-sm text-muted-foreground">
                  La conexión se guarda cifrada. Si cambiaste de cuenta o la conexión dejó de funcionar, puedes
                  reconectar.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-fit shrink-0"
              onClick={abrirWidget}
              disabled={trabajando}
            >
              {trabajando ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : null}
              {trabajando ? "Conectando…" : "Reconectar banco"}
            </Button>
          </div>

          {error ? (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  // Estado vacío explicativo → botón "Conectar banco".
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Conecta tu banco para cobrar a tus sellers</CardTitle>
        <CardDescription>
          Conectamos tu cuenta bancaria de forma segura (a través de Fintoc) para leer los movimientos y reconocer,
          solos, los pagos que te hacen tus sellers. No movemos tu dinero ni guardamos tus claves del banco — solo
          consultamos tus movimientos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/20 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Banknote className="size-5" aria-hidden="true" />
          </div>
          <p className="text-sm text-muted-foreground">
            Cuando conectes tu banco, cada transferencia que recibas de un seller se cruzará automáticamente con su
            período facturado. Los pagos que no calcen quedarán en la bandeja de revisión para que los resuelvas a
            mano.
          </p>
        </div>

        {error ? (
          <Alert variant="destructive">
            <ShieldAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {trabajando ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
              {pendiente ? "Guardando la conexión…" : "Conectando con tu banco — sigue los pasos en la ventana de Fintoc."}
            </p>
            {abriendoWidget && !pendiente ? (
              <>
                <p className="text-xs text-muted-foreground">
                  ¿No se abrió la ventana del banco o se quedó cargando? Suele ser un{" "}
                  <strong>bloqueador de anuncios</strong> bloqueando a Fintoc — desactívalo para este sitio
                  (o agrega <code>fintoc.com</code> a la lista blanca) y vuelve a intentar.
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={cancelarConexion}>
                  Cancelar
                </Button>
              </>
            ) : null}
          </div>
        ) : null}

        <Button onClick={abrirWidget} disabled={trabajando}>
          {trabajando ? "Conectando…" : "Conectar banco"}
        </Button>
      </CardContent>
    </Card>
  );
}

function BadgeEstadoConexion({ estado }: { estado: EstadoConfiguracionCobranza["estadoConexion"] }) {
  switch (estado) {
    case "conectado":
      return (
        <Badge variant="outline" className="border-success-subtle text-success">
          <CheckCircle2 className="size-3" aria-hidden="true" /> Conectado
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive">
          <ShieldAlert className="size-3" aria-hidden="true" /> Con problemas
        </Badge>
      );
    case "revocado":
      return <Badge variant="outline">Revocado</Badge>;
    case "desconectado":
    default:
      return <Badge variant="outline">Desconectado</Badge>;
  }
}
