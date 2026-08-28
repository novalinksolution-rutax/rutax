/**
 * Layout de la sección Dinero — solo para roles internos con capacidades financieras.
 *
 * Redirige a /dashboard si el usuario no tiene permisos de facturación
 * ni de liquidaciones. La autorización real vive en el backend (RLS), pero
 * redirigir aquí evita mostrar una sección vacía a roles sin acceso.
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  puedeVerPeriodosCobro,
  puedeVerLiquidaciones,
  puedeVerConciliacion,
} from "@/modules/identidad/capacidades";
import { resolverModoDteTenant, type ModoDte } from "@/modules/dinero/modo-dte";
import { FranjaModoPruebas } from "@/components/ui/franja-modo-pruebas";

export default async function LayoutDinero({
  children,
}: {
  children: React.ReactNode;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  // Solo roles internos con acceso financiero
  const tieneAcceso =
    puedeVerPeriodosCobro(sesion.usuario) ||
    puedeVerLiquidaciones(sesion.usuario) ||
    puedeVerConciliacion(sesion.usuario);

  if (!tieneAcceso) {
    redirect("/dashboard");
  }

  const tenantId = sesion.usuario.tenantId;

  // Modo de emisión DTE (sandbox vs. real) — solo relevante para quien factura.
  // Hace visible en toda la sección si las emisiones tocan el SII o son simuladas.
  let modoDte: ModoDte | null = null;
  if (puedeVerPeriodosCobro(sesion.usuario)) {
    try {
      modoDte = await resolverModoDteTenant(tenantId);
    } catch {
      // No bloquear la navegación si falla la resolución del modo.
    }
  }

  return (
    <div className="space-y-6">
      {/* ⚠️ Acá vivían unas pestañas horizontales con Períodos · Liquidaciones ·
          Conciliación. Se retiraron el 22-08: eran un CUARTO patrón de
          navegación para tres destinos que ya están en el sidebar, no marcaban
          nunca en cuál estabas, les faltaba Cobranza —que sí es una ruta real—
          y llevaban la pastilla redondeada del ADN retirado. El tablero B2a no
          las dibuja.

          Lo que sí era real no se perdió: el contador de excepciones pendientes
          se mudó al destino «Conciliación» del sidebar, y el modo de emisión
          queda acá como franja de sección. */}
      {modoDte !== null && modoDte !== "real" ? (
        <FranjaModoPruebas className="-mx-1 border" />
      ) : null}

      {children}
    </div>
  );
}
