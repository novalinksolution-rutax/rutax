import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Store } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeInvitarUsuarios } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { BadgeEstado } from "@/components/ui/badge-estado";
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
import { BotonCopiarInvitacion } from "./boton-copiar-invitacion";

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
  /** Hay una invitación viva que todavía se puede entregar a mano. */
  invitacionPendiente: boolean;
}

/**
 * Sellers con invitación `pendiente` y NO vencida. Se consulta aparte (y no
 * como join) porque el listado necesita solo un booleano: el token se pide
 * después, bajo demanda y auditado, al presionar "Copiar enlace" — nunca viaja
 * con el HTML de esta página. Ver `actions.ts`.
 *
 * La cardinalidad es naturalmente chica (sellers que aún no entran), así que no
 * hay riesgo del corte silencioso de PostgREST en 1000 filas.
 */
async function cargarInvitacionesPendientes(
  cliente: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
): Promise<Set<string>> {
  const { data, error } = await cliente
    .from("invitaciones")
    .select("seller_id")
    .eq("tenant_id", tenantId)
    .eq("tipo_usuario", "seller")
    .eq("estado", "pendiente")
    .gt("expira_en", new Date().toISOString());

  if (error || !data) return new Set();

  return new Set(
    (data as Record<string, unknown>[])
      .map((i) => i.seller_id as string | null)
      .filter((id): id is string => Boolean(id)),
  );
}

async function cargarSellers(tenantId: string): Promise<SellerFila[]> {
  const cliente = crearClienteServiceRole();
  const [{ data, error }, pendientes] = await Promise.all([
    cliente
      .from("sellers")
      .select(
        "id, razon_social, rut, estado, conexiones_seller_ml!conexiones_seller_ml_seller_id_fkey(estado_salud)",
      )
      .eq("tenant_id", tenantId)
      .order("razon_social"),
    cargarInvitacionesPendientes(cliente, tenantId),
  ]);

  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((s) => {
    const conexion = s.conexiones_seller_ml as { estado_salud: string } | { estado_salud: string }[] | null;
    const conexionUnica = Array.isArray(conexion) ? conexion[0] : conexion;
    const id = s.id as string;
    return {
      id,
      razonSocial: s.razon_social as string,
      rut: s.rut as string,
      estado: s.estado as string,
      estadoSalud: conexionUnica?.estado_salud ?? "pendiente",
      invitacionPendiente: pendientes.has(id),
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
  // La columna solo aparece si hay algo que entregar: una tabla con una columna
  // vacía permanente le cobra ancho a las demás sin dar nada a cambio.
  const mostrarColumnaInvitacion = puedeInvitar && sellers.some((s) => s.invitacionPendiente);

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
                {mostrarColumnaInvitacion && (
                  <TableHead className="px-4 text-right">Invitación</TableHead>
                )}
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
                    <BadgeEstado
                      variante={BADGE_ESTADO_SELLER[seller.estado] ?? "warning"}
                      texto={TEXTO_ESTADO_SELLER[seller.estado] ?? seller.estado}
                    />
                  </TableCell>
                  <TableCell className="px-4">
                    <BadgeEstado
                      variante={BADGE_SALUD_CONEXION[seller.estadoSalud] ?? "neutral"}
                      texto={TEXTO_SALUD_CONEXION[seller.estadoSalud] ?? seller.estadoSalud}
                    />
                  </TableCell>
                  {mostrarColumnaInvitacion && (
                    <TableCell className="px-4 text-right">
                      {seller.invitacionPendiente ? (
                        <div className="flex justify-end">
                          <BotonCopiarInvitacion
                            sellerId={seller.id}
                            razonSocial={seller.razonSocial}
                          />
                        </div>
                      ) : null}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTable>
      )}
    </div>
  );
}
