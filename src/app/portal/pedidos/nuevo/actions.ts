"use server";

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { crearPedidoSameDay } from "@/modules/operacion/pedidos";
import { ErrorValidacion } from "@/modules/identidad/errores";
import { puedeSolicitarSameDay } from "@/modules/identidad/capacidades";

export type ResultadoCrearSameDay =
  | { ok: true; pedidoId: string }
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
  const fechaCompromiso = fechaCompromisoForm || new Date().toISOString().split("T")[0];

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
    const pedido = await crearPedidoSameDay(cliente, {
      tenantId: sesion.usuario.tenantId,
      sellerId: sesion.usuario.sellerId,
      destinatarioNombre: nombre,
      destinatarioDireccion: direccion,
      destinatarioComuna: comuna,
      destinatarioTelefono: telefono,
      instruccionesEntrega: instrucciones,
      fechaCompromiso,
    });

    redirect(`/portal/pedidos?nuevo=${pedido.id}`);
  } catch (err) {
    if (err instanceof ErrorValidacion) {
      return { ok: false, mensaje: err.message };
    }
    if ((err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw err;
    return { ok: false, mensaje: "No se pudo crear el envío. Intenta nuevamente." };
  }
}
