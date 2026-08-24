/**
 * Los dos avisos de un pago a conductor, y a quién le toca cada uno.
 * =============================================================================
 *
 * Se separan de `notificaciones-dinero.ts` —que solo redacta— porque acá está lo
 * que hay que ir a buscar a la base: el nombre del conductor, su correo, el
 * período de la liquidación y de qué se compone.
 *
 * -----------------------------------------------------------------------------
 * EL DESTINATARIO ES DISTINTO EN CADA UNO, Y ESO ES LA DECISIÓN
 * -----------------------------------------------------------------------------
 * · **Pagado → al conductor.** Es su plata y él la está esperando.
 * · **Rechazado → al courier.** Es quien puede arreglarlo: los datos bancarios
 *   están en la ficha del conductor. Avisarle al conductor de un rechazo que no
 *   puede resolver lo deja llamando sin nada que hacer; se entera cuando el pago
 *   se reintenta y llega.
 *
 * -----------------------------------------------------------------------------
 * NINGUNO PUEDE TUMBAR LA TRANSICIÓN
 * -----------------------------------------------------------------------------
 * ⚠️ Las dos funciones devuelven si pudieron o no y **nunca lanzan**. Un pago
 * confirmado no se desconfirma porque el proveedor de correo esté caído, y el
 * dinero ya salió del banco.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  enviarNotificacionEmail,
  resolverDestinatarioCourier,
} from "@/modules/plataforma/notificaciones";
import { resolverUrlBaseApp } from "@/modules/identidad/enlace-invitacion";

import {
  construirEmailLiquidacionPagada,
  construirEmailPagoRechazado,
} from "./notificaciones-dinero";

export interface ResultadoAviso {
  enviado: boolean;
  motivo?: "sin_destinatario" | "sin_datos" | "error";
}

interface DatosLiquidacion {
  fechaInicio: string;
  fechaFin: string;
  montoClp: number;
  driverId: string;
  nombreConductor: string;
  emailConductor: string | null;
  entregas: number;
  visitas: number;
}

/**
 * Lee lo que los dos correos necesitan de una liquidación.
 *
 * El neto se calcula con la fórmula del motor —`total + bono − penalización`—
 * porque **no existe como columna**. Mostrar `monto_total_clp` a secas le diría
 * al conductor una cifra distinta de la que le llegó al banco cada vez que hubo
 * un ajuste.
 */
async function leerDatos(
  cliente: SupabaseClient,
  entrada: { tenantId: string; liquidacionId: string },
): Promise<DatosLiquidacion | null> {
  const { data: liq, error } = await cliente
    .schema("dinero")
    .from("liquidaciones")
    .select("driver_id, fecha_inicio, fecha_fin, monto_total_clp, bono_clp, penalizacion_clp")
    .eq("id", entrada.liquidacionId)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  if (error || !liq) return null;

  const driverId = liq.driver_id as string;

  const [{ data: conductor }, { data: lineas }, { data: perfil }] = await Promise.all([
    cliente
      .schema("identidad")
      .from("conductores")
      .select("nombre_completo")
      .eq("id", driverId)
      .eq("tenant_id", entrada.tenantId)
      .maybeSingle(),
    cliente
      .schema("dinero")
      .from("lineas_liquidacion")
      .select("tipo_hecho")
      .eq("tenant_id", entrada.tenantId)
      .eq("liquidacion_id", entrada.liquidacionId),
    // ⚠️ El vínculo va en ESTA dirección: `usuarios_perfil.driver_id`.
    // `identidad.conductores` NO tiene `usuario_id` — un conductor de la nómina
    // puede no tener cuenta todavía, así que la ficha existe antes que el
    // usuario. Buscarlo al revés devuelve `undefined` en silencio y el correo se
    // queda sin destinatario sin que nada falle.
    cliente
      .schema("identidad")
      .from("usuarios_perfil")
      .select("id")
      .eq("tenant_id", entrada.tenantId)
      .eq("driver_id", driverId)
      .eq("tipo_usuario", "conductor")
      .maybeSingle(),
  ]);

  // El correo sale de Auth, no de una columna de negocio: es el mismo con el que
  // entra a su app.
  let email: string | null = null;
  const usuarioId = perfil?.id as string | undefined;
  if (usuarioId) {
    const { data: authUser } = await cliente.auth.admin.getUserById(usuarioId);
    email = authUser?.user?.email ?? null;
  }

  const filas = (lineas ?? []) as { tipo_hecho: string }[];

  return {
    fechaInicio: liq.fecha_inicio as string,
    fechaFin: liq.fecha_fin as string,
    montoClp:
      Number(liq.monto_total_clp ?? 0) +
      Number(liq.bono_clp ?? 0) -
      Number(liq.penalizacion_clp ?? 0),
    driverId,
    nombreConductor: (conductor?.nombre_completo as string | null) ?? "el conductor",
    emailConductor: email,
    entregas: filas.filter((l) => l.tipo_hecho === "entrega").length,
    visitas: filas.filter((l) => l.tipo_hecho === "retiro_bodega").length,
  };
}

/** «Te transferimos» → al conductor. */
export async function avisarLiquidacionPagada(
  cliente: SupabaseClient,
  entrada: { tenantId: string; liquidacionId: string },
): Promise<ResultadoAviso> {
  try {
    const datos = await leerDatos(cliente, entrada);
    if (!datos) return { enviado: false, motivo: "sin_datos" };
    if (!datos.emailConductor) return { enviado: false, motivo: "sin_destinatario" };

    const destinatario = await resolverDestinatarioCourier(cliente, entrada.tenantId);

    const contenido = construirEmailLiquidacionPagada({
      // Firma el COURIER: el conductor trabaja con él, no con Rutax (regla 42).
      nombreCourier: destinatario.nombreTenant ?? "tu courier",
      montoClp: datos.montoClp,
      periodoInicio: datos.fechaInicio,
      periodoFin: datos.fechaFin,
      entregas: datos.entregas,
      visitas: datos.visitas,
      // El detalle vive en la app nativa, no en la web: el enlace no llevaría a
      // ninguna pantalla que el conductor pueda abrir desde el correo.
      urlApp: null,
    });

    const envio = await enviarNotificacionEmail({
      para: datos.emailConductor,
      asunto: contenido.asunto,
      html: contenido.html,
      texto: contenido.texto,
    });
    return { enviado: envio.enviado };
  } catch {
    return { enviado: false, motivo: "error" };
  }
}

/** «El banco rechazó el pago» → al courier. */
export async function avisarPagoRechazado(
  cliente: SupabaseClient,
  entrada: { tenantId: string; liquidacionId: string; motivoBanco: string | null },
): Promise<ResultadoAviso> {
  try {
    const datos = await leerDatos(cliente, entrada);
    if (!datos) return { enviado: false, motivo: "sin_datos" };

    const destinatario = await resolverDestinatarioCourier(cliente, entrada.tenantId);
    if (!destinatario.email) return { enviado: false, motivo: "sin_destinatario" };

    const base = resolverUrlBaseApp();
    const contenido = construirEmailPagoRechazado({
      nombreConductor: datos.nombreConductor,
      montoClp: datos.montoClp,
      periodoInicio: datos.fechaInicio,
      periodoFin: datos.fechaFin,
      motivoBanco: entrada.motivoBanco,
      urlLiquidacion: base ? `${base}/dinero/liquidaciones` : null,
    });

    const envio = await enviarNotificacionEmail({
      para: destinatario.email,
      asunto: contenido.asunto,
      html: contenido.html,
      texto: contenido.texto,
    });
    return { enviado: envio.enviado };
  } catch {
    return { enviado: false, motivo: "error" };
  }
}
