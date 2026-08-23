/**
 * Conductores — la nómina, con su tabla y su cajón lateral (tablero B1c).
 *
 * El encabezado ya no vive acá: lo pinta `PanelNomina`, porque su bajada
 * —«9 en nómina · 7 disponibles hoy»— se mueve cuando alguien cambia de estado
 * en el cajón, y un encabezado de servidor se quedaría con la cifra vieja hasta
 * la próxima recarga.
 *
 * Acceso: `asignar_y_reasignar_pedidos` abre la pantalla —configurar el pool es
 * la preparación del reparto—. Sacar de la nómina exige además
 * `gestionar_liquidaciones_conductores`: tiene consecuencia de dinero y no es
 * una decisión de terreno.
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  puedeAsignarYReasignarPedidos,
  puedeGestionarLiquidacionesConductores,
} from "@/modules/identidad/capacidades";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  listarNomina,
  obtenerHoyDeConductores,
  verificarBajasNomina,
  type ConductorEnNomina,
  type HoyDelConductor,
} from "@/modules/operacion/conductores-nomina";
import { listarZonas } from "@/modules/operacion/zonas";
import { ahoraEnSantiago } from "@/lib/fecha-santiago";
import type { Zona } from "@/modules/operacion/tipos";
import { PanelNomina } from "./nomina";

export default async function PaginaConductores() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    redirect("/manifiestos");
  }

  const tenantId = sesion.usuario.tenantId;
  const fechaHoy = ahoraEnSantiago().fecha;
  const puedeEditarBanco = puedeGestionarLiquidacionesConductores(sesion.usuario);
  const puedeGestionarNomina = puedeGestionarLiquidacionesConductores(sesion.usuario);

  const cliente = crearClienteServiceRole();

  let conductores: ConductorEnNomina[] = [];
  let zonas: Zona[] = [];
  let hoy = new Map<string, HoyDelConductor>();
  let impedimentos = new Map<string, { motivo: string }[]>();
  let errorCarga = false;

  try {
    // Los impedimentos se calculan para TODOS de una vez, no al abrir el cajón:
    // así el botón de baja nace deshabilitado con su motivo, en vez de
    // habilitarse y fallar recién al apretarlo.
    [conductores, zonas, hoy, impedimentos] = await Promise.all([
      listarNomina(cliente, tenantId),
      listarZonas(cliente, tenantId),
      obtenerHoyDeConductores(cliente, tenantId, fechaHoy),
      verificarBajasNomina(cliente, tenantId, fechaHoy),
    ]);
  } catch {
    errorCarga = true;
  }

  if (errorCarga) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold">Conductores</h1>
        <div
          role="alert"
          className="border border-attention-line bg-attention-bg px-4 py-3 text-sm text-attention-fg"
        >
          No pudimos cargar la nómina. Vuelve a intentarlo recargando la página; nada de lo
          que hayas cambiado antes se perdió.
        </div>
      </div>
    );
  }

  return (
    <PanelNomina
      estadoInicial={{
        conductores,
        zonas,
        hoy: Object.fromEntries(hoy),
        impedimentos: Object.fromEntries(
          [...impedimentos].map(([id, lista]) => [id, lista.map((i) => i.motivo)]),
        ),
      }}
      fechaHoy={fechaHoy}
      puedeEditarBanco={puedeEditarBanco}
      puedeGestionarNomina={puedeGestionarNomina}
    />
  );
}
