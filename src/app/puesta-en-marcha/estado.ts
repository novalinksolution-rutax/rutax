/**
 * Estado del wizard de puesta en marcha (2026-09-12).
 * =============================================================================
 *
 * Reemplaza a `(tenant)/onboarding/estado.ts`. Aquel derivaba "¿puede operar?"
 * de un conteo frágil (el bug del enum `'inactivo'` que caía a 0 en silencio);
 * la completitud del wizard ahora vive EXPLÍCITA en
 * `tenants.puesta_en_marcha_completada_en` y esta función solo reporta el avance
 * paso a paso mientras el wizard está abierto.
 *
 * Ocho pasos, en el orden que definió el usuario. Siete son OBLIGATORIOS (sin
 * ellos no se puede cerrar el wizard); "equipo" es saltable —invitar gente es
 * acción continua, no un candado—. No hay DTE, folios ni conciliación: salieron
 * del flujo obligatorio (se activan después, en Configuración).
 *
 * Solo lectura, cliente de sesión (RLS activa): todas son tablas del propio
 * tenant, visibles a sus roles internos.
 */

import { createClient } from "@/lib/supabase/server";
import { leerPeriodicidadTenant } from "@/modules/dinero/config-periodos";

/** Las claves de paso, EN ORDEN. El índice es el número de paso. */
export const PASOS_PUESTA_EN_MARCHA = [
  "empresa",
  "tarifa",
  "periodicidad",
  "cobro",
  "retiro",
  "zonas",
  "contacto",
  "equipo",
] as const;

export type ClavePaso = (typeof PASOS_PUESTA_EN_MARCHA)[number];

/** Los siete que bloquean el cierre. "equipo" no está: es saltable. */
const PASOS_OBLIGATORIOS: ReadonlySet<ClavePaso> = new Set<ClavePaso>([
  "empresa",
  "tarifa",
  "periodicidad",
  "cobro",
  "retiro",
  "zonas",
  "contacto",
]);

export interface DatosInicialesPaso {
  empresa: {
    nombreFantasia: string | null;
    razonSocial: string | null;
    rut: string | null;
    giro: string | null;
    direccion: string | null;
    comuna: string | null;
    actividadEconomica: string | null;
  };
  tarifa: { cobroClp: number | null; pagoConductorClp: number | null };
  periodicidad: { tipo: string; explicita: boolean };
  cobro: {
    banco: string | null;
    tipoCuenta: string | null;
    numeroCuenta: string | null;
    nombreTitular: string | null;
    rutTitular: string | null;
    emailAviso: string | null;
  };
  retiro: { montoVisitaClp: number | null };
  zonas: { comunas: string[] };
  contacto: { telefono: string | null; email: string | null };
  equipo: { sellers: number; conductores: number };
}

export interface EstadoPuestaEnMarcha {
  /** `true`/`false` por cada paso, en el orden de `PASOS_PUESTA_EN_MARCHA`. */
  completos: Record<ClavePaso, boolean>;
  /** Datos ya guardados, para precargar cada pantalla. */
  iniciales: DatosInicialesPaso;
  /** Primer paso obligatorio sin completar; si están todos, el primero pendiente
   *  cualquiera; si no queda ninguno, "equipo". Es dónde abre el wizard. */
  primerPendiente: ClavePaso;
  /** `true` cuando los siete obligatorios están listos: se puede cerrar. */
  puedeCompletar: boolean;
}

export async function resolverEstadoPuestaEnMarcha(tenantId: string): Promise<EstadoPuestaEnMarcha> {
  const supabase = await createClient();

  const [
    tenantRes,
    tarifaRes,
    periodicidad,
    cobroRes,
    retiroRes,
    zonaRes,
    sellersRes,
    conductoresRes,
  ] = await Promise.all([
    supabase
      .from("tenants")
      .select(
        "nombre_fantasia, razon_social, rut, giro, direccion, comuna, actividad_economica, telefono_contacto, email_contacto",
      )
      .eq("id", tenantId)
      .maybeSingle(),
    // La tarifa base: seller y zona nulos, activa y vigente.
    supabase
      .from("tarifas")
      .select("monto_clp, monto_conductor_clp")
      .eq("tenant_id", tenantId)
      .eq("estado", "activa")
      .is("seller_id", null)
      .is("zona", null)
      .is("vigente_hasta", null)
      .limit(1),
    leerPeriodicidadTenant(supabase, tenantId).catch(() => ({
      tipoPeriodo: "mensual" as const,
      explicita: false,
      fijadaEn: null,
    })),
    supabase
      .from("courier_datos_cobro")
      .select("banco, tipo_cuenta, numero_cuenta, nombre_titular, rut_titular, email_aviso")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("courier_config_retiro")
      .select("monto_visita_bodega_clp")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    // Las comunas de la zona "Cobertura". Se leen vía la vista de zona_comunas.
    supabase
      .from("zonas")
      .select("id, zona_comunas(comuna)")
      .eq("tenant_id", tenantId)
      .eq("activa", true)
      .eq("nombre", "Cobertura")
      .maybeSingle(),
    supabase
      .from("sellers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .neq("estado", "suspendido"),
    supabase
      .from("conductores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("estado", "activo"),
  ]);

  const t = tenantRes.data ?? null;

  const tarifaFila = (tarifaRes.data ?? [])[0] as
    | { monto_clp: number; monto_conductor_clp: number | null }
    | undefined;

  const zonaComunas = ((zonaRes.data?.zona_comunas ?? []) as Array<{ comuna: string }>).map(
    (z) => z.comuna,
  );

  const iniciales: DatosInicialesPaso = {
    empresa: {
      nombreFantasia: (t?.nombre_fantasia as string | undefined) ?? null,
      razonSocial: (t?.razon_social as string | undefined) ?? null,
      rut: (t?.rut as string | undefined) ?? null,
      giro: (t?.giro as string | undefined) ?? null,
      direccion: (t?.direccion as string | undefined) ?? null,
      comuna: (t?.comuna as string | undefined) ?? null,
      actividadEconomica: (t?.actividad_economica as string | undefined) ?? null,
    },
    tarifa: {
      cobroClp: tarifaFila ? Number(tarifaFila.monto_clp) : null,
      pagoConductorClp: tarifaFila ? Number(tarifaFila.monto_conductor_clp ?? 0) || null : null,
    },
    periodicidad: { tipo: periodicidad.tipoPeriodo, explicita: periodicidad.explicita },
    cobro: {
      banco: (cobroRes.data?.banco as string | undefined) ?? null,
      tipoCuenta: (cobroRes.data?.tipo_cuenta as string | undefined) ?? null,
      numeroCuenta: (cobroRes.data?.numero_cuenta as string | undefined) ?? null,
      nombreTitular: (cobroRes.data?.nombre_titular as string | undefined) ?? null,
      rutTitular: (cobroRes.data?.rut_titular as string | undefined) ?? null,
      emailAviso: (cobroRes.data?.email_aviso as string | undefined) ?? null,
    },
    retiro: {
      montoVisitaClp: retiroRes.data ? Number(retiroRes.data.monto_visita_bodega_clp) : null,
    },
    zonas: { comunas: zonaComunas },
    contacto: {
      telefono: (t?.telefono_contacto as string | undefined) ?? null,
      email: (t?.email_contacto as string | undefined) ?? null,
    },
    equipo: { sellers: sellersRes.count ?? 0, conductores: conductoresRes.count ?? 0 },
  };

  const empresaCompleta = Boolean(
    iniciales.empresa.razonSocial?.trim() &&
      iniciales.empresa.rut?.trim() &&
      iniciales.empresa.giro?.trim() &&
      iniciales.empresa.direccion?.trim() &&
      iniciales.empresa.comuna?.trim() &&
      iniciales.empresa.actividadEconomica?.trim(),
  );

  const completos: Record<ClavePaso, boolean> = {
    empresa: empresaCompleta,
    tarifa: iniciales.tarifa.cobroClp !== null && iniciales.tarifa.pagoConductorClp !== null,
    periodicidad: iniciales.periodicidad.explicita,
    cobro: Boolean(iniciales.cobro.numeroCuenta?.trim()),
    retiro: iniciales.retiro.montoVisitaClp !== null,
    zonas: iniciales.zonas.comunas.length > 0,
    contacto: Boolean(iniciales.contacto.telefono?.trim() || iniciales.contacto.email?.trim()),
    equipo: iniciales.equipo.sellers > 0 || iniciales.equipo.conductores > 0,
  };

  const primerPendiente =
    PASOS_PUESTA_EN_MARCHA.find((p) => PASOS_OBLIGATORIOS.has(p) && !completos[p]) ??
    PASOS_PUESTA_EN_MARCHA.find((p) => !completos[p]) ??
    "equipo";

  const puedeCompletar = [...PASOS_OBLIGATORIOS].every((p) => completos[p]);

  return { completos, iniciales, primerPendiente, puedeCompletar };
}
