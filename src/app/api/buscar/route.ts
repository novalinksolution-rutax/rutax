/**
 * Buscador global (⌘K) — endpoint del type-ahead.
 * =====================================================================
 * BORDE DE SEGURIDAD del buscador. Toda consulta se acota al `tenant_id` de la
 * sesión y cada tipo de resultado se habilita según la capacidad RBAC del rol
 * (mismo criterio que la navegación del AppShell). El cliente NUNCA decide qué
 * puede buscar: lo decide este handler a partir de la sesión.
 *
 * Devuelve grupos (pedidos, sellers, conductores) con destino navegable. Las
 * liquidaciones se dejan para una iteración aparte (no tienen una identidad de
 * texto directa; se alcanzan desde el conductor).
 */

import type { NextRequest } from "next/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  puedeAsignarYReasignarPedidos,
  puedeAjustarOperacionDiaria,
  puedeGestionarIncidencias,
  puedeGenerarManifiestos,
} from "@/modules/identidad/capacidades";
import { traducirEstadoPedido } from "@/lib/ui/traduccion-estados";
import type { EstadoPedido } from "@/modules/operacion/tipos";
import type { GrupoResultado, RespuestaBusqueda } from "@/lib/buscar/tipos";

export const runtime = "nodejs";

const LIMITE_POR_TIPO = 6;

/**
 * Deja el término apto para `ilike`/`.or()` de PostgREST: quita los caracteres
 * que rompen el parser del filtro (`,` `.` `(` `)`) y los comodines (`%` `_`),
 * colapsa espacios y acota el largo. Evita inyección en el filtro y comodines
 * accidentales.
 */
function sanitizar(q: string): string {
  return q
    .replace(/[,.()%_*\\"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

const VACIA: RespuestaBusqueda = { grupos: [] };

export async function GET(req: NextRequest): Promise<Response> {
  const sesion = await obtenerSesionActual();
  if (!sesion || !sesion.usuario.tenantId || sesion.usuario.tipoUsuario !== "interno") {
    return Response.json(VACIA);
  }

  const q = sanitizar(req.nextUrl.searchParams.get("q") ?? "");
  if (q.length < 2) return Response.json(VACIA);

  const tenantId = sesion.usuario.tenantId;
  const u = sesion.usuario;
  const patron = `%${q}%`;
  const cliente = crearClienteServiceRole();

  const puedeVerOperacion =
    puedeAsignarYReasignarPedidos(u) ||
    puedeAjustarOperacionDiaria(u) ||
    puedeGestionarIncidencias(u) ||
    puedeGenerarManifiestos(u);
  const puedeVerConductores = puedeAsignarYReasignarPedidos(u);

  const grupos: GrupoResultado[] = [];
  const tareas: Promise<void>[] = [];

  if (puedeVerOperacion) {
    tareas.push(
      (async () => {
        const { data } = await cliente
          .schema("operacion")
          .from("pedidos")
          .select("id, destinatario_nombre, destinatario_comuna, estado, codigo_interno")
          .eq("tenant_id", tenantId)
          .or(
            `destinatario_nombre.ilike.${patron},destinatario_direccion.ilike.${patron},ml_order_id.ilike.${patron},codigo_interno.ilike.${patron}`,
          )
          .order("creado_en", { ascending: false })
          .limit(LIMITE_POR_TIPO);

        const items = ((data ?? []) as Array<{
          id: string;
          destinatario_nombre: string;
          destinatario_comuna: string | null;
          estado: EstadoPedido;
          codigo_interno: string | null;
        }>).map((p) => ({
          id: p.id,
          titulo: p.destinatario_nombre,
          subtitulo: [traducirEstadoPedido(p.estado), p.destinatario_comuna, p.codigo_interno]
            .filter(Boolean)
            .join(" · "),
          href: `/operaciones/${p.id}`,
        }));
        if (items.length > 0) grupos.push({ tipo: "pedido", titulo: "Pedidos", items });
      })(),
    );
  }

  // Sellers — todos los roles internos ven la sección Sellers.
  tareas.push(
    (async () => {
      const { data } = await cliente
        .from("sellers")
        .select("id, razon_social")
        .eq("tenant_id", tenantId)
        .ilike("razon_social", patron)
        .order("razon_social")
        .limit(LIMITE_POR_TIPO);

      const items = ((data ?? []) as Array<{ id: string; razon_social: string }>).map((s) => ({
        id: s.id,
        titulo: s.razon_social,
        subtitulo: "Ver sus pedidos",
        href: `/operaciones?seller=${s.id}`,
      }));
      if (items.length > 0) grupos.push({ tipo: "seller", titulo: "Sellers", items });
    })(),
  );

  if (puedeVerConductores) {
    tareas.push(
      (async () => {
        const { data } = await cliente
          .schema("identidad")
          .from("conductores")
          .select("id, nombre_completo")
          .eq("tenant_id", tenantId)
          .ilike("nombre_completo", patron)
          .order("nombre_completo")
          .limit(LIMITE_POR_TIPO);

        const items = ((data ?? []) as Array<{ id: string; nombre_completo: string }>).map((c) => ({
          id: c.id,
          titulo: c.nombre_completo,
          subtitulo: "Ver conductor",
          href: `/conductores/${c.id}`,
        }));
        if (items.length > 0) grupos.push({ tipo: "conductor", titulo: "Conductores", items });
      })(),
    );
  }

  await Promise.all(tareas);

  // Orden estable de grupos: pedidos, sellers, conductores.
  const orden: Record<GrupoResultado["tipo"], number> = { pedido: 0, seller: 1, conductor: 2 };
  grupos.sort((a, b) => orden[a.tipo] - orden[b.tipo]);

  return Response.json({ grupos } satisfies RespuestaBusqueda);
}
