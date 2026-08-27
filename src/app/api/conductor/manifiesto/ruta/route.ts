/**
 * POST /api/conductor/manifiesto/ruta — el conductor reordena su propia ruta.
 * =============================================================================
 *
 * Es el respaldo de servidor de los tres gestos del mapa (tablero B5c):
 *
 *   · arrastrar una parada en la lista,
 *   · arrastrar su pin sobre la línea,
 *   · «Ir a esta ahora» (adelantarla al frente).
 *
 * Los tres son **el mismo hecho** —la ruta cambió de orden— y por eso comparten
 * una sola acción: `mover`. La cuarta, `optimizar`, es el «Ordenar la ruta» del
 * estado 3, cuando el coordinador no la ruteó.
 *
 * =============================================================================
 * EL CONDUCTOR PUEDE PISAR AL COORDINADOR, Y ES UNA DECISIÓN
 * =============================================================================
 * Reordenar existía solo en la web. Que ahora exista acá significa que el
 * conductor cambia una secuencia que el coordinador calculó, sin pedirle
 * permiso. Es deliberado: el que está en la calle ve el salto absurdo que el
 * motor no ve, y obligarlo a llamar por teléfono para corregirlo es la forma
 * más segura de que deje de usar la app.
 *
 * Lo que lo acota: **solo su propio manifiesto del día**, resuelto desde el
 * token. `manifiestoId` NO viaja en el cuerpo — si viajara, un conductor podría
 * reordenarle la ruta a otro con un curl. Mismo criterio que el receptor del
 * traspaso.
 *
 * =============================================================================
 * LAS PARADAS CERRADAS NO SE MUEVEN, Y SE IMPONE ACÁ
 * =============================================================================
 * «Ya ocurrieron»: una entrega hecha no puede cambiar de posición. Se resuelve
 * fijándolas a todas en su orden actual antes de rutear — el motor las respeta
 * igual que a una fijada por el conductor, así que el reordenamiento solo
 * alcanza a lo que falta sin necesidad de un caso especial.
 *
 * Y si el conductor intenta mover una cerrada (no debería poder: la pantalla no
 * le da asa), se rechaza con un mensaje claro en vez de reordenarle el día.
 */

import { NextResponse, type NextRequest } from "next/server";

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { leerParadasYAnclarCerradas } from "@/modules/operacion/ruteo/anclas-cerradas";
import { obtenerManifiestoVigenteDelConductor } from "@/modules/operacion/manifiesto-vigente";
import {
  calcularYAplicarRutaManifiesto,
  ErrorSinBodegaOrigen,
} from "@/modules/operacion/ruta-manifiesto";
import { ErrorSecuenciaDesincronizada } from "@/modules/operacion/secuencia-paradas-rpc";

interface CuerpoRuta {
  accion?: unknown;
  pedidoId?: unknown;
  posicion?: unknown;
}

export async function POST(request: NextRequest) {
  // Molde exacto de `api/conductor/manifiesto`: el conductor sale del token y
  // nunca del cuerpo.
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (
    !usuario ||
    usuario.tipoUsuario !== "conductor" ||
    !usuario.driverId ||
    !usuario.tenantId
  ) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (usuario.estado !== "activo") {
    return NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 });
  }

  const tenantId = usuario.tenantId;
  const driverId = usuario.driverId;

  let cuerpo: CuerpoRuta;
  try {
    cuerpo = (await request.json()) as CuerpoRuta;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const accion = cuerpo.accion;
  if (accion !== "mover" && accion !== "optimizar") {
    return NextResponse.json(
      { error: "accion debe ser 'mover' u 'optimizar'." },
      { status: 400 },
    );
  }

  const cliente = crearClienteServiceRole();

  // El manifiesto sale del TOKEN, nunca del cuerpo. Ver la cabecera.
  const vigente = await obtenerManifiestoVigenteDelConductor(cliente, {
    tenantId,
    driverId,
    fecha: fechaLocalEnSantiago(new Date()),
  });

  if (!vigente) {
    return NextResponse.json({ error: "No tienes una ruta hoy." }, { status: 404 });
  }

  // --- Paradas y anclas de las cerradas --------------------------------------
  // El anclado vive en `ruteo/anclas-cerradas` porque lo comparte con el
  // redefinir del punto de término: dos gestos que recalculan la misma ruta no
  // pueden tener dos ideas distintas de qué parada «ya ocurrió».
  let paradas, fijaciones, estaCerrada;
  try {
    ({ paradas, fijaciones, estaCerrada } = await leerParadasYAnclarCerradas(cliente, {
      tenantId,
      manifiestoId: vigente.id,
    }));
  } catch (err) {
    console.error(
      "[api/conductor/manifiesto/ruta] al leer paradas:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "No se pudo leer tu ruta." }, { status: 500 });
  }

  // --- Validación del gesto --------------------------------------------------

  if (accion === "mover") {
    const pedidoId = cuerpo.pedidoId;
    const posicion = cuerpo.posicion;

    if (typeof pedidoId !== "string" || pedidoId.length === 0) {
      return NextResponse.json({ error: "Falta el pedido a mover." }, { status: 400 });
    }
    if (typeof posicion !== "number" || !Number.isInteger(posicion) || posicion < 1) {
      return NextResponse.json(
        { error: "posicion debe ser un entero mayor o igual a 1." },
        { status: 400 },
      );
    }

    const parada = paradas.find((p) => p.pedidoId === pedidoId);
    if (!parada) {
      // Indistinguible de «no existe» a propósito: un pedido de otro conductor
      // no se confirma como existente.
      return NextResponse.json({ error: "Esa parada no está en tu ruta." }, { status: 404 });
    }
    if (estaCerrada(parada.pedidoId, parada.estado)) {
      return NextResponse.json(
        { error: "Esa parada ya la cerraste y no se puede mover." },
        { status: 409 },
      );
    }

    // Va al final para que gane a cualquier ancla previa de la misma parada.
    fijaciones.push({ pedidoId, orden: posicion });
  }

  try {
    const resumen = await calcularYAplicarRutaManifiesto(cliente, {
      tenantId,
      manifiestoId: vigente.id,
      actorUsuarioId: usuario.usuarioId,
      fijarAdicionales: fijaciones,
    });

    return NextResponse.json({
      ok: true,
      totalParadas: resumen.totalParadas,
      totalSinSecuencia: resumen.totalSinSecuencia,
      distanciaTotalM: resumen.distanciaTotalM,
      duracionTotalS: resumen.duracionTotalS,
      proveedor: resumen.proveedor,
    });
  } catch (err) {
    if (err instanceof ErrorSecuenciaDesincronizada) {
      // Le cambiaron la ruta mientras arrastraba. Reintentar con la misma lista
      // falla igual: la app tiene que recargar el manifiesto.
      return NextResponse.json(
        { error: "Tu ruta cambió mientras la movías. Vuelve a cargarla.", recargar: true },
        { status: 409 },
      );
    }
    if (err instanceof ErrorSinBodegaOrigen) {
      return NextResponse.json(
        { error: "Tu courier todavía no configuró la bodega de salida." },
        { status: 409 },
      );
    }
    console.error(
      "[api/conductor/manifiesto/ruta]",
      err instanceof Error ? err.message : "error desconocido",
    );
    return NextResponse.json({ error: "No se pudo reordenar tu ruta." }, { status: 500 });
  }
}
