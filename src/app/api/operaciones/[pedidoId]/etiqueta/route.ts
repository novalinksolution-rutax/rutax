/**
 * GET /api/operaciones/:pedidoId/etiqueta — descarga la etiqueta imprimible de
 * un pedido (RF-021, item C-04). Ramifica según `tipo_pedido`:
 * - `flex`: etiqueta de envío ML obtenida vía el adaptador (`obtenerEtiquetaEnvio`).
 * - `same_day`: etiqueta interna Rutax con QR (`generarEtiquetaSameDayPdf`),
 *   con backfill perezoso de `codigo_interno` si el pedido aún no lo tiene.
 *
 * Flujo común:
 * 1. Requiere sesión activa (401 si no hay).
 * 2. Requiere la misma capacidad que protege las acciones operativas de
 *    asignación/reasignación en el detalle del pedido
 *    (`puedeAsignarYReasignarPedidos` — ver
 *    `src/app/(tenant)/operaciones/[pedidoId]/page.tsx`). 403 si no la tiene.
 * 3. Lee el pedido vía `service_role` filtrando por `id` Y `tenant_id` del
 *    usuario — aislamiento multi-tenant, nunca confiar en el `pedidoId` de la
 *    URL sin este filtro. 404 si no existe (incluye pedidos de otro tenant).
 * 4. Éxito → responde el PDF inline y registra en bitácora de auditoría
 *    (acción distinta por rama: `operacion.etiqueta_descargada` para flex,
 *    `operacion.etiqueta_same_day_descargada` para same-day).
 *
 * Rama flex:
 * 5. Si el pedido no tiene `ml_shipment_id` → 400.
 * 6. Llama al adaptador ML (`obtenerEtiquetaEnvio`) — el único punto de
 *    contacto con la API externa.
 * 7. `ErrorConexionMlRequiereRevinculacion` → 409.
 * 8. Cualquier otro error (incl. `ErrorHttpMl`) → 502, sin exponer detalles
 *    internos al cliente; se loguea en servidor (sin tokens).
 *
 * Rama same_day:
 * 5. `asegurarCodigoInterno` (backfill perezoso) + `generarEtiquetaSameDayPdf`.
 * 6. Respeta `?formato=termica|carta` (default `termica`).
 */

import { NextRequest, NextResponse } from "next/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { asegurarCodigoInterno } from "@/modules/operacion/pedidos";
import {
  generarEtiquetaSameDayPdf,
  type FormatoEtiqueta,
} from "@/modules/operacion/etiqueta-same-day-pdf";
import {
  obtenerEtiquetaEnvio,
  ErrorConexionMlRequiereRevinculacion,
} from "@/modules/integraciones/ml";
import { laFuenteProveeEtiqueta } from "@/modules/operacion/fuente";

function resolverFormato(request: NextRequest): FormatoEtiqueta {
  const valor = request.nextUrl.searchParams.get("formato");
  return valor === "carta" ? "carta" : "termica";
}

interface Params {
  params: Promise<{ pedidoId: string }>;
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const sesion = await obtenerSesionActual();
  if (!sesion) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  if (!sesion.usuario.tenantId) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return NextResponse.json(
      { error: "No tienes permiso para descargar la etiqueta de este pedido." },
      { status: 403 },
    );
  }

  const { pedidoId } = await params;
  const tenantId = sesion.usuario.tenantId;

  const cliente = crearClienteServiceRole();
  const { data: pedido, error: errorLectura } = await cliente
    .from("pedidos")
    .select(
      "id, tenant_id, seller_id, tipo_pedido, fuente, ml_shipment_id, ml_user_id, codigo_interno, destinatario_nombre, destinatario_direccion, destinatario_comuna, destinatario_telefono, instrucciones_entrega, fecha_compromiso",
    )
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (errorLectura) {
    console.error("Error al leer pedido para etiqueta:", errorLectura.message);
    return NextResponse.json(
      { error: "No se pudo obtener la etiqueta. Intenta nuevamente más tarde." },
      { status: 502 },
    );
  }

  if (!pedido) {
    return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });
  }

  // --- Rama same-day: etiqueta interna Rutax con QR ---------------------------
  // Criterio: quién PROVEE la etiqueta, no el POD (`laFuenteProveeEtiqueta`,
  // no `podLoGobiernaLaFuente` — ver docstring de `fuente.ts`).
  if (!laFuenteProveeEtiqueta(pedido.fuente)) {
    const formato = resolverFormato(request);

    try {
      const { data: seller, error: errorSeller } = await cliente
        .from("sellers")
        .select("razon_social")
        .eq("id", pedido.seller_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (errorSeller) {
        console.error("Error al leer seller para etiqueta same-day:", errorSeller.message);
        return NextResponse.json(
          { error: "No se pudo generar la etiqueta. Intenta nuevamente más tarde." },
          { status: 502 },
        );
      }

      const codigoInterno = await asegurarCodigoInterno(cliente, {
        id: pedido.id,
        tenantId: pedido.tenant_id,
        codigoInterno: pedido.codigo_interno ?? null,
      });

      // Bitácora ANTES de responder (CLAUDE.md: bitácora antes que efectos externos).
      await registrarEnBitacora(cliente, {
        tenantId,
        actorUsuarioId: sesion.usuarioId,
        actorTipo: "usuario",
        accion: "operacion.etiqueta_same_day_descargada",
        entidadTipo: "pedido",
        entidadId: pedidoId,
        detalle: {
          codigo_interno: codigoInterno,
          seller_id: pedido.seller_id,
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

  // --- Rama flex: etiqueta de envío ML -----------------------------------------
  if (!pedido.ml_shipment_id) {
    return NextResponse.json(
      { error: "Este pedido no tiene un envío de Mercado Libre asociado." },
      { status: 400 },
    );
  }

  try {
    const { contenido, contentType } = await obtenerEtiquetaEnvio({
      sellerId: pedido.seller_id,
      mlShipmentId: pedido.ml_shipment_id,
      // Cuenta ML de origen del pedido (modelo 1:N) — resuelve el token de la
      // conexión correcta cuando el seller tiene varias cuentas conectadas.
      mlUserId: pedido.ml_user_id ?? null,
    });

    await registrarEnBitacora(cliente, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "operacion.etiqueta_descargada",
      entidadTipo: "pedido",
      entidadId: pedidoId,
      detalle: {
        ml_shipment_id: pedido.ml_shipment_id,
        seller_id: pedido.seller_id,
      },
    });

    return new NextResponse(contenido, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="etiqueta-${pedido.ml_shipment_id}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof ErrorConexionMlRequiereRevinculacion) {
      return NextResponse.json(
        {
          error:
            "La conexión de Mercado Libre del seller requiere reconexión. No se puede obtener la etiqueta.",
        },
        { status: 409 },
      );
    }

    // No exponer detalles internos del error al cliente — pero sí loguearlos
    // en servidor (sin tokens; el cuerpo de ErrorHttpMl ya viene saneado).
    console.error("Error al obtener etiqueta de envío desde ML:", error);

    return NextResponse.json(
      { error: "No se pudo obtener la etiqueta desde Mercado Libre. Intenta nuevamente más tarde." },
      { status: 502 },
    );
  }
}
