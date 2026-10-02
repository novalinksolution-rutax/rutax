/**
 * Perfil comercial de los couriers, para el backstage (solo lectura,
 * service_role). Fuente: `identidad.courier_perfil_comercial`.
 *
 * Propósito del dato: priorizar la atención comercial y medir qué e-commerce
 * conviene integrar. Fila ausente = «sin responder».
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  FUENTES_PEDIDOS_OPCIONES,
  type PerfilComercial,
} from "@/lib/ui/perfil-comercial";

export type PerfilesPorTenant = Record<string, PerfilComercial>;

export async function obtenerPerfilesComerciales(): Promise<PerfilesPorTenant> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("courier_perfil_comercial")
    .select("tenant_id, envios_dia_rango, conductores_rango, fuentes_pedidos, fuente_otra");
  if (error) throw new Error(`Error al leer los perfiles comerciales: ${error.message}`);

  const salida: PerfilesPorTenant = {};
  for (const f of data ?? []) {
    salida[f.tenant_id as string] = {
      enviosDiaRango: f.envios_dia_rango as string,
      conductoresRango: f.conductores_rango as string,
      fuentesPedidos: (f.fuentes_pedidos as string[]) ?? [],
      fuenteOtra: (f.fuente_otra as string | null) ?? null,
    };
  }
  return salida;
}

export interface ResumenPlataformas {
  /** Couriers que respondieron (el denominador del resumen). */
  respondieron: number;
  /** Una fila por plataforma del catálogo salvo «otra», de más a menos declarada. */
  plataformas: { valor: string; etiqueta: string; couriers: number }[];
  /** Texto libre de «Otra», agrupado sin distinguir mayúsculas ni espacios. */
  otras: { texto: string; couriers: number }[];
}

/** Función pura: cuenta COURIERS (no menciones) por plataforma declarada. */
export function resumirPlataformas(perfiles: Iterable<PerfilComercial>): ResumenPlataformas {
  const conteo = new Map<string, number>();
  const otras = new Map<string, { texto: string; couriers: number }>();
  let respondieron = 0;

  for (const p of perfiles) {
    respondieron += 1;
    for (const f of new Set(p.fuentesPedidos)) {
      if (f === "otra") continue;
      conteo.set(f, (conteo.get(f) ?? 0) + 1);
    }
    if (p.fuentesPedidos.includes("otra") && p.fuenteOtra) {
      const clave = p.fuenteOtra.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-CL");
      const previo = otras.get(clave);
      if (previo) previo.couriers += 1;
      else otras.set(clave, { texto: p.fuenteOtra.trim().replace(/\s+/g, " "), couriers: 1 });
    }
  }

  const plataformas = FUENTES_PEDIDOS_OPCIONES.filter((o) => o.valor !== "otra")
    .map((o) => ({ valor: o.valor as string, etiqueta: o.etiqueta as string, couriers: conteo.get(o.valor) ?? 0 }))
    .sort((a, b) => b.couriers - a.couriers);

  return {
    respondieron,
    plataformas,
    otras: [...otras.values()].sort(
      (a, b) => b.couriers - a.couriers || a.texto.localeCompare(b.texto, "es-CL"),
    ),
  };
}
