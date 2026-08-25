import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import {
  contarAsignablesSinAsignar,
  listarComunasConAsignables,
  listarPedidosAsignables,
  obtenerCargaConductoresDelDia,
  type EstadoAsignable,
  type FiltroAsignables,
  type PedidoAsignable,
} from "@/modules/operacion/asignacion";
import { listarConductores } from "@/modules/operacion/conductores";
import { etiquetaConexionMl } from "@/lib/ui/etiqueta-conexion-ml";
import { Button } from "@/components/ui/button";
import { BandejaAsignar } from "./_componentes/bandeja-asignar";
import type { ComunaOpcion } from "./_componentes/selector-comuna";
import type { SellerOpcion } from "./_componentes/filtros-bandeja";
import type { ConductorOpcion } from "./_componentes/barra-seleccion";
import {
  hayFiltrosActivos,
  normalizarComunas,
  normalizarEstado,
  normalizarPagina,
  normalizarTexto,
} from "./_lib/filtros";

export const metadata: Metadata = {
  title: "Asignar pedidos",
};

/**
 * "Asignar pedidos" — la bandeja de asignación en bloque (Etapa 6 del
 * alcance "retiro en bodega + ruteo"). El coordinador filtra el universo de
 * lo ya retirado, selecciona un bloque y lo asigna a un conductor con un
 * clic — muchas veces al día, en lotes chicos.
 *
 * Fuente de verdad de esta pantalla: docs/ux/etapa-6-asignacion-en-bloque.md.
 *
 * RBAC: `puedeAsignarYReasignarPedidos` — dueño, supervisor y coordinador de
 * tráfico. Mismo patrón de gate que `/preparacion` y la Torre de control:
 * bloque `ShieldAlert` en la propia página, nunca un `redirect` (§15,
 * criterio "gate de ruta con el patrón de la Torre").
 *
 * Ancho: SÍ entra a `rutasAnchas` (layout de `(tenant)`). El comentario decía
 * lo contrario —«ancho normal, `max-w-6xl`, no entra»— y quedó desactualizado
 * cuando los listados pasaron a usar el lienzo. Se corrige porque una nota así
 * invita a reponer un tope que anularía el ensanche sin que nadie lo note; es
 * lo que estaba pasando en `/sellers` (§2.1).
 *
 * `error_carga` (§4): "aquí hay una sola fuente de datos" — a diferencia de
 * `/preparacion` (dos consultas independientes), toda la carga vive en UNA
 * función (`cargarDatosBandeja`) y un solo `try/catch` decide si hubo o no
 * error. El único camino que se sale de ese contrato a propósito es el
 * enriquecimiento "cuenta ML de origen" (§9, chip discreto bajo la comuna):
 * es decorativo, no crítico, y falla en silencio como best-effort — mismo
 * criterio que `/operaciones`.
 *
 * El `try/catch` NUNCA construye JSX en su interior (regla
 * `react-hooks/error-boundaries`: React no renderiza sincrónicamente al
 * crear un elemento, así que un `try` alrededor de JSX no protege de nada) —
 * solo junta datos en `DatosBandeja`; el JSX se arma después, ya fuera del
 * bloque.
 */

const PEDIDOS_POR_PAGINA = 50;

interface SearchParamsAsignar {
  comuna?: string | string[];
  seller?: string;
  q?: string;
  estado?: string;
  pagina?: string;
  /** Preselección de conductor al llegar desde "Agregar pedidos" del manifiesto (§2.3). */
  conductor?: string;
}

interface DatosBandeja {
  totalRetiradosHoy: number;
  totalSinAsignar: number;
  pedidos: PedidoAsignable[];
  totalFiltro: number;
  origenPorPedido: Record<string, string | null>;
  comunasCatalogo: ComunaOpcion[];
  sellers: SellerOpcion[];
  conductores: ConductorOpcion[];
}

// =============================================================================
// Sellers del tenant — para el filtro "Seller" (§5.2)
// =============================================================================
// No se acota a "sellers con asignables hoy" (a diferencia de la comuna,
// §5.1): a la escala del piloto (~10 sellers, CLAUDE.md "Decisiones del
// piloto") el riesgo de "52 filas casi todas en cero" que sí justifica ese
// recorte en comunas no aplica acá. Decisión de esta etapa — ver el informe.
async function cargarSellers(cliente: SupabaseClient, tenantId: string): Promise<SellerOpcion[]> {
  const { data, error } = await cliente
    .schema("identidad")
    .from("sellers")
    .select("id, razon_social, estado")
    .eq("tenant_id", tenantId)
    .order("razon_social", { ascending: true });

  if (error) {
    throw new Error(`Error al listar sellers: ${error.message}`);
  }

  return (data ?? []).map((fila: Record<string, unknown>) => ({
    id: fila.id as string,
    nombre: fila.razon_social as string,
    estado: fila.estado as string,
  }));
}

// =============================================================================
// Chip de cuenta ML de origen — SOLO si el seller tiene más de una cuenta
// =============================================================================
// Mismo patrón, EXACTO, que `/operaciones/page.tsx` (líneas ~211-256): dos
// consultas acotadas a los sellers/pedidos de la página actual, sin tocar
// `asignacion.ts` ni el tipo `PedidoAsignable`. Best-effort: si falla, la
// pantalla se sigue viendo bien, solo sin el chip (CLAUDE.md — "en
// manifiestos con pedidos de varias cuentas/fuentes, muestra el origen SOLO
// cuando el seller tiene más de una cuenta").
async function resolverOrigenPorPedido(
  cliente: SupabaseClient,
  tenantId: string,
  pedidos: PedidoAsignable[],
): Promise<Record<string, string | null>> {
  const mapa: Record<string, string | null> = {};
  try {
    const sellerIds = [...new Set(pedidos.map((p) => p.sellerId))];
    const pedidoIds = pedidos.map((p) => p.pedidoId);
    if (sellerIds.length === 0 || pedidoIds.length === 0) return mapa;

    const [conexRes, pedRes] = await Promise.all([
      cliente
        .schema("identidad")
        .from("conexiones_seller_ml")
        .select("seller_id, ml_user_id, alias, ml_nickname")
        .eq("tenant_id", tenantId)
        .in("seller_id", sellerIds),
      cliente
        .schema("operacion")
        .from("pedidos")
        .select("id, seller_id, ml_user_id")
        .in("id", pedidoIds),
    ]);

    const countBySeller: Record<string, number> = {};
    const labelByKey: Record<string, string> = {};
    for (const c of (conexRes.data ?? []) as Array<{
      seller_id: string;
      ml_user_id: string | null;
      alias: string | null;
      ml_nickname: string | null;
    }>) {
      countBySeller[c.seller_id] = (countBySeller[c.seller_id] ?? 0) + 1;
      if (c.ml_user_id) {
        labelByKey[`${c.seller_id}:${c.ml_user_id}`] = etiquetaConexionMl({
          alias: c.alias,
          mlNickname: c.ml_nickname,
          mlUserId: c.ml_user_id,
        });
      }
    }
    for (const p of (pedRes.data ?? []) as Array<{ id: string; seller_id: string; ml_user_id: string | null }>) {
      if ((countBySeller[p.seller_id] ?? 0) > 1 && p.ml_user_id) {
        mapa[p.id] = labelByKey[`${p.seller_id}:${p.ml_user_id}`] ?? null;
      }
    }
  } catch {
    // best-effort — sin chip si falla la resolución de origen.
  }
  return mapa;
}

// =============================================================================
// Toda la carga de datos, en UNA función — sin JSX adentro (ver cabecera)
// =============================================================================
async function cargarDatosBandeja(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    fecha: string;
    comunasSeleccionadas: readonly string[];
    sellerId: string | null;
    texto: string;
    estado: EstadoAsignable | null;
    pagina: number;
  },
): Promise<DatosBandeja> {
  const { tenantId, fecha, comunasSeleccionadas, sellerId, texto, estado, pagina } = entrada;

  // "Carga por comuna" resuelve el filtro Y da, sumado, el total GLOBAL de
  // hoy (§9 cabecera: "143 pedidos retirados hoy") sin pagar una consulta
  // aparte — las dos cifras comparten exactamente las mismas dos rejas.
  const comunas = await listarComunasConAsignables(cliente, { tenantId, fecha });
  const totalRetiradosHoy = comunas.reduce((acc, c) => acc + c.total, 0);

  if (totalRetiradosHoy === 0) {
    // arranque_vacio_global (§4): cero pedidos retirado en TODO el tenant
    // hoy. Ni siquiera se piden pedidos/sellers/conductores — no hay nada
    // que ofrecer todavía.
    return {
      totalRetiradosHoy: 0,
      totalSinAsignar: 0,
      pedidos: [],
      totalFiltro: 0,
      origenPorPedido: {},
      comunasCatalogo: [],
      sellers: [],
      conductores: [],
    };
  }

  const comunasCatalogo: ComunaOpcion[] = comunas
    .filter((c) => c.comuna !== null)
    .map((c) => ({ comuna: c.comuna as string, total: c.total }));

  const filtro: FiltroAsignables = {
    tenantId,
    fecha,
    comunas: comunasSeleccionadas.length > 0 ? comunasSeleccionadas : undefined,
    sellerId,
    texto: texto || null,
    estado,
  };

  const [{ pedidos, total: totalFiltro }, totalSinAsignar, sellers, conductoresRaw, cargaPorConductor] =
    await Promise.all([
      listarPedidosAsignables(cliente, filtro, { pagina, porPagina: PEDIDOS_POR_PAGINA }),
      contarAsignablesSinAsignar(cliente, { tenantId, fecha }),
      cargarSellers(cliente, tenantId),
      listarConductores(cliente, tenantId),
      // "Hoy" con el MISMO criterio de fecha que usa `asignacion.ts` para la
      // carga del selector de conductor: `fecha_compromiso`, no
      // `retirado_en` (ver la cabecera de ese archivo).
      obtenerCargaConductoresDelDia(cliente, { tenantId, fecha }),
    ]);

  // Enriquecimiento decorativo (chip de cuenta ML) — NO dentro del
  // `Promise.all` de arriba: no debe hacer más lento el camino crítico ni,
  // sobre todo, tumbar la carga si falla (ya se protege sola con su propio
  // try/catch, pero se separa también para que su latencia no bloquee el
  // resto).
  const origenPorPedido = await resolverOrigenPorPedido(cliente, tenantId, pedidos);

  const conductores: ConductorOpcion[] = conductoresRaw
    .filter((c) => c.estado === "activo")
    .map((c) => ({
      id: c.id,
      nombre: c.nombre,
      disponible: c.disponible,
      cargaHoy: cargaPorConductor.get(c.id) ?? 0,
    }))
    // Los disponibles primero (§6.3), y dentro de cada grupo, alfabético —
    // determinista para que la lista no "salte" entre renders.
    .sort((a, b) => {
      if (a.disponible !== b.disponible) return a.disponible ? -1 : 1;
      return a.nombre.localeCompare(b.nombre, "es");
    });

  return { totalRetiradosHoy, totalSinAsignar, pedidos, totalFiltro, origenPorPedido, comunasCatalogo, sellers, conductores };
}

export default async function PaginaAsignarPedidos({
  searchParams,
}: {
  searchParams: Promise<SearchParamsAsignar>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  const botonVolver = (
    <Link
      href="/preparacion"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      Volver a Preparación del día
    </Link>
  );

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return (
      <div className="space-y-6">
        {botonVolver}
        <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-3 px-6 py-14 text-center">
          <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">No tienes permiso para asignar pedidos</p>
            <p className="text-sm text-muted-foreground">
              Asignar pedidos es para el dueño, el supervisor y el coordinador de tráfico.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/preparacion">Volver a Preparación del día</Link>
          </Button>
        </div>
      </div>
    );
  }

  const tenantId = sesion.usuario.tenantId;
  const fecha = fechaLocalEnSantiago(new Date());
  const cliente = crearClienteServiceRole();
  const sp = await searchParams;

  const comunasSeleccionadas = normalizarComunas(sp.comuna);
  const sellerId = normalizarTexto(sp.seller);
  const texto = normalizarTexto(sp.q) ?? "";
  const estado = normalizarEstado(sp.estado);
  const pagina = normalizarPagina(sp.pagina);
  const conductorInicialId = normalizarTexto(sp.conductor);
  const hayFiltros = hayFiltrosActivos({ comunas: comunasSeleccionadas, sellerId, texto: texto || null, estado });

  // Sin JSX adentro del try — ver la nota de cabecera (react-hooks/error-boundaries).
  let resultado: { ok: true; datos: DatosBandeja } | { ok: false };
  try {
    const datos = await cargarDatosBandeja(cliente, {
      tenantId,
      fecha,
      comunasSeleccionadas,
      sellerId,
      texto,
      estado,
      pagina,
    });
    resultado = { ok: true, datos };
  } catch {
    resultado = { ok: false };
  }

  if (!resultado.ok) {
    return (
      <div className="space-y-6">
        {botonVolver}
        <div
          role="alert"
          className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
        >
          No pudimos cargar los pedidos para asignar. Intenta recargar la página.
        </div>
      </div>
    );
  }

  const datos = resultado.datos;

  return (
    <div className="space-y-6">
      {botonVolver}
      <BandejaAsignar
        tenantId={tenantId}
        totalRetiradosHoy={datos.totalRetiradosHoy}
        totalSinAsignar={datos.totalSinAsignar}
        pedidos={datos.pedidos}
        totalFiltro={datos.totalFiltro}
        pagina={pagina}
        porPagina={PEDIDOS_POR_PAGINA}
        origenPorPedido={datos.origenPorPedido}
        comunasCatalogo={datos.comunasCatalogo}
        comunasSeleccionadas={comunasSeleccionadas}
        sellers={datos.sellers}
        sellerId={sellerId}
        texto={texto}
        estado={estado}
        hayFiltros={hayFiltros}
        conductores={datos.conductores}
        conductorInicialId={conductorInicialId}
      />
    </div>
  );
}
