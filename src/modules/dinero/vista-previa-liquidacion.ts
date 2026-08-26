/**
 * Lo que muestra la vista previa de una liquidación de conductor.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ RESPONDE
 * -----------------------------------------------------------------------------
 * La lee alguien que **desconfía del descuento**: el conductor pregunta por qué
 * le llegó menos, y el que responde tiene que poder abrir la fila y contestar
 * sin ir al detalle. Así que lo que trae este lector es la descomposición:
 *
 * · **entregas y visitas a bodega por separado.** Son dos hechos generadores
 *   distintos —la entrega se le cobra al seller, la visita a bodega NO— y el
 *   listado mostraba solo el conteo de entregas sobre una cifra que además
 *   pagaba las visitas;
 * · **el ajuste, con su nota.** Bono y penalización son lo que se discute, y sin
 *   el motivo escrito la cifra no explica nada;
 * · **el estado del pago**, con el texto del banco cuando lo rechazó.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL AISLAMIENTO SE IMPONE ACÁ, EN CADA CONSULTA
 * -----------------------------------------------------------------------------
 * Se llama con `service_role`, así que RLS no protege nada: **cada consulta
 * filtra por `tenant_id`**. Un id que no es del tenant devuelve `null`, no un
 * error — desde afuera, «no existe» y «no es tuyo» tienen que ser
 * indistinguibles.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";
import type { EstadoLiquidacion } from "./tipos";

export interface VistaPreviaLiquidacion {
  id: string;
  driverId: string;
  conductorNombre: string;
  /** Régimen: decide si hay retención y qué documento respalda el pago. */
  tipoRelacion: string | null;
  fechaInicio: string;
  fechaFin: string;
  estado: EstadoLiquidacion;

  /** Composición: los dos hechos generadores, por separado. */
  entregas: number;
  visitas: number;
  /** Lo que suman las líneas vigentes, antes de bono y penalización. */
  brutoClp: number;
  /** Líneas anuladas: lo que explica una diferencia con el total guardado. */
  lineasAnuladas: number;

  bonoClp: number;
  penalizacionClp: number;
  notaAjuste: string | null;
  /** Bruto + bono − penalización. Es la cifra que se transfiere. */
  netoClp: number;

  /** El total que quedó guardado al generar la liquidación. */
  montoGuardadoClp: number | null;

  primerHecho: string | null;
  ultimoHecho: string | null;

  tienePdf: boolean;

  /** El payout más reciente, si hay uno. */
  payoutEstado: string | null;
  payoutErrorDescripcion: string | null;
}

interface FilaLineaLiq {
  monto_final_clp: number | null;
  tipo_hecho: string | null;
  fecha_hecho: string | null;
  anulada: boolean | null;
}

export async function armarVistaPreviaLiquidacion(
  cliente: SupabaseClient,
  tenantId: string,
  liquidacionId: string,
): Promise<VistaPreviaLiquidacion | null> {
  const { data: liq, error } = await cliente
    .schema("dinero")
    .from("liquidaciones")
    .select(
      "id, driver_id, fecha_inicio, fecha_fin, estado, monto_total_clp, tipo_relacion_conductor, pdf_ref, bono_clp, penalizacion_clp, nota_ajuste",
    )
    .eq("id", liquidacionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !liq) return null;

  const driverId = liq.driver_id as string;

  // ⚠️ `Promise.resolve(...)` alrededor de cada builder: PostgREST devuelve un
  // `PromiseLike`, no una `Promise`. Sin el envoltorio, `.catch()` no compila y
  // el tipo del `Promise.all` entero se derrumba a `any`.
  const [conductor, lineas, payout] = await Promise.all([
    Promise.resolve(
      cliente
        .schema("identidad")
        .from("conductores")
        .select("nombre_completo")
        .eq("id", driverId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    )
      .then((r) => r.data)
      .catch(() => null),

    leerTodasLasFilas<FilaLineaLiq>("líneas de la liquidación", (desde, hasta) =>
      cliente
        .schema("dinero")
        .from("lineas_liquidacion")
        .select("monto_final_clp, tipo_hecho, fecha_hecho, anulada")
        .eq("tenant_id", tenantId)
        .eq("liquidacion_id", liquidacionId)
        .range(desde, hasta),
    ).catch(() => [] as FilaLineaLiq[]),

    Promise.resolve(
      cliente
        .schema("dinero")
        .from("payouts_conductor")
        .select("estado, error_descripcion")
        .eq("tenant_id", tenantId)
        .eq("liquidacion_id", liquidacionId)
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle(),
    )
      .then((r) => r.data)
      .catch(() => null),
  ]);

  const vigentes = lineas.filter((l) => !l.anulada);

  // `tipo_hecho` distingue los dos hechos generadores: `entrega` y
  // `retiro_bodega` (verificado contra los valores reales de la tabla). Se
  // cuenta el retiro por lo positivo y **todo lo demás cuenta como entrega**:
  // las líneas anteriores a que la columna existiera son entregas, y un valor
  // nuevo que apareciera no puede hacer desaparecer plata de la suma.
  const visitas = vigentes.filter((l) => l.tipo_hecho === "retiro_bodega").length;
  const entregas = vigentes.length - visitas;

  const brutoClp = vigentes.reduce((s, l) => s + (l.monto_final_clp ?? 0), 0);
  const bonoClp = (liq.bono_clp as number | null) ?? 0;
  const penalizacionClp = (liq.penalizacion_clp as number | null) ?? 0;

  const fechas = vigentes
    .map((l) => l.fecha_hecho)
    .filter((f): f is string => Boolean(f))
    .sort();

  return {
    id: liq.id as string,
    driverId,
    conductorNombre: (conductor?.nombre_completo as string | undefined) ?? "Conductor",
    tipoRelacion: (liq.tipo_relacion_conductor as string | null) ?? null,
    fechaInicio: liq.fecha_inicio as string,
    fechaFin: liq.fecha_fin as string,
    estado: liq.estado as EstadoLiquidacion,

    entregas,
    visitas,
    brutoClp,
    lineasAnuladas: lineas.length - vigentes.length,

    bonoClp,
    penalizacionClp,
    notaAjuste: (liq.nota_ajuste as string | null) ?? null,
    netoClp: brutoClp + bonoClp - penalizacionClp,

    montoGuardadoClp: (liq.monto_total_clp as number | null) ?? null,

    primerHecho: fechas[0] ?? null,
    ultimoHecho: fechas.at(-1) ?? null,

    tienePdf: Boolean(liq.pdf_ref),

    payoutEstado: (payout?.estado as string | undefined) ?? null,
    payoutErrorDescripcion: (payout?.error_descripcion as string | undefined) ?? null,
  };
}
