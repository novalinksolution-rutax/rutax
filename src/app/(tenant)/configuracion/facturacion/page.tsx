import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  puedeGestionarCobranza,
  puedeGestionarConfiguracionDte,
  puedeGestionarLiquidacionesConductores,
  puedeGestionarPerfilEmpresa,
} from "@/modules/identidad/capacidades";
import {
  PantallaConfiguracion,
  SinPermisoConfiguracion,
} from "../_componentes/pantalla-configuracion";

import { obtenerEstadoConfiguracionDte } from "./dte/actions";
import { obtenerEstadoFoliosCaf } from "./folios/actions";
import { FormularioConfiguracionDte } from "./dte/formulario-configuracion-dte";
import { PanelFoliosCaf } from "./folios/panel-folios-caf";
import { FormularioDatosEmisor } from "./_formularios/datos-emisor";
import { FormularioDatosCobro } from "./_formularios/datos-cobro";
import { FormularioRetencion } from "./_formularios/retencion";
import { FormularioContacto } from "./_formularios/contacto";

export const metadata: Metadata = {
  title: "Facturación",
};

/**
 * Facturación — datos del emisor, DTE, folios, cuenta de cobro, retención y
 * contacto público.
 * =============================================================================
 * Antes vivían como pasos del asistente de puesta en marcha (retirado). Se piden
 * cuando duelen —al emitir una factura o pagar una liquidación— y los mensajes
 * de esos bloqueos enlazan aquí, a la sección que falta (`#emisor`, `#dte`,
 * `#folios`, `#cobro`, `#retencion`).
 *
 * Cada sección conserva el gate de capacidad y de área de la acción que la
 * escribe: ocultar no basta, la barrera real está en cada Server Action.
 *
 * ⚠️ Si falla la lectura de folios, la sección lo dice con esas palabras: sin
 * ver qué rango hay cargado, alguien vuelve a cargar el mismo y lo consume dos
 * veces.
 */
export default async function PaginaFacturacion() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  const u = sesion.usuario;
  const tenantId = u.tenantId as string;
  const areas = u.areasHabilitadas;

  const puedeEmpresa = puedeGestionarPerfilEmpresa(u);
  const puedeDte = puedeGestionarConfiguracionDte(u);
  const puedeCobro = puedeGestionarCobranza(u) && areas.includes("emision_facturas");
  const puedeFolios = puedeDte && areas.includes("folios_caf");
  const puedeRetencion =
    puedeGestionarLiquidacionesConductores(u) && areas.includes("pago_conductores");

  if (!puedeEmpresa && !puedeDte && !puedeCobro && !puedeRetencion) {
    return (
      <SinPermisoConfiguracion frase="La facturación solo la pueden ver y cambiar el dueño o administración." />
    );
  }

  const [emisor, dte, folios, cobro, retencion] = await Promise.all([
    puedeEmpresa ? leerDatosEmisor(tenantId) : null,
    puedeDte ? obtenerEstadoConfiguracionDte() : null,
    puedeFolios ? obtenerEstadoFoliosCaf() : null,
    puedeCobro ? leerDatosCobro(tenantId) : null,
    puedeRetencion ? leerRetencion(tenantId) : null,
  ]);

  return (
    <PantallaConfiguracion titulo="Facturación">
      {emisor ? (
        <Seccion id="emisor" titulo="Datos del emisor">
          <FormularioDatosEmisor iniciales={emisor.emisor} />
        </Seccion>
      ) : null}

      {dte ? (
        <Seccion id="dte" titulo="Facturación electrónica">
          <FormularioConfiguracionDte
            estadoInicial={dte.ok ? dte.estado : null}
            errorInicial={dte.ok ? null : dte.mensaje}
          />
        </Seccion>
      ) : null}

      {folios ? (
        <Seccion id="folios" titulo="Folios CAF">
          <PanelFoliosCaf
            estadoInicial={folios.ok ? folios.estado : null}
            errorInicial={folios.ok ? null : folios.mensaje}
          />
        </Seccion>
      ) : null}

      {cobro ? (
        <Seccion id="cobro" titulo="Dónde te pagan">
          <FormularioDatosCobro iniciales={cobro} />
        </Seccion>
      ) : null}

      {retencion ? (
        <Seccion id="retencion" titulo="Retención de boleta de terceros">
          <FormularioRetencion porcentajeActual={retencion.porcentaje} />
        </Seccion>
      ) : null}

      {emisor ? (
        <Seccion id="contacto" titulo="Contacto público">
          <FormularioContacto telefono={emisor.telefono} email={emisor.email} />
        </Seccion>
      ) : null}
    </PantallaConfiguracion>
  );
}

function Seccion({
  id,
  titulo,
  children,
}: {
  id: string;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="scroll-mt-6 space-y-3">
      <h2 id={`${id}-titulo`} className="font-heading text-base font-semibold text-fg">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

async function leerDatosEmisor(tenantId: string) {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .schema("identidad")
    .from("tenants")
    .select(
      "nombre_fantasia, razon_social, rut, giro, direccion, comuna, actividad_economica, telefono_contacto, email_contacto",
    )
    .eq("id", tenantId)
    .maybeSingle();

  return {
    emisor: {
      nombreFantasia: (data?.nombre_fantasia as string | null) ?? null,
      razonSocial: (data?.razon_social as string | null) ?? null,
      rut: (data?.rut as string | null) ?? null,
      giro: (data?.giro as string | null) ?? null,
      direccion: (data?.direccion as string | null) ?? null,
      comuna: (data?.comuna as string | null) ?? null,
      actividadEconomica: (data?.actividad_economica as string | null) ?? null,
    },
    telefono: (data?.telefono_contacto as string | null) ?? null,
    email: (data?.email_contacto as string | null) ?? null,
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

async function leerRetencion(tenantId: string): Promise<{ porcentaje: number | null }> {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .schema("identidad")
    .from("courier_config_payout")
    .select("porcentaje_retencion")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // La AUSENCIA de fila es «sin configurar»; un 0 escrito es una decisión.
  return {
    porcentaje:
      data && typeof data.porcentaje_retencion !== "undefined" && data.porcentaje_retencion !== null
        ? Number(data.porcentaje_retencion)
        : null,
  };
}
