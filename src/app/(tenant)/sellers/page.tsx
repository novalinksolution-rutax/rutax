import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PanelEnlaceSeller } from "./enlace/panel-enlace-seller";
import { Store } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeInvitarUsuarios } from "@/modules/identidad/capacidades";
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
  BADGE_SALUD_CONEXION,
  traducirEstadoSeller,
  traducirSaludConexion,
  type EstadoSaludConexion,
  type EstadoSeller,
} from "@/lib/ui/traduccion-estados";
import { EnlaceDetalle } from "@/components/app-shell/enlace-detalle";
import { ListaAtenuable } from "@/components/ui/vista-previa-lateral";
import { FilaSeller } from "./fila-seller";
import { BotonCopiarInvitacion } from "./boton-copiar-invitacion";

export const metadata: Metadata = {
  title: "Sellers",
};

/** Recién unido: se unió por el enlace de autoservicio hace ≤3 días. */
const HORAS_RECIEN_UNIDO = 72;

interface SellerFila {
  id: string;
  razonSocial: string;
  rut: string;
  estado: string;
  /**
   * La PEOR salud entre todas sus cuentas (ML y Shopify), o `null` si no tiene
   * ninguna. Antes se mostraba la de la primera cuenta ML: un seller con cuatro
   * cuentas y una caída salía «conectado».
   */
  peorSalud: EstadoSaludConexion | null;
  /** Hay una invitación viva que todavía se puede entregar a mano. */
  invitacionPendiente: boolean;
  /** Qué sabemos de la ENTREGA del correo. `rebotado` es lo accionable. */
  invitacionEmailEstado: string | null;
  invitacionEmailMotivo: string | null;
  /** `true` si se creó hace ≤72 h — quien acaba de unirse por el enlace. */
  esReciente: boolean;
}

/** Orden de gravedad: la primera que aparezca en esta lista gana. */
const GRAVEDAD_SALUD: EstadoSaludConexion[] = ["desvinculada", "atencion", "pendiente", "sana"];

function peorDe(estados: string[]): EstadoSaludConexion | null {
  return GRAVEDAD_SALUD.find((g) => estados.includes(g)) ?? null;
}

/** Hay algo que hacer con este seller. Define el grupo «Requieren atención». */
function requiereAtencion(s: SellerFila): boolean {
  return (
    s.estado !== "activo" ||
    s.invitacionPendiente ||
    s.peorSalud === "desvinculada" ||
    s.peorSalud === "atencion"
  );
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
  const [{ data, error }, ml, shopify, pendientes] = await Promise.all([
    cliente
      .from("sellers")
      .select("id, razon_social, rut, estado, creado_en")
      .eq("tenant_id", tenantId)
      .order("razon_social"),
    // Desde `identidad` y no por la vista `public`: esa vista congeló sus
    // columnas antes de que existiera `desconectada_por_usuario_id`, y así
    // debe seguir (ver la migración 20260826000002).
    cliente
      .schema("identidad")
      .from("conexiones_seller_ml")
      .select("seller_id, estado_salud")
      .eq("tenant_id", tenantId)
      // La cuenta que el seller apagó a propósito no es una caída: es una
      // decisión suya y no pide nada al courier (mismo criterio que el dashboard).
      .is("desconectada_por_usuario_id", null),
    cliente
      .schema("identidad")
      .from("conexiones_seller_shopify")
      .select("seller_id, estado_salud")
      .eq("tenant_id", tenantId)
      .eq("activa", true),
    cargarInvitacionesPendientes(cliente, tenantId),
  ]);

  if (error || !data) return [];

  const saludPorSeller = new Map<string, string[]>();
  for (const f of [...(ml.data ?? []), ...(shopify.data ?? [])] as {
    seller_id: string;
    estado_salud: string;
  }[]) {
    saludPorSeller.set(f.seller_id, [...(saludPorSeller.get(f.seller_id) ?? []), f.estado_salud]);
  }

  return (data as Record<string, unknown>[]).map((s) => {
    const id = s.id as string;
    const envio = pendientes.get(id);
    const creadoEn = s.creado_en as string | null;
    const horasDesdeCreacion = creadoEn
      ? (Date.now() - new Date(creadoEn).getTime()) / (1000 * 60 * 60)
      : Number.POSITIVE_INFINITY;
    return {
      id,
      razonSocial: s.razon_social as string,
      rut: s.rut as string,
      estado: s.estado as string,
      peorSalud: peorDe(saludPorSeller.get(id) ?? []),
      invitacionPendiente: pendientes.has(id),
      invitacionEmailEstado: envio?.emailEstado ?? null,
      invitacionEmailMotivo: envio?.emailMotivo ?? null,
      esReciente: horasDesdeCreacion <= HORAS_RECIEN_UNIDO,
    };
  });
}

/** «Nuevo» — quien se unió hace poco por el enlace de autoservicio. */
function DistintivoRecienUnido() {
  return (
    <span
      className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
      title="Se unió hace poco por el enlace de registro"
    >
      Nuevo
    </span>
  );
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
 * Lo que pide atención de un seller, en distintivos. Vacío si está al día: en
 * el grupo «Al día» la fila es solo el nombre.
 */
function Problemas({ seller }: { seller: SellerFila }) {
  return (
    <>
      {seller.estado !== "activo" ? (
        <BadgeEstado
          variante={BADGE_ESTADO_SELLER[seller.estado as EstadoSeller] ?? "warning"}
          texto={traducirEstadoSeller(seller.estado)}
          eje="seller"
          valor={seller.estado}
        />
      ) : null}
      {seller.peorSalud === "desvinculada" || seller.peorSalud === "atencion" ? (
        <BadgeEstado
          variante={BADGE_SALUD_CONEXION[seller.peorSalud]}
          texto={traducirSaludConexion(seller.peorSalud)}
          eje="conexion"
          valor={seller.peorSalud}
        />
      ) : null}
    </>
  );
}

function AccionInvitacion({ seller, alinear }: { seller: SellerFila; alinear: "start" | "end" }) {
  if (!seller.invitacionPendiente) return null;
  return (
    <div className={`flex flex-col gap-1.5 ${alinear === "end" ? "items-end" : "items-start"}`}>
      {avisoEntrega(seller.invitacionEmailEstado, seller.invitacionEmailMotivo)}
      <BotonCopiarInvitacion sellerId={seller.id} razonSocial={seller.razonSocial} />
    </div>
  );
}

/**
 * Pantalla — Listado de sellers del courier (RF-010, §3.2).
 *
 * Dos grupos: los que piden algo y los que están al día. La fila de un seller
 * al día es solo su nombre; los distintivos aparecen únicamente cuando hay un
 * problema. «Sincronizar» salió de la fila —cada fila repetía el mismo botón— y
 * vive en el panel lateral, donde se ven sus cuentas.
 */
export default async function PaginaSellers() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  const cliente = crearClienteServiceRole();
  const [sellers, { data: tenant }] = await Promise.all([
    cargarSellers(sesion.usuario.tenantId),
    cliente
      .from("tenants")
      .select("nombre_fantasia")
      .eq("id", sesion.usuario.tenantId)
      .maybeSingle(),
  ]);
  const nombreFantasia = (tenant?.nombre_fantasia as string | null)?.trim() || "tu courier";
  const puedeInvitar = puedeInvitarUsuarios(sesion.usuario);

  const grupos = [
    { titulo: "Requieren atención", lista: sellers.filter(requiereAtencion) },
    { titulo: "Al día", lista: sellers.filter((s) => !requiereAtencion(s)) },
  ].filter((g) => g.lista.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Sellers</h1>
        {puedeInvitar && <PanelEnlaceSeller nombreFantasia={nombreFantasia} />}
      </div>

      {sellers.length === 0 ? (
        <EmptyState
          icon={Store}
          titulo="Todavía no tienes sellers"
          accion={
            puedeInvitar ? <PanelEnlaceSeller nombreFantasia={nombreFantasia} /> : undefined
          }
        />
      ) : (
        <DataTable>
          {/* Teléfono: las dos formas se renderizan y CSS elige (mismo patrón
              que `/operaciones`). */}
          <div className="md:hidden">
            {grupos.map((g) => (
              <section key={g.titulo}>
                <EncabezadoGrupo titulo={g.titulo} cantidad={g.lista.length} />
                <ul className="divide-y divide-border">
                  {g.lista.map((seller) => (
                    <li
                      key={seller.id}
                      className={`space-y-2 px-4 ${requiereAtencion(seller) ? "py-3" : "py-0.5"}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <EnlaceDetalle
                          href={`/sellers/${seller.id}`}
                          className="flex min-h-11 min-w-0 items-center truncate font-medium hover:underline"
                        >
                          {seller.razonSocial}
                        </EnlaceDetalle>
                        {seller.esReciente ? <DistintivoRecienUnido /> : null}
                      </span>
                      {requiereAtencion(seller) ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Problemas seller={seller} />
                        </div>
                      ) : null}
                      <AccionInvitacion seller={seller} alinear="start" />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {/* Atenuar, no tapar: con el panel abierto hay que poder seguir
              leyendo las filas y tocar otra cambia el panel sin cerrarlo. */}
          <ListaAtenuable>
            <Table densidad="comfortable" aria-label="Lista de sellers" className="hidden md:table">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4">Seller</TableHead>
                  {/* El RUT vuelve en `xl`, no en `lg`: en `lg` entra la barra
                      lateral y el lienzo se encoge. */}
                  <TableHead className="hidden px-4 xl:table-cell">RUT</TableHead>
                  <TableHead className="px-4" />
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              {grupos.map((g) => (
                <TableBody key={g.titulo}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="!p-0">
                      <EncabezadoGrupo titulo={g.titulo} cantidad={g.lista.length} />
                    </TableCell>
                  </TableRow>
                  {g.lista.map((seller) => (
                    <FilaSeller key={seller.id} sellerId={seller.id}>
                      <TableCell className="px-4 font-medium">
                        <span className="flex items-center gap-2">
                          <EnlaceDetalle href={`/sellers/${seller.id}`} className="hover:underline">
                            {seller.razonSocial}
                          </EnlaceDetalle>
                          {seller.esReciente ? <DistintivoRecienUnido /> : null}
                        </span>
                      </TableCell>
                      <TableCell className="hidden px-4 font-mono text-muted-foreground tabular-nums xl:table-cell">
                        {seller.rut}
                      </TableCell>
                      <TableCell className="px-4">
                        <span className="flex flex-wrap items-center gap-2">
                          <Problemas seller={seller} />
                        </span>
                      </TableCell>
                      <TableCell className="px-4 text-right whitespace-normal">
                        <AccionInvitacion seller={seller} alinear="end" />
                      </TableCell>
                    </FilaSeller>
                  ))}
                </TableBody>
              ))}
            </Table>
          </ListaAtenuable>
        </DataTable>
      )}
    </div>
  );
}

function EncabezadoGrupo({ titulo, cantidad }: { titulo: string; cantidad: number }) {
  return (
    <p className="rx-num flex items-baseline justify-between border-b border-border bg-muted/40 px-4 py-1.5 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
      <span>{titulo}</span>
      <span>{cantidad}</span>
    </p>
  );
}
