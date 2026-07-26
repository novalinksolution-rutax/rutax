"use server";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { crearPedidoSameDay } from "@/modules/operacion/pedidos";
import { ErrorValidacion } from "@/modules/identidad/errores";
import { puedeSolicitarSameDay } from "@/modules/identidad/capacidades";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";

export type ResultadoCrearSameDay =
  | {
      ok: true;
      pedidoId: string;
      destinatarioNombre: string;
      destinatarioComuna: string;
      /** Presente solo cuando el pedido se creó pasado el horario de corte. */
      avisoCorte?: { mensaje: string; sugerencia: string };
    }
  | { ok: false; campo?: string; mensaje: string };

export async function crearSameDayAction(
  _estado: ResultadoCrearSameDay | null,
  formData: FormData,
): Promise<ResultadoCrearSameDay> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { ok: false, mensaje: "Sesión inválida. Vuelve a iniciar sesión." };
  }
  if (!puedeSolicitarSameDay(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para solicitar envíos same-day." };
  }

  const nombre = (formData.get("nombre") as string | null)?.trim() ?? "";
  const direccion = (formData.get("direccion") as string | null)?.trim() ?? "";
  const comuna = (formData.get("comuna") as string | null)?.trim() ?? "";
  const telefono = (formData.get("telefono") as string | null)?.trim() || undefined;
  const instrucciones = (formData.get("instrucciones") as string | null)?.trim() || undefined;
  // Same-day = entrega hoy por definición. Si el seller no especifica fecha, se fija a hoy
  // para que el pedido aparezca en la vista operaciones del courier (filtrada por fecha_compromiso).
  const fechaCompromisoForm = (formData.get("fecha_compromiso") as string | null)?.trim();
  const fechaCompromiso = fechaCompromisoForm || fechaLocalEnSantiago(new Date());

  if (!nombre) return { ok: false, campo: "nombre", mensaje: "El nombre del destinatario es obligatorio." };
  if (!direccion) return { ok: false, campo: "direccion", mensaje: "La dirección de entrega es obligatoria." };
  if (!comuna) return { ok: false, campo: "comuna", mensaje: "La comuna es obligatoria." };
  if (nombre.length > 120) return { ok: false, campo: "nombre", mensaje: "El nombre no puede superar los 120 caracteres." };
  if (direccion.length > 200) return { ok: false, campo: "direccion", mensaje: "La dirección no puede superar los 200 caracteres." };
  if (telefono && !/^\+?[0-9\s\-()]{7,20}$/.test(telefono)) {
    return { ok: false, campo: "telefono", mensaje: "El teléfono no tiene un formato válido." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const { pedido, avisoCorte } = await crearPedidoSameDay(cliente, {
      tenantId: sesion.usuario.tenantId,
      sellerId: sesion.usuario.sellerId,
      destinatarioNombre: nombre,
      destinatarioDireccion: direccion,
      destinatarioComuna: comuna,
      destinatarioTelefono: telefono,
      instruccionesEntrega: instrucciones,
      fechaCompromiso,
    });

    // Modo ráfaga (captura veloz): en vez de redirigir, se devuelve el pedido
    // creado para que el cliente muestre una confirmación inline (con la
    // etiqueta lista para imprimir) y deje el formulario listo para el
    // siguiente envío, sin recargar la página.
    return {
      ok: true,
      pedidoId: pedido.id,
      destinatarioNombre: pedido.destinatarioNombre,
      destinatarioComuna: pedido.destinatarioComuna,
      avisoCorte: avisoCorte
        ? { mensaje: avisoCorte.mensaje, sugerencia: avisoCorte.sugerencia }
        : undefined,
    };
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      // El mensaje de `crearPedidoSameDay` para "sin tarifa configurada" referencia
      // /onboarding/tarifas — una pantalla interna del courier a la que el seller no
      // tiene acceso. Se reemplaza por un mensaje neutral orientado al seller; el
      // mensaje original (con la ruta interna) sigue intacto para el flujo interno.
      if (err.message.includes("no tiene una tarifa configurada")) {
        return {
          ok: false,
          mensaje:
            "El courier aún no configuró tarifas para envíos same-day. Contáctalo para habilitarlas.",
        };
      }
      return { ok: false, mensaje: err.message };
    }
    return { ok: false, mensaje: "No se pudo crear el envío. Intenta nuevamente." };
  }
}
