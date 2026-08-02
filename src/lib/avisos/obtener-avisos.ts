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
  puedeGestionarSuscripcion,
} from "@/modules/identidad/capacidades";
import { verificarLimite } from "@/modules/plataforma/enforcement";
import { obtenerComunicacionesActivasParaCourier } from "@/modules/plataforma/comunicaciones";
import { UMBRAL_FOLIOS } from "@/modules/dinero/folios";
import { ESTADOS_NO_TERMINALES_CONCILIACION } from "@/modules/dinero/conciliacion-clasificacion";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { ahoraEnSantiago, horaAMinutos, sumarDiasCalendario } from "@/lib/fecha-santiago";
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
        descripcion: "Tus pedidos dejaron de llegar automáticamente.",
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
    const limite = sumarDiasCalendario(hoy, UMBRAL_EXCEPCION_DIAS);

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

/** Umbrales de consumo del plan (% del límite) que disparan el banner. */
const UMBRAL_CONSUMO_MEDIO_PCT = 80;
const UMBRAL_CONSUMO_ALTO_PCT = 100;

/**
 * Consumo del plan de Rutax (backstage `plataforma`, F2 "Ola 1", ítem banner
 * G) — DISTINTO de los avisos operativos de arriba: esto es Rutax avisándole
 * al DUEÑO del courier que se está acercando al límite de SU PROPIO plan
 * (pedidos/mes, y opcionalmente conductores), no algo sobre sus sellers.
 * Gateado en `puedeGestionarSuscripcion` (dueño) — la relación comercial con
 * Rutax es del dueño, mismo gate que el resto de `configuracion/plan`.
 *
 * Reusa `verificarLimite` (enforcement.ts) — que es SIEMPRE informativo para
 * `pedidos_mes` (nunca bloquea la operación en marcha, CLAUDE.md); este aviso
 * es justamente el mecanismo "avisa" de esa política blanda.
 */
async function avisosConsumoPlan(tenantId: string): Promise<Aviso[]> {
  try {
    const [pedidos, conductores] = await Promise.all([
      verificarLimite(tenantId, "pedidos_mes"),
      verificarLimite(tenantId, "conductores"),
    ]);

    const avisos: Aviso[] = [];

    if (pedidos.limite !== null && pedidos.porcentaje !== null) {
      if (pedidos.porcentaje >= UMBRAL_CONSUMO_ALTO_PCT) {
        avisos.push({
          id: "consumo-plan-pedidos-100",
          urgencia: "urgente",
          titulo: "Superaste el límite de pedidos de tu plan",
          descripcion: `Llevas ${pedidos.usoActual} de ${pedidos.limite} pedidos este mes.`,
          href: "/configuracion/plan",
          accion: "Ver plan",
        });
      } else if (pedidos.porcentaje >= UMBRAL_CONSUMO_MEDIO_PCT) {
        avisos.push({
          id: "consumo-plan-pedidos-80",
          urgencia: "importante",
          titulo: `Vas en el ${pedidos.porcentaje}% de los pedidos de tu plan este mes`,
          descripcion: `Llevas ${pedidos.usoActual} de ${pedidos.limite} pedidos este mes.`,
          href: "/configuracion/plan",
          accion: "Ver plan",
        });
      }
    }

    // Conductores: solo al 100% (el alta ya se topa en `crearConductor` — este
    // aviso es el eco informativo para quien no pasó por ese flujo todavía).
    if (
      conductores.limite !== null &&
      conductores.porcentaje !== null &&
      conductores.porcentaje >= UMBRAL_CONSUMO_ALTO_PCT
    ) {
      avisos.push({
        id: "consumo-plan-conductores-100",
        urgencia: "urgente",
        titulo: "Alcanzaste el máximo de conductores de tu plan",
        descripcion: `Tienes ${conductores.usoActual} de ${conductores.limite} conductores activos.`,
        href: "/configuracion/plan",
        accion: "Ver plan",
      });
    }

    return avisos;
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

  // Comunicaciones de Rutax al courier (F3, Gap 7 — mantención/novedad/alerta,
  // banner in-app GLOBAL a todos los couriers). Sin gate de capacidad: es un
  // anuncio de la PLATAFORMA, no de una función de negocio del tenant — todo
  // rol interno que llega a `(tenant)/layout.tsx` (dueño, supervisor,
  // coordinador, administración) lo ve. `obtenerComunicacionesActivasParaCourier`
  // ya es defensiva (nunca lanza) — se empuja directo, sin envolver de nuevo.
  tareas.push(obtenerComunicacionesActivasParaCourier());

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
  if (puedeGestionarSuscripcion(usuario)) {
    tareas.push(avisosConsumoPlan(tenantId));
  }

  const resultados = await Promise.all(tareas);
  return resultados
    .flat()
    .sort((a, b) => PESO_URGENCIA[a.urgencia] - PESO_URGENCIA[b.urgencia]);
}
