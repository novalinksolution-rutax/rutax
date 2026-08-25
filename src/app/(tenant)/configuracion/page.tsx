import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  puedeGestionarTarifas,
  puedeGestionarBodegas,
  puedeGestionarContactosWhatsApp,
  puedeGestionarUsuariosYRoles,
  puedeVerBitacoraAuditoria,
  puedeGestionarSuscripcion,
} from "@/modules/identidad/capacidades";

export const metadata: Metadata = {
  title: "Configuración",
};

/**
 * `/configuracion` — el índice, que hasta hoy era una redirección.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ ERA
 * -----------------------------------------------------------------------------
 * Un `redirect("/onboarding")` con un comentario que se declaraba provisional y
 * anticipaba este bloque: «cuando exista el índice, este archivo pasa a
 * renderizarlo». Antes de eso era directamente la 404 del framework, en inglés
 * y sin marca, para quien borrara el último segmento de la URL.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ UN ÍNDICE Y NO OTRA REDIRECCIÓN
 * -----------------------------------------------------------------------------
 * La sub-navegación lateral ya lista las secciones, pero **no dice cómo está
 * cada una**. La pregunta que trae a alguien acá no es «dónde están las
 * tarifas»: es «qué me falta configurar». Cada renglón lleva su dato real —«3
 * tarifas activas», «sin banco conectado»— para poder responderla sin entrar a
 * las nueve.
 *
 * -----------------------------------------------------------------------------
 * LOS CONTEOS SON DE SOLO LECTURA Y TOLERAN EL FALLO
 * -----------------------------------------------------------------------------
 * Si una lectura falla, ese renglón se queda sin su línea de estado y el resto
 * del índice sigue en pie. Una pantalla de navegación que se cae entera porque
 * no pudo contar bodegas deja al courier sin entrada a su configuración.
 */
export default async function ConfiguracionIndex() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  const u = sesion.usuario;
  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  const contar = async (tabla: string, esquema: string, filtros: Record<string, unknown> = {}) => {
    try {
      let q = cliente
        .schema(esquema)
        .from(tabla)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      for (const [k, v] of Object.entries(filtros)) q = q.eq(k, v);
      const { count, error } = await q;
      return error ? null : (count ?? 0);
    } catch {
      return null;
    }
  };

  /**
   * Un conteo con filtro libre, tolerante al fallo.
   *
   * ⚠️ El `ajustar` va tipado como `any` a propósito y con su regla apagada:
   * el builder de PostgREST cambia de tipo en cada `.eq()` encadenado, así que
   * escribir la firma exacta obliga a copiar un genérico de seis parámetros
   * que no aporta nada — lo que importa acá es que el fallo devuelva `null` y
   * no un cero, y eso sí está tipado en el retorno.
   */
  const contarCrudo = async (
    tabla: string,
    esquema: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ajustar: (q: any) => any,
  ): Promise<number | null> => {
    try {
      const base = cliente.schema(esquema).from(tabla).select("id", { count: "exact", head: true });
      const { count, error } = await ajustar(base);
      return error ? null : (count ?? 0);
    } catch {
      return null;
    }
  };

  const [
    tarifas,
    zonas,
    bodegas,
    equipo,
    cobranza,
    comunasAsignadas,
    bodegasSinUbicar,
    invitacionesPendientes,
  ] = await Promise.all([
    contar("tarifas", "identidad", { estado: "activa" }),
    contar("zonas", "identidad", { activa: true }),
    contar("courier_bodegas", "identidad", { activa: true }),
    // ⚠️ La tabla es `usuarios_perfil`, no `usuarios`. Y el conteo va acotado a
    // `tipo_usuario = 'interno'`: en esa tabla conviven también los perfiles de
    // seller y de conductor, que no son «personas con acceso a la
    // configuración» y harían que el renglón contara gente de más.
    contar("usuarios_perfil", "identidad", { estado: "activo", tipo_usuario: "interno" }),
    Promise.resolve(
      cliente
        .schema("identidad")
        .from("courier_config_cobranza")
        .select("cuenta_banco_alias, link_token_ref")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    )
      .then((r) => r.data)
      .catch(() => null),
    // Las comunas ya asignadas: lo que importa es cuántas quedan HUÉRFANAS, y
    // una comuna sin zona no falla —cae en la tarifa por defecto y se cobra
    // igual, en silencio— así que el número tiene que estar a la vista.
    contarCrudo("zona_comunas", "identidad", (q) => q.eq("tenant_id", tenantId)),
    contarCrudo("courier_bodegas", "identidad", (q) =>
      q.eq("tenant_id", tenantId).eq("activa", true).neq("geo_estado", "resuelto"),
    ),
    contarCrudo("invitaciones", "identidad", (q) =>
      q.eq("tenant_id", tenantId).eq("estado", "pendiente"),
    ),
  ]);

  /** El total de comunas de la Región Metropolitana. */
  const COMUNAS_RM_TOTAL = 52;
  const comunasSinZona =
    comunasAsignadas === null ? null : Math.max(0, COMUNAS_RM_TOTAL - comunasAsignadas);

  /**
   * 🔴 Cada destino trae su estado en la segunda línea, **y los que necesitan
   * atención lo dicen en ámbar**.
   *
   * En 1440 esta información no cabe en la navegación lateral y no hace falta
   * —el listado está al lado—, pero en teléfono **la lista ES la pantalla**, así
   * que tiene que decir dónde hay que entrar. Un renglón que dice «Claves de API
   * y webhooks para conectar tus sistemas» describe la sección; «6 comunas sin
   * zona» dice qué hacer.
   */
  const secciones: {
    href: string;
    titulo: string;
    estado: string | null;
    /** Ámbar: hay algo que resolver ahí adentro. */
    alerta?: boolean;
    visible: boolean;
  }[] = [
    {
      href: "/onboarding",
      titulo: "Puesta en marcha",
      estado: "El estado de tu activación, paso por paso.",
      visible: true,
    },
    {
      href: "/configuracion/tarifas",
      titulo: "Tarifas",
      estado:
        tarifas === null
          ? null
          : tarifas > 0
            ? `${tarifas} ${tarifas === 1 ? "tarifa activa" : "tarifas activas"}.`
            : "Sin tarifas. Una entrega sin tarifa se hace y no se puede cobrar.",
      alerta: tarifas === 0,
      visible: puedeGestionarTarifas(u),
    },
    {
      href: "/configuracion/api",
      titulo: "Integraciones",
      estado: "Claves de API y avisos hacia tus propios sistemas.",
      visible: puedeGestionarTarifas(u),
    },
    {
      href: "/configuracion/zonas",
      titulo: "Zonas",
      estado:
        zonas === null
          ? null
          : zonas === 0
            ? "Sin zonas. Los pedidos no se agrupan por sector."
            : comunasSinZona !== null && comunasSinZona > 0
              ? `${comunasSinZona} ${comunasSinZona === 1 ? "comuna sin zona" : "comunas sin zona"}.`
              : `${zonas} ${zonas === 1 ? "zona activa" : "zonas activas"}. Todas las comunas cubiertas.`,
      alerta: zonas === 0 || (comunasSinZona !== null && comunasSinZona > 0),
      visible: puedeGestionarTarifas(u),
    },
    {
      href: "/configuracion/retiro",
      titulo: "Retiro",
      estado: "Cuánto se le paga al conductor por cada visita a bodega.",
      visible: puedeGestionarTarifas(u),
    },
    {
      href: "/configuracion/bodegas",
      titulo: "Bodegas",
      estado:
        bodegas === null
          ? null
          : bodegas > 0
            ? bodegasSinUbicar !== null && bodegasSinUbicar > 0
              ? `${bodegasSinUbicar} sin ubicar. Sin coordenada no entra en ninguna ruta.`
              : `${bodegas} ${bodegas === 1 ? "bodega propia" : "bodegas propias"}. De ahí sale toda ruta.`
            : "Sin bodega propia. Sin ella no se puede calcular una ruta.",
      alerta: bodegas === 0 || (bodegasSinUbicar !== null && bodegasSinUbicar > 0),
      visible: puedeGestionarBodegas(u),
    },
    {
      href: "/configuracion/whatsapp",
      titulo: "Contactos de WhatsApp",
      estado: "A quién le avisa Rutax por WhatsApp. Sin contactos, los avisos no salen.",
      visible: puedeGestionarContactosWhatsApp(u),
    },
    {
      href: "/equipo",
      titulo: "Equipo",
      estado:
        equipo === null
          ? null
          : `${equipo} ${equipo === 1 ? "persona" : "personas"}${
              invitacionesPendientes
                ? ` · ${invitacionesPendientes} ${invitacionesPendientes === 1 ? "invitada" : "invitadas"}`
                : ""
            }.`,
      visible: puedeGestionarUsuariosYRoles(u),
    },
    {
      href: "/configuracion/exportar-datos",
      titulo: "Exportar datos",
      estado: "Llévate todo lo tuyo, cuando quieras.",
      visible: puedeVerBitacoraAuditoria(u),
    },
    {
      href: "/configuracion/plan",
      titulo: "Mi plan",
      estado: "Lo que le pagas a Rutax, aparte de lo que tú le cobras a tus sellers.",
      visible: puedeGestionarSuscripcion(u),
    },
  ];

  const bancoConectado = Boolean(cobranza?.link_token_ref);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Configuración</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Cómo está armado tu courier. Cada sección dice cómo la tienes hoy.
        </p>
      </div>

      {/* La cobranza no tiene sección propia bajo `/configuracion` —vive dentro
          de la puesta en marcha— pero es lo que más se pregunta acá, así que se
          declara arriba en vez de esconderse un nivel adentro. */}
      {!bancoConectado ? (
        <p className="border border-attention-line bg-attention-bg px-4 py-3 text-sm leading-relaxed text-attention-fg">
          No tienes banco conectado: los pagos de tus sellers los estás conciliando a mano.{" "}
          <Link href="/onboarding?paso=cobranza" className="font-medium underline">
            Conectarlo ›
          </Link>
        </p>
      ) : null}

      <ul className="divide-y divide-line border border-line">
        {secciones
          .filter((s) => s.visible)
          .map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                // 56 px en táctil: en teléfono esta lista ES la pantalla y cada renglón
                // es un destino, no un renglón de tabla.
                className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-bg-sunken pointer-coarse:min-h-14"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-fg">{s.titulo}</span>
                  {/* Sin dato no se inventa uno: el renglón se queda con su
                      nombre y sigue llevando a su sección. */}
                  {/* 🔴 El estado que necesita atención va en ámbar. En 1440
                      no cabe en la navegación lateral y no hace falta —el
                      listado está al lado—, pero en teléfono la lista ES la
                      pantalla y tiene que decir dónde hay que entrar. */}
                  {s.estado ? (
                    <span
                      className={
                        s.alerta
                          ? "block text-sm leading-snug font-medium text-attention-fg"
                          : "block text-sm leading-snug text-fg-muted"
                      }
                    >
                      {s.estado}
                    </span>
                  ) : (
                    <span className="block text-sm leading-snug text-fg-subtle">
                      No se pudo leer su estado.
                    </span>
                  )}
                </span>
                <ChevronRight className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
      </ul>
    </div>
  );
}
