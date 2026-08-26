import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  puedeGestionarConfiguracionDte,
  puedeGestionarTarifas,
  puedeVerConciliacion,
} from "@/modules/identidad/capacidades";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

import { resolverEstadoOnboarding } from "./estado";
import { pasosDelAsistente, siguientePendiente, type ClavePaso } from "./pasos";
import { ListaPasos } from "./lista-pasos";
import { MarcoPaso } from "./marco-paso";

import { obtenerEstadoConfiguracionDte } from "./dte/actions";
import { obtenerEstadoFoliosCaf } from "./folios/actions";
import { obtenerEstadoTarifas } from "./tarifas/actions";
import { obtenerEstadoConfiguracionCobranza } from "./cobranza/actions";
import { FormularioConfiguracionDte } from "./dte/formulario-configuracion-dte";
import { PanelFoliosCaf } from "./folios/panel-folios-caf";
import { PanelTarifas } from "./tarifas/panel-tarifas";
import { FormularioConexionCobranza } from "./cobranza/formulario-conexion-cobranza";

export const metadata: Metadata = {
  title: "Puesta en marcha",
};

const CLAVES: ClavePaso[] = ["dte", "folios", "tarifas", "cobranza", "plan"];

/**
 * Puesta en marcha — el asistente.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * LISTA Y CUERPO EN LA MISMA PANTALLA
 * -----------------------------------------------------------------------------
 * Era un checklist de cinco tarjetas-enlace: elegir un paso te sacaba a otra
 * ruta y la lista desaparecía. Ahora la lista se queda arriba y el paso elegido
 * se abre debajo, con su encabezado de posición y su pie de continuidad.
 *
 * **Las cuatro rutas de paso siguen existiendo** (`/onboarding/dte` y hermanas):
 * son destino de enlaces guardados y de la vuelta atrás del navegador. Lo que
 * cambia es el camino normal, que ya no salta de pantalla en pantalla.
 *
 * -----------------------------------------------------------------------------
 * SE CARGAN LOS CUATRO ESTADOS, NO SOLO EL DEL PASO ABIERTO
 * -----------------------------------------------------------------------------
 * Porque la LISTA los necesita: su gracia es que cada renglón dice el dato real
 * («3 rangos vigentes», «sin tarifas»), no un rótulo de estado. Cargar solo el
 * abierto dejaría cuatro renglones mudos. Las cuatro lecturas van en paralelo.
 *
 * -----------------------------------------------------------------------------
 * FALLA DE LECTURA: LO IMPORTANTE ES QUE NO SE DUPLIQUEN LOS FOLIOS
 * -----------------------------------------------------------------------------
 * Antes `resolverEstadoOnboarding` se llamaba sin `try`, así que una falla de
 * lectura tumbaba la pantalla entera con el error genérico de Next. El riesgo
 * concreto de esta pantalla no es estético: **si no se ve qué folios hay
 * cargados, alguien vuelve a cargar el mismo rango**. Por eso el estado de falla
 * lo dice con esas palabras.
 */
export default async function PaginaOnboarding({
  searchParams,
}: {
  searchParams: Promise<{ paso?: string }>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  const tenantId = sesion.usuario.tenantId;
  const { paso: pasoParam } = await searchParams;

  const puedeDte = puedeGestionarConfiguracionDte(sesion.usuario);
  const puedeTarifas = puedeGestionarTarifas(sesion.usuario);
  const puedeCobranza = puedeVerConciliacion(sesion.usuario);

  const estado = await resolverEstadoOnboarding(tenantId).catch(() => null);

  if (!estado) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="font-heading text-2xl font-semibold">Puesta en marcha</h1>
        <div
          role="alert"
          className="border border-fault-line bg-fault-bg px-4 py-3.5 text-sm leading-relaxed text-fault-fg"
        >
          <strong className="font-medium">No se pudo leer el estado de tu configuración.</strong>{" "}
          No vuelvas a cargar los folios hasta verlo: podrías duplicar el rango y consumirlo dos
          veces. Recarga en unos segundos.
        </div>
      </div>
    );
  }

  const pasos = pasosDelAsistente(estado);

  // El paso abierto: el de la URL si es válido, o el primero que falte. Abrir en
  // el primero pendiente es lo que hace que la pantalla sirva sin leerla.
  const clave: ClavePaso = CLAVES.includes(pasoParam as ClavePaso)
    ? (pasoParam as ClavePaso)
    : (pasos.find((p) => !p.listo && !p.bloqueado)?.clave ?? "dte");

  const activo = pasos.find((p) => p.clave === clave)!;
  const dependencia = activo.dependeDe
    ? (pasos.find((p) => p.clave === activo.dependeDe) ?? null)
    : null;
  const siguiente = siguientePendiente(pasos, clave);

  // Solo el estado del paso abierto se carga en detalle: los otros cuatro ya
  // tienen su resumen desde `resolverEstadoOnboarding`.
  const cuerpo = await cuerpoDelPaso(clave, {
    tenantId,
    puedeDte,
    puedeTarifas,
    puedeCobranza,
  });

  const porcentaje = Math.round((estado.pasosCompletados / estado.totalPasos) * 100);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold">
            {estado.completo
              ? `${estado.nombreFantasia} ya puede operar`
              : `Pon en marcha ${estado.nombreFantasia}`}
          </h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {estado.completo
              ? "Lo esencial está configurado. Puedes seguir ajustando estos pasos cuando lo necesites."
              : `Te falta configurar ${estado.faltaParaOperar} para poder operar. Los otros pasos no te bloquean.`}
          </p>
        </div>
        {/* UN SOLO CONTEO, y sobre los cinco pasos que se ven. Antes la barra
            decía «1 de 2» encima de cinco tarjetas. */}
        <div className="w-40 shrink-0 space-y-1">
          <p className="rx-num flex items-baseline justify-between text-xs text-fg-muted">
            <span>
              {estado.pasosCompletados} de {estado.totalPasos}
            </span>
            <span className="text-fg">{porcentaje}%</span>
          </p>
          <Progress value={porcentaje} />
        </div>
      </div>

      {estado.completo ? (
        <p className="border border-balanced-line bg-balanced-bg px-4 py-3 text-sm leading-relaxed text-balanced-fg">
          Ya puedes facturar a tus sellers y liquidar a tus conductores.{" "}
          <Link href="/onboarding/listo" className="font-medium underline">
            Ver el resumen y qué hacer ahora ›
          </Link>
        </p>
      ) : null}

      <ListaPasos pasos={pasos} activo={clave} />

      <MarcoPaso paso={activo} total={pasos.length} dependencia={dependencia} siguiente={siguiente}>
        {cuerpo}
      </MarcoPaso>
    </div>
  );
}

/**
 * El cuerpo del paso elegido.
 *
 * Cada rama repite el guard de capacidad de su ruta hermana: la pantalla puede
 * alcanzarse por enlace directo, y **ocultar no basta** — hay que decir por qué
 * no se puede.
 */
async function cuerpoDelPaso(
  clave: ClavePaso,
  ctx: { tenantId: string; puedeDte: boolean; puedeTarifas: boolean; puedeCobranza: boolean },
) {
  if (clave === "dte") {
    if (!ctx.puedeDte) return <SinPermiso que="la facturación electrónica" />;
    const r = await obtenerEstadoConfiguracionDte();
    return (
      <FormularioConfiguracionDte
        estadoInicial={r.ok ? r.estado : null}
        errorInicial={r.ok ? null : r.mensaje}
      />
    );
  }

  if (clave === "folios") {
    if (!ctx.puedeDte) return <SinPermiso que="los folios CAF" />;
    const r = await obtenerEstadoFoliosCaf();
    return (
      <PanelFoliosCaf
        estadoInicial={r.ok ? r.estado : null}
        errorInicial={r.ok ? null : r.mensaje}
      />
    );
  }

  if (clave === "tarifas") {
    if (!ctx.puedeTarifas) return <SinPermiso que="las tarifas" />;
    const r = await obtenerEstadoTarifas();
    return (
      <PanelTarifas estadoInicial={r.ok ? r.estado : null} errorInicial={r.ok ? null : r.mensaje} />
    );
  }

  if (clave === "cobranza") {
    if (!ctx.puedeCobranza) return <SinPermiso que="la conexión del banco" />;
    const r = await obtenerEstadoConfiguracionCobranza();
    const publicKey = process.env.FINTOC_PUBLIC_KEY ?? process.env.FINTOC_PUBLIC_KEY_TEST ?? null;

    // El widget de "movements" de Fintoc EXIGE `webhookUrl` (a dónde enviará los
    // movimientos). Es la URL por-tenant: se prefiere la pública canónica, y si
    // no está, se deriva del request.
    let baseUrl = process.env.APP_PUBLIC_URL ?? null;
    if (!baseUrl) {
      const h = await headers();
      const host = h.get("x-forwarded-host") ?? h.get("host");
      const proto = h.get("x-forwarded-proto") ?? "http";
      baseUrl = host ? `${proto}://${host}` : null;
    }
    const webhookUrl = baseUrl
      ? `${baseUrl.replace(/\/+$/, "")}/api/webhooks/fintoc/${ctx.tenantId}`
      : null;
    const holderType: "business" | "individual" =
      process.env.FINTOC_HOLDER_TYPE === "individual" ? "individual" : "business";

    return (
      <FormularioConexionCobranza
        estadoInicial={r.ok ? r.estado : null}
        errorInicial={r.ok ? null : r.mensaje}
        publicKey={publicKey}
        webhookUrl={webhookUrl}
        holderType={holderType}
      />
    );
  }

  // Plan: la suscripción del courier a Rutax es backstage y tiene su propia
  // pantalla. No se embebe: cobra, y una pantalla de cobro dentro de un
  // asistente de configuración mezcla dos relaciones distintas.
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-fg-muted">
        Tu plan en Rutax es lo que nos pagas a nosotros, aparte de lo que tú le cobras a tus
        sellers. No bloquea nada de lo anterior.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/configuracion/plan">Ver mi plan</Link>
      </Button>
    </div>
  );
}

function SinPermiso({ que }: { que: string }) {
  return (
    <p className="border border-line bg-bg-sunken px-4 py-3.5 text-sm leading-relaxed text-fg-muted">
      No tienes permiso para configurar {que}: solo el dueño de la cuenta o administración pueden.
      Si necesitas un cambio acá, pídeselo a esa persona o que te dé acceso.
    </p>
  );
}
