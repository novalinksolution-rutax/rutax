import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  armarVistaPreviaSellerCourier,
  type VistaPreviaSellerCourier,
} from "@/modules/identidad/vista-previa-seller-courier";
import { etiquetaPeriodo } from "@/modules/dinero/listado-periodos";
import type { Zona } from "@/modules/operacion/tipos";

/**
 * La ficha del seller, entera, para el panel lateral.
 *
 * Antes eran dos vistas del mismo seller con datos distintos —la vista previa
 * del panel y la página `/sellers/[id]`—. Ahora es una sola: la del panel, que
 * suma a la vista previa lo que tenía la página (bodegas, tarifas, períodos,
 * hora de corte, acceso). La ruta vieja redirige acá.
 */
export interface FichaSeller extends VistaPreviaSellerCourier {
  puedeSincronizar: boolean;
  puedeInvitar: boolean;
  /** Hay una invitación viva que todavía se puede entregar a mano. */
  invitacionPendiente: boolean;
  pedidosHoy: number;
  /**
   * Las cuentas con la apagada separada de la caída: las dos son
   * `desvinculada`, pero una pide llamar al seller y la otra no pide nada.
   * El id de quien la apagó se reduce acá a booleano y nunca sale al navegador.
   */
  cuentas: {
    id: string;
    tipo: "ml" | "shopify";
    nombre: string;
    estadoSalud: string;
    apagadaPorSeller: boolean;
  }[];
  bodegas: { id: string; nombre: string; direccion: string; comuna: string | null }[];
  tarifas: { id: string; tipoEntrega: string; montoClp: number; montoConductorClp: number | null }[];
  periodos: { id: string; etiqueta: string; estado: string; montoClp: number | null }[];
  zonas: Zona[];
  /** `null` si nunca se registró por el enlace: no hay acceso que bloquear. */
  membresia: "activa" | "bloqueada" | null;
}

export async function cargarFichaSeller(
  cliente: SupabaseClient,
  tenantId: string,
  sellerId: string,
  hoyIso: string,
  permisos: { puedeSincronizar: boolean; puedeInvitar: boolean },
): Promise<FichaSeller | null> {
  const base = await armarVistaPreviaSellerCourier(cliente, tenantId, sellerId, hoyIso);
  if (!base) return null;

  const [ml, shopify, bodegas, tarifas, periodos, pedidosHoy, zonas, membresia, invitacion] = await Promise.all([
    // Por `identidad` y no por `public`: `desconectada_por_usuario_id` no está
    // en las vistas a propósito (ver la migración 20260826000002).
    cliente
      .schema("identidad")
      .from("conexiones_seller_ml")
      .select("id, alias, ml_nickname, estado_salud, desconectada_por_usuario_id")
      .eq("tenant_id", tenantId)
      .eq("seller_id", sellerId),
    Promise.resolve(
      cliente
        .schema("identidad")
        .from("conexiones_seller_shopify")
        .select("id, shop_domain, estado_salud, desconectada_por_usuario_id")
        .eq("tenant_id", tenantId)
        .eq("seller_id", sellerId),
    ).catch(() => ({ data: null })),
    cliente
      .schema("identidad")
      .from("seller_bodegas")
      .select("id, nombre, direccion, comuna")
      .eq("tenant_id", tenantId)
      .eq("seller_id", sellerId)
      .eq("activa", true),
    cliente
      .from("tarifas")
      .select("id, tipo_entrega, monto_clp, monto_conductor_clp")
      .eq("tenant_id", tenantId)
      .eq("seller_id", sellerId)
      .eq("estado", "activa"),
    cliente
      .schema("dinero")
      .from("periodos_cobro")
      .select("id, fecha_inicio, fecha_fin, estado, monto_total_clp")
      .eq("tenant_id", tenantId)
      .eq("seller_id", sellerId)
      .order("fecha_fin", { ascending: false })
      .limit(3),
    cliente
      .from("pedidos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("seller_id", sellerId)
      .eq("fecha_compromiso", hoyIso),
    cliente
      .schema("identidad")
      .from("zonas")
      .select("id, nombre, activa")
      .eq("tenant_id", tenantId)
      .eq("activa", true)
      .order("nombre"),
    cliente
      .schema("identidad")
      .from("seller_membresias")
      .select("estado")
      .eq("tenant_id", tenantId)
      .eq("seller_id", sellerId)
      .maybeSingle(),
    cliente
      .from("invitaciones")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("seller_id", sellerId)
      .eq("tipo_usuario", "seller")
      .eq("estado", "pendiente")
      .gt("expira_en", new Date().toISOString()),
  ]);

  type Fila = Record<string, unknown>;
  const cuentas: FichaSeller["cuentas"] = [
    ...((ml.data ?? []) as Fila[]).map((c) => ({
      id: c.id as string,
      tipo: "ml" as const,
      nombre: (c.alias as string | null) ?? (c.ml_nickname as string | null) ?? "Mercado Libre",
      estadoSalud: c.estado_salud as string,
      apagadaPorSeller: c.desconectada_por_usuario_id != null,
    })),
    ...((shopify.data ?? []) as Fila[]).map((c) => ({
      id: c.id as string,
      tipo: "shopify" as const,
      nombre: c.shop_domain as string,
      estadoSalud: c.estado_salud as string,
      apagadaPorSeller: c.desconectada_por_usuario_id != null,
    })),
  ];

  return {
    ...base,
    ...permisos,
    invitacionPendiente: (invitacion.count ?? 0) > 0,
    pedidosHoy: pedidosHoy.count ?? 0,
    cuentas,
    bodegas: ((bodegas.data ?? []) as Fila[]).map((b) => ({
      id: b.id as string,
      nombre: b.nombre as string,
      direccion: b.direccion as string,
      comuna: (b.comuna as string | null) ?? null,
    })),
    tarifas: ((tarifas.data ?? []) as Fila[]).map((t) => ({
      id: t.id as string,
      tipoEntrega: t.tipo_entrega as string,
      montoClp: Number(t.monto_clp),
      montoConductorClp: t.monto_conductor_clp === null ? null : Number(t.monto_conductor_clp),
    })),
    periodos: ((periodos.data ?? []) as Fila[]).map((p) => ({
      id: p.id as string,
      etiqueta: etiquetaPeriodo(p.fecha_inicio as string, p.fecha_fin as string),
      estado: p.estado as string,
      montoClp: p.monto_total_clp === null ? null : Number(p.monto_total_clp),
    })),
    zonas: ((zonas.data ?? []) as Fila[]).map((z) => ({
      id: z.id as string,
      nombre: z.nombre as string,
      activa: true,
    })) as Zona[],
    membresia: (membresia.data?.estado as "activa" | "bloqueada" | undefined) ?? null,
  };
}
