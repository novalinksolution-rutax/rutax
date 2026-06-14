/**
 * Centro de avisos in-app — agregador de alertas (UX_STRATEGY §6.6 / §A5).
 *
 * Reúne, del lado servidor, las alertas que el courier debe ver SIN tener que
 * entrar a cada pantalla: conexiones de Mercado Libre caídas, folios CAF por
 * agotarse e incidencias sin gestionar. Cada aviso es accionable (lleva su
 * destino) y está jerarquizado por urgencia.
 *
 * Decisión cerrada (P6): todo es in-app. Este módulo NUNCA dispara correos.
 *
 * Filtrado por capacidad: solo se incluyen avisos que el rol puede atender.
 * Lo que un rol no gestiona, no lo ve como aviso (coherente con la navegación).
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  puedeGestionarConfiguracionDte,
  puedeGestionarIncidencias,
  puedeAsignarYReasignarPedidos,
} from "@/modules/identidad/capacidades";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import {
  esIncidenciaSinGestion,
  UMBRAL_INCIDENCIA_SIN_GESTION_HORAS,
} from "@/lib/ui/traduccion-estados";

export type UrgenciaAviso = "urgente" | "importante" | "informativo";

export interface Aviso {
  id: string;
  urgencia: UrgenciaAviso;
  titulo: string;
  descripcion?: string;
  href: string;
  accion: string;
}

/** Orden de jerarquía para presentar lo más urgente primero. */
const PESO_URGENCIA: Record<UrgenciaAviso, number> = {
  urgente: 0,
  importante: 1,
  informativo: 2,
};

async function avisosConexionesCaidas(tenantId: string): Promise<Aviso[]> {
  try {
    const cliente = crearClienteServiceRole();
    const { data } = await cliente
      .schema("identidad")
      .from("conexiones_seller_ml")
      .select("id, sellers!conexiones_seller_ml_seller_id_fkey(razon_social)")
      .eq("tenant_id", tenantId)
      .eq("estado_salud", "desvinculada");

    const caidas = data ?? [];
    if (caidas.length === 0) return [];
    return [
      {
        id: "conexiones-caidas",
        urgencia: "urgente",
        titulo:
          caidas.length === 1
            ? "Una conexión de Mercado Libre está caída"
            : `${caidas.length} conexiones de Mercado Libre caídas`,
        descripcion: "Sus pedidos dejaron de llegar automáticamente.",
        href: "/sellers",
        accion: "Reconectar",
      },
    ];
  } catch {
    return [];
  }
}

async function avisosFoliosBajos(tenantId: string): Promise<Aviso[]> {
  try {
    const cliente = crearClienteServiceRole();
    const { data: folios } = await cliente
      .schema("identidad")
      .from("folios_caf")
      .select("folio_actual, folio_hasta")
      .eq("tenant_id", tenantId)
      .eq("estado", "vigente")
      .limit(1)
      .maybeSingle();

    if (!folios) return [];
    const restantes = (folios.folio_hasta as number) - (folios.folio_actual as number);
    if (restantes >= 50) return [];
    const agotado = restantes <= 0;
    return [
      {
        id: "folios-bajos",
        urgencia: "urgente",
        titulo: agotado
          ? "Sin folios CAF disponibles"
          : `Quedan ${restantes} folio${restantes !== 1 ? "s" : ""} CAF`,
        descripcion: agotado
          ? "La emisión de facturas está detenida hasta subir un nuevo CAF."
          : "Sube un nuevo CAF para no interrumpir la facturación.",
        href: "/onboarding/folios",
        accion: "Cargar folios",
      },
    ];
  } catch {
    return [];
  }
}

async function avisosIncidenciasSinGestion(tenantId: string): Promise<Aviso[]> {
  try {
    const cliente = crearClienteServiceRole();
    const { data } = await cliente
      .schema("operacion")
      .from("incidencias")
      .select("id, estado, abierta_en")
      .eq("tenant_id", tenantId)
      .eq("estado", "abierta")
      .order("abierta_en", { ascending: true })
      .limit(50);

    const sinGestion = (data ?? []).filter((inc) =>
      esIncidenciaSinGestion(inc.estado, inc.abierta_en as string),
    );
    if (sinGestion.length === 0) return [];
    return [
      {
        id: "incidencias-sin-gestion",
        urgencia: "importante",
        titulo:
          sinGestion.length === 1
            ? "1 incidencia sin gestionar"
            : `${sinGestion.length} incidencias sin gestionar`,
        descripcion: `Llevan más de ${UMBRAL_INCIDENCIA_SIN_GESTION_HORAS} horas abiertas.`,
        href: "/operaciones/incidencias?estado=abierta",
        accion: "Ver incidencias",
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Reúne los avisos in-app pertinentes al usuario, ordenados por urgencia.
 * Defensivo: cualquier fuente que falle se omite, nunca tumba el layout.
 */
export async function obtenerAvisos(
  tenantId: string,
  usuario: UsuarioActual,
): Promise<Aviso[]> {
  const tareas: Promise<Aviso[]>[] = [];

  if (puedeAsignarYReasignarPedidos(usuario) || puedeGestionarConfiguracionDte(usuario)) {
    tareas.push(avisosConexionesCaidas(tenantId));
  }
  if (puedeGestionarConfiguracionDte(usuario)) {
    tareas.push(avisosFoliosBajos(tenantId));
  }
  if (puedeGestionarIncidencias(usuario)) {
    tareas.push(avisosIncidenciasSinGestion(tenantId));
  }

  const resultados = await Promise.all(tareas);
  return resultados
    .flat()
    .sort((a, b) => PESO_URGENCIA[a.urgencia] - PESO_URGENCIA[b.urgencia]);
}
