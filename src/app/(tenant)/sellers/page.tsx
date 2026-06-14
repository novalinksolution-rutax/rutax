import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Store } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeInvitarUsuarios } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
        <EmptyState
          icon={Store}
          titulo="Todavía no tienes sellers"
          descripcion="Invita a tus clientes para que conecten Mercado Libre y sus pedidos lleguen solos."
          accion={
            puedeInvitar ? (
              <Button asChild size="sm">
                <Link href="/sellers/invitar">Invitar a tu primer seller</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          toolbar={
            <span className="text-sm text-muted-foreground tabular-nums">
              {sellers.length} seller{sellers.length !== 1 ? "s" : ""}
            </span>
          }
        >
          <Table densidad="comfortable" aria-label="Lista de sellers">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="px-4">Seller</TableHead>
                <TableHead className="hidden px-4 sm:table-cell">RUT</TableHead>
                <TableHead className="px-4">Cuenta</TableHead>
                <TableHead className="px-4">Conexión ML</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sellers.map((seller) => (
                <TableRow key={seller.id}>
                  <TableCell className="px-4 font-medium">{seller.razonSocial}</TableCell>
                  <TableCell className="hidden px-4 font-mono text-muted-foreground tabular-nums sm:table-cell">
                    {seller.rut}
                  </TableCell>
                  <TableCell className="px-4">
                    <Badge variant={BADGE_ESTADO_SELLER[seller.estado] ?? "warning"}>
                      {TEXTO_ESTADO_SELLER[seller.estado] ?? seller.estado}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4">
                    <Badge variant={BADGE_SALUD_CONEXION[seller.estadoSalud] ?? "neutral"}>
                      {TEXTO_SALUD_CONEXION[seller.estadoSalud] ?? seller.estadoSalud}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTable>
      )}
    </div>
  );
}
