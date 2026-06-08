"use client";

/**
 * Pantallas M + N — componente compartido y parametrizable (§3.2/§3.3).
 *
 * - Sin `resultado` en la URL → Pantalla M: CTA inicial ("Conectar con
 *   Mercado Libre"), con el bloque de instrucción de "cuenta principal"
 *   ANTES del botón — no en letra chica después (jerarquía explícita de §3.2).
 * - Con `resultado` → Pantalla N: una de las 7 ramificaciones de la tabla
 *   §3.2, cada una respondiendo primero "¿qué hago ahora?" y solo después
 *   (si acaso) "qué pasó técnicamente" (criterio de §3.3).
 *
 * `modo: 'conexion_inicial' | 'reconexion'` ajusta encabezados y énfasis —
 * en reconexión, la instrucción de "cuenta principal" es "aún más prominente"
 * (§3.2: "una causa común de desvinculación es justamente haber autorizado
 * con la cuenta equivocada la primera vez").
 */

import { useState } from "react";
import Link from "next/link";
import {
  AlertOctagon,
  CheckCircle2,
  ExternalLink,
  Loader2,
  ShieldAlert,
  TriangleAlert,
  UserX,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { iniciarConexionMl } from "./actions";
import type { ModoConexionMl, ResultadoCallbackMl } from "./compartido";

interface Props {
  modo: ModoConexionMl;
  resultado: ResultadoCallbackMl | null;
}

export function PantallaConexionMl({ modo, resultado }: Props) {
  if (resultado) {
    return <PantallaResultado modo={modo} resultado={resultado} />;
  }
  return <PantallaConectar modo={modo} />;
}

// ---------------------------------------------------------------------------
// Pantalla M — CTA inicial
// ---------------------------------------------------------------------------

type EstadoBoton = "inicial" | "redirigiendo";

function PantallaConectar({ modo }: { modo: ModoConexionMl }) {
  const [estado, setEstado] = useState<EstadoBoton>("inicial");
  const [error, setError] = useState<string | null>(null);

  async function manejarClicConectar() {
    if (estado === "redirigiendo") return;
    setError(null);
    setEstado("redirigiendo");

    const resultado = await iniciarConexionMl(modo);
    if (!resultado.ok || !resultado.urlAutorizacion) {
      setEstado("inicial");
      setError(resultado.mensaje ?? "No pudimos iniciar la conexión por un problema de nuestro sistema. Intenta de nuevo en unos minutos.");
      return;
    }

    // Redirección externa — no hay nada más que renderizar de este lado;
    // dejamos visible "Te llevamos a Mercado Libre…" mientras el navegador
    // navega (la redirección externa puede tardar un instante — §3.2,
    // estado "Redirigiendo").
    window.location.assign(resultado.urlAutorizacion);
  }

  return (
    <div className="w-full space-y-6 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {modo === "reconexion" ? "Reconecta tu cuenta de Mercado Libre" : "Conecta tu cuenta de Mercado Libre"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {modo === "reconexion"
            ? "Vamos a llevarte a Mercado Libre para que vuelvas a autorizar el acceso. Esto solo toma un minuto."
            : "Para que tus pedidos se sincronicen automáticamente, necesitamos que autorices el acceso desde tu cuenta de Mercado Libre."}
        </p>
      </div>

      {/* Bloque de instrucción destacado — ANTES del botón, no en letra
          chica después (jerarquía explícita de §3.2). En reconexión es "aún
          más prominente" porque entrar con la cuenta equivocada es una causa
          común de desvinculación. */}
      <div
        className={`flex gap-3 rounded-lg border-2 px-4 py-4 text-left ${
          modo === "reconexion"
            ? "border-destructive/50 bg-destructive/5"
            : "border-amber-500/50 bg-amber-500/10"
        }`}
        role="alert"
      >
        <TriangleAlert
          className={`size-6 shrink-0 ${modo === "reconexion" ? "text-destructive" : "text-amber-600"}`}
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className="font-semibold text-foreground">
            Importante: inicia sesión con tu cuenta PRINCIPAL de Mercado Libre
          </p>
          <p className="text-sm text-foreground">
            Es la cuenta del dueño o administrador de tu tienda. Si entras con la cuenta de un colaborador u
            operador, la conexión no va a funcionar y vas a tener que rehacerla.
          </p>
        </div>
      </div>

      <Button
        size="lg"
        className="w-full"
        onClick={manejarClicConectar}
        disabled={estado === "redirigiendo"}
      >
        {estado === "redirigiendo" ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Te llevamos a Mercado Libre…
          </>
        ) : (
          "Conectar con Mercado Libre"
        )}
      </Button>

      {error ? (
        <Alert variant="destructive" className="text-left">
          <ShieldAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Solo compartimos contigo la información de tus pedidos y publicaciones para sincronizarlos en este portal —
        nunca vemos ni guardamos tu contraseña de Mercado Libre.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pantalla N — Resultado (7 ramificaciones de la tabla §3.2)
// ---------------------------------------------------------------------------

interface ContenidoResultado {
  icono: React.ReactNode;
  tono: "exito" | "advertencia" | "error" | "neutro";
  titulo: string;
  descripcion: string;
  acciones: React.ReactNode;
}

function PantallaResultado({ modo, resultado }: { modo: ModoConexionMl; resultado: ResultadoCallbackMl }) {
  const contenido = construirContenido(modo, resultado);

  const estilosPorTono: Record<ContenidoResultado["tono"], string> = {
    exito: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
    advertencia: "border-amber-500/40 bg-amber-500/10 text-amber-700",
    error: "border-destructive/40 bg-destructive/10 text-destructive",
    neutro: "border-border bg-muted/40 text-muted-foreground",
  };

  return (
    <Card className="w-full">
      <CardContent className="flex flex-col items-center gap-5 px-6 py-8 text-center">
        <div className={`flex size-14 items-center justify-center rounded-full border-2 ${estilosPorTono[contenido.tono]}`}>
          {contenido.icono}
        </div>
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{contenido.titulo}</h1>
          <p className="text-sm text-muted-foreground">{contenido.descripcion}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">{contenido.acciones}</div>
      </CardContent>
    </Card>
  );
}

function BotonVolverAIntentar({ modo }: { modo: ModoConexionMl }) {
  return (
    <Button asChild className="w-full sm:w-auto">
      <Link href={`/portal/conectar-ml?modo=${modo}`}>Intentar de nuevo</Link>
    </Button>
  );
}

function BotonIrAlPortal() {
  return (
    <Button asChild className="w-full sm:w-auto">
      <Link href="/portal">Ir a mi portal</Link>
    </Button>
  );
}

function BotonContactarSoporte() {
  return (
    <Button asChild variant="outline" className="w-full sm:w-auto">
      <a href="mailto:soporte@plataforma.cl">
        Contactar soporte
        <ExternalLink className="size-4" aria-hidden="true" />
      </a>
    </Button>
  );
}

/**
 * Arma título/descripción/acciones para cada una de las 7 ramificaciones de
 * la tabla §3.2 — cada mensaje responde, en una frase, "¿es mi culpa, es de
 * ML, o es un conflicto con otra cuenta?" (decisión de diseño que atraviesa
 * toda la tabla). Devuelve también `estado_invalido` y `error_sistema`
 * (variantes que la tabla no nombra explícitamente, pero que el callback real
 * puede producir — sesión/CSRF y errores no clasificados — y que NO deben
 * caer en un mensaje genérico "ocurrió un error").
 */
function construirContenido(modo: ModoConexionMl, resultado: ResultadoCallbackMl): ContenidoResultado {
  switch (resultado) {
    case "exito":
      return {
        icono: <CheckCircle2 className="size-7" aria-hidden="true" />,
        tono: "exito",
        titulo: "¡Listo! Tu cuenta de Mercado Libre está conectada",
        descripcion:
          modo === "reconexion"
            ? "Volviste a autorizar el acceso correctamente. Tus pedidos van a seguir sincronizándose con normalidad."
            : "Ya podemos empezar a sincronizar tus pedidos automáticamente. Desde tu portal vas a poder seguir su estado en todo momento.",
        acciones: <BotonIrAlPortal />,
      };

    case "cuenta_en_otro_courier":
      return {
        icono: <UserX className="size-7" aria-hidden="true" />,
        tono: "error",
        titulo: "Esta cuenta de Mercado Libre ya está conectada a otra empresa",
        descripcion:
          "La cuenta con la que iniciaste sesión ya está vinculada a otra empresa de despacho en nuestra plataforma. Si crees que esto es un error, contacta a la empresa que te invitó o a soporte para revisarlo.",
        acciones: (
          <>
            <BotonVolverAIntentar modo={modo} />
            <BotonContactarSoporte />
          </>
        ),
      };

    case "cancelado":
      return {
        icono: <XCircle className="size-7" aria-hidden="true" />,
        tono: "neutro",
        titulo: "No completaste la conexión con Mercado Libre",
        descripcion: "No pasa nada — puedes intentarlo de nuevo cuando quieras.",
        acciones: <BotonVolverAIntentar modo={modo} />,
      };

    case "cuenta_colaborador":
      return {
        icono: <ShieldAlert className="size-7" aria-hidden="true" />,
        tono: "advertencia",
        titulo: "Iniciaste sesión con una cuenta de colaborador",
        descripcion:
          "Para conectar correctamente, vuelve a intentarlo iniciando sesión con la cuenta PRINCIPAL de tu tienda — la del dueño o administrador, no la de un colaborador u operador.",
        acciones: <BotonVolverAIntentar modo={modo} />,
      };

    case "error_transitorio":
      return {
        icono: <AlertOctagon className="size-7" aria-hidden="true" />,
        tono: "advertencia",
        titulo: "Mercado Libre no respondió a tiempo",
        descripcion: "Esto no es un problema de tu cuenta — es algo pasajero del lado de Mercado Libre. Intenta de nuevo en unos minutos.",
        acciones: <BotonVolverAIntentar modo={modo} />,
      };

    case "estado_invalido":
      return {
        icono: <ShieldAlert className="size-7" aria-hidden="true" />,
        tono: "neutro",
        titulo: "Tu sesión de conexión expiró",
        descripcion:
          "Pasó demasiado tiempo desde que iniciaste el proceso (o lo abriste en otra pestaña). No es un problema de tu cuenta de Mercado Libre — solo necesitas iniciar la conexión de nuevo.",
        acciones: <BotonVolverAIntentar modo={modo} />,
      };

    case "error_sistema":
    default:
      return {
        icono: <AlertOctagon className="size-7" aria-hidden="true" />,
        tono: "error",
        titulo: "No pudimos completar la conexión",
        descripcion: "Tuvimos un problema de nuestro lado al procesar tu conexión — no es algo que debas resolver tú. Ya quedó registrado; intenta de nuevo en unos minutos o contáctanos si sigue ocurriendo.",
        acciones: (
          <>
            <BotonVolverAIntentar modo={modo} />
            <BotonContactarSoporte />
          </>
        ),
      };
  }
}
