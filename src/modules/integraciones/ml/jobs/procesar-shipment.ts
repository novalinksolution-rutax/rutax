/**
 * Job 3 · ml/procesarShipmentActualizado
 * =====================================================================
 * Trigger: evento `ml/shipment.actualizado`
 * (publicado por el webhook handler y por el job de polling de respaldo)
 *
 * Lógica:
 * 1. Resolver qué pedido tiene este shipment_id (consulta operacion.pedidos).
 *    El UNIQUE es (tenant_id, ml_shipment_id), NO (ml_shipment_id) — un mismo
 *    shipment puede existir en >1 tenant; se desambigua por el `userId`
 *    (ml_user_id) del evento. Por eso NO se usa `.maybeSingle()`.
 * 1b. **Si el envío NO está en BD, se INGESTA** (ver el bloque de abajo).
 * 2. Obtener el token del seller y leer GET /shipments/{id} (fuente de verdad)
 *    vía `peticionMl` (backoff/Retry-After) con header `x-format-new: true`.
 * 3. Traducir status + substatus de ML al estado interno.
 * 4. Delegar en `actualizarEstadoPedido` del módulo `operacion` — salvo la
 *    CANCELACIÓN, que se publica como evento y no se aplica aquí.
 *
 * ---------------------------------------------------------------------------
 * EL ENVÍO DESCONOCIDO SE INGESTA (corrección de 2026-08-13)
 * ---------------------------------------------------------------------------
 * Antes, un shipment que no estaba en `operacion.pedidos` se descartaba en
 * silencio con el comentario «puede ser de un seller no conectado». El
 * razonamiento estaba al revés: **ML solo notifica cuentas que autorizaron
 * nuestra app**, así que si el `user_id` de la notificación calza con una
 * conexión nuestra, ese envío ES nuestro — y no está en la base porque nunca lo
 * ingestamos. Ese descarte era la mitad del bloqueador raíz: un pedido Flex
 * nuevo no entraba al sistema.
 *
 * Ahora: se resuelve la conexión por `ml_user_id`; si existe, se ingesta con la
 * pieza compartida (`../ingesta-pedidos.ts`). Si el `user_id` NO corresponde a
 * ninguna conexión, ahí sí se ignora — ese es el caso real de «seller no
 * conectado» (y el webhook ya lo filtra antes de encolar).
 *
 * ---------------------------------------------------------------------------
 * 🔴 CUENTA APAGADA: SE SALE LIMPIO, NO SE LANZA (26-08-2026)
 * ---------------------------------------------------------------------------
 * Desconectar una cuenta de venta NO le revoca el permiso a Rutax en ML, así que
 * ML **sigue notificando** esa cuenta. Sus pedidos ya están en `operacion.pedidos`
 * (se ingestaron antes de apagarla), así que la notificación llegaba hasta el
 * paso 2 y ahí moría: `access_token_ref` en null → `throw` → 4 reintentos →
 * alerta en Sentry. Una por notificación, para un estado que alguien pidió.
 *
 * Ahora el paso devuelve un centinela `{ omitido }` y el job termina sin error.
 * El `resultado` separa `conexion_desconectada_por_persona` de
 * `conexion_sin_token` porque en el panel de Inngest eso es justo lo que uno
 * necesita saber: la primera la pidió alguien, la segunda hay que ir a mirarla.
 *
 * ⚠️ La barrera de verdad está en el webhook, que ya no encola para una cuenta
 * desvinculada. Esto es defensa en profundidad: cubre los eventos que quedaron
 * encolados, el polling de respaldo y cualquier emisor futuro. **Las dos mitades
 * se mueven juntas.**
 *
 * ⚠️ Y deja un cabo que este job no puede cerrar: los pedidos de esa cuenta que
 * quedaron en vuelo ya no reciben actualizaciones de NINGUNA fuente y su estado
 * ML queda congelado. Es consecuencia de apagar la cuenta, no de este cambio.
 *
 * Idempotencia y no-reintento:
 * - Si el pedido ya está en el estado traducido → no-op.
 * - `ErrorConflicto` (optimistic locking perdido ante otra ejecución
 *   concurrente) → loguear y terminar sin reintento.
 * - `ErrorTransicionInvalida` (ML reporta un estado al que la máquina de estados
 *   no permite transicionar) → loguear y terminar sin reintento (reintentar 4×
 *   sería inútil; la conciliación C6 detecta la discrepancia).
 *
 * SEGURIDAD: el access token nunca aparece en logs ni en el payload del evento.
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { descifrarSecreto } from "../../secretos";
import { peticionMl, ErrorHttpMl } from "../cliente-http";
import { traducirEstadoMl } from "../traduccion-estados";
import { esCancelacionMl, publicarCancelacionEnMl } from "../cancelacion-ml";
import { ingestarShipmentsMl, type ContextoIngestaMl } from "../ingesta-pedidos";
import { actualizarEstadoPedido } from "@/modules/operacion";
import type {
  ActualizarEstadoEntrada,
  EstadoPedidoInterno,
  PedidoResumen,
} from "../tipos-operacion";

/** Respuesta del endpoint /shipments/{id} de ML (campos que usamos). */
interface RespuestaShipmentMl {
  id: number | string;
  status: string;
  substatus?: string | null;
}

/** Fila interna de conexión con la referencia al access token. */
interface FilaConexionToken {
  id: string;
  access_token_ref: string | null;
  estado_salud: string;
  /**
   * Solo para distinguir la DECISIÓN de la avería en el log y en el resultado
   * del run. Se reduce a booleano dentro del paso y **el id nunca sale**: la
   * salida de un `step.run` la persiste Inngest y queda a la vista en su panel.
   * Mismo trato que le da `aConexionPublica` en el puerto.
   */
  desconectada_por_usuario_id: string | null;
}

/**
 * Inyectable para tests: la función real de `actualizarEstadoPedido` del módulo
 * `operacion`. En producción usa el adaptador real por defecto (abajo); en
 * tests se sustituye con un mock vía `setFnActualizarEstado`.
 */
export type FnActualizarEstado = (entrada: ActualizarEstadoEntrada) => Promise<void>;

/**
 * Adaptador REAL por defecto: traduce la entrada del job (forma `sistema_ml`)
 * a la entrada del módulo `operacion` y delega en `actualizarEstadoPedido`.
 *
 * Detalles del puente:
 * - `ejecutor: 'sistema'` → NO requiere RBAC, NO requiere actor, NO exige
 *   `motivo` (eso es solo para correcciones `'interno'`). Por eso no se pasa
 *   `actuadoPorUsuarioId` ni `actor`.
 * - `tenantId` viaja en la entrada del job (resuelto en el paso `resolver-pedido`),
 *   y se usa para el aislamiento de tenant en la lectura/UPDATE de `operacion`.
 * - `actualizarEstadoPedido` YA se encarga de: optimistic locking
 *   (`ErrorConflicto`), validación de la máquina de estados
 *   (`ErrorTransicionInvalida`), apertura idempotente de incidencia en
 *   fallidos y publicación post-commit del evento financiero. NO se duplica
 *   nada de eso aquí.
 * - Se pasa el cliente service_role CRUDO (sin `.schema(...)`), igual que el
 *   resto de llamadores de `actualizarEstadoPedido` (p. ej. la Server Action de
 *   `(tenant)/operaciones`): `operacion` está en el `extra_search_path` de cada
 *   request (ver `supabase/config.toml`), por lo que `cliente.from("pedidos")`
 *   resuelve a `operacion.pedidos`.
 *
 * Devuelve `Promise<void>` (la firma del puerto): el `Pedido` que retorna
 * `actualizarEstadoPedido` no lo necesita el job, que solo actualiza metadatos
 * de ML después.
 */
export async function actualizarEstadoPedidoReal(
  entrada: ActualizarEstadoEntrada,
): Promise<void> {
  const supabase = crearClienteServiceRole();
  await actualizarEstadoPedido(supabase, {
    pedidoId: entrada.pedidoId,
    tenantId: entrada.tenantId,
    estadoNuevo: entrada.estadoNuevo,
    estadoEsperado: entrada.estadoEsperado,
    ejecutor: "sistema",
  });
}

/** Referencia mutable para inyección de dependencia en tests. */
let fnActualizarEstadoActual: FnActualizarEstado = actualizarEstadoPedidoReal;

/**
 * Permite a los tests sustituir la función de actualización de estado sin
 * importar el módulo `operacion` real (que está siendo construido en paralelo).
 * Solo debe llamarse en contexto de pruebas — no en código de producción.
 */
export function setFnActualizarEstado(fn: FnActualizarEstado): void {
  fnActualizarEstadoActual = fn;
}

export function resetFnActualizarEstado(): void {
  fnActualizarEstadoActual = actualizarEstadoPedidoReal;
}

/** Conexión candidata a ser dueña de un envío que todavía no está en BD. */
interface FilaConexionDueña {
  id: string;
  tenant_id: string;
  seller_id: string;
  ml_user_id: string | null;
  access_token_ref: string | null;
  estado_salud: string;
}

/**
 * Ingesta un envío que ML notificó y que NO existe en `operacion.pedidos`.
 *
 * Resuelve la(s) conexión(es) cuyo `ml_user_id` coincide con el de la
 * notificación. **`ml_user_id` no es único globalmente** (la misma cuenta de ML
 * puede estar conectada por dos couriers distintos; el UNIQUE es
 * `(seller_id, ml_user_id)`), así que se ingesta para CADA conexión que calce:
 * cada tenant tiene derecho a su propia fila y el UNIQUE de pedidos es
 * `(tenant_id, ml_shipment_id)`.
 *
 * Si no calza ninguna conexión, el envío no es nuestro: se ignora sin llamar a
 * ML ni escribir nada.
 *
 * Exportada para que la prueba ejerza ESTE código —incluida la de que un
 * `user_id` ajeno no ingesta nada— y no una copia espejo.
 */
export async function ingestarShipmentDesconocido(
  shipmentId: string,
  userId: string,
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void },
): Promise<{
  resultado: "sin_conexion" | "ingestado" | "nada_que_ingestar";
  insertados: number;
  actualizados: number;
  omitidosNoFlex: number;
  noEncontrados: number;
}> {
  const vacio = { insertados: 0, actualizados: 0, omitidosNoFlex: 0, noEncontrados: 0 };
  const supabase = crearClienteServiceRole();

  const { data, error } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select("id, tenant_id, seller_id, ml_user_id, access_token_ref, estado_salud")
    .eq("ml_user_id", String(userId));

  if (error) {
    throw new Error(`Error al resolver la conexión del envío notificado: ${error.message}`);
  }

  const conexiones = ((data ?? []) as FilaConexionDueña[]).filter(
    (c) => c.access_token_ref && c.estado_salud !== "desvinculada",
  );

  if (conexiones.length === 0) {
    // Caso REAL de "seller no conectado": el user_id no es de ninguna cuenta
    // vinculada a nosotros (o su conexión está caída y la gestiona el sondeo de
    // salud). Ni una llamada a ML, ni una escritura.
    logger.info(
      `Shipment ${shipmentId}: la cuenta ML ${userId} no corresponde a ninguna conexión ` +
        "activa. Se ignora sin ingestar.",
    );
    return { resultado: "sin_conexion", ...vacio };
  }

  const totales = { ...vacio };

  for (const conexion of conexiones) {
    let accessToken: string;
    try {
      const descifrado = await descifrarSecreto(conexion.access_token_ref!);
      if (typeof descifrado.valor !== "string") throw new Error("no es texto");
      accessToken = descifrado.valor;
    } catch {
      // El mensaje del error de descifrado no se propaga: podría llevar
      // fragmentos del material cifrado.
      logger.warn(
        `Shipment ${shipmentId}: no se pudo obtener el token de la conexión ` +
          `${conexion.id}. Se omite esa cuenta.`,
      );
      continue;
    }

    const ctx: ContextoIngestaMl = {
      tenantId: conexion.tenant_id,
      sellerId: conexion.seller_id,
      mlUserId: String(conexion.ml_user_id),
      origen: "ml_ingesta",
    };

    const resumen = await ingestarShipmentsMl(supabase, [{ shipmentId }], ctx, accessToken, {
      logger,
    });

    totales.insertados += resumen.insertados;
    totales.actualizados += resumen.actualizados;
    totales.omitidosNoFlex += resumen.omitidosNoFlex;
    totales.noEncontrados += resumen.noEncontrados.length;

    if (resumen.noEncontrados.length > 0) {
      // 404 en un envío que ML acaba de notificar: raro, pero NUNCA se
      // interpreta como cancelación (la doc de ML no dice qué devuelve para un
      // envío cancelado). Queda visible y sin efecto sobre ningún estado.
      logger.error(
        `Shipment ${shipmentId}: ML respondió 404 al consultarlo tras su propia ` +
          "notificación. No se asume cancelación y no se toca ningún estado.",
      );
    }
    // El token en claro sale de scope en cada vuelta.
  }

  const hizoAlgo = totales.insertados + totales.actualizados > 0;
  return { resultado: hizoAlgo ? "ingestado" : "nada_que_ingestar", ...totales };
}

export const jobProcesarShipmentActualizado = inngest.createFunction(
  {
    id: "ml/procesarShipmentActualizado",
    name: "ML · Procesar actualización de shipment",
    triggers: [{ event: "ml/shipment.actualizado" }],
    retries: 4,
  },
  async ({ event, step, logger }) => {
    const { shipmentId, userId } = event.data as {
      shipmentId: string;
      userId: string;
      timestamp: string;
    };
    const fnActualizar = fnActualizarEstadoActual;

    // Paso 1: resolver qué pedido corresponde a este shipment en BD.
    //
    // COLISIÓN MULTI-TENANT: el UNIQUE de `operacion.pedidos` es
    // (tenant_id, ml_shipment_id), NO (ml_shipment_id) solo. Un mismo
    // shipment_id de ML puede existir en pedidos de >1 tenant (p. ej. la misma
    // cuenta de ML conectada por dos couriers). Por eso NO se usa
    // `.maybeSingle()` (que ERRORearía con 2+ filas y perdería la transición):
    // se leen TODAS las filas y se desambigua por el `userId` (ml_user_id) que
    // viene en el evento — el shipment pertenece a la cuenta ML que lo notificó.
    const pedido = await step.run("resolver-pedido", async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema("operacion")
        .from("pedidos")
        .select("id, tenant_id, seller_id, ml_shipment_id, estado, estado_ml")
        .eq("ml_shipment_id", shipmentId);

      if (error) {
        throw new Error(`Error al buscar pedido por shipment_id: ${error.message}`);
      }

      const filas = (data ?? []) as Array<{
        id: string;
        tenant_id: string;
        seller_id: string;
        ml_shipment_id: string;
        estado: EstadoPedidoInterno;
        estado_ml: string | null;
      }>;

      if (filas.length === 0) {
        // El envío NO está en `operacion.pedidos`. Antes se descartaba aquí en
        // silencio; ahora se marca para ingestarlo (ver el bloque del
        // encabezado): ML solo notifica cuentas que autorizaron nuestra app.
        return { faltaEnBd: true as const };
      }

      let fila = filas[0];

      // Desambiguar por la cuenta ML que notificó (userId = ml_user_id). Solo
      // se consulta el cruce si hay colisión real (>1 fila) — el caso normal
      // (1 fila) no paga el join.
      if (filas.length > 1) {
        const sellerIds = filas.map((f) => f.seller_id);
        const { data: conexiones, error: errConex } = await supabase
          .schema("identidad")
          .from("conexiones_seller_ml")
          .select("seller_id, ml_user_id")
          .in("seller_id", sellerIds)
          .eq("ml_user_id", String(userId));

        if (errConex) {
          throw new Error(
            `Error al desambiguar shipment ${shipmentId} por ml_user_id: ${errConex.message}`,
          );
        }

        const sellersDelUser = new Set(
          ((conexiones ?? []) as Array<{ seller_id: string }>).map((c) => c.seller_id),
        );
        const filaDelUser = filas.find((f) => sellersDelUser.has(f.seller_id));

        if (!filaDelUser) {
          // Colisión sin coincidencia por ml_user_id: no podemos saber a qué
          // tenant pertenece. NO actualizamos a ciegas (riesgo de transición
          // cruzada). El polling de respaldo lo reintentará con su propia
          // resolución por seller; aquí terminamos sin error.
          logger.warn(
            `Shipment ${shipmentId} colisiona en ${filas.length} tenants y ninguno ` +
              `coincide con ml_user_id del evento. Se omite para evitar transición cruzada.`,
          );
          return null;
        }
        fila = filaDelUser;
      }

      return {
        id: fila.id,
        tenantId: fila.tenant_id,
        sellerId: fila.seller_id,
        mlShipmentId: fila.ml_shipment_id,
        estado: fila.estado,
        estadoMl: fila.estado_ml,
      } satisfies PedidoResumen;
    });

    // Colisión multi-tenant sin desambiguar: no se toca nada (ya se logueó).
    if (!pedido) return { resultado: "shipment_ambiguo" };

    // Paso 1b: el envío no está en BD → ingestarlo si es de una cuenta nuestra.
    //
    // No se intenta aplicar transición después: el pedido acaba de nacer con su
    // `estado_ml` real y su `estado` por defecto. Si el envío ya venía en un
    // estado avanzado (o incluso cancelado), el repaso del cron
    // `ml/ingestaPedidos` lo encuentra en la próxima corrida —sigue no
    // terminal— y publica lo que corresponda. Un camino, no dos.
    if ("faltaEnBd" in pedido) {
      const ingesta = await step.run("ingestar-shipment-desconocido", async () =>
        ingestarShipmentDesconocido(shipmentId, String(userId), logger),
      );
      const { resultado, ...conteos } = ingesta;
      return { resultado: `shipment_desconocido_${resultado}`, ...conteos };
    }

    // Paso 2: obtener el token del seller y consultar ML.
    const estadoMl = await step.run("consultar-ml", async () => {
      const supabase = crearClienteServiceRole();

      // Obtener el access_token_ref de la conexión de la CUENTA que originó el
      // envío (modelo 1:N — un seller puede tener varias cuentas ML). Se
      // resuelve por `(seller_id, ml_user_id)` usando el `userId` del evento;
      // el índice único parcial garantiza a lo sumo una fila → `maybeSingle`
      // es seguro. Si el evento no trae `userId` (no debería), se cae a la
      // conexión del seller sin filtrar por cuenta.
      let consulta = supabase
        .schema("identidad")
        .from("conexiones_seller_ml")
        .select("id, access_token_ref, estado_salud, desconectada_por_usuario_id")
        .eq("seller_id", pedido.sellerId);
      if (userId) {
        consulta = consulta.eq("ml_user_id", String(userId));
      }
      const { data: conexionData, error: conexionError } = await consulta
        .limit(1)
        .maybeSingle();

      if (conexionError) {
        throw new Error(`Error al buscar conexión del seller: ${conexionError.message}`);
      }

      const conexion = conexionData as FilaConexionToken | null;

      // 🔴 SIN CONEXIÓN QUE INGIERA NO ES UN FALLO DEL JOB — ver el bloque
      // «CUENTA APAGADA» del encabezado. Antes eran dos `throw`, y contra una
      // cuenta desconectada a propósito eso significaba 5 intentos y una alerta
      // en Sentry por cada notificación de ML, para un estado que alguien pidió.
      // Se sale limpio, igual que hace `polling-estados.ts` ante lo mismo.
      if (conexion?.estado_salud === "desvinculada" || !conexion?.access_token_ref) {
        return {
          // Solo el booleano cruza el borde del paso; el id se queda acá.
          omitido: conexion?.desconectada_por_usuario_id
            ? ("conexion_desconectada_por_persona" as const)
            : ("conexion_sin_token" as const),
        };
      }

      // Descifrar token SOLO para este request
      const descifrado = await descifrarSecreto(conexion.access_token_ref);
      if (typeof descifrado.valor !== "string") {
        throw new Error("access_token descifrado no es texto");
      }

      // FUENTE DE VERDAD: GET /shipments/{id} con el token del seller.
      // - `x-format-new: true` es OBLIGATORIO según la doc oficial de ML
      //   (ver docs/mercadolibre/05-mercado-envios-shipments.md). Sin él la
      //   respuesta puede venir en el formato legacy con otra forma.
      // - Se usa `peticionMl` (cliente-http) en vez de `fetch` crudo para
      //   heredar backoff/reintentos ante 429/5xx y respeto de `Retry-After`
      //   (skill flex-ml: respetar límites de tasa con backoff). El token nunca
      //   se asigna a variable de vida larga ni entra en logs.
      try {
        const datos = await peticionMl<RespuestaShipmentMl>({
          metodo: "GET",
          ruta: `/shipments/${shipmentId}`,
          accessToken: descifrado.valor,
          encabezadosExtra: { "x-format-new": "true" },
        });
        // El token en claro sale de scope aquí.
        return { status: datos.status, substatus: datos.substatus ?? null };
      } catch (error) {
        // 404 → el shipment no existe en ML; ignorar sin reintentar.
        if (error instanceof ErrorHttpMl && error.status === 404) {
          return null;
        }
        throw error; // 429/5xx ya vienen con backoff aplicado; el resto se propaga.
      }
    });

    // La cuenta no está ingiriendo: se termina sin tocar el pedido y sin error.
    // El `resultado` distingue la decisión de la avería, que es lo que uno
    // quiere leer en el panel de Inngest al preguntarse por qué no se actualizó.
    if (estadoMl && "omitido" in estadoMl) {
      if (estadoMl.omitido === "conexion_desconectada_por_persona") {
        logger.info(
          `Shipment ${shipmentId}: la cuenta ML ${userId ?? "?"} está desconectada a ` +
            "propósito. No se consulta ML ni se toca el pedido.",
        );
      } else {
        logger.warn(
          `Shipment ${shipmentId}: el seller ${pedido.sellerId} no tiene conexión ML ` +
            `que ingiera para la cuenta ${userId ?? "?"}. Se omite sin tocar el pedido.`,
        );
      }
      return { resultado: estadoMl.omitido, pedidoId: pedido.id };
    }

    if (!estadoMl) return { resultado: "shipment_no_existe_en_ml" };

    // Paso 3: traducir estado (status + substatus) y verificar idempotencia.
    const estadoInterno = traducirEstadoMl(estadoMl.status, estadoMl.substatus);

    if (!estadoInterno) {
      logger.info(
        `Estado ML '${estadoMl.status}'/'${estadoMl.substatus ?? "-"}' para shipment ` +
          `${shipmentId} no tiene traducción. Ignorando.`,
      );
      return { resultado: "estado_sin_traduccion", estadoMl: estadoMl.status };
    }

    // Idempotencia: si el pedido ya está en ese estado, no hacer nada.
    if (pedido.estado === estadoInterno) {
      logger.info(
        `Pedido ${pedido.id} ya está en estado '${estadoInterno}'. No-op idempotente.`,
      );
      return { resultado: "ya_en_estado", estado: estadoInterno };
    }

    // Paso 3b: CANCELACIÓN — se detecta y se avisa; NO se aplica aquí.
    //
    // Cancelar un pedido no es solo mover un enum: hay que cerrar la incidencia
    // y el cabo de dinero (una línea de cobro viva sobre un pedido cancelado es
    // plata mal facturada). Esa cadena tiene un dueño, y es el consumidor de
    // `operacion/pedido.cancelado-en-ml` — no este adaptador. El resto de las
    // transiciones se siguen aplicando como siempre.
    //
    // A propósito NO se escribe `estado_ml` en este camino: mientras el pedido
    // siga en un estado no terminal, el polling y el repaso del cron vuelven a
    // ver la diferencia y el aviso se reintenta solo. El `id` determinístico del
    // evento hace que el consumidor corra una única vez igual.
    if (esCancelacionMl(estadoMl.status, estadoMl.substatus)) {
      await step.run("publicar-cancelacion", async () =>
        publicarCancelacionEnMl(
          {
            pedidoId: pedido.id,
            tenantId: pedido.tenantId,
            sellerId: pedido.sellerId,
            mlShipmentId: pedido.mlShipmentId,
            estadoAnterior: pedido.estado,
            substatusMl: estadoMl.substatus,
          },
          logger,
        ),
      );
      logger.info(
        `Pedido ${pedido.id}: ML reporta cancelación del envío. Evento publicado; ` +
          "el estado y sus consecuencias las aplica el consumidor.",
      );
      return { resultado: "cancelacion_publicada", pedidoId: pedido.id };
    }

    // Helper: actualiza solo los METADATOS de ML del pedido (estado_ml,
    // subestado_ml, ultima_sync_ml_en). NO toca `estado` — así no pisa la
    // transición ni interfiere con el optimistic locking de
    // `actualizarEstadoPedido`. Es seguro ejecutarlo incluso si la transición
    // de estado no se aplicó (conflicto/transición inválida): registrar lo que
    // ML reportó por última vez es información útil para diagnóstico.
    const sincronizarMetadatosMl = async () => {
      const supabase = crearClienteServiceRole();
      await supabase
        .schema("operacion")
        .from("pedidos")
        .update({
          estado_ml: estadoMl.status,
          subestado_ml: estadoMl.substatus,
          ultima_sync_ml_en: new Date().toISOString(),
        })
        .eq("id", pedido.id);
    };

    // Paso 4: actualizar el estado del pedido en el módulo `operacion`.
    const resultadoPaso = await step.run("actualizar-estado-pedido", async () => {
      try {
        await fnActualizar({
          pedidoId: pedido.id,
          tenantId: pedido.tenantId,
          estadoNuevo: estadoInterno,
          estadoEsperado: pedido.estado,
          actuadoPor: "sistema_ml",
          motivo: `Actualización desde ML: status=${estadoMl.status}`,
        });

        await sincronizarMetadatosMl();
        return { resultado: "actualizado" as const };
      } catch (error) {
        const nombre = error instanceof Error ? error.name : "";

        // ErrorConflicto: otra ejecución ganó la carrera (optimistic locking).
        // El estado ya quedó donde debía — NO reintentar.
        if (nombre === "ErrorConflicto") {
          logger.warn(
            `Pedido ${pedido.id}: condición de carrera resuelta por otra ejecución. ` +
              "Terminando sin reintento.",
          );
          await sincronizarMetadatosMl();
          return { resultado: "conflicto_resuelto" as const };
        }

        // ErrorTransicionInvalida: ML reporta un estado al que la máquina de
        // estados NO permite transicionar desde el estado actual (p. ej. un
        // pedido ya 'entregado' que recibe un 'shipped' tardío, o un terminal).
        // Reintentar 4× es inútil: la transición NUNCA será válida. Se loguea,
        // se guarda el metadato de ML y se termina sin reintento (igual que el
        // conflicto). La discrepancia real la detecta la conciliación (C6).
        if (nombre === "ErrorTransicionInvalida") {
          logger.warn(
            `Pedido ${pedido.id}: ML reporta '${estadoMl.status}' → estado interno ` +
              `'${estadoInterno}', transición inválida desde '${pedido.estado}'. ` +
              "Se ignora la transición (no reintentable) y se registra el estado ML.",
          );
          await sincronizarMetadatosMl();
          return { resultado: "transicion_invalida" as const };
        }

        throw error; // Otros errores (infra, 5xx ya con backoff) → Inngest reintenta.
      }
    });

    return {
      resultado: resultadoPaso.resultado,
      pedidoId: pedido.id,
      estadoNuevo: estadoInterno,
    };
  },
);
