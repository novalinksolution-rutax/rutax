import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { MAX_ESCANEOS_POR_LOTE, registrarLoteEscaneos, type EscaneoEntrada } from "@/modules/operacion/retiro/escaneos";

interface EscaneoBody {
  escaneoId?: unknown;
  codigo?: unknown;
  escaneadoEn?: unknown;
}

interface Body {
  escaneos?: EscaneoBody[];
}

/**
 * POST /api/conductor/retiros/:sesionId/escaneos
 *
 * Lote de hasta `MAX_ESCANEOS_POR_LOTE` escaneos, con RESULTADO POR
 * ELEMENTO. Responde 200 siempre que la sesión sea del conductor — un
 * código que Rutax no puede procesar contra su ingesta se guarda igual
 * (`estado: "registrado"`, `resolucion: "no_procesado"` o `"ilegible"`); un
 * duplicado se fusiona (`"duplicado_fusionado"`); solo lo estructural cae en
 * `"rechazado"`. Nunca se pierde un escaneo.
 *
 * Body JSON: { escaneos: [{ escaneoId, codigo, escaneadoEn }] }
 *
 * ⚠️ NO llama a ML: la resolución de un flex_qr sin match dispara
 * `operacion/bulto-retiro.sin-pedido` (best-effort, ver `escaneos.ts`) en vez
 * de una llamada síncrona a un tercero — meter esa latencia en el gesto que
 * el conductor repite ~130 veces con el seller apurándolo rompería la app.
 *
 * ⚠️ ESTE ENDPOINT NUNCA LOGUEA EL BODY, NI EN EL CATCH: el `codigo` de un
 * escaneo puede traer el JSON completo de la etiqueta Flex (`hash_code`,
 * `security_digit`), que `PATRON_LLAVE_SENSIBLE` no redacta por FORMA (sus
 * llaves con `{`, `"`, `:` caen fuera de la clase de caracteres del regex) —
 * un log crudo del body viajaría íntegro a observabilidad.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sesionId: string }> },
) {
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

  const { sesionId } = await params;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!Array.isArray(body.escaneos) || body.escaneos.length === 0) {
    return NextResponse.json({ error: "Falta escaneos" }, { status: 400 });
  }
  if (body.escaneos.length > MAX_ESCANEOS_POR_LOTE) {
    return NextResponse.json(
      {
        error: `El lote supera el máximo de ${MAX_ESCANEOS_POR_LOTE} escaneos por petición.`,
        codigo: "lote_excede_maximo",
        maximo: MAX_ESCANEOS_POR_LOTE,
      },
      { status: 400 },
    );
  }

  try {
    const cliente = crearClienteServiceRole();

    // Canario de aislamiento: ÚNICA consulta antes de tocar bultos_retiro. Un
    // sesionId de otro tenant o de otro conductor no encuentra fila -> 404,
    // sin que el lote llegue a escribir un solo bulto.
    const { data: sesion } = await cliente
      .from("sesiones_retiro")
      .select("id, estado, seller_id")
      .eq("id", sesionId)
      .eq("tenant_id", usuario.tenantId)
      .eq("conductor_id", usuario.driverId)
      .maybeSingle();

    if (!sesion) {
      return NextResponse.json({ error: "Visita de retiro no encontrada" }, { status: 404 });
    }

    const escaneos: EscaneoEntrada[] = body.escaneos.map((e) => ({
      escaneoId: typeof e?.escaneoId === "string" ? e.escaneoId : "",
      codigo: typeof e?.codigo === "string" ? e.codigo : "",
      escaneadoEn: typeof e?.escaneadoEn === "string" ? e.escaneadoEn : "",
    }));

    const { resultados } = await registrarLoteEscaneos(cliente, {
      tenantId: usuario.tenantId,
      sesionId: sesion.id as string,
      conductorId: usuario.driverId,
      sellerIdBodega: sesion.seller_id as string,
      sesionCerrada: sesion.estado === "cerrada",
      escaneos,
    });

    return NextResponse.json({ resultados });
  } catch (err) {
    // Deliberadamente NO se loguea `body`, `err` completo, ni `err.message`:
    // ver el comentario de cabecera. Solo el nombre del error y los
    // identificadores de negocio, que nunca llevan el crudo de un QR.
    console.error(
      "[api/conductor/retiros/:sesionId/escaneos] fallo al registrar el lote",
      err instanceof Error ? err.name : "error desconocido",
      { tenantId: usuario.tenantId, sesionId },
    );
    return NextResponse.json({ error: "Error al registrar el lote de escaneos" }, { status: 500 });
  }
}
