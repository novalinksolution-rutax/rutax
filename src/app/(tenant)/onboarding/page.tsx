import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowUpRight } from "lucide-react";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  puedeGestionarCobranza,
  puedeGestionarConfiguracionDte,
  puedeGestionarLiquidacionesConductores,
  puedeGestionarPerfilEmpresa,
  puedeGestionarTarifas,
  puedeVerConciliacion,
} from "@/modules/identidad/capacidades";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";

import { resolverEstadoOnboarding, type EstadoOnboardingCourier } from "./estado";
import { pasosDelAsistente, siguientePendiente, type ClavePaso, type PasoAsistente } from "./pasos";
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

import { FormularioDatosEmisor } from "./_formularios/datos-emisor";
import { FormularioDatosCobro } from "./_formularios/datos-cobro";
import { FormularioRetencion } from "./_formularios/retencion";
import { FormularioContacto } from "./_formularios/contacto";

// Dos pasos reusan ENTERA la pantalla que ya existe en Configuración, en vez de
// una copia: la periodicidad con sus avisos y sus rangos calculados por el
// motor, y el pago por visita con su acuse.
import { SeccionPeriodos } from "@/app/(tenant)/configuracion/tarifas/_secciones/seccion-periodos";
import { FormularioRetiro } from "@/app/(tenant)/configuracion/retiro/formulario-retiro";

export const metadata: Metadata = {
  title: "Puesta en marcha",
};

/**
 * Puesta en marcha — el asistente.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * LISTA Y CUERPO EN LA MISMA PANTALLA
 * -----------------------------------------------------------------------------
 * Era un checklist de tarjetas-enlace: elegir un paso te sacaba a otra ruta y la
 * lista desaparecía. Ahora la lista se queda arriba y el paso elegido se abre
 * debajo, con su encabezado de posición y su pie de continuidad.
 *
 * **Las rutas de paso siguen existiendo** (`/onboarding/dte` y hermanas): son
 * destino de enlaces guardados y de la vuelta atrás del navegador.
 *
 * -----------------------------------------------------------------------------
 * SOLO SE CARGA EN DETALLE EL PASO ABIERTO
 * -----------------------------------------------------------------------------
 * La LISTA ya tiene el dato real de cada renglón desde `resolverEstadoOnboarding`
 * («3 rangos vigentes», «sin tarifas»). Lo pesado —el formulario del proveedor
 * DTE, el panel de folios— se pide solo para el que está abierto.
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

  const permisos = {
    dte: puedeGestionarConfiguracionDte(sesion.usuario),
    tarifas: puedeGestionarTarifas(sesion.usuario),
    cobranza: puedeVerConciliacion(sesion.usuario),
    cobro: puedeGestionarCobranza(sesion.usuario),
    liquidaciones: puedeGestionarLiquidacionesConductores(sesion.usuario),
    empresa: puedeGestionarPerfilEmpresa(sesion.usuario),
  };

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

  // Los pasos de un área que Rutax tiene apagada NO se muestran: pedirle al
  // courier que cargue su certificado DTE para luego no dejarlo emitir es
  // trabajo tirado. Las áreas ya vienen resueltas en la sesión.
  const pasos = pasosDelAsistente(estado, sesion.usuario.areasHabilitadas);
  const claves = pasos.map((p) => p.clave);

  // El paso abierto: el de la URL si es válido, o el primero que falte. Abrir en
  // el primero pendiente es lo que hace que la pantalla sirva sin leerla.
  const clave: ClavePaso = claves.includes(pasoParam as ClavePaso)
    ? (pasoParam as ClavePaso)
    : (pasos.find((p) => !p.listo && !p.bloqueado)?.clave ?? pasos[0].clave);

  const activo = pasos.find((p) => p.clave === clave)!;
  const dependencia = activo.dependeDe
    ? (pasos.find((p) => p.clave === activo.dependeDe) ?? null)
    : null;
  const siguiente = siguientePendiente(pasos, clave);

  const cuerpo = await cuerpoDelPaso(activo, { tenantId, estado, permisos });

  // 🔴 EL CONTADOR SALE DE `pasos`, QUE ES LA LISTA QUE SE VE.
  //
  // `estado.ts` cuenta los catorce pasos posibles; la lista ya está filtrada por
  // las áreas que Rutax tiene encendidas. Tomarlo de `estado` ponía «13 de 14»
  // encima de nueve renglones — el MISMO defecto de los dos conteos a 25 px que
  // este archivo ya había corregido una vez, reintroducido por la puerta de
  // atrás. Una sola fuente: lo que se cuenta es lo que se muestra.
  const completados = pasos.filter((p) => p.listo).length;
  const porcentaje = pasos.length === 0 ? 100 : Math.round((completados / pasos.length) * 100);

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
              ? "Lo esencial está configurado. Los pasos que queden te van a ir haciendo falta, pero ninguno te detiene."
              : `Te falta ${estado.faltaParaOperar} para poder operar. Los otros pasos no te bloquean.`}
          </p>
        </div>
        {/* UN SOLO CONTEO, y sobre los pasos que se ven. Antes la barra decía
            «1 de 2» encima de cinco tarjetas. */}
        <div className="w-40 shrink-0 space-y-1">
          <p className="rx-num flex items-baseline justify-between text-xs text-fg-muted">
            <span>
              {completados} de {pasos.length}
            </span>
            <span className="text-fg">{porcentaje}%</span>
          </p>
          <Progress value={porcentaje} />
        </div>
      </div>

      {estado.completo ? (
        <p className="border border-balanced-line bg-balanced-bg px-4 py-3 text-sm leading-relaxed text-balanced-fg">
          {/* ⚠️ No promete facturar ni liquidar: esas dos cosas pueden estar
              apagadas por Rutax, y prometerlas acá sería mandar al courier a
              buscar un botón que no existe. */}
          Ya puedes operar y llevar la cuenta de lo que entra y lo que sale.{" "}
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

interface Permisos {
  dte: boolean;
  tarifas: boolean;
  cobranza: boolean;
  cobro: boolean;
  liquidaciones: boolean;
  empresa: boolean;
}

/**
 * El cuerpo del paso elegido.
 *
 * Cada rama repite el guard de capacidad de su ruta hermana: la pantalla puede
 * alcanzarse por enlace directo, y **ocultar no basta** — hay que decir por qué
 * no se puede.
 */
async function cuerpoDelPaso(
  paso: PasoAsistente,
  ctx: { tenantId: string; estado: EstadoOnboardingCourier; permisos: Permisos },
) {
  const { estado, permisos } = ctx;

  // Los pasos que ya tienen su pantalla propia se ENLAZAN. Ver la nota de
  // `seResuelveFuera` en `pasos.ts`: una copia embebida de la nómina de
  // conductores sería una segunda pantalla que mantener.
  if (paso.seResuelveFuera) {
    return <EnlaceAPantalla paso={paso} />;
  }

  if (paso.clave === "empresa") {
    if (!permisos.empresa) return <SinPermiso que="los datos de tu empresa" />;
    return <FormularioDatosEmisor iniciales={await leerDatosEmisor(ctx.tenantId)} />;
  }

  if (paso.clave === "dte") {
    if (!permisos.dte) return <SinPermiso que="la facturación electrónica" />;
    const r = await obtenerEstadoConfiguracionDte();
    return (
      <FormularioConfiguracionDte
        estadoInicial={r.ok ? r.estado : null}
        errorInicial={r.ok ? null : r.mensaje}
      />
    );
  }

  if (paso.clave === "folios") {
    if (!permisos.dte) return <SinPermiso que="los folios CAF" />;
    const r = await obtenerEstadoFoliosCaf();
    return (
      <PanelFoliosCaf estadoInicial={r.ok ? r.estado : null} errorInicial={r.ok ? null : r.mensaje} />
    );
  }

  if (paso.clave === "tarifas") {
    if (!permisos.tarifas) return <SinPermiso que="las tarifas" />;
    const r = await obtenerEstadoTarifas();
    return (
      <PanelTarifas estadoInicial={r.ok ? r.estado : null} errorInicial={r.ok ? null : r.mensaje} />
    );
  }

  if (paso.clave === "periodos") {
    if (!permisos.tarifas) return <SinPermiso que="la periodicidad de facturación" />;
    // La sección entera de Configuración → Tarifas → Períodos, con sus avisos y
    // sus rangos calculados por `calcularRangoPeriodo`.
    return <SeccionPeriodos tenantId={ctx.tenantId} />;
  }

  if (paso.clave === "cobro") {
    if (!permisos.cobro) return <SinPermiso que="dónde te pagan" />;
    return <FormularioDatosCobro iniciales={await leerDatosCobro(ctx.tenantId)} />;
  }

  if (paso.clave === "cobranza") {
    if (!permisos.cobranza) return <SinPermiso que="la conexión del banco" />;
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

  if (paso.clave === "retencion") {
    if (!permisos.liquidaciones) return <SinPermiso que="la retención de tus conductores" />;
    return <FormularioRetencion porcentajeActual={estado.retencion.porcentaje} />;
  }

  if (paso.clave === "retiro") {
    if (!permisos.tarifas) return <SinPermiso que="el pago por visita a bodega" />;
    return <FormularioRetiro montoActual={estado.retiro.montoVisitaClp} />;
  }

  if (paso.clave === "contacto") {
    if (!permisos.empresa) return <SinPermiso que="los datos de tu empresa" />;
    return (
      <FormularioContacto telefono={estado.contacto.telefono} email={estado.contacto.email} />
    );
  }

  return <EnlaceAPantalla paso={paso} />;
}

/**
 * El cuerpo de un paso que se resuelve en otra pantalla.
 *
 * Lleva el resumen otra vez a propósito: el renglón de la lista queda arriba y
 * fuera del foco cuando el paso está abierto, y mandar a alguien a otra pantalla
 * sin recordarle qué va a hacer allá es la forma de que vuelva sin haberlo
 * hecho.
 */
function EnlaceAPantalla({ paso }: { paso: PasoAsistente }) {
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-fg-muted">{paso.resumen}</p>
      <Button asChild variant="outline" size="sm">
        <Link href={paso.href}>
          Ir a {paso.enFrase}
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}

async function leerDatosEmisor(tenantId: string) {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .schema("identidad")
    .from("tenants")
    .select("giro, direccion, comuna, actividad_economica")
    .eq("id", tenantId)
    .maybeSingle();

  return {
    giro: (data?.giro as string | null) ?? null,
    direccion: (data?.direccion as string | null) ?? null,
    comuna: (data?.comuna as string | null) ?? null,
    actividadEconomica: (data?.actividad_economica as string | null) ?? null,
  };
}

async function leerDatosCobro(tenantId: string) {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .schema("identidad")
    .from("courier_datos_cobro")
    .select("banco, tipo_cuenta, numero_cuenta, rut_titular, nombre_titular, email_aviso")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return {
    banco: (data?.banco as string | null) ?? null,
    tipoCuenta: (data?.tipo_cuenta as string | null) ?? null,
    numeroCuenta: (data?.numero_cuenta as string | null) ?? null,
    rutTitular: (data?.rut_titular as string | null) ?? null,
    nombreTitular: (data?.nombre_titular as string | null) ?? null,
    emailAviso: (data?.email_aviso as string | null) ?? null,
  };
}

function SinPermiso({ que }: { que: string }) {
  return (
    <p className="border border-line bg-bg-sunken px-4 py-3.5 text-sm leading-relaxed text-fg-muted">
      No tienes permiso para configurar {que}: solo el dueño de la cuenta o administración pueden.
      Si necesitas un cambio acá, pídeselo a esa persona o que te dé acceso.
    </p>
  );
}
