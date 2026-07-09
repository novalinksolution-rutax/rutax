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
  puedeVerReportesEjecutivos,
  puedeVerConciliacion,
} from "@/modules/identidad/capacidades";
import { UMBRAL_FOLIOS } from "@/modules/dinero/folios";
import { ESTADOS_NO_TERMINALES_CONCILIACION } from "@/modules/dinero/conciliacion-clasificacion";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { ahoraEnSantiago, horaAMinutos } from "@/lib/fecha-santiago";
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
    if (restantes >= UMBRAL_FOLIOS) return [];
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

/** Minutos antes del corte en que se activa el aviso. */
const UMBRAL_CORTE_MINUTOS = 45;

async function avisosCorteProximo(tenantId: string): Promise<Aviso[]> {
  try {
    const cliente = crearClienteServiceRole();
    const { fecha: fechaHoy, hora: horaActual } = ahoraEnSantiago();
    const minutosActual = horaAMinutos(horaActual);

    const [ventanasRes, pedidosRes, sellersRes] = await Promise.all([
      cliente
        .schema("identidad")
        .from("ventanas_corte")
        .select("seller_id, hora_corte")
        .eq("tenant_id", tenantId)
        .is("zona_id", null)
        .eq("activa", true),
      cliente
        .schema("operacion")
        .from("pedidos")
        .select("seller_id")
        .eq("tenant_id", tenantId)
        .eq("tipo_pedido", "same_day")
        .eq("fecha_compromiso", fechaHoy)
        .in("estado", ["pendiente_asignacion", "asignado", "en_ruta"]),
      cliente
        .schema("identidad")
        .from("sellers")
        .select("id, nombre_empresa")
        .eq("tenant_id", tenantId),
    ]);

    const ventanas = ventanasRes.data ?? [];
    const pedidos = pedidosRes.data ?? [];
    const sellers = sellersRes.data ?? [];

    if (ventanas.length === 0 || pedidos.length === 0) return [];

    const mapaNombre = new Map<string, string>();
    for (const s of sellers) {
      mapaNombre.set(s.id as string, (s.nombre_empresa as string) ?? "Seller");
    }

    const mapaPendientes = new Map<string, number>();
    for (const p of pedidos) {
      const sid = p.seller_id as string;
      mapaPendientes.set(sid, (mapaPendientes.get(sid) ?? 0) + 1);
    }

    const avisos: Aviso[] = [];
    for (const v of ventanas) {
      const sid = v.seller_id as string;
      const pendientes = mapaPendientes.get(sid) ?? 0;
      if (pendientes === 0) continue;

      const horaCorte = ((v.hora_corte as string) ?? "").slice(0, 5);
      const minutosCorte = horaAMinutos(horaCorte);
      const minutosRestantes = minutosCorte - minutosActual;

      if (minutosRestantes <= 0 || minutosRestantes > UMBRAL_CORTE_MINUTOS) continue;

      const nombre = mapaNombre.get(sid) ?? "un seller";
      avisos.push({
        id: `corte-proximo-${sid}`,
        urgencia: minutosRestantes <= 15 ? "urgente" : "importante",
        titulo: `Corte de ${nombre} en ${minutosRestantes} min`,
        descripcion: `${pendientes} pedido${pendientes !== 1 ? "s" : ""} pendiente${pendientes !== 1 ? "s" : ""} de entregar.`,
        href: `/operaciones?sellerId=${sid}&estado=pendiente_asignacion`,
        accion: "Ver pedidos",
      });
    }

    return avisos;
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
 * Discrepancias de conciliación sin revisar — hallazgos del detective C7
 * (`conciliar-tres-fuentes`). El motor los escribe en `eventos_conciliacion`;
 * este aviso los saca a la superficie para que dueño/administración no tengan
 * que entrar a la pantalla de Conciliación para enterarse (auditoría §2.7/QW6:
 * exponer la verificación de integridad como alerta, no dejarla silenciosa).
 */
async function avisosDiscrepanciasConciliacion(tenantId: string): Promise<Aviso[]> {
  try {
    const cliente = crearClienteServiceRole();
    const { data } = await cliente
      .schema("dinero")
      .from("eventos_conciliacion")
      .select("id, monto_diferencia_clp")
      .eq("tenant_id", tenantId)
      .eq("estado", "pendiente")
      .limit(200);

    const pendientes = data ?? [];
    if (pendientes.length === 0) return [];

    const montoEnJuego = pendientes.reduce(
      (acc, e) => acc + Math.abs(Number(e.monto_diferencia_clp ?? 0)),
      0,
    );

    return [
      {
        id: "discrepancias-conciliacion",
        urgencia: "importante",
        titulo:
          pendientes.length === 1
            ? "1 discrepancia de conciliación sin revisar"
            : `${pendientes.length} discrepancias de conciliación sin revisar`,
        descripcion:
          montoEnJuego > 0
            ? `Diferencias por ${formatearCLP(montoEnJuego)} en el cruce cobro–liquidación.`
            : "El cruce automático de cobro y liquidación detectó diferencias.",
        href: "/dinero/conciliacion",
        accion: "Revisar",
      },
    ];
  } catch {
    return [];
  }
}

/** Días de anticipación con que se avisa un SLA de excepción por vencer. */
const UMBRAL_EXCEPCION_DIAS = 2;

/** Suma `dias` días de calendario a una fecha 'YYYY-MM-DD' (date-only, sin problemas de DST). */
function sumarDiasFecha(fechaIso: string, dias: number): string {
  const fecha = new Date(`${fechaIso}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/**
 * Excepciones de conciliación asignadas al usuario actual cuya `fecha_limite`
 * (SLA — §1.1 P1) está vencida o a ≤2 días. El motor C7/C6 (`eventos_conciliacion`)
 * las categoriza y les fija SLA por defecto al detectarlas; este aviso saca a
 * la superficie las que el propio usuario tiene bajo su responsabilidad, sin
 * que tenga que entrar a la bandeja de conciliación a revisarlas una por una.
 */
async function avisosExcepcionesVencidas(tenantId: string, usuarioId: string): Promise<Aviso[]> {
  try {
    const cliente = crearClienteServiceRole();
    const { fecha: hoy } = ahoraEnSantiago();
    const limite = sumarDiasFecha(hoy, UMBRAL_EXCEPCION_DIAS);

    const { data } = await cliente
      .schema("dinero")
      .from("eventos_conciliacion")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("asignado_a_usuario_id", usuarioId)
      .in("estado", ESTADOS_NO_TERMINALES_CONCILIACION)
      .not("fecha_limite", "is", null)
      .lte("fecha_limite", limite)
      .limit(200);

    const vencidas = data ?? [];
    if (vencidas.length === 0) return [];

    return [
      {
        id: "excepciones-vencidas",
        urgencia: "urgente",
        titulo:
          vencidas.length === 1
            ? "1 excepción asignada vence pronto"
            : `${vencidas.length} excepciones asignadas vencen pronto`,
        descripcion: "Tienen fecha límite vencida o a menos de 2 días.",
        href: "/dinero/conciliacion",
        accion: "Revisar",
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Reúne los avisos in-app pertinentes al usuario, ordenados por urgencia.
 * Defensivo: cualquier fuente que falle se omite, nunca tumba el layout.
 *
 * `usuarioId` (UUID de auth — `sesion.usuarioId`) es necesario para los avisos
 * que dependen de "lo mío" (excepciones asignadas a este usuario), no solo de
 * su rol/tenant — `UsuarioActual` no lleva su propio id.
 */
export async function obtenerAvisos(
  tenantId: string,
  usuario: UsuarioActual,
  usuarioId: string,
): Promise<Aviso[]> {
  const tareas: Promise<Aviso[]>[] = [];

  if (puedeAsignarYReasignarPedidos(usuario) || puedeGestionarConfiguracionDte(usuario)) {
    tareas.push(avisosConexionesCaidas(tenantId));
  }
  if (puedeAsignarYReasignarPedidos(usuario) || puedeVerReportesEjecutivos(usuario)) {
    tareas.push(avisosCorteProximo(tenantId));
  }
  if (puedeGestionarConfiguracionDte(usuario)) {
    tareas.push(avisosFoliosBajos(tenantId));
  }
  if (puedeGestionarIncidencias(usuario)) {
    tareas.push(avisosIncidenciasSinGestion(tenantId));
  }
  if (puedeVerConciliacion(usuario)) {
    tareas.push(avisosDiscrepanciasConciliacion(tenantId));
    tareas.push(avisosExcepcionesVencidas(tenantId, usuarioId));
  }

  const resultados = await Promise.all(tareas);
  return resultados
    .flat()
    .sort((a, b) => PESO_URGENCIA[a.urgencia] - PESO_URGENCIA[b.urgencia]);
}
