/**
 * Crear pedido same-day — pantalla propia (tablero B1c).
 *
 * El tablero abre con una frase que es la decisión entera: **«Peldaño 1: no
 * lleva modal.»** Crear un pedido es el gesto más repetido del día en la
 * bodega, y un modal lo mete en una caja de 512 px con el listado detrás,
 * imposible de compartir por enlace y con el foco secuestrado.
 *
 * El modal viejo no desapareció de golpe: `FormularioPedidoSameDay` —el
 * componente que `operaciones/page.tsx` monta— ahora **delega** en esta ruta.
 * Es el patrón de convivencia del proyecto: se construye lo nuevo y lo viejo
 * pasa a apuntar ahí, sin tocar la pantalla que lo hospeda.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeAjustarOperacionDiaria } from "@/modules/identidad/capacidades";
import { obtenerSellersDelTenant } from "@/lib/datos-tenant/sellers";
import { FormularioAltaSameDay } from "./formulario";

export default async function PaginaNuevoPedidoSameDay() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  // «Solicitar same-day es capacidad propia: quien no la tiene no ve el botón
  // Crear.» Y tampoco llega por URL — la acción lo vuelve a exigir en servidor.
  if (!puedeAjustarOperacionDiaria(sesion.usuario)) {
    redirect("/operaciones");
  }

  const sellers = await obtenerSellersDelTenant(sesion.usuario.tenantId);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/operaciones"
          className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Pedidos
        </Link>
        <h1 className="mt-1 font-heading text-2xl font-semibold">Crear pedido same-day</h1>
      </div>

      <FormularioAltaSameDay
        sellers={sellers.map((s) => ({ id: s.id, nombre: s.nombre }))}
      />
    </div>
  );
}
