"use server";

/**
 * Server Actions de «Crear pedido same-day».
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTA PANTALLA TIENE ACCIONES PROPIAS Y NO REUSA `operaciones/actions`
 * -----------------------------------------------------------------------------
 * `actionCrearPedidoSameDay` sigue existiendo y sigue sirviendo: lo que hace
 * falta acá es lo que aquella no devuelve —el **código** del pedido, que es lo
 * primero que la pantalla de éxito muestra porque es lo que se dicta por
 * teléfono— y la persistencia de la coordenada que el autocompletado ya
 * resolvió.
 *
 * -----------------------------------------------------------------------------
 * LA COORDENADA SE GUARDA DESPUÉS DE CREAR, Y NO ES UN PARCHE
 * -----------------------------------------------------------------------------
 * `crearPedidoSameDay` no recibe lat/long: nace con `geo_estado='pendiente'` y
 * publica un evento para que el job la resuelva. Cuando la dirección se eligió
 * de la lista, esa coordenada **ya existe** y hacerla resolver de nuevo es pagar
 * dos veces por el mismo hecho.
 *
 * Así que se escribe acá, justo después de crear. **No hay carrera con el job**:
 * su primer paso es «si `geo_estado != 'pendiente'` → no-op idempotente»
 * (`jobs/geocodificar-pedido.ts`), así que llegue antes o después, el job
 * respeta lo que ya está escrito.
 *
 * La cobertura se calcula con `calcularCobertura`, **la misma función del job**,
 * no con una copia: es la que decide si el pedido queda «por revisar», y dos
 * implementaciones de esa regla divergirían el día que alguien toque una.
 */

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeAjustarOperacionDiaria } from "@/modules/identidad/capacidades";
import { crearPedidoSameDay } from "@/modules/operacion/pedidos";
import { guardarCoordenadaElegida } from "@/modules/operacion/coordenada-elegida";
import { resolverTarifaVigente } from "@/modules/operacion/tarifas";
import { obtenerResumenCortePorSeller } from "@/modules/operacion/metricas";
import { obtenerPuertoAutocompletado } from "@/modules/integraciones/geocoding/autocompletado";
import { ahoraEnSantiago } from "@/lib/fecha-santiago";

// =============================================================================
// Autocompletado de dirección
// =============================================================================

export async function actionSugerirDirecciones(consulta: string, sesion: string) {
  // Gate igual que el de crear: sugerir direcciones es parte del mismo acto, y
  // la acción es invocable directamente.
  const sesionUsuario = await exigirSesionActual();
  if (!puedeAjustarOperacionDiaria(sesionUsuario.usuario)) return [];

  try {
    return await obtenerPuertoAutocompletado().sugerir({ consulta, sesion });
  } catch {
    // Un proveedor mal configurado no puede impedir crear un pedido: el campo
    // sigue aceptando texto libre.
    return [];
  }
}

export async function actionResolverDireccion(id: string, sesion: string) {
  const sesionUsuario = await exigirSesionActual();
  if (!puedeAjustarOperacionDiaria(sesionUsuario.usuario)) return null;

  try {
    return await obtenerPuertoAutocompletado().resolver({ id, sesion });
  } catch {
    return null;
  }
}

// =============================================================================
// Lo que hay que saber del seller ANTES de guardar
// =============================================================================

export interface EstadoSellerParaAlta {
  /** `HH:MM` en Santiago, o `null` si el seller no tiene ventana de corte. */
  horaCorte: string | null;
  /** `false` → esta entrega no se podría cobrar. */
  tieneTarifa: boolean;
}

/**
 * Las dos advertencias de la pantalla, resueltas **al elegir el seller**.
 *
 * Es el patrón que da nombre a esta pantalla: un aviso que no bloquea vive
 * pegado al campo que lo provoca y aparece **antes** de enviar. Las dos cosas
 * ya se sabían dentro de `crearPedidoSameDay`, pero ahí llegan tarde — cuando
 * el courier ya escribió todo el formulario.
 */
export async function actionEstadoSellerParaAlta(
  sellerId: string,
): Promise<EstadoSellerParaAlta | null> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return null;
  if (!puedeAjustarOperacionDiaria(sesion.usuario)) return null;

  const cliente = crearClienteServiceRole();
  const tenantId = sesion.usuario.tenantId;

  const [cortes, tarifaId] = await Promise.all([
    obtenerResumenCortePorSeller(cliente, tenantId).catch(() => []),
    resolverTarifaVigente(cliente, {
      tenantId,
      sellerId,
      tipoEntrega: "same_day",
      fecha: ahoraEnSantiago().fecha,
    }).catch(() => null),
  ]);

  return {
    horaCorte: cortes.find((c) => c.sellerId === sellerId)?.horaCorte ?? null,
    tieneTarifa: tarifaId !== null,
  };
}

// =============================================================================
// Crear
// =============================================================================

export interface DatosAltaSameDay {
  sellerId: string;
  destinatarioNombre: string;
  destinatarioDireccion: string;
  destinatarioComuna: string;
  destinatarioTelefono?: string;
  instruccionesEntrega?: string;
  fechaCompromiso?: string;
  /** Vienen solo si la dirección se eligió de la lista. */
  lat?: number | null;
  long?: number | null;
  comunaResuelta?: string | null;
}

export type ResultadoAlta =
  | {
      ok: true;
      pedidoId: string;
      /** `RX-XXXX-XXXX` — lo primero que muestra el éxito. */
      codigo: string | null;
      destinatario: string;
      avisoCorte: string | null;
    }
  | { ok: false; mensaje: string };

export async function actionCrearSameDay(datos: DatosAltaSameDay): Promise<ResultadoAlta> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }
  if (!puedeAjustarOperacionDiaria(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para crear pedidos same-day." };
  }

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  try {
    const { pedido, avisoCorte } = await crearPedidoSameDay(cliente, {
      tenantId,
      sellerId: datos.sellerId,
      destinatarioNombre: datos.destinatarioNombre,
      destinatarioDireccion: datos.destinatarioDireccion,
      destinatarioComuna: datos.destinatarioComuna,
      destinatarioTelefono: datos.destinatarioTelefono,
      instruccionesEntrega: datos.instruccionesEntrega,
      fechaCompromiso: datos.fechaCompromiso,
      actorUsuarioId: sesion.usuarioId,
    });

    if (datos.lat != null && datos.long != null) {
      await guardarCoordenadaElegida(cliente, {
        tenantId,
        pedidoId: pedido.id,
        sellerId: datos.sellerId,
        lat: datos.lat,
        long: datos.long,
        comunaDeclarada: datos.destinatarioComuna,
        comunaResuelta: datos.comunaResuelta ?? null,
      });
    }

    revalidatePath("/operaciones");
    return {
      ok: true,
      pedidoId: pedido.id,
      codigo: pedido.codigoInterno ?? null,
      destinatario: datos.destinatarioNombre,
      avisoCorte: avisoCorte?.mensaje ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al crear el pedido.",
    };
  }
}
