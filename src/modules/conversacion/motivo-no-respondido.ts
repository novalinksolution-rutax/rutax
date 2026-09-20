/**
 * POR QUÉ no se respondió un mensaje entrante de WhatsApp.
 * =============================================================================
 * Espejo en TypeScript del CHECK `whatsapp_entrantes_motivo_valido`
 * (migración `20260920000003`), sobre la columna
 * `integraciones.whatsapp_mensajes_entrantes.motivo_no_respondido`.
 *
 * ⚠️ EJE DISTINTO DE `clasificacion`. `clasificacion` dice QUÉ TRAJO el
 * mensaje (código interno, shipment de ML, ristra de dígitos, intención de
 * retiro, nada reconocible); esto dice QUÉ COMPUERTA lo detuvo. Son
 * ortogonales y se combinan — el corte por barrido ocurre CON clasificación
 * (`flex_manual` + `hubo_match = false`), que es la única forma de detectarlo.
 * Meter el motivo dentro de `clasificacion` no sería un atajo de estilo:
 * borraría el `flex_manual` que el detector de §6.1 cuenta, y el corte se
 * auto-invisibilizaría para el mensaje siguiente. Es el bug de `tipo_pedido`
 * otra vez (CLAUDE.md, eje de fuente).
 *
 * ⚠️ `null` NO ES "SE RESPONDIÓ". La fila la reserva el webhook ANTES de
 * publicar el evento (es la barrera de idempotencia), así que existe de verdad
 * un estado «el job todavía no la tocó». Si el caso normal fuera el nulo, un
 * job que murió a mitad y una respuesta exitosa serían la misma fila — que es
 * justo el fallo silencioso que esta columna existe para eliminar.
 *
 * ⚠️ NO hay `envio_fallido`. Que Meta rechace el envío es un hecho del
 * SALIENTE y vive en `whatsapp_mensajes` con su estado de acuses; duplicarlo
 * acá crearía dos lugares que pueden discrepar sobre el mismo envío.
 *
 * La lista de acá y la del SQL no pueden divergir: las ata
 * `motivo-no-respondido-sql.test.ts`, con el conjunto exacto y nunca un
 * conteo. Dos listas sin prueba que las ate es la trampa que ya mordió con el
 * tope de cuentas ML (SQL y TypeScript, cada uno por su lado).
 */

/**
 * Orden: primero el caso normal, después las tres compuertas del canal (las
 * que exigen identidad resuelta) y al final las dos de las filas sin resolver.
 * El orden es documental; la prueba compara conjuntos.
 */
export const MOTIVOS_NO_RESPONDIDO = [
  /** Se armó y se despachó una respuesta. Incluye el aviso neutro de §5. */
  "respondido",
  /** §3 — `canal_activo = false`, courier sin fila incluido. No se clasificó nada. */
  "canal_apagado",
  /** §9 — el contacto superó `tope_consultas_hora`. No se clasificó nada. */
  "tope_consultas",
  /** §6.1 — superó `tope_intentos_sin_match_hora`. SÍ hay clasificación. */
  "barrido_codigos",
  /** La identidad no se resolvió y no había aviso neutro que mandar (hoy: `ilegible`). */
  "sin_alcance",
  /** §5 — ya se le avisó a ese número en las últimas 24 h. Silencio deliberado. */
  "aviso_neutro_omitido",
] as const;

export type MotivoNoRespondido = (typeof MOTIVOS_NO_RESPONDIDO)[number];

/**
 * Los tres que solo existen con la identidad RESUELTA — ninguno se llega a
 * evaluar antes de tener `tenant_id`. Lo impone además el CHECK
 * `whatsapp_entrantes_motivo_segun_resolucion`.
 */
export const MOTIVOS_DE_CORTE_DEL_CANAL = [
  "canal_apagado",
  "tope_consultas",
  "barrido_codigos",
] as const satisfies readonly MotivoNoRespondido[];
