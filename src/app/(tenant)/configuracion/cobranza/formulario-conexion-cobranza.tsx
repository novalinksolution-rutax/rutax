"use client";

/**
 * Onboarding "Conectar banco para cobranza" — formulario de cliente.
 *
 * Estructura del patrón "secreto guardado" del onboarding DTE: estado vacío
 * explicativo → botón que abre el widget de Fintoc → tarjeta de solo-lectura con
 * el alias de la cuenta + "Reconectar".
 *
 * ⚠️ LA CONEXIÓN NO SE CONFIRMA EN `onSuccess`, Y NO SE PUEDE. El widget del
 * producto "movements" devuelve `{id, link:{id}}` y nada más — no hay
 * `exchangeToken` que canjear (se verificó dos veces contra el sandbox con una
 * conexión completa). El `link_token` llega por un camino distinto y asíncrono: la
 * notificación que Fintoc dispara al `webhookUrl`, que aterriza en
 * `/api/webhooks/fintoc/[tenantId]` y es la que escribe la conexión.
 *
 * Por eso el flujo del cliente es: (1) `prepararConexionBanco()` para obtener el
 * `webhookUrl` con su nonce de un solo uso, (2) abrir el widget, (3) al cerrarse,
 * SONDEAR `obtenerEstadoConfiguracionCobranza()` hasta que el webhook haya
 * aterrizado. El sondeo no es pereza: no existe un canal sincrónico.
 *
 * REGLA DE ORO: el `link_token` NUNCA llega al cliente. Esta pantalla solo conoce
 * metadatos (alias de la cuenta, estado de conexión) — jamás el secreto. El widget
 * usa la PUBLIC key (`pk_test_…`/`pk_live_…`), segura para el cliente.
 *
 * TODO copy: textos pendientes de pulido por `copywriter`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Banknote, CheckCircle2, Landmark, RefreshCw, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoError } from "@/components/estado/estado-pantalla";
import {
  obtenerEstadoConfiguracionCobranza,
  prepararConexionBanco,
  type EstadoConfiguracionCobranza,
} from "./actions";
import { BadgeEstado } from "@/components/ui/badge-estado";
import {
  BADGE_CONEXION_COBRANZA,
  traducirEstadoConexionCobranza,
  type EstadoConexionCobranza,
} from "@/lib/ui/traduccion-estados";

// URL del widget de Fintoc (script oficial). El SDK expone `window.Fintoc`.
const FINTOC_WIDGET_SRC = "https://js.fintoc.com/v1/";

// Sondeo de confirmación: ~20 intentos cada 2,5 s ≈ 50 s. Fintoc notifica en
// segundos; el tope está para no dejar la pantalla girando si no llega nunca.
const INTENTOS_CONFIRMACION = 20;
const ESPERA_ENTRE_INTENTOS_MS = 2500;

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
    /**
     * En "movements" el payload real es `{id, link:{id}}`: NO trae el
     * `exchange_token` que documentan otros productos. Se tipa como desconocido
     * a propósito, para que nadie vuelva a leerle un token que no está.
     */
    onSuccess: (datos: unknown) => void;
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
  /** Tipo de titular para el widget de Fintoc. `business` en producción. */
  holderType: "business" | "individual";
}

export function FormularioConexionCobranza({ estadoInicial, errorInicial, publicKey, holderType }: Props) {
  const [estado, setEstado] = useState<EstadoConfiguracionCobranza | null>(estadoInicial);
  const [errorCarga, setErrorCarga] = useState<string | null>(errorInicial);
  const [recargando, setRecargando] = useState(false);

  async function recargar() {
    setRecargando(true);
    try {
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
        holderType={holderType}
      />
    </>
  );
}

function SeccionConexion({
  estado,
  onActualizar,
  publicKey,
  holderType,
}: {
  estado: EstadoConfiguracionCobranza;
  onActualizar: (estado: EstadoConfiguracionCobranza) => void;
  publicKey: string | null;
  holderType: "business" | "individual";
}) {
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [abriendoWidget, setAbriendoWidget] = useState(false);
  // `confirmando` = el widget cerró bien y estamos esperando que aterrice el
  // webhook de Fintoc. Es un estado propio, no un `useTransition`: la espera es
  // de un tercero, no de una Server Action nuestra.
  const [confirmando, setConfirmando] = useState(false);
  // Handler del widget abierto, para poder cerrarlo si el usuario cancela
  // (escape cuando el widget se cuelga, p. ej. bloqueado por un adblocker).
  const widgetRef = useRef<FintocWidgetHandler | null>(null);
  // Corta el sondeo si el componente se desmonta o el usuario cancela.
  const sondeoCanceladoRef = useRef(false);

  useEffect(() => {
    return () => {
      sondeoCanceladoRef.current = true;
    };
  }, []);

  const cancelarConexion = useCallback(() => {
    widgetRef.current?.destroy?.();
    widgetRef.current = null;
    sondeoCanceladoRef.current = true;
    setAbriendoWidget(false);
    setConfirmando(false);
    setError(null);
  }, []);

  /**
   * Espera a que el webhook de Fintoc aterrice.
   *
   * No hay forma de saberlo en el momento: el `link_token` viaja del servidor de
   * Fintoc al nuestro por un canal aparte, así que lo único que se puede hacer es
   * preguntar por el estado hasta que cambie. El tope evita dejar la pantalla
   * girando para siempre si la notificación nunca llega (y no rompe nada: la
   * conexión podría confirmarse después, y se verá al recargar).
   */
  const esperarConfirmacion = useCallback(async () => {
    sondeoCanceladoRef.current = false;
    setConfirmando(true);

    for (let intento = 0; intento < INTENTOS_CONFIRMACION; intento += 1) {
      await new Promise((resolver) => setTimeout(resolver, ESPERA_ENTRE_INTENTOS_MS));
      if (sondeoCanceladoRef.current) return;

      const resultado = await obtenerEstadoConfiguracionCobranza();
      if (sondeoCanceladoRef.current) return;

      if (resultado.ok && resultado.estado.bancoConectado) {
        setConfirmando(false);
        setExito(true);
        onActualizar(resultado.estado);
        return;
      }
    }

    setConfirmando(false);
    setError(
      "No pudimos confirmar la conexión con tu banco. Vuelve a intentarlo.",
    );
  }, [onActualizar]);

  const abrirWidget = useCallback(async () => {
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

    // El `webhookUrl` con su nonce se pide AHORA, no en el render: es de un solo
    // uso y vence en 15 minutos. Es también la única autorización que tendrá la
    // notificación en la que viene el `link_token`.
    setAbriendoWidget(true);
    const preparacion = await prepararConexionBanco();
    if (!preparacion.ok) {
      setAbriendoWidget(false);
      setError(preparacion.mensaje);
      return;
    }

    try {
      const widget = window.Fintoc.create({
        publicKey,
        product: "movements",
        holderType,
        country: "cl",
        webhookUrl: preparacion.webhookUrl,
        onEvent: (evento) => {
          // Diagnóstico de los estados del widget (sin datos sensibles del banco).
          console.debug("[Fintoc] evento:", evento);
        },
        onSuccess: () => {
          // El payload NO se lee: en "movements" no trae nada que sirva. La
          // conexión la confirma el webhook, y aquí solo se empieza a esperar.
          widgetRef.current = null;
          setAbriendoWidget(false);
          void esperarConfirmacion();
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
      setError("No pudimos abrir el conector del banco. Intenta recargar la página.");
    }
  }, [publicKey, holderType, esperarConfirmacion]);

  const trabajando = abriendoWidget || confirmando;

  // Tarjeta de solo-lectura tras conectar (patrón "secreto guardado" del DTE).
  if (estado.bancoConectado) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Banco conectado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {exito ? (
            <Alert className="bg-success-subtle text-success-subtle-foreground">
              <CheckCircle2 className="text-success" />
              <AlertDescription className="text-success-subtle-foreground">
                Banco conectado.
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
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-fit shrink-0"
              onClick={() => void abrirWidget()}
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
        <CardTitle className="text-base">Conecta tu banco</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/20 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Banknote className="size-5" aria-hidden="true" />
          </div>
          <p className="text-sm text-muted-foreground">
            Cada transferencia se concilia sola. Lo que no calce queda para revisión.
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
              {confirmando
                ? "Confirmando la conexión con tu banco…"
                : "Abriendo ventana segura — completa los pasos ahí."}
            </p>
            {abriendoWidget && !confirmando ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Si la ventana no se abre, desactiva cualquier{" "}
                  <strong>bloqueador de anuncios</strong> en este sitio y vuelve a intentar.
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={cancelarConexion}>
                  Cancelar
                </Button>
              </>
            ) : null}
          </div>
        ) : null}

        <Button onClick={() => void abrirWidget()} disabled={trabajando}>
          {trabajando ? "Conectando…" : "Conectar banco"}
        </Button>
      </CardContent>
    </Card>
  );
}

function BadgeEstadoConexion({ estado }: { estado: EstadoConfiguracionCobranza["estadoConexion"] }) {
  // `revocado` y `desconectado` quedan en `inert`: la conexión existe, está
  // fuera de juego y se arregla volviendo a conectar (registro §12.3). Antes
  // eran el mismo gris de "todavía no se hizo".
  return (
    <BadgeEstado
      variante={BADGE_CONEXION_COBRANZA[estado as EstadoConexionCobranza] ?? "neutral"}
      texto={traducirEstadoConexionCobranza(estado)}
      eje="conexion-cobranza"
      valor={estado}
    />
  );
}
