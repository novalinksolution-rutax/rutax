"use server";

/**
 * Reportar un problema — la acción que el portal prometía y no tenía.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * LA PROMESA ROTA
 * -----------------------------------------------------------------------------
 * `portal/bienvenida` decía, textual, «Reporta incidencias directo desde aquí —
 * quedan registradas y con seguimiento», y **esa acción no existía en ninguna
 * parte del portal**: ni formulario, ni botón, ni Server Action.
 * `abrirIncidencia` tenía un único llamador en toda la app, y era el lado del
 * courier.
 *
 * -----------------------------------------------------------------------------
 * TRES BARRERAS, Y NINGUNA ES LA DEL COURIER
 * -----------------------------------------------------------------------------
 * 1. **Sesión de seller.** No basta con estar autenticado.
 * 2. **La capacidad propia** `reportar_incidencias_propias`. Se agregó al
 *    catálogo en vez de reusar `ver_incidencias_propias`: un gate de lectura no
 *    puede autorizar un alta.
 * 3. **El pedido es suyo.** Se comprueba contra `seller_id` ANTES de abrir nada.
 *    Sin esto, un seller podría reportar sobre el pedido de otro pasando su id.
 *
 * `esAccionManual` va en `false` a propósito: ese flag exige
 * `puedeGestionarIncidencias`, que es la capacidad del supervisor. El seller no
 * la tiene ni debe tenerla — la barrera de acá es otra y es la de arriba.
 *
 * -----------------------------------------------------------------------------
 * LOS SIETE TIPOS, LOS MISMOS
 * -----------------------------------------------------------------------------
 * Decisión del usuario: el seller elige entre los mismos siete tipos del
 * sistema, escritos en su idioma (`vocabulario-portal.ts`). Si clasificara con
 * una taxonomía propia, la misma incidencia se contaría de dos formas y la
 * reportería del courier dejaría de cuadrar.
 */

import { revalidatePath } from "next/cache";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeReportarIncidenciasPropias } from "@/modules/identidad/capacidades";
import { abrirIncidencia } from "@/modules/operacion/incidencias";
import { TIPOS_INCIDENCIA, type TipoIncidencia } from "@/modules/operacion/tipos";

export type ResultadoReporte = { ok: true; incidenciaId: string } | { ok: false; mensaje: string };

export async function accionReportarProblema(
  pedidoId: string,
  tipo: string,
  descripcion: string,
): Promise<ResultadoReporte> {
  const sesion = await obtenerSesionActual();
  if (
    !sesion?.usuario.tenantId ||
    sesion.usuario.tipoUsuario !== "seller" ||
    !sesion.usuario.sellerId
  ) {
    return { ok: false, mensaje: "No hay una sesión de seller activa." };
  }
  if (!puedeReportarIncidenciasPropias(sesion.usuario)) {
    return { ok: false, mensaje: "Tu cuenta no puede reportar problemas." };
  }
  if (!TIPOS_INCIDENCIA.includes(tipo as TipoIncidencia)) {
    return { ok: false, mensaje: "Elige qué pasó con el pedido." };
  }

  const texto = descripcion.trim();
  if (texto.length < 10) {
    return {
      ok: false,
      mensaje: "Cuéntanos un poco más: con dos palabras el courier no puede hacer nada.",
    };
  }

  const cliente = crearClienteServiceRole();

  // El pedido tiene que ser SUYO. Se comprueba acá y no dentro de
  // `abrirIncidencia`, que valida tenant pero no seller: para el courier eso
  // basta, para el portal no.
  const { data: pedido, error } = await cliente
    .from("pedidos")
    .select("id, seller_id")
    .eq("id", pedidoId)
    .eq("tenant_id", sesion.usuario.tenantId)
    .maybeSingle();

  if (error) return { ok: false, mensaje: "No se pudo leer el pedido. Intenta de nuevo." };
  if (!pedido || pedido.seller_id !== sesion.usuario.sellerId) {
    return { ok: false, mensaje: "Ese pedido no es tuyo." };
  }

  try {
    const incidencia = await abrirIncidencia(cliente, {
      tenantId: sesion.usuario.tenantId,
      pedidoId,
      sellerId: sesion.usuario.sellerId,
      tipo: tipo as TipoIncidencia,
      descripcion: texto,
      abiertaPorUsuarioId: sesion.usuarioId,
      esAccionManual: false,
    });

    revalidatePath("/portal/incidencias");
    revalidatePath(`/portal/pedidos/${pedidoId}`);
    return { ok: true, incidenciaId: incidencia.id };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No se pudo reportar el problema.",
    };
  }
}
