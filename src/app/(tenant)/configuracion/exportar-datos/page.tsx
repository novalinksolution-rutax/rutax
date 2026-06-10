/**
 * Pantalla — Exportar datos del courier (RNF-13, item H-07: portabilidad de datos).
 *
 * Server Component de solo lectura: explica qué incluye/excluye el export y
 * ofrece un enlace de descarga directa hacia
 * GET /api/courier/exportar-datos (genera el JSON, registra bitácora).
 * Reservada a `dueno` y `administracion` (capacidad `ver_bitacora_auditoria`).
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeVerBitacoraAuditoria } from "@/modules/identidad/capacidades";

export const metadata: Metadata = {
  title: "Exportar datos",
};

export default async function PaginaExportarDatos() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  if (!puedeVerBitacoraAuditoria(sesion.usuario)) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Exportar datos</h1>
        <p className="text-sm text-muted-foreground">
          Descarga una copia de los datos de tu cuenta en formato JSON: sellers, conductores,
          pedidos, manifiestos, incidencias, períodos de cobro, líneas de cobro, liquidaciones y
          documentos tributarios. Esto NO incluye credenciales ni tokens de conexión.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Archivo de exportación (JSON)</p>
            <p className="text-sm text-muted-foreground">
              La descarga puede tardar unos segundos dependiendo del volumen de datos. Cada
              exportación queda registrada en la bitácora de auditoría de tu cuenta.
            </p>
          </div>
          <a
            href="/api/courier/exportar-datos"
            download
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="size-4" aria-hidden="true" />
            Descargar mis datos
          </a>
        </div>
      </div>
    </div>
  );
}
