import { type NextRequest, NextResponse } from "next/server";

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  definirPuntoTermino,
  ErrorCoordenadaPuntoTerminoInvalida,
  ErrorSinConsentimientoPuntoTermino,
  FINALIDAD_PUNTO_TERMINO,
  obtenerPuntoTerminoPropio,
  revocarPuntoTermino,
} from "@/modules/operacion/punto-termino-conductor";
import { tieneConsentimientoVigente } from "@/modules/operacion/consentimiento-ubicacion";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { obtenerManifiestoVigenteDelConductor } from "@/modules/operacion/manifiesto-vigente";
import { calcularYAplicarRutaManifiesto } from "@/modules/operacion/ruta-manifiesto";
import { leerParadasYAnclarCerradas } from "@/modules/operacion/ruteo/anclas-cerradas";

/**
 * Punto de término de ruta del conductor — superficie para la app nativa.
 * =============================================================================
 * `GET | PUT | DELETE /api/conductor/punto-termino`
 *
 * FUENTE DE VERDAD: `docs/seguridad/punto-de-termino-conductor.md`. Manda sobre
 * todo lo que toque este dato.
 *
 * ## Por qué esta ruta existe y no una consulta directa
 *
 * `operacion.punto_termino_conductor` **no tiene vista en `public` ni un solo
 * `grant` a `authenticated`** (§6.1). Su política de RLS —solo el propio
 * conductor— está escrita y **inerte a propósito**: correcta el día que alguien
 * exponga la tabla, inútil hoy porque nadie la consulta por PostgREST. La app
 * del conductor llega a todo lo suyo por rutas Bearer con `service_role`, y esta
 * es una más (§6.3, resuelto el 2026-08-14).
 *
 * Consecuencia directa: **el filtro por conductor lo pone este archivo**, igual
 * que en las otras rutas Bearer. `usuario.driverId` y `usuario.tenantId` salen
 * del JWT verificado; ningún identificador de conductor se acepta por body ni
 * por query. Un conductor no puede pedir el punto de otro porque no hay forma de
 * nombrarlo.
 *
 * ## Lo único que este archivo NO puede hacer
 *
 * Devolver el punto de un conductor que no sea el autenticado. No existe una
 * variante "de un conductor cualquiera" en el módulo, y no debe agregarse: el
 * dato es del trabajador y **nadie más lo ve**, ni el coordinador, ni el dueño,
 * ni el seller (§4). Si alguna vez aparece un `?conductorId=` en esta ruta, es
 * un bug de privacidad, no una mejora de API.
 *
 * ## El consentimiento va aparte
 *
 * Otorgarlo o rechazarlo es su propio acto y su propio endpoint
 * (`./consentimiento`). `PUT` aquí **falla cerrado** con 409 si no hay
 * consentimiento vigente de la finalidad `punto_termino_ruta`: la base de
 * licitud de este dato es el consentimiento, no el contrato de trabajo.
 */

interface UsuarioConductor {
  usuarioId: string;
  tenantId: string;
  driverId: string;
}

/**
 * Autentica y exige conductor activo. Devuelve la respuesta de error ya armada
 * en vez de lanzar, para que cada verbo la devuelva tal cual.
 */
async function exigirConductor(
  request: NextRequest,
): Promise<{ usuario: UsuarioConductor } | { respuesta: NextResponse }> {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (
    !usuario ||
    usuario.tipoUsuario !== "conductor" ||
    !usuario.driverId ||
    !usuario.tenantId
  ) {
    return { respuesta: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }
  if (usuario.estado !== "activo") {
    return { respuesta: NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 }) };
  }
  return {
    usuario: {
      usuarioId: usuario.usuarioId,
      tenantId: usuario.tenantId,
      driverId: usuario.driverId,
    },
  };
}

// =============================================================================
// GET — su propio punto
// =============================================================================

/**
 * Devuelve el punto de término del conductor autenticado, o `null` si no lo
 * definió, más si tiene consentimiento vigente (la app necesita saber si mostrar
 * la pantalla de consentimiento o la del mapa).
 *
 * `no-store` explícito: es un dato personal del trabajador y no tiene por qué
 * quedar en ninguna caché intermedia.
 */
export async function GET(request: NextRequest) {
  const auth = await exigirConductor(request);
  if ("respuesta" in auth) return auth.respuesta;
  const { tenantId, driverId } = auth.usuario;

  try {
    const cliente = crearClienteServiceRole();
    const [punto, consentimientoVigente] = await Promise.all([
      obtenerPuntoTerminoPropio(cliente, tenantId, driverId),
      tieneConsentimientoVigente(cliente, tenantId, driverId, FINALIDAD_PUNTO_TERMINO),
    ]);

    return NextResponse.json(
      { puntoTermino: punto, consentimientoVigente },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error al leer el punto de término" },
      { status: 500 },
    );
  }
}

// =============================================================================

// =============================================================================
// Rehacer la ruta con el punto de término nuevo
// =============================================================================
/**
 * El punto de término es **el final de la ruta**, así que moverlo cambia cuál
 * es la mejor secuencia de lo que falta. Hasta el 2026-08-27 no lo cambiaba: el
 * conductor corregía su dirección de término en plena entrega, la guardaba, y
 * la ruta seguía igual. El dato se usaba solo en el siguiente cálculo, que
 * podía no llegar nunca.
 *
 * Tres decisiones que no son obvias:
 *
 * · **Las cerradas se anclan**, igual que al reordenar. Recalcular a media
 *   jornada no puede reubicar entregas ya hechas.
 *
 * · **Si el manifiesto no tiene secuencia, no se toca.** Que nadie lo haya
 *   ruteado es un estado con su propia pantalla («Ordenar la ruta»), y ese
 *   botón ya va a leer el punto nuevo. Rutear de callada al guardar una
 *   dirección convertiría un ajuste de perfil en una decisión operativa.
 *
 * · **Un fallo acá NUNCA tumba el guardado.** El punto ya quedó escrito y es
 *   dato personal del conductor: devolver 500 lo dejaría creyendo que no se
 *   guardó, y volvería a intentarlo. Se registra y se informa con
 *   `rutaRecalculada: false`.
 */
async function rehacerRutaConTerminoNuevo(
  cliente: ReturnType<typeof crearClienteServiceRole>,
  entrada: { tenantId: string; driverId: string; actorUsuarioId: string },
): Promise<boolean> {
  try {
    const vigente = await obtenerManifiestoVigenteDelConductor(cliente, {
      tenantId: entrada.tenantId,
      driverId: entrada.driverId,
      fecha: fechaLocalEnSantiago(new Date()),
    });
    if (!vigente) return false;

    const { fijaciones, tieneSecuencia } = await leerParadasYAnclarCerradas(cliente, {
      tenantId: entrada.tenantId,
      manifiestoId: vigente.id,
    });
    if (!tieneSecuencia) return false;

    await calcularYAplicarRutaManifiesto(cliente, {
      tenantId: entrada.tenantId,
      manifiestoId: vigente.id,
      actorUsuarioId: entrada.actorUsuarioId,
      fijarAdicionales: fijaciones,
    });
    return true;
  } catch (err) {
    console.error(
      "[api/conductor/punto-termino] el punto se guardó pero la ruta no se rehizo:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

// =============================================================================
// PUT — definir o redefinir
// =============================================================================

/**
 * Guarda el pin que marcó el conductor. Body: `{ lat: number, long: number }`.
 *
 * **Solo dos números.** No se acepta —ni se ignora en silencio— un campo de
 * dirección en texto: §8.2 prohíbe guardar el texto de la dirección del
 * conductor en ninguna columna de ninguna tabla, y §8.3 prohíbe hacerla pasar
 * por `resolverCoordenadaConCache` (ese caché es global, sin `tenant_id`, en
 * claro y sin purga: haría FALSA la promesa de borrado). Un body con `direccion`
 * se rechaza con 400 para que el error aparezca en desarrollo y no como un
 * campo que "no hizo nada".
 *
 * Devuelve lo que quedó GUARDADO, ya redondeado a 3 decimales por el trigger de
 * la base — nunca lo que se pidió guardar. Devolver el input mentiría al
 * conductor sobre la precisión con la que se le guardó.
 */
export async function PUT(request: NextRequest) {
  const auth = await exigirConductor(request);
  if ("respuesta" in auth) return auth.respuesta;
  const { tenantId, driverId, usuarioId } = auth.usuario;

  let body: { lat?: unknown; long?: unknown; direccion?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (body.direccion !== undefined) {
    return NextResponse.json(
      {
        error:
          "El punto de término se guarda como coordenada, nunca como dirección en texto.",
      },
      { status: 400 },
    );
  }

  if (typeof body.lat !== "number" || typeof body.long !== "number") {
    return NextResponse.json({ error: "Faltan lat y long numéricos" }, { status: 400 });
  }

  try {
    const punto = await definirPuntoTermino(crearClienteServiceRole(), {
      tenantId,
      conductorId: driverId,
      actorUsuarioId: usuarioId,
      lat: body.lat,
      long: body.long,
    });

    // Después de guardar, no antes: si el guardado falla no hay término nuevo
    // con el que rutear, y recalcular con el viejo sería trabajo para nada.
    const rutaRecalculada = await rehacerRutaConTerminoNuevo(crearClienteServiceRole(), {
      tenantId,
      driverId,
      actorUsuarioId: usuarioId,
    });

    return NextResponse.json(
      { puntoTermino: punto, rutaRecalculada },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof ErrorSinConsentimientoPuntoTermino) {
      // 409 y no 403: no es "no tienes permiso", es "falta un paso previo que tú
      // mismo controlas". La app lo traduce a la pantalla de consentimiento.
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof ErrorCoordenadaPuntoTerminoInvalida) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error al guardar el punto de término" },
      { status: 500 },
    );
  }
}

// =============================================================================
// DELETE — quitarlo
// =============================================================================

/**
 * El conductor retira su punto: bitácora, `revocado_en` en el consentimiento y
 * **DELETE de la fila** — no `activa = false` (§5.3). Aquí no cuelga plata, ni
 * prueba, ni respaldo contable: conservar la fila sería conservar el domicilio
 * de un trabajador sin un solo motivo.
 *
 * Idempotente, y tiene que serlo: el control en la app es de UN TOQUE, sin
 * confirmación en cadena, así que un doble toque no puede devolver un error.
 */
export async function DELETE(request: NextRequest) {
  const auth = await exigirConductor(request);
  if ("respuesta" in auth) return auth.respuesta;
  const { tenantId, driverId, usuarioId } = auth.usuario;

  try {
    await revocarPuntoTermino(crearClienteServiceRole(), {
      tenantId,
      conductorId: driverId,
      actorUsuarioId: usuarioId,
    });
    // Simétrico al PUT: quitarlo también cambia dónde termina la ruta, así que
    // la secuencia que se calculó apuntando a ese destino deja de ser la buena.
    const rutaRecalculada = await rehacerRutaConTerminoNuevo(crearClienteServiceRole(), {
      tenantId,
      driverId,
      actorUsuarioId: usuarioId,
    });

    return NextResponse.json(
      { ok: true, rutaRecalculada },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error al quitar el punto de término" },
      { status: 500 },
    );
  }
}
