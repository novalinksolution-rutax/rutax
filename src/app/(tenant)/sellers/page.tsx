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
import {
  BADGE_ESTADO_SELLER,
  traducirEstadoSeller,
  type BadgeVariante,
  type EstadoSeller,
} from "@/lib/ui/traduccion-estados";
import { BotonCopiarInvitacion } from "./boton-copiar-invitacion";

export const metadata: Metadata = {
  title: "Sellers",
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
  /** Qué sabemos de la ENTREGA del correo. `rebotado` es lo accionable. */
  invitacionEmailEstado: string | null;
  invitacionEmailMotivo: string | null;
}

interface EstadoEnvioInvitacion {
  emailEstado: string | null;
  emailMotivo: string | null;
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
): Promise<Map<string, EstadoEnvioInvitacion>> {
  const { data, error } = await cliente
    .from("invitaciones")
    .select("seller_id, email_estado, email_motivo")
    .eq("tenant_id", tenantId)
    .eq("tipo_usuario", "seller")
    .eq("estado", "pendiente")
    .gt("expira_en", new Date().toISOString());

  if (error || !data) return new Map();

  const mapa = new Map<string, EstadoEnvioInvitacion>();
  for (const fila of data as Record<string, unknown>[]) {
    const sellerId = fila.seller_id as string | null;
    if (!sellerId) continue;
    mapa.set(sellerId, {
      emailEstado: (fila.email_estado as string | null) ?? null,
      emailMotivo: (fila.email_motivo as string | null) ?? null,
    });
  }
  return mapa;
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
    const envio = pendientes.get(id);
    return {
      id,
      razonSocial: s.razon_social as string,
      rut: s.rut as string,
      estado: s.estado as string,
      estadoSalud: conexionUnica?.estado_salud ?? "pendiente",
      invitacionPendiente: pendientes.has(id),
      invitacionEmailEstado: envio?.emailEstado ?? null,
      invitacionEmailMotivo: envio?.emailMotivo ?? null,
    };
  });
}

/**
 * Aviso de entrega del correo de invitación.
 *
 * Solo se dice algo cuando hay algo que hacer. `enviado` y `entregado` no
 * pintan nada: el caso normal no necesita rótulo, y un "entregado" en cada fila
 * volvería invisible al único que importa. `null` tampoco dice nada — son
 * invitaciones anteriores a que registráramos esto, o creadas sin envío.
 */
function avisoEntrega(estado: string | null, motivo: string | null) {
  if (estado === "rebotado") {
    return (
      <p className="text-right text-xs font-medium text-destructive">
        El correo rebotó — no llegó
        {motivo ? <span className="block font-normal text-muted-foreground">{motivo}</span> : null}
      </p>
    );
  }
  if (estado === "marcado_spam") {
    return (
      <p className="text-right text-xs font-medium text-warning">
        Llegó, pero lo marcaron como spam
      </p>
    );
  }
  return null;
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
                      variante={BADGE_ESTADO_SELLER[seller.estado as EstadoSeller] ?? "warning"}
                      texto={traducirEstadoSeller(seller.estado)}
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
                        <div className="flex flex-col items-end gap-1.5">
                          {avisoEntrega(seller.invitacionEmailEstado, seller.invitacionEmailMotivo)}
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
