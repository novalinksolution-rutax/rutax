import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeVerConciliacion } from "@/modules/identidad/capacidades";
import {
  PantallaConfiguracion,
  SinPermisoConfiguracion,
} from "../_componentes/pantalla-configuracion";

import { obtenerEstadoConfiguracionCobranza } from "./actions";
import { FormularioConexionCobranza } from "./formulario-conexion-cobranza";

export const metadata: Metadata = {
  title: "Conciliación de pagos",
};

/**
 * Conexión del banco para conciliar los pagos (Fintoc). Antes era un paso del
 * asistente de puesta en marcha (retirado); `/dinero/cobranza` y
 * `/dinero/liquidaciones` enlazan aquí cuando falta.
 */
export default async function PaginaConfiguracionCobranza() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (
    !puedeVerConciliacion(sesion.usuario) ||
    !sesion.usuario.areasHabilitadas.includes("conciliacion_cobranza")
  ) {
    return (
      <SinPermisoConfiguracion frase="La conexión del banco solo la pueden ver y cambiar el dueño o administración." />
    );
  }

  const r = await obtenerEstadoConfiguracionCobranza();
  const publicKey = process.env.FINTOC_PUBLIC_KEY ?? process.env.FINTOC_PUBLIC_KEY_TEST ?? null;

  // El `webhookUrl` del widget NO se arma aquí: lleva un nonce de un solo uso que
  // se emite justo antes de abrir el widget (`prepararConexionBanco`). Armarlo en
  // el render lo dejaría vivo todo el tiempo que la pestaña esté abierta.
  const holderType: "business" | "individual" =
    process.env.FINTOC_HOLDER_TYPE === "individual" ? "individual" : "business";

  return (
    <PantallaConfiguracion titulo="Conciliación de pagos">
      <FormularioConexionCobranza
        estadoInicial={r.ok ? r.estado : null}
        errorInicial={r.ok ? null : r.mensaje}
        publicKey={publicKey}
        holderType={holderType}
      />
    </PantallaConfiguracion>
  );
}
