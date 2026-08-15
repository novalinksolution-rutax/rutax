import { type NextRequest, NextResponse } from "next/server";

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  registrarConsentimientoUbicacion,
  tieneConsentimientoVigente,
  VERSION_TEXTO_CONSENTIMIENTO_PUNTO_TERMINO,
} from "@/modules/operacion/consentimiento-ubicacion";
import { FINALIDAD_PUNTO_TERMINO } from "@/modules/operacion/punto-termino-conductor";

/**
 * `POST /api/conductor/punto-termino/consentimiento` — la app nativa registra la
 * decisión del conductor sobre guardar dónde termina su ruta.
 * =============================================================================
 * Body: `{ acepto: boolean }`.
 *
 * ## Por qué el rechazo TAMBIÉN se registra
 *
 * `acepto: false` no es un no-op. Se guarda por trazabilidad legal: la tabla
 * conserva el histórico de decisiones, y poder demostrar que a un conductor se
 * le preguntó y dijo que no —y a qué redacción dijo que no— es parte de lo que
 * hace defendible el tratamiento del que dijo que sí.
 *
 * ⚠️ Y por eso mismo: **nada en la pantalla del coordinador puede derivarse de
 * este registro.** El rechazo vive en la bitácora y en esta tabla, que solo lee
 * el servidor. `docs/seguridad/punto-de-termino-conductor.md` §4.2 — bajo
 * subordinación laboral el consentimiento solo es libre si negarse no queda a la
 * vista de quien manda; si el jefe pudiera ver quién declinó, el consentimiento
 * de todos los demás quedaría contaminado.
 *
 * ## La versión del texto la pone el SERVIDOR
 *
 * `VERSION_TEXTO_CONSENTIMIENTO_PUNTO_TERMINO` no viene del cliente. Si la
 * pusiera la app, una versión vieja instalada en un teléfono registraría
 * consentimientos contra una redacción que ya no es la que se mostró — y esa
 * constante existe justo para saber a qué texto dijo que sí cada conductor.
 *
 * ## Lo que este endpoint NO hace
 *
 * No guarda ninguna coordenada. Aceptar el texto y marcar el pin son dos actos
 * distintos, en ese orden: aceptar aquí, y después `PUT /api/conductor/punto-termino`.
 * Revocar es al revés y va por `DELETE` de esa misma ruta, que además borra la
 * fila — revocar aquí solo marcaría el consentimiento y dejaría el domicilio
 * guardado, que es exactamente el fallo que §5.3 evita.
 */
export async function POST(request: NextRequest) {
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

  let body: { acepto?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (typeof body.acepto !== "boolean") {
    return NextResponse.json({ error: "Falta `acepto` (booleano)" }, { status: 400 });
  }

  try {
    const cliente = crearClienteServiceRole();

    // Otorgar dos veces seguidas no crea dos filas abiertas. `registrar…`
    // siempre INSERTA (la tabla es un historial de eventos) y
    // `revocar…` cierra solo la MÁS RECIENTE, así que un doble otorgamiento
    // dejaría una fila `acepto = true, revocado_en = null` viva para siempre
    // después de que el conductor revoque. Hoy no rompe nada porque
    // `tieneConsentimientoVigente` mira solo la última fila; la trampa es para
    // el primero que escriba `where acepto and revocado_en is null` en un job de
    // purga o un reporte. Se cierra no creando el duplicado.
    //
    // El RECHAZO no lleva esta guarda a propósito: decir que no es un evento
    // que siempre vale la pena registrar, y no deja ninguna fila abierta.
    const yaConsintio =
      body.acepto === true &&
      (await tieneConsentimientoVigente(
        cliente,
        usuario.tenantId,
        usuario.driverId,
        FINALIDAD_PUNTO_TERMINO,
      ));

    if (!yaConsintio) {
      await registrarConsentimientoUbicacion(cliente, {
        tenantId: usuario.tenantId,
        conductorId: usuario.driverId,
        actorUsuarioId: usuario.usuarioId,
        acepto: body.acepto,
        versionTexto: VERSION_TEXTO_CONSENTIMIENTO_PUNTO_TERMINO,
        finalidad: FINALIDAD_PUNTO_TERMINO,
      });
    }

    return NextResponse.json(
      { ok: true, acepto: body.acepto },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error al registrar el consentimiento" },
      { status: 500 },
    );
  }
}
