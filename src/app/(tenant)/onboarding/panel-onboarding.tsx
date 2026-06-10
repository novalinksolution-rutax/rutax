"use client";

/**
 * Pantalla D — Panel de onboarding (checklist persistente).
 *
 * Jerarquía (§1.2 del documento UX): encabezado + barra de progreso, luego
 * tres tarjetas de paso (DTE, Folios, Tarifas), cada una con ícono de estado,
 * título, descripción de una línea, badge y botón de acción que precarga el
 * dato ya capturado (criterio transversal #4 — nunca repetir lo ya sabido).
 *
 * Cuando los pasos críticos (DTE activo + ≥1 tarifa) están completos, la
 * tarjeta se reemplaza por un mensaje de cierre — pero esta página NUNCA
 * desaparece del todo: sigue accesible desde "Configuración → Estado de
 * activación" (§1.3), por eso conserva un resumen incluso "completo".
 */

import Link from "next/link";
import {
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  Receipt,
  ShieldAlert,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatearFecha } from "@/lib/formato-cl";
import type { EstadoOnboardingCourier } from "./estado";

interface Props {
  estado: EstadoOnboardingCourier;
  puedeGestionarDte: boolean;
  puedeGestionarTarifas: boolean;
}

export function PanelOnboarding({ estado, puedeGestionarDte, puedeGestionarTarifas }: Props) {
  const porcentaje = Math.round((estado.pasosCompletados / estado.totalPasos) * 100);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {estado.completo
            ? `${estado.nombreFantasia} está listo para operar`
            : `Completa la activación de ${estado.nombreFantasia}`}
        </h1>
        {estado.completo ? (
          <p className="text-sm text-muted-foreground">
            Configuraste lo esencial: facturación activa y al menos una tarifa. Puedes seguir ajustando estos pasos
            cuando lo necesites — esta pantalla queda disponible desde &ldquo;Configuración → Estado de activación&rdquo;.
          </p>
        ) : (
          <div className="max-w-md space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {estado.pasosCompletados} de {estado.totalPasos} pasos críticos completados
              </span>
              <span className="font-medium text-foreground">{porcentaje}%</span>
            </div>
            <Progress value={porcentaje} />
          </div>
        )}
      </div>

      {estado.completo ? (
        <Card className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20">
          <CardHeader className="flex-row items-start gap-3 space-y-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
              <Sparkles className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-base">Tu cuenta está lista para operar</CardTitle>
              <CardDescription>
                Ya puedes facturar a tus sellers y liquidar a tus conductores. Folios CAF sigue su propio curso —
                no bloquea el resto de tu operación.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4">
        <TarjetaPasoDte estado={estado} puedeGestionar={puedeGestionarDte} />
        <TarjetaPasoFolios estado={estado} puedeGestionar={puedeGestionarDte} />
        <TarjetaPasoTarifas estado={estado} puedeGestionar={puedeGestionarTarifas} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Tarjeta base — estructura común a los tres pasos
// -----------------------------------------------------------------------------

function TarjetaPaso({
  icono,
  titulo,
  descripcion,
  badge,
  accion,
  destacado = false,
}: {
  icono: React.ReactNode;
  titulo: string;
  descripcion: string;
  badge: React.ReactNode;
  accion?: React.ReactNode;
  destacado?: boolean;
}) {
  return (
    <Card className={destacado ? "border-amber-300 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/10" : undefined}>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            {icono}
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium text-foreground">{titulo}</h2>
              {badge}
            </div>
            <p className="text-sm text-muted-foreground">{descripcion}</p>
          </div>
        </div>
        {accion ? <div className="shrink-0 sm:pl-4">{accion}</div> : null}
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Paso 1 — Configuración DTE
// -----------------------------------------------------------------------------

function TarjetaPasoDte({ estado, puedeGestionar }: { estado: EstadoOnboardingCourier; puedeGestionar: boolean }) {
  const { dte } = estado;

  const config: Record<
    EstadoOnboardingCourier["dte"]["estado"],
    { icono: React.ReactNode; badge: React.ReactNode; descripcion: string }
  > = {
    pendiente: {
      icono: <CircleDashed className="size-5" aria-hidden="true" />,
      badge: <Badge variant="outline">Sin configurar</Badge>,
      descripcion: "Elige tu proveedor de facturación electrónica y carga tu certificado digital.",
    },
    en_proceso: {
      icono: <Clock className="size-5 text-amber-600" aria-hidden="true" />,
      badge: (
        <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400">
          En revisión
        </Badge>
      ),
      descripcion: "Tu proveedor está validando tu certificado con el SII — puede tardar algunos días.",
    },
    activo: {
      icono: <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />,
      badge: (
        <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400">
          Activo
        </Badge>
      ),
      descripcion: dte.certificadoVenceEn
        ? `Tu facturación está activa. Certificado vigente hasta el ${formatearFecha(dte.certificadoVenceEn)}.`
        : "Tu facturación electrónica está activa y lista para emitir documentos.",
    },
    con_problemas: {
      icono: <ShieldAlert className="size-5 text-destructive" aria-hidden="true" />,
      badge: <Badge variant="destructive">Necesita tu atención</Badge>,
      descripcion: "Hay un problema con tu certificado o tus credenciales — revisa los detalles para resolverlo.",
    },
  };

  const { icono, badge, descripcion } = config[dte.estado];

  return (
    <TarjetaPaso
      icono={icono}
      titulo="Configuración DTE"
      descripcion={descripcion}
      badge={badge}
      destacado={dte.estado === "con_problemas"}
      accion={
        puedeGestionar ? (
          <Button asChild variant={dte.estado === "pendiente" ? "default" : "outline"}>
            <Link href="/onboarding/dte">
              {dte.estado === "pendiente" ? "Configurar ahora" : "Ver configuración"}
            </Link>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground sm:max-w-40 sm:text-right">
            Solo el dueño o administración pueden configurar la facturación.
          </p>
        )
      }
    />
  );
}

// -----------------------------------------------------------------------------
// Paso 2 — Folios CAF
// -----------------------------------------------------------------------------

function TarjetaPasoFolios({ estado, puedeGestionar }: { estado: EstadoOnboardingCourier; puedeGestionar: boolean }) {
  const { folios, dte } = estado;

  if (!dte.proveedorElegido) {
    return (
      <TarjetaPaso
        icono={<CircleDashed className="size-5" aria-hidden="true" />}
        titulo="Folios CAF"
        descripcion="Primero elige tu proveedor DTE — él decide si gestiona tus folios o si debes cargarlos tú."
        badge={<Badge variant="outline">Pendiente</Badge>}
        accion={
          puedeGestionar ? (
            <Button asChild variant="outline">
              <Link href="/onboarding/dte">Configurar proveedor DTE</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (folios.gestionadoPorProveedor) {
    return (
      <TarjetaPaso
        icono={<CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />}
        titulo="Folios CAF"
        descripcion="Tu proveedor DTE gestiona tus folios directamente con el SII — no necesitas hacer nada aquí."
        badge={
          <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400">
            Lo gestiona tu proveedor
          </Badge>
        }
        accion={
          <Button asChild variant="outline" size="sm">
            <Link href="/onboarding/folios">Ver estado</Link>
          </Button>
        }
      />
    );
  }

  const vigentes = folios.cantidadVigentes > 0;

  return (
    <TarjetaPaso
      icono={
        vigentes ? (
          <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />
        ) : (
          <FileText className="size-5" aria-hidden="true" />
        )
      }
      titulo="Folios CAF"
      descripcion={
        vigentes
          ? `Tienes ${folios.cantidadVigentes} ${folios.cantidadVigentes === 1 ? "rango vigente" : "rangos vigentes"} de folios cargados.`
          : "Carga tu primer archivo CAF para poder timbrar documentos tributarios."
      }
      badge={
        vigentes ? (
          <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400">
            Vigentes
          </Badge>
        ) : (
          <Badge variant="outline">Pendiente</Badge>
        )
      }
      accion={
        puedeGestionar ? (
          <Button asChild variant={vigentes ? "outline" : "default"}>
            <Link href="/onboarding/folios">{vigentes ? "Ver folios" : "Cargar mi primer CAF"}</Link>
          </Button>
        ) : undefined
      }
    />
  );
}

// -----------------------------------------------------------------------------
// Paso 3 — Tarifas iniciales
// -----------------------------------------------------------------------------

function TarjetaPasoTarifas({ estado, puedeGestionar }: { estado: EstadoOnboardingCourier; puedeGestionar: boolean }) {
  const { tarifas } = estado;
  const configuradas = tarifas.estado === "configuradas";

  return (
    <TarjetaPaso
      icono={
        configuradas ? (
          <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />
        ) : (
          <Wallet className="size-5" aria-hidden="true" />
        )
      }
      titulo="Tarifas iniciales"
      descripcion={
        configuradas
          ? `Tienes ${tarifas.cantidad} ${tarifas.cantidad === 1 ? "tarifa vigente" : "tarifas vigentes"} — puedes seguir ajustando por seller o zona.`
          : "Define un monto base para empezar a cobrar — podrás ajustar por seller o zona después."
      }
      badge={
        configuradas ? (
          <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400">
            Configuradas
          </Badge>
        ) : (
          <Badge variant="outline">Sin configurar</Badge>
        )
      }
      accion={
        puedeGestionar ? (
          <Button asChild variant={configuradas ? "outline" : "default"}>
            <Link href="/onboarding/tarifas">
              <Receipt className="size-4" aria-hidden="true" />
              {configuradas ? "Ver tarifas" : "Definir tarifa base"}
            </Link>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground sm:max-w-40 sm:text-right">
            Solo el dueño o administración pueden gestionar tarifas.
          </p>
        )
      }
    />
  );
}
