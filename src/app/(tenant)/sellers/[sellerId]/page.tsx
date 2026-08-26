import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { Retorno, destinoRetorno } from "@/components/app-shell/retorno";
import {
  BADGE_ESTADO_SELLER,
  BADGE_SALUD_CONEXION,
  BADGE_ESTADO_PERIODO,
  traducirEstadoSeller,
  traducirSaludConexion,
  traducirEstadoPeriodoCobro,
  type EstadoSaludConexion,
  type EstadoSeller,
} from "@/lib/ui/traduccion-estados";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { etiquetaPeriodo } from "@/modules/dinero/listado-periodos";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import type { Zona } from "@/modules/operacion/tipos";
import { VentanasCorteSeller } from "./ventanas-corte-seller";

export const metadata: Metadata = {
  title: "Ficha del seller",
};

/**
 * La ficha del seller.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * EL LISTADO ERA TERMINAL
 * -----------------------------------------------------------------------------
 * `sellers/page.tsx` no tenía un solo enlace a una ficha: las filas no navegaban
 * a ninguna parte. El seller es uno de los objetos centrales del dominio —tiene
 * pedidos, bodegas, tarifas, períodos de cobro y conexiones— y todo eso vivía
 * repartido en cinco pantallas que se filtran por seller, sin un lugar donde
 * verlo junto.
 *
 * -----------------------------------------------------------------------------
 * REÚNE, NO CALCULA
 * -----------------------------------------------------------------------------
 * Esta pantalla no introduce ninguna cifra nueva: cada bloque muestra lo que ya
 * está en la base y **enlaza a la pantalla que manda sobre ese dato**. Es
 * deliberado — una ficha que calcula sus propias versiones de las cifras es una
 * segunda aritmética que se desincroniza de la primera.
 *
 * Los conteos van con `head: true`: cuenta en la base y no trae filas.
 */
/**
 * El distintivo de una conexión, con la apagada separada de la caída.
 *
 * ⚠️ Recibe la fila cruda porque el id de quien la apagó se lee acá y **muere
 * acá**: hacia el marcado sale solo el distintivo ya resuelto.
 */
function badgeConexion(c: Record<string, unknown>): React.ComponentProps<typeof BadgeEstado> {
  if (c.desconectada_por_usuario_id != null) {
    return {
      variante: "neutral",
      eje: "conexion",
      valor: "desconectada_a_proposito",
      texto: "La desconectó el seller",
    };
  }
  const estado = c.estado_salud as EstadoSaludConexion;
  return {
    variante: BADGE_SALUD_CONEXION[estado] ?? "neutral",
    eje: "conexion",
    valor: estado as string,
    texto: traducirSaludConexion(estado as string),
  };
}

export default async function PaginaFichaSeller({
  params,
  searchParams,
}: {
  params: Promise<{ sellerId: string }>;
  searchParams: Promise<{ volver?: string }>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  const { sellerId } = await params;
  const { volver } = await searchParams;
  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();
  const hoy = hoyEnSantiago();

  const { data: seller } = await cliente
    .from("sellers")
    .select("id, razon_social, rut, estado, nombre_contacto, email_contacto, creado_en")
    .eq("id", sellerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!seller) notFound();

  const [conexionesMl, conexionesShopify, bodegas, tarifas, periodos, pedidosHoy, zonasActivas] =
    await Promise.all([
      // ⚠️ Las dos van por el esquema `identidad` y no por la vista de
      // `public`: `desconectada_por_usuario_id` NO está en las vistas a
      // propósito (es un id de usuario), y sin ella la ficha no puede
      // distinguir la cuenta que se cayó de la que el seller apagó. El id se
      // reduce a booleano unas líneas más abajo y nunca llega al navegador.
      cliente
        .schema("identidad")
        .from("conexiones_seller_ml")
        .select("id, alias, ml_nickname, estado_salud, ultima_sync_exitosa_en, desconectada_por_usuario_id")
        .eq("tenant_id", tenantId)
        .eq("seller_id", sellerId),
      // La tabla de Shopify es de agosto: si por lo que sea la lectura falla, la
      // ficha no se cae — se muestra sin esa fuente.
      Promise.resolve(
        cliente
          .schema("identidad")
          .from("conexiones_seller_shopify")
          // 🔴 Acá decía `dominio_tienda`, columna que NO EXISTE (es
          // `shop_domain`). PostgREST devolvía 400, el `.catch` de abajo lo
          // convertía en `data: null` y el bloque quedaba vacío: **el courier
          // nunca vio ni una tienda Shopify de ninguno de sus sellers**, sin un
          // solo error a la vista. El respaldo pensado para no tumbar la ficha
          // terminó escondiendo el fallo que debía sobrevivir.
          .select("id, shop_domain, estado_salud, ultima_sync_exitosa_en, desconectada_por_usuario_id")
          .eq("tenant_id", tenantId)
          .eq("seller_id", sellerId),
      ).catch(() => ({ data: null })),
      cliente
        .schema("identidad")
        .from("seller_bodegas")
        .select("id, nombre, direccion, comuna, activa")
        .eq("tenant_id", tenantId)
        .eq("seller_id", sellerId)
        .eq("activa", true),
      cliente
        .from("tarifas")
        .select("id, tipo_entrega, monto_clp, monto_conductor_clp, vigente_desde")
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
        .limit(5),
      cliente
        .from("pedidos")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("seller_id", sellerId)
        .eq("fecha_compromiso", hoy),
      // Las zonas activas del courier: las necesita el formulario de hora de
      // corte para poder fijar un plazo distinto por zona.
      cliente
        .schema("identidad")
        .from("zonas")
        .select("id, nombre, activa")
        .eq("tenant_id", tenantId)
        .eq("activa", true)
        .order("nombre"),
    ]);

  const filasMl = (conexionesMl.data ?? []) as Record<string, unknown>[];
  const filasShopify = (conexionesShopify?.data ?? []) as Record<string, unknown>[];
  const filasBodegas = (bodegas.data ?? []) as Record<string, unknown>[];
  const filasTarifas = (tarifas.data ?? []) as Record<string, unknown>[];
  const filasPeriodos = (periodos.data ?? []) as Record<string, unknown>[];
  const zonas = ((zonasActivas.data ?? []) as Record<string, unknown>[]).map((z) => ({
    id: z.id as string,
    nombre: z.nombre as string,
    activa: true,
  })) as Zona[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Retorno href={destinoRetorno("/sellers", volver)} etiqueta="Volver a sellers" />

      <div>
        <h1 className="font-heading text-2xl font-semibold">{seller.razon_social as string}</h1>
        <p className="rx-num mt-0.5 text-xs text-fg-muted">
          {seller.rut as string}
          {seller.nombre_contacto ? ` · ${seller.nombre_contacto as string}` : ""}
          {seller.email_contacto ? ` · ${seller.email_contacto as string}` : ""}
        </p>
        <div className="mt-2">
          <BadgeEstado
            variante={BADGE_ESTADO_SELLER[seller.estado as EstadoSeller] ?? "neutral"}
            eje="seller"
            valor={seller.estado as string}
            texto={traducirEstadoSeller(seller.estado as EstadoSeller)}
          />
        </div>
      </div>

      {/* --- Sus fuentes de pedidos --------------------------------------- */}
      <Bloque
        titulo="De dónde llegan sus pedidos"
        vacio="No tiene ninguna cuenta conectada: sus pedidos entran solo si los creas a mano."
        vacioSiNoHay={filasMl.length === 0 && filasShopify.length === 0}
      >
        <ul className="divide-y divide-line">
          {filasMl.map((c) => (
            <li key={c.id as string} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">
                  {(c.alias as string | null) ?? (c.ml_nickname as string | null) ?? "Cuenta de Mercado Libre"}
                </span>
                <span className="block text-xs text-fg-muted">Mercado Libre</span>
              </span>
              {/* La salud de CADA cuenta, no la de la primera. El listado
                  muestra una sola y pierde la del resto — acá es donde se ven
                  todas, que es para lo que se entra a la ficha.

                  🔴 Y se separa la apagada de la caída: las dos comparten
                  `desvinculada`, pero al courier le piden cosas distintas —
                  una es «llama a tu seller, se le venció el token» y la otra es
                  «tu seller lo apagó, no hay nada que arreglar». */}
              <BadgeEstado {...badgeConexion(c)} />
            </li>
          ))}
          {filasShopify.map((c) => (
            <li key={c.id as string} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-fg">
                  {c.shop_domain as string}
                </span>
                <span className="block text-xs text-fg-muted">Shopify</span>
              </span>
              <BadgeEstado {...badgeConexion(c)} />
            </li>
          ))}
        </ul>
      </Bloque>

      {/* --- Su operación de hoy ------------------------------------------ */}
      <Bloque
        titulo="Hoy"
        enlace={{ texto: "Ver sus pedidos", href: `/operaciones?seller=${sellerId}` }}
        vacio="Hoy no tiene ningún pedido."
        vacioSiNoHay={(pedidosHoy.count ?? 0) === 0}
      >
        <p className="rx-num text-2xl font-semibold text-fg">
          {pedidosHoy.count ?? 0}{" "}
          <span className="text-sm font-normal text-fg-muted">
            {pedidosHoy.count === 1 ? "pedido" : "pedidos"} con compromiso hoy
          </span>
        </p>
      </Bloque>

      {/* --- Sus bodegas --------------------------------------------------- */}
      <Bloque
        titulo="Dónde se retira"
        enlace={{ texto: "Administrar bodegas", href: "/configuracion/bodegas" }}
        vacio="No tiene bodegas registradas: el conductor no sabe adónde ir a retirar."
        vacioSiNoHay={filasBodegas.length === 0}
      >
        <ul className="divide-y divide-line">
          {filasBodegas.map((b) => (
            <li key={b.id as string} className="py-2">
              <span className="block text-sm font-medium text-fg">{b.nombre as string}</span>
              <span className="block text-xs text-fg-muted">
                {b.direccion as string}
                {b.comuna ? `, ${b.comuna as string}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Bloque>

      {/* --- Su tarifa ----------------------------------------------------- */}
      <Bloque
        titulo="Cuánto se le cobra"
        enlace={{ texto: "Ver tarifas", href: "/configuracion/tarifas" }}
        vacio="No tiene tarifa propia: se le aplica la del courier, si la hay. Sin ninguna, sus entregas se hacen y no se pueden cobrar."
        vacioSiNoHay={filasTarifas.length === 0}
      >
        <ul className="divide-y divide-line">
          {filasTarifas.map((t) => (
            <li key={t.id as string} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-fg">{t.tipo_entrega as string}</span>
              <span className="rx-num text-sm text-fg-muted">
                cobras {formatearCLPOGuion(Number(t.monto_clp))} · pagas{" "}
                {formatearCLPOGuion(
                  t.monto_conductor_clp === null ? null : Number(t.monto_conductor_clp),
                )}
              </span>
            </li>
          ))}
        </ul>
      </Bloque>

      {/* --- Su hora de corte ----------------------------------------------
          🔴 Vivía en `/configuracion/zonas`, detrás de un acordeón y un selector
          de seller. B3b: «la ventana de corte no es un destino de
          configuración: es un campo del seller, porque cada seller tiene el
          plazo que su courier le prometió». Acá el seller ya está elegido.

          Y NO es una preferencia de visualización: la hora de corte y el
          objetivo de SLA deciden si una entrega llegó a tiempo — de ahí sale el
          semáforo de cumplimiento y el cálculo de riesgo del día. */}
      <Bloque
        titulo="Su hora de corte"
        vacio=""
        vacioSiNoHay={false}
        enlace={{ texto: "Ver zonas", href: "/configuracion/zonas" }}
      >
        <VentanasCorteSeller sellerId={sellerId} zonas={zonas} />
      </Bloque>

      {/* --- Sus períodos -------------------------------------------------- */}
      <Bloque
        titulo="Sus últimos períodos"
        enlace={{ texto: "Ver todos", href: `/dinero/periodos?seller=${sellerId}` }}
        vacio="Todavía no tiene períodos de cobro. Se abren solos con su primera entrega."
        vacioSiNoHay={filasPeriodos.length === 0}
      >
        <ul className="divide-y divide-line">
          {filasPeriodos.map((p) => (
            <li key={p.id as string} className="flex items-center justify-between gap-3 py-2">
              <Link
                href={`/dinero/periodos/${p.id as string}`}
                className="rx-num text-sm hover:underline"
              >
                {etiquetaPeriodo(p.fecha_inicio as string, p.fecha_fin as string)}
              </Link>
              <span className="flex items-center gap-3">
                <span className="rx-num text-sm text-fg-muted">
                  {formatearCLPOGuion(
                    p.monto_total_clp === null ? null : Number(p.monto_total_clp),
                  )}
                </span>
                <BadgeEstado
                  variante={BADGE_ESTADO_PERIODO[p.estado as "abierto"] ?? "neutral"}
                  eje="periodo"
                  valor={p.estado as string}
                  texto={traducirEstadoPeriodoCobro(p.estado as "abierto")}
                />
              </span>
            </li>
          ))}
        </ul>
      </Bloque>
    </div>
  );
}

/**
 * Un bloque de la ficha.
 *
 * Cada uno declara su propio vacío **con la consecuencia escrita**: «no tiene
 * bodegas» no dice nada; «el conductor no sabe adónde ir a retirar» sí. Una
 * ficha llena de bloques que dicen «sin datos» es una ficha que no se lee.
 */
function Bloque({
  titulo,
  enlace,
  vacio,
  vacioSiNoHay,
  children,
}: {
  titulo: string;
  enlace?: { texto: string; href: string };
  vacio: string;
  vacioSiNoHay: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5 border-t border-line pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-medium tracking-[0.12em] text-fg-muted uppercase">
          {titulo}
        </h2>
        {enlace ? (
          <Link
            href={enlace.href}
            className="text-xs font-medium text-accent-text hover:underline"
          >
            {enlace.texto} ›
          </Link>
        ) : null}
      </div>
      {vacioSiNoHay ? (
        <p className="text-sm leading-relaxed text-fg-muted">{vacio}</p>
      ) : (
        children
      )}
    </section>
  );
}
