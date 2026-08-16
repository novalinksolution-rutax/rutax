/**
 * POST /api/conductor/traspasos — recibir bultos de otro conductor (etapa 9).
 *
 * Pedro escanea los bultos que Juan le pasa en la calle y quedan suyos. Molde:
 * `api/conductor/retiros/[sesionId]/escaneos/route.ts` — mismo Bearer, mismo
 * `service_role`, misma respuesta 200-con-detalle-por-elemento.
 *
 * =============================================================================
 * EL RECEPTOR NO ES UN PARÁMETRO. SALE DEL TOKEN.
 * =============================================================================
 * Es la decisión de seguridad central de esta ruta. El cuerpo del request trae
 * SOLO los códigos escaneados; el conductor que recibe es `usuario.driverId`.
 * Si el receptor viajara en el cuerpo, cualquier conductor podría moverle
 * pedidos —y por tanto plata— a otro con un curl. Así, lo peor que puede hacer
 * es traérselos a sí mismo, que es exactamente el gesto que la pantalla ofrece.
 *
 * Por lo mismo la capacidad se llama `recibir_traspaso_propio` y no
 * `asignar_*`: sigue siendo "lo propio", el límite declarado del rol conductor.
 *
 * =============================================================================
 * AISLAMIENTO: AQUÍ HAY DOS CONDUCTORES, ASÍ QUE EL CANARIO HABITUAL NO BASTA
 * =============================================================================
 * Estas rutas corren con `service_role`, que salta RLS: el aislamiento son los
 * filtros explícitos. En el retiro basta con "esta sesión es mía"; acá hay un
 * conductor de ORIGEN que no controlamos, así que el filtro de tenant vive
 * dentro del RPC (`traspasar_pedidos_a_conductor`), en cada uno de sus JOIN, y
 * un pedido de otro courier se OMITE como `ajeno` en vez de lanzar — nunca se
 * confirma que un id ajeno existe.
 *
 * ⚠️ NUNCA se loguea el cuerpo, ni en el catch: el código escaneado puede traer
 * el JSON completo de la etiqueta Flex, con su `hash_code`, que el redactor de
 * logs no cubre por forma. Mismo criterio que el endpoint de escaneos.
 */

import { NextResponse, type NextRequest } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { puedeRecibirTraspaso } from "@/modules/identidad/capacidades";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  traspasarBultosEscaneados,
  ErrorLoteExcedido,
  MAX_BULTOS_POR_TRASPASO,
} from "@/modules/operacion/traspaso";

export async function POST(request: NextRequest) {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (!usuario || usuario.tipoUsuario !== "conductor" || !usuario.driverId || !usuario.tenantId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (usuario.estado !== "activo") {
    return NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 });
  }
  // La capacidad se comprueba de VERDAD y no se da por implícita en
  // `tipoUsuario === "conductor"`. Declararla en `capacidades.ts` y no
  // consultarla en ningún lado la volvería decorativa — y este proyecto ya tiene
  // el antecedente de funciones escritas sin llamador. Si algún día se le quita
  // al rol, esta ruta se cierra sola.
  if (!puedeRecibirTraspaso(usuario)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let codigos: unknown;
  try {
    const cuerpo = (await request.json()) as { codigos?: unknown };
    codigos = cuerpo?.codigos;
  } catch {
    // Sin detalle del cuerpo a propósito (ver cabecera).
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  if (!Array.isArray(codigos) || codigos.some((c) => typeof c !== "string")) {
    return NextResponse.json(
      { error: "Se espera { codigos: string[] }" },
      { status: 400 },
    );
  }

  // Lote vacío: 400 explícito. La pantalla no deja enviar cero, así que un lote
  // vacío es un defecto del llamador y decirlo ayuda a encontrarlo; devolver
  // "0 de 0" lo escondería.
  if (codigos.length === 0) {
    return NextResponse.json({ error: "No llegó ningún código" }, { status: 400 });
  }

  try {
    const resultado = await traspasarBultosEscaneados(crearClienteServiceRole(), {
      tenantId: usuario.tenantId,
      conductorReceptorId: usuario.driverId,
      actorUsuarioId: usuario.usuarioId,
      codigos: codigos as string[],
    });

    return NextResponse.json(resultado, { status: 200 });
  } catch (err) {
    if (err instanceof ErrorLoteExcedido) {
      return NextResponse.json(
        { error: err.message, codigo: err.codigo, maximo: MAX_BULTOS_POR_TRASPASO },
        { status: 400 },
      );
    }
    // El mensaje del dominio SÍ se devuelve (son textos de negocio ya
    // redactados, sin datos de terceros); el cuerpo del request, nunca.
    const mensaje = err instanceof Error ? err.message : "No se pudieron recibir los bultos.";
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
