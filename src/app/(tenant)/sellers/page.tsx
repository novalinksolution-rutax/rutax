import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PanelInvitarSeller } from "./panel-invitar-seller";
import { Store } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeSincronizarConexionesMl, puedeInvitarUsuarios } from "@/modules/identidad/capacidades";
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
import { etiquetaConexionMl } from "@/lib/ui/etiqueta-conexion-ml";
import { EnlaceDetalle } from "@/components/app-shell/enlace-detalle";
import { BotonCopiarInvitacion } from "./boton-copiar-invitacion";
import { ControlSincronizarMl, type ConexionMlResumen } from "./control-sincronizar-ml";

export const metadata: Metadata = {
  title: "Sellers",
};

// El vocabulario de salud de conexión vive en `traduccion-estados.ts` desde el
// bloque 0.3 del rediseño: acá era un mapa suelto que no pasaba por el sistema
// de tonos.

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
  /** Todas las cuentas ML del seller (0 a N) — para "Sincronizar ahora". */
  conexiones: ConexionMlResumen[];
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

interface ConexionMlFilaCruda {
  id: string;
  alias: string | null;
  ml_nickname: string | null;
  ml_user_id: string | null;
  estado_salud: string;
}

async function cargarSellers(tenantId: string): Promise<SellerFila[]> {
  const cliente = crearClienteServiceRole();
  const [{ data, error }, pendientes] = await Promise.all([
    cliente
      .from("sellers")
      .select(
        "id, razon_social, rut, estado, conexiones_seller_ml!conexiones_seller_ml_seller_id_fkey(id, alias, ml_nickname, ml_user_id, estado_salud)",
      )
      .eq("tenant_id", tenantId)
      .order("razon_social"),
    cargarInvitacionesPendientes(cliente, tenantId),
  ]);

  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((s) => {
    const conexionRaw = s.conexiones_seller_ml as ConexionMlFilaCruda | ConexionMlFilaCruda[] | null;
    const listaConexiones = Array.isArray(conexionRaw) ? conexionRaw : conexionRaw ? [conexionRaw] : [];
    // La salud mostrada en la columna "Conexión ML" sigue tomando la primera
    // (comportamiento existente, sin cambios); "Sincronizar ahora" sí necesita
    // TODAS las cuentas, así que se guardan aparte con su etiqueta ya resuelta.
    const conexionUnica = listaConexiones[0] ?? null;
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
      conexiones: listaConexiones.map((c) => ({
        id: c.id,
        etiqueta: etiquetaConexionMl({ alias: c.alias, mlNickname: c.ml_nickname, mlUserId: c.ml_user_id }),
      })),
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

  // "Sincronizar ahora": capacidad propia, los CUATRO roles internos. No se
  // reusa el gate de asignar/reasignar porque ese excluye a `administracion`
  // por diseño, y traer pedidos no asigna nada a nadie — administración los
  // necesita para tener qué facturar y conciliar. Igual que la columna de
  // invitación, no aparece si no hay ninguna cuenta que sincronizar.
  const puedeSincronizar = puedeSincronizarConexionesMl(sesion.usuario);
  const mostrarColumnaSincronizar = puedeSincronizar && sellers.some((s) => s.conexiones.length > 0);

  return (
    /* 🔴 Sin tope propio: la ruta está en `rutasAnchas` del layout justamente
       para que la tabla use el lienzo, y un `max-w-4xl` acá lo anulaba en
       silencio — el `<main>` se ensanchaba a 1800 y la página se quedaba en
       896, o sea un cuadrado en el centro. El espaciado y el ancho los pone el
       layout; la página solo apila su contenido. */
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sellers</h1>
          <p className="text-sm text-muted-foreground">
            Clientes de tu cuenta y el estado de su conexión con sus fuentes de pedidos.
          </p>
        </div>
        {/* Panel, no navegación: la pregunta que trae a alguien acá suele ser
            «¿ya invité a este?», y la respuesta está en la tabla de atrás. */}
        {puedeInvitar && <PanelInvitarSeller />}
      </div>

      {sellers.length === 0 ? (
        <EmptyState
          icon={Store}
          titulo="Todavía no tienes sellers"
          descripcion="Invita a tus clientes para que conecten sus cuentas de Mercado Libre o Shopify y sus pedidos lleguen solos."
          accion={
            puedeInvitar ? <PanelInvitarSeller etiqueta="Invitar a tu primer seller" /> : undefined
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
          {/* ─────────────────────────────────────────────────────────────
              A 375 px la fila deja de ser una fila.
              ──────────────────────────────────────────────────────────────
              Mismo patrón que `/operaciones`: se renderizan LAS DOS formas y
              CSS elige. Decidirlo en JavaScript midiendo el ancho sería peor —
              el servidor no sabe el ancho, así que la primera pintura saldría
              con la forma equivocada y cambiaría delante del usuario.

              🔴 Sin esto, en teléfono la tabla se arrastraba 302 px de lado
              dentro de su caja y la columna «Sincronizar» —la única accionable—
              vivía fuera de la vista. Cuatro columnas no caben en 342 px por
              mucho que se recorte cada una.
              ───────────────────────────────────────────────────────────── */}
          <ul className="divide-y divide-border md:hidden">
            {sellers.map((seller) => (
              <li key={seller.id} className="space-y-2.5 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <EnlaceDetalle
                    href={`/sellers/${seller.id}`}
                    className="min-w-0 font-medium hover:underline"
                  >
                    {seller.razonSocial}
                  </EnlaceDetalle>
                  <BadgeEstado
                    variante={BADGE_ESTADO_SELLER[seller.estado as EstadoSeller] ?? "warning"}
                    texto={traducirEstadoSeller(seller.estado)}
                    eje="seller"
                    valor={seller.estado}
                  />
                </div>

                {/* El RUT sí cabe acá: en la ficha ocupa su propia línea, y es
                    el dato con el que un courier reconoce a su cliente. */}
                <p className="font-mono text-xs text-muted-foreground tabular-nums">
                  {seller.rut}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <BadgeEstado
                    variante={BADGE_SALUD_CONEXION[seller.estadoSalud as EstadoSaludConexion] ?? "neutral"}
                    texto={traducirSaludConexion(seller.estadoSalud)}
                    eje="conexion"
                    valor={seller.estadoSalud}
                  />
                  {mostrarColumnaSincronizar && (
                    <ControlSincronizarMl
                      razonSocial={seller.razonSocial}
                      conexiones={seller.conexiones}
                    />
                  )}
                </div>

                {mostrarColumnaInvitacion && seller.invitacionPendiente && (
                  <div className="flex flex-col items-start gap-1.5">
                    {avisoEntrega(seller.invitacionEmailEstado, seller.invitacionEmailMotivo)}
                    <BotonCopiarInvitacion
                      sellerId={seller.id}
                      razonSocial={seller.razonSocial}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>

          <Table densidad="comfortable" aria-label="Lista de sellers" className="hidden md:table">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="px-4">Seller</TableHead>
                {/* 🔴 El RUT se retira hasta `lg`, no hasta `sm`. Con las cinco
                    columnas visibles la tabla pide ~756 px y entre 640 y 790
                    desbordaba su caja: aparecía un scroll horizontal y la
                    columna «Sincronizar» —la única accionable— quedaba fuera de
                    la vista, sin nada que delatara que estaba ahí. El RUT es el
                    dato menos urgente de un listado y vive en la ficha.

                    ⚠️ Vuelve en `xl`, no en `lg`, y la razón no es el viewport:
                    **en `lg` entra la barra lateral y el lienzo se ENCOGE** (734
                    px a 768 de viewport → 702 px a 1024). El ancho disponible no
                    crece de forma monótona con la pantalla, así que un punto de
                    corte elegido mirando solo el viewport reintroduce el
                    desborde justo en el tamaño más común de portátil. */}
                <TableHead className="hidden px-4 xl:table-cell">RUT</TableHead>
                <TableHead className="px-4">Cuenta</TableHead>
                <TableHead className="px-4">Conexión ML</TableHead>
                {mostrarColumnaSincronizar && (
                  <TableHead className="px-4 text-right">Sincronizar</TableHead>
                )}
                {mostrarColumnaInvitacion && (
                  <TableHead className="px-4 text-right">Invitación</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sellers.map((seller) => (
                <TableRow key={seller.id}>
                  {/* 🐞 El listado era TERMINAL: ninguna fila navegaba a
                      ninguna parte, aunque el seller es uno de los objetos
                      centrales del dominio. Ahora el nombre abre su ficha. */}
                  <TableCell className="px-4 font-medium">
                    <EnlaceDetalle
                      href={`/sellers/${seller.id}`}
                      className="hover:underline"
                    >
                      {seller.razonSocial}
                    </EnlaceDetalle>
                  </TableCell>
                  <TableCell className="hidden px-4 font-mono text-muted-foreground tabular-nums xl:table-cell">
                    {seller.rut}
                  </TableCell>
                  <TableCell className="px-4">
                    <BadgeEstado
                      variante={BADGE_ESTADO_SELLER[seller.estado as EstadoSeller] ?? "warning"}
                      texto={traducirEstadoSeller(seller.estado)}
                      eje="seller"
                      valor={seller.estado}
                    />
                  </TableCell>
                  <TableCell className="px-4">
                    <BadgeEstado
                      variante={BADGE_SALUD_CONEXION[seller.estadoSalud as EstadoSaludConexion] ?? "neutral"}
                      texto={traducirSaludConexion(seller.estadoSalud)}
                      eje="conexion"
                      valor={seller.estadoSalud}
                    />
                  </TableCell>
                  {mostrarColumnaSincronizar && (
                    <TableCell className="px-4 text-right whitespace-normal">
                      <ControlSincronizarMl
                        razonSocial={seller.razonSocial}
                        conexiones={seller.conexiones}
                      />
                    </TableCell>
                  )}
                  {mostrarColumnaInvitacion && (
                    <TableCell className="px-4 text-right whitespace-normal">
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
