import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeInvitarUsuarios } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariante } from "@/lib/ui/traduccion-estados";

export const metadata: Metadata = {
  title: "Sellers",
};

const TEXTO_ESTADO_SELLER: Record<string, string> = {
  invitado: "Invitado",
  activo: "Activo",
  suspendido: "Suspendido",
};

const BADGE_ESTADO_SELLER: Record<string, BadgeVariante> = {
  invitado: "warning",
  activo: "success",
  suspendido: "error",
};

const TEXTO_SALUD_CONEXION: Record<string, string> = {
  sana: "Conectado",
  atencion: "Requiere atención",
  desvinculada: "Desconectado",
  pendiente: "Sin conectar",
};

const BADGE_SALUD_CONEXION: Record<string, BadgeVariante> = {
  sana: "success",
  atencion: "warning",
  desvinculada: "error",
  pendiente: "neutral",
};

interface SellerFila {
  id: string;
  razonSocial: string;
  rut: string;
  estado: string;
  estadoSalud: string;
}

async function cargarSellers(tenantId: string): Promise<SellerFila[]> {
  const cliente = crearClienteServiceRole();
  const { data, error } = await cliente
    .from("sellers")
    .select(
      "id, razon_social, rut, estado, conexiones_seller_ml!conexiones_seller_ml_seller_id_fkey(estado_salud)",
    )
    .eq("tenant_id", tenantId)
    .order("razon_social");

  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((s) => {
    const conexion = s.conexiones_seller_ml as { estado_salud: string } | { estado_salud: string }[] | null;
    const conexionUnica = Array.isArray(conexion) ? conexion[0] : conexion;
    return {
      id: s.id as string,
      razonSocial: s.razon_social as string,
      rut: s.rut as string,
      estado: s.estado as string,
      estadoSalud: conexionUnica?.estado_salud ?? "pendiente",
    };
  });
}

/**
 * Pantalla — Listado de sellers del courier (RF-010, §3.2).
 *
 * Punto de entrada al que apuntan tanto la barra superior como el dashboard
 * ("Conexiones de ML caídas" → "ver todos los sellers"). Vista de solo
 * lectura con estado de cuenta y salud de la conexión ML; el alta de nuevos
 * sellers vive en /sellers/invitar.
 */
export default async function PaginaSellers() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  const sellers = await cargarSellers(sesion.usuario.tenantId);
  const puedeInvitar = puedeInvitarUsuarios(sesion.usuario);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sellers</h1>
          <p className="text-sm text-muted-foreground">
            Clientes de tu cuenta y el estado de su conexión con Mercado Libre.
          </p>
        </div>
        {puedeInvitar && (
          <Button asChild size="sm">
            <Link href="/sellers/invitar">Invitar seller</Link>
          </Button>
        )}
      </div>

      {sellers.length === 0 ? (
        <div className="rounded-xl border bg-card px-6 py-12 text-center">
          <p className="text-muted-foreground">Todavía no tienes sellers registrados.</p>
          {puedeInvitar && (
            <Link
              href="/sellers/invitar"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              Invitar a tu primer seller
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Lista de sellers">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Seller</th>
                  <th className="hidden px-4 py-2 sm:table-cell">RUT</th>
                  <th className="px-4 py-2">Cuenta</th>
                  <th className="px-4 py-2">Conexión ML</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sellers.map((seller) => (
                  <tr key={seller.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{seller.razonSocial}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{seller.rut}</td>
                    <td className="px-4 py-3">
                      <Badge variant={BADGE_ESTADO_SELLER[seller.estado] ?? "warning"}>
                        {TEXTO_ESTADO_SELLER[seller.estado] ?? seller.estado}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={BADGE_SALUD_CONEXION[seller.estadoSalud] ?? "neutral"}>
                        {TEXTO_SALUD_CONEXION[seller.estadoSalud] ?? seller.estadoSalud}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
