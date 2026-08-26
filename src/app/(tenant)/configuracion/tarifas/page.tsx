import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import {
  PantallaConfiguracion,
  SinPermisoConfiguracion,
} from "../_componentes/pantalla-configuracion";
import { BarraSeccionesTarifas } from "./barra-secciones";
import { sanearSeccionTarifas } from "./secciones";
import { SeccionTarifas, esCajonTarifa } from "./_secciones/seccion-tarifas";
import { SeccionZonas } from "./_secciones/seccion-zonas";
import { SeccionRetiro } from "./_secciones/seccion-retiro";

export const metadata: Metadata = {
  title: "Tarifas",
};

/**
 * El módulo de tarifas: Tarifas · Zonas · Retiro.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ TRES PANTALLAS PASARON A SER UNA (26-08-2026, decisión del usuario)
 * -----------------------------------------------------------------------------
 * Las tres hablan de lo mismo: **cuánto entra y cuánto sale por cada cosa que
 * hace el courier**. La zona no existe por sí misma —es la clave por la que una
 * tarifa cobra distinto según dónde entregas— y el retiro es la otra mitad de lo
 * que se le paga al conductor: la tarifa cubre la entrega, el retiro cubre la
 * visita a la bodega. Repartidas en tres entradas de la navegación obligaban a
 * saber de memoria en cuál estaba el campo que uno venía a cambiar.
 *
 * **Juntarlas no abre ningún acceso nuevo**: las tres pedían exactamente la
 * misma capacidad, `gestionar_tarifas`. Por eso el gate es uno solo, acá arriba,
 * y ninguna sección repite su propia comprobación.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ LA SECCIÓN VIVE EN LA URL, Y LAS RUTAS VIEJAS SIGUEN LLEGANDO
 * -----------------------------------------------------------------------------
 * `?seccion=zonas`. `/configuracion/zonas` y `/configuracion/retiro` redirigen
 * acá con su sección puesta: **hay marcadores guardados y enlaces dentro del
 * producto** —el índice de configuración, el onboarding— y una ruta que empieza
 * a dar 404 después de una reorganización interna es un fallo que nadie ve
 * hasta que un courier lo reporta.
 *
 * -----------------------------------------------------------------------------
 * EL ANCHO ES DEL MÓDULO; EL DEL CONTENIDO LO PONE CADA SECCIÓN
 * -----------------------------------------------------------------------------
 * El contenedor va `ancho="tabla"` porque la tabla de tarifas lo necesita —y
 * porque `/configuracion/tarifas` ya estaba declarada ancha en `rutasAnchas`—.
 * Zonas y Retiro se acotan a `max-w-3xl` **dentro de su propia sección**: un
 * campo de monto no se lee mejor por estar en 1580 px.
 *
 * Se hace así y no cambiando el ancho del contenedor por pestaña porque eso
 * movería el título y la barra de secciones de sitio al cambiar de pestaña, que
 * es justo lo que un contenedor compartido tiene que impedir.
 */
export default async function PaginaTarifas({
  searchParams,
}: {
  searchParams: Promise<{ cajon?: string; seccion?: string }>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (!puedeGestionarTarifas(sesion.usuario)) {
    return (
      <SinPermisoConfiguracion frase="Las tarifas, las zonas y el pago por retiro solo los pueden ver y cambiar el dueño de la cuenta o administración." />
    );
  }

  const params = await searchParams;
  const seccion = sanearSeccionTarifas(params.seccion);
  const cajonActivo = esCajonTarifa(params.cajon) ? params.cajon : null;
  const tenantId = sesion.usuario.tenantId;

  return (
    <PantallaConfiguracion
      titulo="Tarifas"
      /* Lenguaje de negocio, no jerga, y ahora tiene que cubrir las tres: lo que
         cobras, cómo agrupas para cobrarlo, y la otra mitad de lo que pagas. */
      bajada="Lo que le cobras a cada seller y lo que le pagas al conductor: por entrega, por zona y por cada visita a bodega. Sin una tarifa vigente, una entrega se hace y no se puede cobrar."
      ancho="tabla"
    >
      <BarraSeccionesTarifas activa={seccion} />

      {seccion === "tarifas" && (
        <SeccionTarifas tenantId={tenantId} cajonActivo={cajonActivo} />
      )}
      {seccion === "zonas" && <SeccionZonas />}
      {seccion === "retiro" && <SeccionRetiro tenantId={tenantId} />}
    </PantallaConfiguracion>
  );
}
