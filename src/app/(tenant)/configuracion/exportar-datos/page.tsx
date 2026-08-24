/**
 * Exportar los datos del courier (RNF-13, ítem H-07: portabilidad).
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🐞 ERA LA ÚNICA PANTALLA DEL BLOQUE QUE EXPULSABA EN SILENCIO
 * -----------------------------------------------------------------------------
 * Sin la capacidad hacía `redirect("/dashboard")`. Quien llegaba por un enlace
 * directo se quedaba pensando que el enlace estaba roto, y quien no sabía que le
 * faltaba permiso no sabía a quién pedírselo. Las otras ocho explicaban.
 *
 * -----------------------------------------------------------------------------
 * EL RASTRO DE LA ÚLTIMA EXPORTACIÓN
 * -----------------------------------------------------------------------------
 * El endpoint ya escribe bitácora con conteos por tabla, así que el dato existía
 * y no se mostraba. Verlo evita la pregunta que trae a alguien acá dos veces
 * seguidas: «¿la pedí o no la pedí?».
 *
 * -----------------------------------------------------------------------------
 * SIGUE SIENDO SÍNCRONO, Y ESO SE DICE
 * -----------------------------------------------------------------------------
 * El tablero la quiere asíncrona —pedir, «quedó en curso», aviso al terminar—, y
 * eso exige un job y una notificación. Mientras tanto el copy dice lo que de
 * verdad pasa: el navegador espera. Prometer «te avisamos cuando esté listo»
 * sobre una descarga bloqueante sería peor que la descarga.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeVerBitacoraAuditoria } from "@/modules/identidad/capacidades";
import { formatearFechaHora } from "@/lib/formato-cl";
import {
  PantallaConfiguracion,
  SinPermisoConfiguracion,
} from "../_componentes/pantalla-configuracion";

export const metadata: Metadata = {
  title: "Exportar datos",
};

export default async function PaginaExportarDatos() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  if (!puedeVerBitacoraAuditoria(sesion.usuario)) {
    return (
      <SinPermisoConfiguracion frase="La exportación de datos solo la pueden pedir el dueño de la cuenta o administración." />
    );
  }

  // La última exportación, de la bitácora que el propio endpoint escribe. Si la
  // lectura falla, la pantalla sigue en pie sin esa línea: no poder decir cuándo
  // fue la última vez no es razón para no dejar pedir una nueva.
  const cliente = crearClienteServiceRole();
  const { data: ultima } = await cliente
    .from("bitacora_auditoria")
    .select("creado_en")
    .eq("tenant_id", sesion.usuario.tenantId)
    .eq("accion", "identidad.datos_courier_exportados")
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <PantallaConfiguracion
      titulo="Exportar datos"
      bajada="Una copia de todo lo tuyo: sellers, conductores, pedidos, manifiestos, incidencias, períodos, líneas de cobro, liquidaciones y documentos tributarios."
    >
      <div className="space-y-4 border border-line bg-bg-sunken px-5 py-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-fg">Archivo de exportación (JSON)</p>
          <p className="text-sm leading-relaxed text-fg-muted">
            La descarga empieza en cuanto la pides y puede tardar según el volumen de datos: deja
            la pestaña abierta hasta que termine. Cada exportación queda en tu bitácora de
            auditoría.
          </p>
          {/* Lo que NO se lleva, dicho acá. Es la pregunta que se hace quien
              exporta para migrar, y la respuesta importa: los secretos no
              salen del sistema, ni siquiera en un export propio. */}
          <p className="text-sm leading-relaxed text-fg-muted">
            No incluye credenciales ni tokens de conexión — esos están cifrados y no salen del
            sistema, ni siquiera en tu propia copia.
          </p>
        </div>

        <a
          href="/api/courier/exportar-datos"
          download
          className="inline-flex items-center gap-2 rounded-ctrl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Download className="size-4" aria-hidden="true" />
          Descargar mis datos
        </a>

        {ultima?.creado_en ? (
          <p className="rx-num text-xs text-fg-muted">
            Última exportación: {formatearFechaHora(ultima.creado_en as string)}
          </p>
        ) : (
          <p className="text-xs text-fg-muted">Todavía no has exportado tus datos.</p>
        )}
      </div>
    </PantallaConfiguracion>
  );
}
