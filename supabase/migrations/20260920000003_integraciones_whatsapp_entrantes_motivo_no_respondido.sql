-- =============================================================================
-- WhatsApp entrantes — POR QUÉ no se respondió (motivo de corte explícito)
-- =============================================================================
-- Hermana de:
--   20260920000001_integraciones_whatsapp_mensajes_entrantes.sql
--   20260920000002_integraciones_whatsapp_canal_consulta_config.sql
--
-- Alcance: `docs/arquitectura/conversacion-whatsapp.md` (§5, §6.1, §9, §10).
--
-- -----------------------------------------------------------------------------
-- EL PROBLEMA QUE CIERRA
-- -----------------------------------------------------------------------------
-- Hoy, cuando un mensaje entrante NO se responde, la fila no dice por qué. Las
-- tres causas de corte quedan con la MISMA forma en la base —`resolucion =
-- 'resuelto'`, `clasificacion is null`, `hubo_match is null`, sin bitácora— y
-- una de ellas ni siquiera se persiste:
--
--   · canal apagado (§3)            → clasificacion/hubo_match en null
--   · tope de consultas por hora (§9) → clasificacion/hubo_match en null
--   · barrido de códigos (§6.1)     → NO SE PERSISTE. El corte es una decisión
--     tomada en memoria (N intentos en la última hora); la fila queda igual a
--     cualquier otro intento `flex_manual` sin match, corte o no.
--
-- Consecuencia: el contador del backstage se llama
-- `cortadasPorCanalApagadoOTopeAbuso` y el de barrido es un TECHO, no un
-- número. Con eso no se controla un canal: «se cortaron 40» no distingue «el
-- canal está apagado y nadie se enteró» de «hay un número barriendo códigos».
--
-- -----------------------------------------------------------------------------
-- LA FORMA: COLUMNA NUEVA, **NO** UN VALOR MÁS EN `clasificacion`
-- -----------------------------------------------------------------------------
-- Son DOS EJES y mezclarlos es el bug de `tipo_pedido` otra vez (CLAUDE.md, eje
-- de fuente): una columna que cargaba tres significados a la vez y donde cada
-- valor nuevo rompía en silencio las comparaciones escritas contra los viejos.
--
--   · `clasificacion` responde QUÉ TRAJO el mensaje: código interno, shipment
--     de ML, ristra de dígitos, intención de retiro, nada reconocible.
--   · `motivo_no_respondido` responde POR QUÉ NO SE RESPONDIÓ: qué compuerta lo
--     detuvo.
--
-- Son ortogonales y se combinan: el corte por barrido ocurre CON clasificación
-- (`flex_manual` + `hubo_match = false`) — es la única forma de detectarlo. Si
-- «barrido» fuera un valor de `clasificacion`, escribirlo BORRARÍA el
-- `flex_manual` que es justamente lo que el contador de §6.1 cuenta, y el
-- propio corte se auto-invisibilizaría para el siguiente mensaje. Eso no es una
-- preferencia de estilo: meter el motivo en `clasificacion` ROMPE el detector.
--
-- Y hay dos consecuencias mecánicas más, de las que ya mordieron en este repo:
--
--   1. Ampliar `clasificacion` obliga a reponer su CHECK entero, que es el
--      movimiento que el 12-ago borró un valor en silencio (`gotcha`: un CHECK
--      de lista se repone ENTERO copiando la VIGENTE). Esta migración NO TOCA
--      ese CHECK — no hay nada que reponer y no hay nada que perder.
--   2. Las consultas existentes que preguntan `clasificacion = 'flex_manual'`
--      o `clasificacion is not null` (abuso.ts, canal-admin.ts, el índice
--      parcial `idx_whatsapp_entrantes_sondeo_numerico`) siguen significando lo
--      mismo. Un valor nuevo en `clasificacion` habría hecho que
--      `clasificacion is not null` contara como «consulta respondida» a un
--      mensaje que precisamente no se respondió.
--
-- -----------------------------------------------------------------------------
-- LOS VALORES, Y POR QUÉ EL CASO NORMAL TIENE EL SUYO
-- -----------------------------------------------------------------------------
-- `null` NO significa «se respondió»: significa «el job todavía no la tocó».
-- La fila la RESERVA el webhook antes de publicar el evento (es la barrera de
-- idempotencia), así que entre la reserva y el procesamiento existe de verdad
-- un estado «sin decidir». Si «respondido» fuera el nulo, un job que murió a
-- mitad y una respuesta exitosa serían la misma fila — que es el fallo
-- silencioso que esta migración existe para eliminar, reintroducido por la
-- puerta de al lado.
--
--   respondido           — se armó y se despachó una respuesta. Incluye el
--                          aviso neutro de §5 a un número sin contacto o
--                          ambiguo: también es responder.
--   canal_apagado        — §3. `canal_activo = false`, courier sin fila
--                          incluido. NO se llegó a clasificar nada.
--   tope_consultas       — §9. El contacto superó `tope_consultas_hora`. NO se
--                          llegó a clasificar nada.
--   barrido_codigos      — §6.1. Superó `tope_intentos_sin_match_hora`. SÍ hay
--                          clasificación: `flex_manual` + `hubo_match = false`.
--   sin_alcance          — la identidad no se resolvió y no había un aviso
--                          neutro que mandar (hoy: `ilegible`).
--   aviso_neutro_omitido — §5: ya se le avisó a ese número en las últimas 24 h.
--                          Es silencio DELIBERADO, no una falla.
--
-- ⚠️ NO hay valor `envio_fallido`. Que Meta rechace el envío es un hecho del
-- SALIENTE y vive en `whatsapp_mensajes` con su estado de acuses; duplicarlo
-- acá crearía dos lugares que pueden discrepar sobre el mismo envío.
--
-- ⚠️ La lista vive también en TypeScript
-- (`src/modules/conversacion/motivo-no-respondido.ts`) y la ata
-- `motivo-no-respondido-sql.test.ts`, con `set_eq` sobre el conjunto exacto y
-- NUNCA un conteo — la red equivalente a `conciliacion-tipos-sql.test.ts`. Dos
-- listas sin prueba que las ate es la trampa del tope de cuentas ML.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ LA COLUMNA **NO** ENTRA EN `whatsapp_entrantes_sin_tenant_no_guarda_nada`
-- -----------------------------------------------------------------------------
-- Esa red prohíbe DATOS DE NEGOCIO en una fila sin tenant. `motivo_no_respondido`
-- no es un dato de negocio: es el hecho de qué compuerta NUESTRA detuvo el
-- mensaje, exactamente de la misma naturaleza que `resolucion`, que ya se
-- escribe sin tenant y por diseño. No trae nada del courier, del seller ni del
-- destinatario. Si se agregara a la lista prohibida, `ilegible` y
-- `aviso_neutro_omitido` —los dos casos que por definición NO tienen tenant— se
-- volverían imposibles de registrar, que es el problema original con otra cara.
-- Los CHECK de coherencia de más abajo son los que impiden que la columna diga
-- algo que contradiga a `resolucion`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La columna
-- -----------------------------------------------------------------------------
alter table integraciones.whatsapp_mensajes_entrantes
  add column if not exists motivo_no_respondido text;

-- El CHECK va aparte y con `drop … if exists` delante para que la migración sea
-- re-ejecutable: `add column if not exists` no repone el constraint si la
-- columna ya estaba.
--
-- ⚠️ ESTA LISTA ES NUEVA: no se copia de ninguna migración anterior porque no
-- existe ninguna anterior. La que viene después de ésta se copia de acá — o
-- mejor, de la base vigente (`\d+ integraciones.whatsapp_mensajes_entrantes`).
alter table integraciones.whatsapp_mensajes_entrantes
  drop constraint if exists whatsapp_entrantes_motivo_valido;
alter table integraciones.whatsapp_mensajes_entrantes
  add constraint whatsapp_entrantes_motivo_valido check (
    motivo_no_respondido is null or motivo_no_respondido in (
      'respondido',
      'canal_apagado',
      'tope_consultas',
      'barrido_codigos',
      'sin_alcance',
      'aviso_neutro_omitido')
  );

-- -----------------------------------------------------------------------------
-- 2. Coherencia entre los dos ejes
-- -----------------------------------------------------------------------------
-- Sin estas redes la columna sería una etiqueta suelta que el día que alguien
-- se equivoque de rama contaría cortes que nunca ocurrieron, y el contador
-- volvería a no servir — con la diferencia de que ahora PARECERÍA preciso.

-- (1) Las tres compuertas del canal solo existen con la identidad RESUELTA:
--     ninguna de ellas se llega a evaluar antes de tener `tenant_id`. Y al
--     revés: `sin_alcance` y `aviso_neutro_omitido` son exclusivos de las filas
--     sin resolver.
alter table integraciones.whatsapp_mensajes_entrantes
  drop constraint if exists whatsapp_entrantes_motivo_segun_resolucion;
alter table integraciones.whatsapp_mensajes_entrantes
  add constraint whatsapp_entrantes_motivo_segun_resolucion check (
    motivo_no_respondido is null
    or (motivo_no_respondido in ('canal_apagado', 'tope_consultas', 'barrido_codigos')
        and resolucion = 'resuelto')
    or (motivo_no_respondido in ('sin_alcance', 'aviso_neutro_omitido')
        and resolucion <> 'resuelto')
    or motivo_no_respondido = 'respondido'
  );

-- (2) El corte por barrido EXIGE su evidencia. Es lo que lo distingue de los
--     otros dos: se decide DESPUÉS de clasificar, contando sobre
--     `flex_manual` + `hubo_match = false`, y la fila que corta es ella misma
--     uno de los intentos contados. Una fila marcada `barrido_codigos` sin esa
--     evidencia significaría que el corte se disparó por otra cosa.
--
--     ⚠️ EL `coalesce` NO ES DECORATIVO, y lo encontró el pgTAP. Escrito como
--     `or (clasificacion = 'flex_manual' and hubo_match = false)`, una fila con
--     las dos columnas en NULL hace que la condición valga NULL — y un CHECK
--     acepta NULL. O sea: el caso EXACTO que esta red existe para prohibir
--     («barrido marcado sin haber clasificado nada») entraba igual, en
--     silencio. Es la lógica ternaria de SQL, el mismo filo que ya mordió en
--     este repo con los predicados de dinero.
alter table integraciones.whatsapp_mensajes_entrantes
  drop constraint if exists whatsapp_entrantes_barrido_exige_evidencia;
alter table integraciones.whatsapp_mensajes_entrantes
  add constraint whatsapp_entrantes_barrido_exige_evidencia check (
    motivo_no_respondido is distinct from 'barrido_codigos'
    or coalesce(clasificacion = 'flex_manual' and hubo_match = false, false)
  );

-- (3) Simétrico del anterior: las dos compuertas que cortan ANTES de mirar el
--     texto no pueden dejar clasificación. Si la dejaran, significaría que se
--     leyó `operacion` igual —o sea, que la compuerta no cortó nada.
alter table integraciones.whatsapp_mensajes_entrantes
  drop constraint if exists whatsapp_entrantes_corte_previo_sin_clasificacion;
alter table integraciones.whatsapp_mensajes_entrantes
  add constraint whatsapp_entrantes_corte_previo_sin_clasificacion check (
    motivo_no_respondido is null
    or motivo_no_respondido not in ('canal_apagado', 'tope_consultas')
    or (clasificacion is null and hubo_match is null)
  );

-- (4) Una fila RESUELTA marcada `respondido` tiene que haber clasificado algo:
--     es la definición de haber llegado hasta el final del camino. (En las no
--     resueltas `respondido` es el aviso neutro de §5, que no clasifica nada y
--     además no puede: el CHECK del tenant nulo lo prohíbe.)
alter table integraciones.whatsapp_mensajes_entrantes
  drop constraint if exists whatsapp_entrantes_respondido_exige_clasificacion;
alter table integraciones.whatsapp_mensajes_entrantes
  add constraint whatsapp_entrantes_respondido_exige_clasificacion check (
    motivo_no_respondido is distinct from 'respondido'
    or resolucion <> 'resuelto'
    or clasificacion is not null
  );

-- -----------------------------------------------------------------------------
-- 3. Índice del contador del backstage
-- -----------------------------------------------------------------------------
-- La pregunta de /admin/whatsapp es «de este courier, en este día, cuántas por
-- cada motivo». Parcial sobre las filas ya decididas: las pendientes no entran
-- en ningún contador y no tienen por qué pagar el índice.
create index if not exists idx_whatsapp_entrantes_motivo
  on integraciones.whatsapp_mensajes_entrantes (tenant_id, motivo_no_respondido, recibido_en desc)
  where motivo_no_respondido is not null;

-- Los tres motivos SIN tenant (`sin_alcance`, `aviso_neutro_omitido`, y
-- `respondido` del aviso neutro) se cuentan globales, como ya ocurre con
-- `resolucion` — por eso su propio índice, sin `tenant_id` a la cabeza.
create index if not exists idx_whatsapp_entrantes_motivo_global
  on integraciones.whatsapp_mensajes_entrantes (motivo_no_respondido, recibido_en desc)
  where tenant_id is null and motivo_no_respondido is not null;

-- -----------------------------------------------------------------------------
-- 4. Comentarios
-- -----------------------------------------------------------------------------
comment on column integraciones.whatsapp_mensajes_entrantes.motivo_no_respondido is
  'POR QUE no se respondio — eje distinto de `clasificacion`, que dice QUE trajo
   el mensaje. respondido | canal_apagado | tope_consultas | barrido_codigos |
   sin_alcance | aviso_neutro_omitido. NULL significa "el job todavia no la
   toco" (la fila la reserva el webhook antes de procesar), NO "se respondio":
   si el caso normal fuera el nulo, un job muerto a mitad y una respuesta
   exitosa serian la misma fila. La lista tiene su espejo en
   src/modules/conversacion/motivo-no-respondido.ts, atado por
   motivo-no-respondido-sql.test.ts.';

-- =============================================================================
-- 5. GRANT — la columna nueva NO se cuela sola
-- =============================================================================
-- La tabla sigue deny-all y sin vista espejo en `public`; acá no se abre nada.
-- Pero el GRANT es POR COLUMNA a propósito (el gotcha que ya mordio dos veces
-- en este repo es el inverso: un grant de TABLA COMPLETA que filtra la columna
-- nueva). El corolario del grant por columna es que una columna nueva nace SIN
-- privilegio para nadie — ni para `service_role`, que es quien la escribe. Sin
-- estas tres líneas la migración aplicaría limpia y el job fallaría con 42501
-- en ejecución.
--
-- Se otorga SOLO la columna nueva, no se repone la lista entera: `grant` es
-- aditivo por columna y reponer la lista invitaría a copiarla de una versión
-- vieja — el mismo movimiento que rompe un CHECK.
grant select (motivo_no_respondido)
  on integraciones.whatsapp_mensajes_entrantes to service_role;
grant insert (motivo_no_respondido)
  on integraciones.whatsapp_mensajes_entrantes to service_role;
grant update (motivo_no_respondido)
  on integraciones.whatsapp_mensajes_entrantes to service_role;

-- Y explícitamente para nadie más, por si un grant de tabla completa se hubiera
-- colado alguna vez sobre esta tabla.
revoke all (motivo_no_respondido)
  on integraciones.whatsapp_mensajes_entrantes from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. La purga NO toca esta columna, y eso es el punto
-- -----------------------------------------------------------------------------
-- `whatsapp_entrantes_purgar_texto` solo anula `texto`. `motivo_no_respondido`
-- sobrevive a los 90 días junto a `clasificacion`, `hubo_match` y
-- `texto_largo`: la pregunta «¿este número estuvo barriendo códigos?» hay que
-- poder responderla seis meses después, y ahora se responde con un `where`
-- sobre esta columna en vez de con una inferencia. No hace falta tocar la
-- función.
