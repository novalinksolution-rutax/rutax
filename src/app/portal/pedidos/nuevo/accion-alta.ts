"use server";

/**
 * El alta same-day del seller — misma forma que la del courier, otra puerta.
 * =============================================================================
 * Desde el 25-08-2026 las dos superficies comparten el MISMO formulario
 * (`components/operacion/formulario-alta-same-day.tsx`). Lo que no se comparte
 * es el control de acceso, y por eso existe este archivo.
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL `sellerId` SALE DE LA SESIÓN, NUNCA DE LOS DATOS
 * -----------------------------------------------------------------------------
 * El formulario manda un `sellerId` porque en el courier hay un selector. Acá
 * **se ignora a propósito**: el seller es quien está firmado. Confiar en el
 * campo dejaría a un seller creando pedidos a nombre de otro con solo cambiar
 * un valor en la petición — el mismo agujero que ya mordió con el `tenant_id`
 * del webhook de WhatsApp.
 *
 * -----------------------------------------------------------------------------
 * LA CAPACIDAD ES OTRA, Y NO ES UN DETALLE
 * -----------------------------------------------------------------------------
 * La acción del courier exige `puedeAjustarOperacionDiaria`, que un seller no
 * tiene; llamarla desde el portal habría devuelto «no tienes permiso» y el
 * formulario compartido habría parecido roto. Acá se exige
 * `puedeSolicitarSameDay`, que es la que define «este seller puede pedir un
 * envío».
 */

import { revalidatePath } from "next/cache";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeSolicitarSameDay } from "@/modules/identidad/capacidades";
import { crearPedidoSameDay } from "@/modules/operacion/pedidos";
import { guardarCoordenadaElegida } from "@/modules/operacion/coordenada-elegida";
import type {
  DatosAltaSameDay,
  ResultadoAlta,
} from "@/app/(tenant)/operaciones/nuevo/actions";

export async function accionCrearSameDaySeller(
  datos: DatosAltaSameDay,
): Promise<ResultadoAlta> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { ok: false, mensaje: "Vuelve a iniciar sesión." };
  }
  if (!puedeSolicitarSameDay(sesion.usuario)) {
    return { ok: false, mensaje: "Tu cuenta no puede crear envíos same-day." };
  }

  try {
    const { pedido, avisoCorte } = await crearPedidoSameDay(crearClienteServiceRole(), {
      tenantId: sesion.usuario.tenantId,
      // ⚠️ De la sesión. `datos.sellerId` se descarta.
      sellerId: sesion.usuario.sellerId,
      destinatarioNombre: datos.destinatarioNombre,
      destinatarioDireccion: datos.destinatarioDireccion,
      destinatarioComuna: datos.destinatarioComuna,
      destinatarioTelefono: datos.destinatarioTelefono,
      instruccionesEntrega: datos.instruccionesEntrega,
      fechaCompromiso: datos.fechaCompromiso,
      actorUsuarioId: sesion.usuarioId,
    });

    // La coordenada va aparte, igual que en el courier: solo existe si la
    // dirección se eligió de la lista del autocompletado.
    if (datos.lat != null && datos.long != null) {
      await guardarCoordenadaElegida(crearClienteServiceRole(), {
        tenantId: sesion.usuario.tenantId,
        pedidoId: pedido.id,
        sellerId: sesion.usuario.sellerId,
        lat: datos.lat,
        long: datos.long,
        comunaDeclarada: datos.destinatarioComuna,
        comunaResuelta: datos.comunaResuelta ?? null,
      });
    }

    revalidatePath("/portal/pedidos");

    return {
      ok: true,
      pedidoId: pedido.id,
      codigo: pedido.codigoInterno ?? null,
      destinatario: pedido.destinatarioNombre,
      avisoCorte: avisoCorte?.mensaje ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No se pudo crear el pedido.",
    };
  }
}
