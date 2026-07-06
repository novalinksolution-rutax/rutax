/**
 * GET /api/portal/pedidos/:pedidoId/etiqueta — descarga la etiqueta imprimible
 * con QR interno (Rutax) de un pedido same-day propio del seller.
 *
 * Flujo:
 * 1. Requiere sesión activa con `tipoUsuario === 'seller'` (401 si no hay
 *    sesión o el usuario no es un seller).
 * 2. Requiere la capacidad `puedeDescargarEtiquetaSameDay` (403 si no la
 *    tiene).
 * 3. Lee el pedido vía `service_role` filtrando por `id` + `tenant_id` +
 *    `seller_id === sesion.usuario.sellerId` — aislamiento: nunca confiar en
 *    el `pedidoId` de la URL sin este filtro. 404 si no existe o no es del
 *    seller (incluye pedidos de otro seller/tenant — mismo mensaje para no
 *    filtrar existencia).
 * 4. 400 si el pedido no es `same_day` (los Flex usan la etiqueta ML, no esta).
 * 5. `asegurarCodigoInterno` — backfill perezoso si el pedido aún no tiene
 *    `codigo_interno` (pedidos creados antes de esta feature).
 * 6. Bitácora ANTES de responder (CLAUDE.md: bitácora antes que efectos
 *    externos) — aquí no hay integración externa, pero se mantiene el orden
 *    "bitácora antes de la respuesta" por consistencia y para que quede
 *    registrada incluso si la generación de PDF fallara después.
 * 7. Genera el PDF on-the-fly (no se persiste) y responde `application/pdf`.
 * 8. Respeta `?formato=termica|carta` (default `termica`).
 */

import { NextRequest, NextResponse } from "next/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeDescargarEtiquetaSameDay } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { asegurarCodigoInterno } from "@/modules/operacion/pedidos";
import {
  generarEtiquetaSameDayPdf,
  type FormatoEtiqueta,
} from "@/modules/operacion/etiqueta-same-day-pdf";

interface Params {
  params: Promise<{ pedidoId: string }>;
}

function resolverFormato(request: NextRequest): FormatoEtiqueta {
  const valor = request.nextUrl.searchParams.get("formato");
  return valor === "carta" ? "carta" : "termica";
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const sesion = await obtenerSesionActual();
  if (!sesion) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  if (
    !sesion.usuario.tenantId ||
    sesion.usuario.tipoUsuario !== "seller" ||
    !sesion.usuario.sellerId
  ) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  if (!puedeDescargarEtiquetaSameDay(sesion.usuario)) {
    return NextResponse.json(
      { error: "No tienes permiso para descargar esta etiqueta." },
      { status: 403 },
    );
  }

  const { pedidoId } = await params;
  const tenantId = sesion.usuario.tenantId;
  const sellerId = sesion.usuario.sellerId;
  const formato = resolverFormato(request);

  const cliente = crearClienteServiceRole();

  const { data: pedido, error: errorLectura } = await cliente
    .from("pedidos")
    .select(
      "id, tenant_id, seller_id, tipo_pedido, codigo_interno, destinatario_nombre, destinatario_direccion, destinatario_comuna, destinatario_telefono, instrucciones_entrega, fecha_compromiso",
    )
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .eq("seller_id", sellerId)
    .maybeSingle();

  if (errorLectura) {
    console.error("Error al leer pedido para etiqueta same-day:", errorLectura.message);
    return NextResponse.json(
      { error: "No se pudo generar la etiqueta. Intenta nuevamente más tarde." },
      { status: 502 },
    );
  }

  if (!pedido) {
    return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });
  }

  if (pedido.tipo_pedido !== "same_day") {
    return NextResponse.json(
      { error: "Este pedido no es un envío same-day." },
      { status: 400 },
    );
  }

  const { data: seller, error: errorSeller } = await cliente
    .from("sellers")
    .select("razon_social")
    .eq("id", sellerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (errorSeller) {
    console.error("Error al leer seller para etiqueta same-day:", errorSeller.message);
    return NextResponse.json(
      { error: "No se pudo generar la etiqueta. Intenta nuevamente más tarde." },
      { status: 502 },
    );
  }

  try {
    const codigoInterno = await asegurarCodigoInterno(cliente, {
      id: pedido.id,
      tenantId: pedido.tenant_id,
      codigoInterno: pedido.codigo_interno ?? null,
    });

    // Bitácora ANTES de responder (CLAUDE.md: bitácora antes que efectos
    // externos). Toda descarga/reimpresión queda registrada con su actor.
    await registrarEnBitacora(cliente, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "operacion.etiqueta_same_day_descargada",
      entidadTipo: "pedido",
      entidadId: pedidoId,
      detalle: {
        codigo_interno: codigoInterno,
        seller_id: sellerId,
        formato,
      },
    });

    const buffer = await generarEtiquetaSameDayPdf({
      codigoInterno,
      destinatarioNombre: pedido.destinatario_nombre,
      destinatarioDireccion: pedido.destinatario_direccion,
      destinatarioComuna: pedido.destinatario_comuna,
      destinatarioTelefono: pedido.destinatario_telefono ?? null,
      sellerNombre: seller?.razon_social ?? "—",
      fechaCompromiso: pedido.fecha_compromiso ?? null,
      instruccionesEntrega: pedido.instrucciones_entrega ?? null,
      formato,
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="etiqueta-${codigoInterno}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Error al generar etiqueta same-day:", error);
    return NextResponse.json(
      { error: "No se pudo generar la etiqueta. Intenta nuevamente más tarde." },
      { status: 502 },
    );
  }
}
