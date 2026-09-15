import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { listarConductores } from "@/modules/operacion/conductores";
import { listarBodegasParaConductor } from "@/modules/operacion/retiro/bodegas";
import { listarPedidosPendientesDeRetiro } from "@/modules/operacion/retiro/registro-web";
import { detectarPedidosSinTarifa } from "@/modules/operacion/tarifas";
import type { SellerSinTarifa } from "@/modules/operacion/retiro/expectativa";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AvisoSinTarifa } from "@/components/operacion/aviso-sin-tarifa";

import { FormularioRetiro } from "./formulario-retiro";

export const metadata: Metadata = {
  title: "Registrar retiro",
};

/**
 * Registrar un retiro desde la oficina.
 * =============================================================================
 *
 * EL AGUJERO QUE TAPA. Hasta ahora un retiro solo podía nacer escaneando QR en
 * la app del conductor, y de ahí cuelga TODO: sin retiro no hay asignación, sin
 * asignación no hay manifiesto y sin manifiesto no hay ruta. Un conductor sin
 * batería, sin señal o sin teléfono bloqueaba el día entero **y nadie en la
 * oficina podía desatascarlo**.
 *
 * El propio alcance ya lo anticipaba —"el respaldo ante falla es seleccionar de
 * una lista, no teclear una cifra"— pero ese respaldo se especificó para la app
 * y nunca se construyó para la web.
 *
 * ⚠️ **Mismo gate que asignar** (`puedeAsignarYReasignarPedidos`) y no uno más
 * laxo: decidir quién cobra una visita es de la misma familia que decidir quién
 * lleva qué. Dueño, supervisor y coordinador; administración no.
 */
export default async function RegistrarRetiroPage() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        tono="filtro"
        titulo="No tienes acceso a esta pantalla"
        descripcion="Necesitas el permiso para asignar pedidos."
        accion={
          <Button asChild variant="outline" size="sm">
            <Link href="/preparacion">Volver a Preparación del día</Link>
          </Button>
        }
      />
    );
  }

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();
  const fecha = fechaLocalEnSantiago(new Date());

  const [conductoresRaw, bodegas, pedidos] = await Promise.all([
    listarConductores(cliente, tenantId),
    listarBodegasParaConductor(cliente, tenantId),
    listarPedidosPendientesDeRetiro(cliente, { tenantId, fecha }),
  ]);

  // Los disponibles primero, igual que en la bandeja de asignación: el que está
  // trabajando hoy es el candidato probable a haber ido a la bodega.
  const conductores = conductoresRaw
    .filter((c) => c.estado === "activo")
    .sort((a, b) => {
      if (a.disponible !== b.disponible) return a.disponible ? -1 : 1;
      return a.nombre.localeCompare(b.nombre, "es");
    })
    .map((c) => ({ id: c.id, nombre: c.nombre }));

  if (bodegas.length === 0) {
    return (
      <div className="space-y-6">
        <Cabecera />
        <EmptyState
          icon={ShieldAlert}
          tono="arranque"
          titulo="Todavía no hay bodegas de seller cargadas"
          descripcion="Primero carga las bodegas de tus sellers en Configuración."
          accion={
            <Button asChild variant="outline" size="sm">
              <Link href="/configuracion/bodegas">Ir a Bodegas</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // El aviso "sin tarifa" (tarifa → $0), mismo componente que Preparación del
  // día y la bandeja de asignación. Acá NO hace falta una consulta nueva: la
  // pantalla ya trae, para TODO el día, los pedidos pendientes de retiro
  // (`pedidos`, capado en 500 — ver `listarPedidosPendientesDeRetiro`) y las
  // bodegas con su seller (`bodegas`, que ya resuelve el nombre). Es
  // best-effort: si falla, la pantalla se sigue viendo bien, solo sin aviso.
  const sinTarifa = await construirAvisoSinTarifa(cliente, { tenantId, fecha, pedidos, bodegas }).catch(
    () => [] as SellerSinTarifa[],
  );

  return (
    <div className="space-y-6">
      <Cabecera />
      <AvisoSinTarifa sinTarifa={sinTarifa} />
      <FormularioRetiro conductores={conductores} bodegas={bodegas} pedidos={pedidos} />
    </div>
  );
}

/**
 * Sellers con pedidos pendientes de retiro hoy sin tarifa vigente para su
 * régimen. Usa `detectarPedidosSinTarifa` (mismo detector que la bandeja de
 * asignación y el detalle de manifiesto) sobre los pedidos que la propia
 * pantalla ya cargó — sin una consulta adicional grande.
 *
 * El nombre del seller sale de `bodegas` (ya trae `sellerNombre`), no de una
 * consulta aparte: solo se ofrecen sellers con bodega en esta pantalla.
 */
async function construirAvisoSinTarifa(
  cliente: ReturnType<typeof crearClienteServiceRole>,
  entrada: {
    tenantId: string;
    fecha: string;
    pedidos: Awaited<ReturnType<typeof listarPedidosPendientesDeRetiro>>;
    bodegas: Awaited<ReturnType<typeof listarBodegasParaConductor>>;
  },
): Promise<SellerSinTarifa[]> {
  const { tenantId, fecha, pedidos, bodegas } = entrada;
  if (pedidos.length === 0) return [];

  const sinTarifaIds = await detectarPedidosSinTarifa(
    cliente,
    { tenantId, fecha },
    pedidos.map((p) => ({ id: p.id, sellerId: p.sellerId, tipoPedido: p.tipoPedido })),
  );
  if (sinTarifaIds.size === 0) return [];

  const bultosPorSeller = new Map<string, number>();
  for (const p of pedidos) {
    if (!sinTarifaIds.has(p.id)) continue;
    bultosPorSeller.set(p.sellerId, (bultosPorSeller.get(p.sellerId) ?? 0) + 1);
  }

  const nombrePorSeller = new Map(bodegas.map((b) => [b.sellerId, b.sellerNombre]));

  return [...bultosPorSeller.entries()]
    .map(([sellerId, bultos]) => ({
      id: sellerId,
      nombre: nombrePorSeller.get(sellerId) || "Seller sin nombre",
      bultos,
    }))
    .sort((a, b) => b.bultos - a.bultos);
}

function Cabecera() {
  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Registrar retiro</h1>
      <p className="text-sm text-muted-foreground">
        Para cuando el retiro ocurrió pero no se pudo escanear. Queda registrado igual que en
        terreno: con su conductor, su bodega y su acta.
      </p>
    </header>
  );
}
