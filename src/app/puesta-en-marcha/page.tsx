import { redirect } from "next/navigation";
import { cerrarSesion } from "@/lib/identidad/cerrar-sesion";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { enmascararRut } from "@/lib/formato-cl";
import { formatearClp } from "@/lib/formato-cl";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import {
  leerEstadoPuestaEnMarcha,
  resolverPasoPermitido,
} from "@/modules/identidad/puesta-en-marcha";
import { Cierre, type RenglonCierre } from "./cierre";
import { MarcoPuestaEnMarcha } from "./marco";
import { PasoBodega } from "./paso-bodega";
import { PasoEmpresa } from "./paso-empresa";
import { PasoOperacion } from "./paso-operacion";
import { PasoTarifas } from "./paso-tarifas";
import { telefonoParaCampo } from "./telefono";
import { hidratarPaso4, plataformasEncendidas } from "./zonas-tarifas";
import type { FuentePedido } from "@/modules/operacion/tipos";

export const dynamic = "force-dynamic";

async function accionSalir() {
  "use server";
  await cerrarSesion("/login");
}

export default async function PaginaPuestaEnMarcha({
  searchParams,
}: {
  searchParams: Promise<{ paso?: string }>;
}) {
  const sesion = await obtenerSesionActual();
  // El layout ya validó sesión y rol; esto es solo para el tipo.
  if (!sesion?.usuario.tenantId) redirect("/login");
  const tenantId = sesion.usuario.tenantId;

  const cliente = crearClienteServiceRole();
  const estado = await leerEstadoPuestaEnMarcha(cliente, tenantId);
  if (estado.completada) redirect("/dashboard");

  const { paso: pedido } = await searchParams;
  const paso = resolverPasoPermitido(estado, pedido);
  // Retoma donde quedó: sin `?paso=`, el primer paso incompleto.
  if (pedido === undefined || pedido !== String(paso)) {
    redirect(`/puesta-en-marcha?paso=${paso}`);
  }

  const { data: tenant } = await cliente
    .schema("identidad")
    .from("tenants")
    .select("nombre_fantasia, rut, telefono_contacto, email_contacto")
    .eq("id", tenantId)
    .maybeSingle();
  const nombre = (tenant?.nombre_fantasia as string | null) ?? "";

  let contenido: React.ReactNode;

  if (paso === 1) {
    const rut = (tenant?.rut as string | null) ?? "";
    contenido = (
      <PasoEmpresa
        rutVisible={rut ? enmascararRut(rut) : ""}
        inicial={{
          nombre,
          telefono: telefonoParaCampo(tenant?.telefono_contacto as string | null),
          email: (tenant?.email_contacto as string | null) ?? sesion.email ?? "",
        }}
      />
    );
  } else if (paso === 2) {
    const { data: b } = await cliente
      .schema("identidad")
      .from("courier_bodegas")
      .select("direccion, comuna, lat, long, geo_estado")
      .eq("tenant_id", tenantId)
      .eq("activa", true)
      .eq("es_principal", true)
      .limit(1)
      .maybeSingle();
    const punto =
      b && b.geo_estado === "resuelto" && b.lat != null && b.long != null
        ? { lat: Number(b.lat), long: Number(b.long) }
        : null;
    contenido = (
      <PasoBodega
        inicial={{
          direccion: (b?.direccion as string | undefined) ?? "",
          comuna: (b?.comuna as string | undefined) ?? "",
          punto,
        }}
      />
    );
  } else if (paso === 3) {
    const { data: c } = await cliente
      .schema("identidad")
      .from("courier_config_operacion")
      .select("ofrece_flex, ofrece_shopify, hora_salida_reparto, hora_corte_reparto")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    contenido = (
      <PasoOperacion
        inicial={
          c
            ? {
                ofreceFlex: c.ofrece_flex as boolean,
                ofreceShopify: c.ofrece_shopify as boolean,
                salida: String(c.hora_salida_reparto).slice(0, 5),
                corte: String(c.hora_corte_reparto).slice(0, 5),
              }
            : null
        }
      />
    );
  } else if (paso === 4) {
    const [{ data: c }, { data: zonas }, { data: comunas }, { data: tarifas }] = await Promise.all([
      cliente
        .schema("identidad")
        .from("courier_config_operacion")
        .select("ofrece_flex, ofrece_shopify")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      cliente
        .schema("identidad")
        .from("zonas")
        .select("id, nombre, es_respaldo, creado_en")
        .eq("tenant_id", tenantId)
        .eq("activa", true),
      cliente.schema("identidad").from("zona_comunas").select("zona_id, comuna").eq("tenant_id", tenantId),
      // Solo las abiertas y de este paso: sin seller y sin régimen legado. Las
      // cerradas (vigente_hasta) son historia; si hay una nueva empezando mañana,
      // esa es la que se muestra.
      cliente
        .schema("identidad")
        .from("tarifas")
        .select("zona_id, fuente, monto_clp, monto_conductor_clp, vigente_desde")
        .eq("tenant_id", tenantId)
        .eq("estado", "activa")
        .is("seller_id", null)
        .is("tipo_entrega", null)
        .is("vigente_hasta", null)
        .order("vigente_desde", { ascending: false }),
    ]);
    const plataformas = plataformasEncendidas({
      ofreceFlex: c?.ofrece_flex === true,
      ofreceShopify: c?.ofrece_shopify === true,
    });
    // Ordenadas de la más reciente a la más antigua: `hidratarPaso4` toma la primera.
    const guardado = hidratarPaso4(
      {
        zonas: (zonas ?? []).map((z) => ({
          id: z.id as string,
          nombre: z.nombre as string,
          esRespaldo: z.es_respaldo === true,
          creadoEn: z.creado_en as string,
        })),
        comunas: (comunas ?? []).map((x) => ({ zonaId: x.zona_id as string, comuna: x.comuna as string })),
        tarifas: (tarifas ?? []).map((t) => ({
          zonaId: (t.zona_id as string | null) ?? null,
          fuente: (t.fuente as FuentePedido | null) ?? null,
          cobro: Number(t.monto_clp),
          pago: Number(t.monto_conductor_clp),
        })),
      },
      plataformas,
    );
    contenido = <PasoTarifas inicial={guardado} plataformas={plataformas} />;
  } else {
    const [{ data: b }, { data: c }, { data: t }, { data: zs }] = await Promise.all([
      cliente
        .schema("identidad")
        .from("courier_bodegas")
        .select("direccion, comuna")
        .eq("tenant_id", tenantId)
        .eq("activa", true)
        .eq("es_principal", true)
        .limit(1)
        .maybeSingle(),
      cliente
        .schema("identidad")
        .from("courier_config_operacion")
        .select("ofrece_flex, ofrece_shopify, hora_salida_reparto, hora_corte_reparto")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      cliente
        .schema("identidad")
        // El resumen muestra el cobro de cada ZONA, no la tarifa general: esa es
        // la red de seguridad oculta (lleva los montos del respaldo) y mostrarla
        // sola hacía creer que había un único precio.
        .from("tarifas")
        .select("monto_clp, zona_id")
        .eq("tenant_id", tenantId)
        .eq("estado", "activa")
        .is("seller_id", null)
        .is("fuente", null)
        .is("tipo_entrega", null)
        .not("zona_id", "is", null)
        .order("vigente_desde", { ascending: false }),
      cliente
        .schema("identidad")
        .from("zonas")
        .select("id, nombre, es_respaldo")
        .eq("tenant_id", tenantId)
        .eq("activa", true),
    ]);
    const servicios = [
      "Pedidos propios",
      ...(c?.ofrece_flex ? [etiquetaFuentePedido("ml_flex")] : []),
      ...(c?.ofrece_shopify ? [etiquetaFuentePedido("shopify")] : []),
    ].join(" · ");
    const renglones: RenglonCierre[] = [
      { etiqueta: "Bodega", valor: `${b?.direccion ?? ""}, ${b?.comuna ?? ""}`, paso: 2 },
      { etiqueta: "Servicios", valor: servicios, paso: 3 },
      {
        etiqueta: "Horario",
        valor: c
          ? `${String(c.hora_salida_reparto).slice(0, 5)} a ${String(c.hora_corte_reparto).slice(0, 5)}`
          : "",
        paso: 3,
      },
      {
        etiqueta: "Tarifas",
        valor: resumenTarifasPorZona(t ?? [], zs ?? []),
        paso: 4,
      },
    ];
    contenido = <Cierre nombre={nombre} renglones={renglones} />;
  }

  return (
    <MarcoPuestaEnMarcha paso={paso} ancho={paso === 4 ? "ancho" : "estrecho"} accionSalir={accionSalir}>
      {contenido}
    </MarcoPuestaEnMarcha>
  );
}

/** «Gran Santiago urbano $3.500 · Periferia $4.000»: una tarifa vigente por zona, la de respaldo al final. */
function resumenTarifasPorZona(
  filas: { monto_clp: number | string | null; zona_id: string | null }[],
  zonas: { id: string; nombre: string; es_respaldo: boolean | null }[],
): string {
  const zonaPorId = new Map(zonas.map((z) => [z.id, z]));
  const porZona = new Map<string, { nombre: string; monto: number; respaldo: boolean }>();
  for (const fila of filas) {
    const zona = fila.zona_id ? zonaPorId.get(fila.zona_id) : undefined;
    // Vienen ordenadas por vigencia descendente: la primera de cada zona es la vigente.
    if (!zona || porZona.has(zona.id) || fila.monto_clp == null) continue;
    porZona.set(zona.id, { nombre: zona.nombre, monto: Number(fila.monto_clp), respaldo: zona.es_respaldo === true });
  }
  return [...porZona.values()]
    .sort((a, b) => Number(a.respaldo) - Number(b.respaldo))
    .map((z) => `${z.nombre} ${formatearClp(z.monto)}`)
    .join(" · ");
}
