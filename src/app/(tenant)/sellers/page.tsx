import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PanelEnlaceSeller } from "./enlace/panel-enlace-seller";
import { Store } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  puedeInvitarUsuarios,
  puedeSincronizarConexionesMl,
} from "@/modules/identidad/capacidades";
import { etiquetaConexionMl } from "@/lib/ui/etiqueta-conexion-ml";
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
import { ListaAtenuable } from "@/components/ui/vista-previa-lateral";
import { FilaSeller, NombreSeller } from "./fila-seller";
import { MenuSeller } from "./menu-seller";

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
  /** Para el menú: sus cuentas ML (sincronizar) y su acceso (bloquear). */
  cuentasMl: { id: string; etiqueta: string }[];
  membresia: "activa" | "bloqueada" | null;
}

/** Orden de gravedad: la primera que aparezca en esta lista gana. */
const GRAVEDAD_SALUD: EstadoSaludConexion[] = ["desvinculada", "atencion", "pendiente", "sana"];

function peorDe(estados: string[]): EstadoSaludConexion | null {
  return GRAVEDAD_SALUD.find((g) => estados.includes(g)) ?? null;
}

/** Hay algo que hacer con este seller. Define el grupo «Requieren atención». */
function requiereAtencion(s: SellerFila): boolean {
  // Suspendido es una decisión ya tomada, no algo que atender: va aparte.
  if (s.estado === "suspendido") return false;
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
  const [{ data, error }, ml, shopify, pendientes, membresias] = await Promise.all([
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
      .select("id, seller_id, estado_salud, alias, ml_nickname, ml_user_id")
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
    cliente
      .schema("identidad")
      .from("seller_membresias")
      .select("seller_id, estado")
      .eq("tenant_id", tenantId),
  ]);

  if (error || !data) return [];

  const cuentasMlPorSeller = new Map<string, { id: string; etiqueta: string }[]>();
  for (const c of (ml.data ?? []) as Record<string, string | null>[]) {
    const sellerId = c.seller_id as string;
    cuentasMlPorSeller.set(sellerId, [
      ...(cuentasMlPorSeller.get(sellerId) ?? []),
      {
        id: c.id as string,
        etiqueta: etiquetaConexionMl({ alias: c.alias, mlNickname: c.ml_nickname, mlUserId: c.ml_user_id }),
      },
    ]);
  }
  const membresiaPorSeller = new Map(
    ((membresias.data ?? []) as { seller_id: string; estado: "activa" | "bloqueada" }[]).map((m) => [
      m.seller_id,
      m.estado,
    ]),
  );

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
      cuentasMl: cuentasMlPorSeller.get(id) ?? [],
      membresia: membresiaPorSeller.get(id) ?? null,
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
      {/* «Invitado» ya dice que falta aceptar; solo se agrega si el correo no llegó. */}
      {seller.invitacionPendiente
        ? avisoEntrega(seller.invitacionEmailEstado, seller.invitacionEmailMotivo)
        : null}
    </>
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
  const puedeSincronizar = puedeSincronizarConexionesMl(sesion.usuario);

  const grupos = [
    { titulo: "Requieren atención", lista: sellers.filter(requiereAtencion), plegado: false },
    {
      titulo: "Al día",
      lista: sellers.filter((s) => s.estado !== "suspendido" && !requiereAtencion(s)),
      plegado: false,
    },
    // Al final y plegado: es una decisión tomada, no algo que mirar cada día.
    { titulo: "Suspendidos", lista: sellers.filter((s) => s.estado === "suspendido"), plegado: true },
  ].filter((g) => g.lista.length > 0);

  const menu = (seller: SellerFila) => (
    <MenuSeller
      seller={seller}
      puedeSincronizar={puedeSincronizar}
      puedeInvitar={puedeInvitar}
    />
  );

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
            {grupos.map((g) => {
              const filas = (
                <ul className="divide-y divide-border">
                  {g.lista.map((seller) => (
                    <li key={seller.id} className="flex items-center gap-2 py-1.5 pr-1 pl-4">
                      <div className="min-w-0 flex-1">
                        <NombreSeller
                          sellerId={seller.id}
                          className="flex w-full min-w-0 flex-col items-start py-1"
                        >
                          <span className="flex w-full min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{seller.razonSocial}</span>
                            {seller.esReciente ? <DistintivoRecienUnido /> : null}
                          </span>
                          <span className="rx-num text-xs text-muted-foreground">{seller.rut}</span>
                        </NombreSeller>
                        {requiereAtencion(seller) ? (
                          <div className="flex flex-wrap items-center gap-2 pb-1">
                            <Problemas seller={seller} />
                          </div>
                        ) : null}
                      </div>
                      {menu(seller)}
                    </li>
                  ))}
                </ul>
              );
              return g.plegado ? (
                <details key={g.titulo} className="group">
                  <summary className="list-none [&::-webkit-details-marker]:hidden">
                    <EncabezadoGrupo titulo={g.titulo} cantidad={g.lista.length} plegable />
                  </summary>
                  {filas}
                </details>
              ) : (
                <section key={g.titulo}>
                  <EncabezadoGrupo titulo={g.titulo} cantidad={g.lista.length} />
                  {filas}
                </section>
              );
            })}
          </div>

          {/* Atenuar, no tapar: con el panel abierto hay que poder seguir
              leyendo las filas y tocar otra cambia el panel sin cerrarlo. */}
          <ListaAtenuable>
            <Table densidad="comfortable" aria-label="Lista de sellers" className="hidden md:table">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4">Seller</TableHead>
                  <TableHead className="px-4" />
                  <TableHead className="w-12 px-2" />
                </TableRow>
              </TableHeader>
              {grupos.map((g) => (
                <TableBody key={g.titulo}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="!p-0">
                      <EncabezadoGrupo titulo={g.titulo} cantidad={g.lista.length} />
                    </TableCell>
                  </TableRow>
                  {g.lista.map((seller) => (
                    <FilaSeller key={seller.id} sellerId={seller.id}>
                      <TableCell className="px-4">
                        <span className="flex items-center gap-2">
                          <NombreSeller sellerId={seller.id} className="font-medium hover:underline">
                            {seller.razonSocial}
                          </NombreSeller>
                          {seller.esReciente ? <DistintivoRecienUnido /> : null}
                        </span>
                        <span className="rx-num block text-xs text-muted-foreground">{seller.rut}</span>
                      </TableCell>
                      <TableCell className="px-4 whitespace-normal">
                        <span className="flex flex-wrap items-center gap-2">
                          <Problemas seller={seller} />
                        </span>
                      </TableCell>
                      <TableCell className="px-2 text-right">{menu(seller)}</TableCell>
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

function EncabezadoGrupo({
  titulo,
  cantidad,
  plegable = false,
}: {
  titulo: string;
  cantidad: number;
  plegable?: boolean;
}) {
  return (
    <p
      className={`rx-num flex items-baseline justify-between border-b border-border bg-muted/40 px-4 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase ${
        plegable ? "min-h-11 cursor-pointer items-center" : "py-1.5"
      }`}
    >
      <span>{titulo}</span>
      <span>{plegable ? `${cantidad} ›` : cantidad}</span>
    </p>
  );
}
