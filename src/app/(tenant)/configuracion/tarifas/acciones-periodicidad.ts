"use server";

/**
 * Server Action — Configuración → Tarifas → Períodos.
 * =============================================================================
 *
 * Fija cada cuánto el courier le pasa la cuenta a sus sellers, y cada cuánto se
 * cierra la liquidación de sus conductores. Escribe `dinero.config_periodos`
 * (fila del tenant, `seller_id` null) a través de la función
 * `dinero.fijar_periodicidad_facturacion`.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ PASA POR UNA FUNCIÓN DE BASE Y NO POR DOS ESCRITURAS
 * -----------------------------------------------------------------------------
 * La tabla es un historial con índice único parcial sobre `activa`: el cambio es
 * desactivar la vigente + insertar la nueva, en ese orden. El cliente de
 * Supabase no abre transacciones, y sueltas dejan al tenant SIN fila activa si
 * la segunda falla — lo que no rompe nada visible, porque la lectura vuelve a
 * caer en 'mensual' por el respaldo del motor. Ver la cabecera de la migración
 * `20260828000001`.
 *
 * -----------------------------------------------------------------------------
 * RBAC: `puedeGestionarTarifas` (dueño / administración), y no una capacidad nueva
 * -----------------------------------------------------------------------------
 * Es el mismo gate que ya protege tarifas, zonas y el pago por retiro en esta
 * misma pantalla, y por la misma razón que se escribió en
 * `configuracion/retiro/actions.ts`: esto es configuración financiera del
 * courier —cada cuánto cobra—, hermana de cuánto cobra. El conjunto de roles que
 * debería tocarla es exactamente el que ya tiene `gestionar_tarifas`: el
 * levantamiento dice de supervisor y coordinador "sin config financiera". Una
 * capacidad propia se concedería a los mismos dos roles y solo agregaría un
 * nombre más que mantener.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ LA BITÁCORA VA DESPUÉS, Y ACÁ NO ES LA EXCEPCIÓN DE SIEMPRE
 * -----------------------------------------------------------------------------
 * El invariante del proyecto es bitácora ANTES de un evento Inngest o de una
 * integración externa — acá no hay ninguno de los dos. Y hay una razón positiva
 * para que vaya después: **la función puede negarse legítimamente** (el candado
 * de períodos abiertos con líneas). Anotar antes dejaría en la auditoría un
 * cambio de periodicidad que nunca ocurrió, sobre la tabla que existe justo para
 * responder "quién cambió esto".
 */

import { revalidatePath } from "next/cache";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import { esTipoPeriodoFacturacion } from "@/modules/dinero/config-periodos";

export type ResultadoPeriodicidad =
  | { ok: true; aplicado: true; tipoAnterior: string; tipoNuevo: string }
  /** Se pidió lo que ya estaba puesto. No es error: no hay nada que guardar. */
  | { ok: true; aplicado: false; motivo: "sin_cambio"; tipoNuevo: string }
  | { ok: false; mensaje: string };

/** Forma de lo que devuelve `dinero.fijar_periodicidad_facturacion`. */
interface RespuestaRpc {
  aplicado?: boolean;
  motivo?: string;
  tipo_anterior?: string;
  tipo_nuevo?: string;
  periodos_bloqueantes?: number;
}

export async function accionFijarPeriodicidad(
  formData: FormData,
): Promise<ResultadoPeriodicidad> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  if (!puedeGestionarTarifas(sesion.usuario)) {
    return {
      ok: false,
      mensaje: "No tienes permiso para cambiar la periodicidad de facturación.",
    };
  }

  const tipo = formData.get("tipo_periodo");
  if (!esTipoPeriodoFacturacion(tipo)) {
    return {
      ok: false,
      mensaje: "Elige una periodicidad: semanal, quincenal o mensual.",
    };
  }

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  try {
    const { data, error } = await supabase
      .schema("dinero")
      .rpc("fijar_periodicidad_facturacion", {
        p_tenant_id: tenantId,
        p_tipo_periodo: tipo,
      });

    if (error) throw new Error(error.message);

    const resultado = (data ?? {}) as RespuestaRpc;

    if (resultado.motivo === "sin_cambio") {
      return { ok: true, aplicado: false, motivo: "sin_cambio", tipoNuevo: tipo };
    }

    if (resultado.motivo === "periodos_abiertos_con_lineas") {
      const n = resultado.periodos_bloqueantes ?? 0;
      return {
        ok: false,
        mensaje:
          `No se puede cambiar la periodicidad ahora: tienes ${n} ` +
          `${n === 1 ? "período de cobro abierto que ya tiene" : "períodos de cobro abiertos que ya tienen"} ` +
          "líneas. Cambiarla partiría ese período en dos rangos que se solapan, y tus sellers " +
          "recibirían dos facturas por días repetidos. Cierra esos períodos y vuelve a intentarlo.",
      };
    }

    if (!resultado.aplicado) {
      return {
        ok: false,
        mensaje: "No se pudo guardar la periodicidad. Intenta de nuevo en unos minutos.",
      };
    }

    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "dinero.periodicidad_facturacion_actualizada",
      entidadTipo: "config_periodos",
      // La entidad es el tenant: la fila nueva cambia de id en cada cambio, y
      // lo que se audita es "la periodicidad de este courier", no una fila.
      entidadId: tenantId,
      detalle: {
        tipo_anterior: resultado.tipo_anterior ?? null,
        tipo_nuevo: resultado.tipo_nuevo ?? tipo,
        config_id: (resultado as { config_id?: string }).config_id ?? null,
      },
    });

    revalidatePath("/configuracion/tarifas");
    // El listado de períodos muestra el tipo de cada uno; los que se creen a
    // partir de ahora salen con el nuevo y esa pantalla tiene que dejar de
    // mostrar el anterior en su encabezado.
    revalidatePath("/dinero/periodos");

    return {
      ok: true,
      aplicado: true,
      tipoAnterior: resultado.tipo_anterior ?? "mensual",
      tipoNuevo: resultado.tipo_nuevo ?? tipo,
    };
  } catch (err) {
    return {
      ok: false,
      mensaje:
        err instanceof Error
          ? err.message
          : "No se pudo guardar la periodicidad de facturación.",
    };
  }
}
