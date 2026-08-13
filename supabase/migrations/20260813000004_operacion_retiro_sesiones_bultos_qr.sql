-- =============================================================================
-- Retiro en bodega · etapa 3 — sesiones de retiro, bultos escaneados y el QR
-- =============================================================================
-- CONTEXTO: docs/arquitectura/retiro-y-ruteo.md (§2.1 el escaneo define el día,
-- §1.5 el hash_code, §1.7 las rutas Bearer bypasean RLS) y
-- docs/arquitectura/retiro-y-ruteo-plan.md, etapa 3.
-- Predecesoras directas: 20260812000002 (operacion.pedidos.situacion_retiro,
-- instalado pero SIN escritor) y 20260813000002 (identidad.seller_bodegas).
--
-- =============================================================================
-- QUÉ MODELA — y por qué el orden importa
-- =============================================================================
-- La operación real del courier es un CROSS-DOCK: el conductor que retira NO es
-- el que entrega. Cuando el conductor llega a la bodega del seller todavía no
-- existe manifiesto ni asignación, así que la visita NO puede colgar de un
-- manifiesto. Cuelga de la bodega:
--
--   operacion.sesiones_retiro   — la VISITA a UNA bodega, por UN conductor, en
--                                 UN día operativo. La abre el conductor al
--                                 llegar y se cierra al salir. Al cerrarse
--                                 congela su ACTA (los tres contadores).
--   operacion.bultos_retiro     — UN BULTO FÍSICO POR FILA (no un log de
--                                 escaneos). El escaneo casa el bulto con el
--                                 pedido que la ingesta ya trajo de ML.
--   operacion.bultos_retiro_qr  — la CREDENCIAL: el string del QR cifrado.
--                                 Tabla 1:1 DENY-ALL, sin vista en `public`.
--
-- =============================================================================
-- LO QUE ESTA MIGRACIÓN SE NIEGA A HACER (y no es olvido)
-- =============================================================================
-- · NO existe `bultos_esperados` en la sesión. El alcance §2.1 la prohíbe: un
--   seller despacha con VARIOS couriers, así que la ingesta entrega CANDIDATOS,
--   no una lista comprometida. Un "te faltaron 2" calculado contra candidatos
--   ajenos es una alarma falsa, y una alarma falsa recurrente entrena al
--   coordinador a ignorar la pantalla. El retiro concilia contra lo escaneado.
--
-- · Los contadores del acta son NULL mientras la sesión está `abierta`, a
--   propósito. Un `not null default 0` mostraría "0 bultos" en una visita con 40
--   escaneados y nadie sabría si es que no se ha escaneado nada o si es que el
--   contador todavía no se calculó. NULL = "todavía no hay acta". Se congelan al
--   cierre y desde ahí son el respaldo del pago del retiro al conductor (etapa 8).
--
-- · NO hay columna `resolucion` en los bultos. Es 100% derivable
--   (`desconocido` ⇒ ilegible; `pedido_id is null` ⇒ no procesado; resto ⇒
--   resuelto) y una columna redundante que hay que mantener sincronizada es la
--   MISMA familia de bug que el incidente del CHECK de `tipo_diferencia`
--   (CLAUDE.md §Invariantes): dos mitades de una verdad que se separan en
--   silencio. La derivación vive en una sola expresión y no se puede desfasar.
--
-- · NO se agrega `unique (tenant_id, id)` a `operacion.pedidos`, que es lo que
--   haría falta para amarrar el pedido del bulto por FK. Es la tabla más caliente
--   del sistema y sería un índice permanente por una sola constraint. El chequeo
--   va por trigger (§4), calcado de `cierres_conductor` (20260623000001:115-158)
--   PERO agregando la comprobación de tenant que a aquel le falta.
--
-- =============================================================================
-- AISLAMIENTO (la razón de ser de esta migración)
-- =============================================================================
--   · sesiones_retiro / bultos_retiro → RLS enable+force. SELECT enumerado:
--     interno de su tenant, o conductor con SUS propias filas. El SELLER VE CERO
--     FILAS EN LAS TRES TABLAS — el retiro es logística interna del courier, y
--     un bulto de otro seller en la misma van no es información suya. Escritura:
--     solo `service_role` (privilegio revocado a los roles de cliente).
--   · bultos_retiro_qr → DENY-ALL, molde `identidad.secretos_cifrados`
--     (20260101000003:100-105): RLS enable+force, CERO políticas,
--     `revoke all from authenticated, anon, public`, y SIN vista en `public`.
--
-- POR QUÉ EL QR VA EN TABLA APARTE DENY-ALL Y NO COMO COLUMNA CON GRANT POR
-- COLUMNA (decisión de la sesión principal, 2026-08-13, que zanja la discrepancia
-- entre `arquitecto` y `seguridad-cumplimiento`):
--   1. El patrón "GRANT de tabla completa + vista restringida" ya FILTRÓ DOS
--      VECES en este repo (dinero.lineas_*.snapshot_regla y el token de
--      invitación). `revoke all` no tiene esa superficie.
--   2. El ciclo de vida es distinto: el QR se PURGA al llegar el pedido a estado
--      terminal (+24-48 h de gracia, `vence_en`), mientras el acta SOBREVIVE
--      porque respalda un pago. Datos con vidas distintas no comparten fila.
--   3. `revoke all` es más fuerte y MUCHO más barato de verificar
--      (`has_table_privilege`, §8) que una lista de columnas que se rompe en
--      silencio el día que las etapas 8 o 10 agreguen una columna a la tabla.
--   Se copia la FORMA DE ACCESO de `secretos_cifrados`, no se guardan filas en
--   ella: esa tabla es para O(tenants) filas de material de larga vida, no para
--   ~400 strings al día (alcance §1.5).
--
-- OJO — `operacion` está expuesto a PostgREST (supabase/config.toml:36), así que
-- "no tener vista en public" NO basta por sí solo: sin el `revoke all`, la tabla
-- del QR sería alcanzable con `Accept-Profile: operacion`. El revoke es la
-- barrera real; la ausencia de vista es la segunda capa.
--
-- =============================================================================
-- IDEMPOTENTE, y NO DESTRUCTIVO: `create table if not exists`,
-- `create or replace view/function`, `drop policy/trigger if exists` + create,
-- DO-block para tipos y constraints. A diferencia del molde de
-- `cierres_conductor` (que hace `drop table cascade`), aquí NO se puede tirar la
-- tabla al re-aplicar: el acta de una visita respalda el pago del retiro a un
-- conductor. La aserción del §8 aborta si alguna barrera no quedó puesta.
-- =============================================================================


-- =============================================================================
-- 0. Pre-requisito en identidad.seller_bodegas — la unique que faltaba
-- =============================================================================
-- 20260813000002 creó `seller_bodegas_tenant_id_id_uk (tenant_id, id)` pensando
-- justamente en esta etapa, pero la sesión de retiro necesita ADEMÁS el par
-- `(id, seller_id)`: es lo que permite declarar por FK que el `seller_id`
-- DENORMALIZADO de la sesión sea el dueño REAL de la bodega visitada.
--
-- Sin esa FK, `seller_id` sería un dato copiado a mano y bastaría un bug de
-- aplicación para que una visita quedara atribuida al seller equivocado — es
-- decir, para que el acta que respalda el pago del retiro nombre a quien no fue.
-- Tabla de ~10-40 filas por tenant: el índice extra no se nota.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'identidad.seller_bodegas'::regclass
       and conname  = 'seller_bodegas_id_seller_id_uk'
  ) then
    alter table identidad.seller_bodegas
      add constraint seller_bodegas_id_seller_id_uk unique (id, seller_id);
  end if;
end $$;


-- =============================================================================
-- 1. Tipos enumerados
-- =============================================================================
-- DO-block idempotente: el repo no usa `create type if not exists` (no existe en
-- Postgres). Mismo patrón que 20260812000002 §1.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'estado_sesion_retiro' and n.nspname = 'operacion'
  ) then
    create type operacion.estado_sesion_retiro as enum ('abierta', 'cerrada');
  end if;
end $$;

comment on type operacion.estado_sesion_retiro is
  'Estado de la VISITA a una bodega. abierta = el conductor está adentro
   escaneando (contadores NULL: todavía no hay acta) · cerrada = salió y el acta
   quedó congelada (los tres contadores no nulos y cuadrados). Solo dos valores a
   propósito: no hay "en pausa" ni "cancelada" — una visita sin bultos se cierra
   igual, con acta en cero, porque haber ido y no haber cargado nada TAMBIÉN es
   un hecho operativo que el coordinador necesita ver.';

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'formato_codigo_bulto' and n.nspname = 'operacion'
  ) then
    create type operacion.formato_codigo_bulto as enum (
      'flex_qr',
      'rutax_interno',
      'desconocido'
    );
  end if;
end $$;

comment on type operacion.formato_codigo_bulto is
  'Qué clase de código leyó la cámara. flex_qr = el JSON de la etiqueta de
   Mercado Envíos ({id, sender_id, hash_code, security_digit}) · rutax_interno =
   la etiqueta que genera Rutax para same-day (codigo_interno RX-XXXX-XXXX) ·
   desconocido = ilegible o de otro sistema. `desconocido` NO es un error: el
   escaneo SE GUARDA IGUAL. Perder un escaneo es el único fallo verdaderamente
   irreversible del retiro — el bulto ya se subió a la van y el QR de Flex no se
   puede reimprimir (GET /shipment_labels exige ready_to_ship).';


-- =============================================================================
-- 2. operacion.sesiones_retiro — la VISITA a una bodega
-- =============================================================================
create table if not exists operacion.sesiones_retiro (
  id                  uuid primary key default gen_random_uuid(),

  -- P1: tenant obligatorio en toda tabla de negocio.
  tenant_id           uuid not null references identidad.tenants (id) on delete restrict,

  -- DÓNDE. La visita cuelga de la bodega, no del manifiesto: cuando el conductor
  -- retira, el manifiesto todavía no existe (cross-dock).
  bodega_id           uuid not null references identidad.seller_bodegas (id) on delete restrict,

  -- DE QUIÉN. Denormalizado desde la bodega para no obligar a un join en cada
  -- consulta del día. La FK compuesta de más abajo garantiza que no miente.
  seller_id           uuid not null references identidad.sellers (id) on delete restrict,

  -- QUIÉN. "El retiro queda registrado con autor" (decisión del usuario,
  -- 2026-08-12): no es un contador anónimo. Es también el alcance P3 de la RLS.
  conductor_id        uuid not null references identidad.conductores (id) on delete restrict,

  -- El DÍA OPERATIVO (fecha local de Santiago, la calcula quien abre la sesión).
  -- Es `date` y no un rango horario a propósito: la jornada del courier cruza el
  -- corte de las 21-22 h pero nunca la medianoche.
  fecha_operacion     date not null,

  estado              operacion.estado_sesion_retiro not null default 'abierta',

  abierta_en          timestamptz not null default now(),
  cerrada_en          timestamptz,

  -- EL ACTA. NULL mientras la sesión está abierta (ver cabecera). Los congela
  -- operacion.cerrar_sesion_retiro() y no se recalculan después: un escaneo que
  -- llega tarde (posterior_al_cierre) NO los mueve.
  bultos_total        integer check (bultos_total        is null or bultos_total        >= 0),
  bultos_resueltos    integer check (bultos_resueltos    is null or bultos_resueltos    >= 0),
  bultos_sin_resolver integer check (bultos_sin_resolver is null or bultos_sin_resolver >= 0),

  notas               text,

  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  -- ---------------------------------------------------------------------------
  -- Integridad referencial multi-tenant. Las tres compuestas impiden que una
  -- visita mezcle piezas de couriers distintos, sin confiar en la disciplina de
  -- inserción de la aplicación.
  -- ---------------------------------------------------------------------------
  constraint sesiones_retiro_bodega_pertenece_al_tenant
    foreign key (tenant_id, bodega_id)
    references identidad.seller_bodegas (tenant_id, id)
    deferrable initially immediate,

  constraint sesiones_retiro_seller_pertenece_al_tenant
    foreign key (tenant_id, seller_id)
    references identidad.sellers (tenant_id, id)
    deferrable initially immediate,

  constraint sesiones_retiro_conductor_pertenece_al_tenant
    foreign key (tenant_id, conductor_id)
    references identidad.conductores (tenant_id, id)
    deferrable initially immediate,

  -- LA QUE HACE HONESTO AL DENORMALIZADO: el seller de la sesión tiene que ser
  -- el dueño REAL de la bodega visitada, no una copia que alguien escribió mal.
  -- Necesita seller_bodegas_id_seller_id_uk, creada en el §0.
  constraint sesiones_retiro_bodega_es_del_seller
    foreign key (bodega_id, seller_id)
    references identidad.seller_bodegas (id, seller_id)
    deferrable initially immediate,

  -- ---------------------------------------------------------------------------
  -- Llaves que necesitan las etapas siguientes. Se crean AHORA por la misma
  -- lección de 20260813000002:102-107 (sellers_tenant_id_id_uk hubo que agregarla
  -- después, con un DO-block, porque no se previó).
  -- ---------------------------------------------------------------------------
  constraint sesiones_retiro_tenant_id_id_uk unique (tenant_id, id),

  -- Ésta la usa la etapa 8 (la línea de liquidación del retiro): permite que la
  -- línea declare por FK que el conductor al que se le paga la visita es EL QUE
  -- HIZO LA VISITA. Sin ella, "a quién se le paga" sería un join que la
  -- aplicación puede equivocar, y equivocarlo es pagarle a otro.
  constraint sesiones_retiro_tenant_id_conductor_uk unique (tenant_id, id, conductor_id),

  -- ---------------------------------------------------------------------------
  -- Coherencia del cierre. Es lo que impide un acta a medias — el estado más
  -- peligroso posible, porque una sesión "cerrada" con contadores nulos parece
  -- cerrada en la pantalla y no respalda ningún pago.
  -- ---------------------------------------------------------------------------
  constraint sesiones_retiro_cierre_coherente check (
    (
      estado = 'abierta'
      and cerrada_en          is null
      and bultos_total        is null
      and bultos_resueltos    is null
      and bultos_sin_resolver is null
    )
    or (
      estado = 'cerrada'
      and cerrada_en          is not null
      and bultos_total        is not null
      and bultos_resueltos    is not null
      and bultos_sin_resolver is not null
      and bultos_total = bultos_resueltos + bultos_sin_resolver
    )
  )
);

comment on table operacion.sesiones_retiro is
  'La VISITA de un conductor a UNA bodega de seller en un día operativo. La abre
   el conductor al llegar; NO cuelga de un manifiesto porque cuando se retira el
   manifiesto todavía no existe (cross-dock: quien retira no entrega). Al cerrarse
   congela su ACTA (bultos_total/resueltos/sin_resolver), que es lo que respalda
   el pago del retiro al conductor (etapa 8). NO tiene `bultos_esperados` a
   propósito (alcance §2.1): un seller despacha con varios couriers, la ingesta da
   candidatos y un faltante calculado contra candidatos ajenos es alarma falsa.
   RLS: P1 tenant + interno, o P3 conductor con las suyas. El SELLER ve CERO
   filas. Escritura solo service_role, y el cierre solo por
   operacion.cerrar_sesion_retiro().';

comment on column operacion.sesiones_retiro.seller_id is
  'Denormalizado desde la bodega para RLS y consultas sin join. NO es un dato
   suelto: la FK sesiones_retiro_bodega_es_del_seller obliga a que sea el dueño
   real de bodega_id.';

comment on column operacion.sesiones_retiro.fecha_operacion is
  'Día operativo (fecha local de Santiago) al que pertenece la visita. Va DENTRO
   del índice único de sesión abierta a propósito — ver el comentario del índice.';

comment on column operacion.sesiones_retiro.bultos_total is
  'Acta congelada al cierre. NULL mientras la sesión está abierta, deliberadamente:
   un `not null default 0` mostraría "0 bultos" en una visita con 40 escaneados.
   NULL significa "todavía no hay acta", que es distinto de "el acta dice cero".';

comment on column operacion.sesiones_retiro.bultos_sin_resolver is
  'Bultos escaneados que NO quedaron casados con un pedido: los ilegibles
   (codigo_formato = desconocido) y los que Rutax no encontró en su ingesta. Se
   suman en un solo contador porque para el acta son lo mismo: bultos que subieron
   a la van sin dueño conocido. El desglose se deriva de bultos_retiro.';

-- Índices ---------------------------------------------------------------------

-- IDEMPOTENCIA DE LA APERTURA: un conductor tiene COMO MÁXIMO una sesión abierta
-- por bodega y por día. Reabrir desde la app (o reintentar el POST tras un
-- timeout) reutiliza la misma visita en vez de partir el acta en dos.
--
-- ⚠️ `fecha_operacion` va DENTRO del índice a propósito, y no es un detalle: sin
-- ella, una sesión que quedó abierta ayer (el conductor cerró la app y se fue a
-- su casa) se reutilizaría hoy. Los bultos de hoy caerían en el acta de AYER —
-- y con la etapa 8, en la PLATA de ayer, en un período que puede estar cerrado.
create unique index if not exists sesiones_retiro_abierta_uk
  on operacion.sesiones_retiro (tenant_id, conductor_id, bodega_id, fecha_operacion)
  where estado = 'abierta';

-- La pantalla de Preparación del día (etapa 5): "las visitas de hoy de este
-- courier", en vivo.
create index if not exists idx_sesiones_retiro_tenant_fecha
  on operacion.sesiones_retiro (tenant_id, fecha_operacion desc);

-- "La carga del día de ESTE conductor": la usa la app del conductor y la usa la
-- liquidación del retiro (etapa 8).
create index if not exists idx_sesiones_retiro_tenant_conductor_fecha
  on operacion.sesiones_retiro (tenant_id, conductor_id, fecha_operacion desc);

drop trigger if exists trg_sesiones_retiro_actualizado_en on operacion.sesiones_retiro;
create trigger trg_sesiones_retiro_actualizado_en
  before update on operacion.sesiones_retiro
  for each row execute function operacion.set_actualizado_en();


-- =============================================================================
-- 3. operacion.bultos_retiro — UN BULTO FÍSICO POR FILA
-- =============================================================================
-- No es un log de escaneos: si la cámara dispara tres veces sobre el mismo
-- código, hay UNA fila. Los dos índices únicos del final son los que lo imponen,
-- y hacen cosas DISTINTAS (ver ahí).
create table if not exists operacion.bultos_retiro (
  id                     uuid primary key default gen_random_uuid(),

  tenant_id              uuid not null references identidad.tenants (id) on delete restrict,

  sesion_retiro_id       uuid not null references operacion.sesiones_retiro (id) on delete restrict,

  -- Denormalizado desde la sesión para que la política del conductor no necesite
  -- un join (mismo criterio que operacion.pedidos.driver_id_asignado). La FK
  -- compuesta de más abajo garantiza que coincide con el conductor de la visita.
  conductor_id           uuid not null,

  -- IDEMPOTENCIA DEL LOTE: lo genera el CLIENTE (la app del conductor) antes de
  -- salir a la red. Un reintento del mismo lote —el caso normal cuando el POST
  -- se corta en la bodega, donde la señal es mala— trae el mismo escaneo_id y no
  -- duplica nada.
  escaneo_id             uuid not null,

  codigo_formato         operacion.formato_codigo_bulto not null,

  -- LA LLAVE DE NEGOCIO DEL BULTO. Para flex_qr es el shipment id extraído del
  -- JSON; para rutax_interno, el codigo_interno. Normalizada por backend
  -- (trim, mayúsculas, sin prefijos) para que dos lecturas del mismo bulto den
  -- el mismo string. NO es el payload crudo: ése vive cifrado en
  -- operacion.bultos_retiro_qr.
  codigo_normalizado     text not null,

  -- Muestra corta para que un humano pueda reconocer un código ilegible en la
  -- bandeja de excepciones. SOLO para formato 'desconocido' y <= 24 caracteres:
  -- de un código que Rutax no entiende no se sabe si trae algo sensible, así que
  -- se guarda un pedazo, no el string.
  muestra_codigo         text,

  ml_shipment_id         text,
  ml_user_id             text,

  -- NULL = el escaneo NO se pudo casar contra la ingesta (bulto "no procesado"
  -- desde el punto de vista del acta). El escaneo SE GUARDA IGUAL: nunca se
  -- pierde un escaneo.
  pedido_id              uuid references operacion.pedidos (id) on delete restrict,

  -- ⚠️ El seller DEL PEDIDO, que NO es necesariamente el seller de la bodega:
  -- un bulto de otro seller puede aparecer físicamente en una bodega ajena, y
  -- eso es exactamente la clase de descuadre que el retiro existe para destapar.
  -- Lo valida el trigger contra operacion.pedidos.seller_id.
  seller_id              uuid references identidad.sellers (id) on delete restrict,

  -- Foto del estado de ML EN EL MOMENTO DEL ESCANEO. Sirve para explicar después
  -- por qué un bulto se cargó pese a estar en un estado raro; no se re-sincroniza.
  estado_ml_al_escanear     text,
  subestado_ml_al_escanear  text,

  -- El escaneo llegó DESPUÉS de que la visita se cerrara. SE ACEPTA, no se
  -- rechaza (ver §4): la cola sin conexión de la app lo vuelve inevitable, y
  -- rechazarlo perdería un escaneo, que es el único invariante duro del retiro.
  -- Los contadores del acta NO se recalculan: el acta es un documento firmado.
  posterior_al_cierre    boolean not null default false,

  -- Dos relojes, a propósito y sin CHECK que los compare: `escaneado_en` es el
  -- del DISPOSITIVO (puede venir desfasado o incluso adelantado; es lo que el
  -- conductor vio) y `recibido_en` es el del SERVIDOR (es el que manda para
  -- cualquier disputa). Compararlos por CHECK rechazaría escaneos legítimos de
  -- un teléfono con la hora mal puesta.
  escaneado_en           timestamptz not null,
  recibido_en            timestamptz not null default now(),

  -- Momento en que el bulto quedó casado con un pedido. Lo escribe
  -- operacion.resolver_bulto_retiro() o el propio ingreso del lote.
  resuelto_en            timestamptz,

  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),

  -- ---------------------------------------------------------------------------
  -- Integridad multi-tenant EN UNA SOLA CONSTRAINT DECLARATIVA: amarra tenant y
  -- conductor de golpe contra la visita. Un bulto no puede pertenecer a la visita
  -- de otro courier ni quedar atribuido a un conductor que no la hizo.
  -- Necesita sesiones_retiro_tenant_id_conductor_uk (§2).
  -- ---------------------------------------------------------------------------
  constraint bultos_retiro_sesion_pertenece_al_tenant_y_conductor
    foreign key (tenant_id, sesion_retiro_id, conductor_id)
    references operacion.sesiones_retiro (tenant_id, id, conductor_id)
    deferrable initially immediate,

  constraint bultos_retiro_seller_pertenece_al_tenant
    foreign key (tenant_id, seller_id)
    references identidad.sellers (tenant_id, id)
    deferrable initially immediate,

  -- La usa operacion.bultos_retiro_qr para colgar el QR sin poder cruzar tenants.
  constraint bultos_retiro_tenant_id_id_uk unique (tenant_id, id),

  -- ---------------------------------------------------------------------------
  -- CHECKs de forma
  -- ---------------------------------------------------------------------------
  constraint bultos_retiro_codigo_normalizado_largo check (
    length(codigo_normalizado) between 1 and 128
  ),

  -- La muestra es EXCLUSIVA del código ilegible: en un flex_qr o un rutax_interno
  -- el codigo_normalizado ya es legible y una segunda copia solo sería una vía
  -- más por la que filtrar el mismo dato.
  constraint bultos_retiro_muestra_solo_desconocido check (
    muestra_codigo is null
    or (codigo_formato = 'desconocido' and length(muestra_codigo) <= 24)
  ),

  -- Un QR de Flex sin shipment id no es un QR de Flex: sería un código mal
  -- clasificado, y clasificarlo mal lo saca de la conciliación con la ingesta.
  constraint bultos_retiro_flex_exige_shipment check (
    codigo_formato <> 'flex_qr' or ml_shipment_id is not null
  ),

  -- De un código que Rutax NO entiende no se puede afirmar nada: ni de qué envío
  -- es, ni de qué cuenta, ni a qué pedido corresponde. Dejar cualquiera de los
  -- tres poblado sería una atribución inventada.
  constraint bultos_retiro_desconocido_sin_vinculo check (
    codigo_formato <> 'desconocido'
    or (ml_shipment_id is null and ml_user_id is null and pedido_id is null)
  ),

  -- El seller sale DEL PEDIDO: sin pedido no hay de dónde sacarlo.
  constraint bultos_retiro_seller_exige_pedido check (
    seller_id is null or pedido_id is not null
  ),

  -- "Resuelto" significa exactamente "casado con un pedido". Una marca de
  -- resolución sin pedido sería un bulto que dice estar resuelto y no lo está —
  -- y el acta lo contaría como resuelto.
  constraint bultos_retiro_resuelto_exige_pedido check (
    resuelto_en is null or pedido_id is not null
  )
);

comment on table operacion.bultos_retiro is
  'UN BULTO FÍSICO POR FILA (no un log de escaneos). El escaneo del QR casa el
   bulto con el pedido que la ingesta de ML ya trajo: el retiro es una
   conciliación de bodega. Un código que Rutax no puede procesar SE GUARDA IGUAL
   (codigo_formato = desconocido) — perder un escaneo es irreversible porque el
   QR de Flex no se puede reimprimir. La "resolución" NO es una columna: se deriva
   (desconocido ⇒ ilegible; pedido_id null ⇒ no procesado; resto ⇒ resuelto).
   RLS: P1 tenant + interno, o P3 conductor con los suyos. El SELLER ve CERO
   filas. Escritura solo service_role. El string crudo del QR NO está aquí: vive
   cifrado en operacion.bultos_retiro_qr, deny-all.';

comment on column operacion.bultos_retiro.escaneo_id is
  'Identificador del escaneo GENERADO POR EL CLIENTE antes de salir a la red.
   Sostiene unique (tenant_id, escaneo_id) = idempotencia del REINTENTO DE LOTE.
   Distinto del duplicado físico: cada disparo de la cámara genera un escaneo_id
   NUEVO, así que esta unique no atrapa el doble escaneo del mismo bulto — de eso
   se encarga la otra.';

comment on column operacion.bultos_retiro.codigo_normalizado is
  'Llave de negocio del bulto, normalizada por backend. Sostiene
   unique (sesion_retiro_id, codigo_normalizado) = idempotencia del DOBLE ESCANEO
   FÍSICO. NO es el payload crudo del QR: ése va cifrado en bultos_retiro_qr.';

comment on column operacion.bultos_retiro.seller_id is
  'Seller DEL PEDIDO, no de la bodega visitada. Un bulto ajeno aparecido en una
   bodega es justamente lo que el retiro destapa. Lo valida el trigger contra
   operacion.pedidos.seller_id (no por FK: pedidos no tiene unique (tenant_id, id)
   y no se le agrega, ver cabecera).';

comment on column operacion.bultos_retiro.posterior_al_cierre is
  'true = el escaneo llegó después de cerrada la visita (cola sin conexión). SE
   ACEPTA: rechazarlo perdería el escaneo. No entra en los contadores del acta,
   que quedan congelados — pero el pedido SÍ se marca `retirado`
   (operacion.resolver_bulto_retiro), o el bulto nunca llegaría a la bandeja de
   asignación.';

comment on column operacion.bultos_retiro.recibido_en is
  'Reloj del SERVIDOR. Es el que manda ante cualquier disputa; escaneado_en es el
   del dispositivo del conductor y puede venir desfasado. No hay CHECK que los
   compare a propósito: un teléfono con la hora mal puesta no puede impedir que se
   registre un bulto que ya está arriba de la van.';

-- Índices ---------------------------------------------------------------------

-- IDEMPOTENCIA #1 — REINTENTO DEL LOTE. La app manda hasta 50 escaneos por POST;
-- si la respuesta se pierde, reintenta el mismo lote con los mismos escaneo_id.
create unique index if not exists bultos_retiro_escaneo_uk
  on operacion.bultos_retiro (tenant_id, escaneo_id);

-- IDEMPOTENCIA #2 — DOBLE ESCANEO FÍSICO. El conductor pasa dos veces la cámara
-- sobre el mismo bulto (pasa todo el rato en ráfaga). Cada disparo trae un
-- escaneo_id NUEVO, así que la unique de arriba no lo ve: hace falta ésta.
--
-- ⚠️ LAS DOS SON NECESARIAS Y HACEN COSAS DISTINTAS. Quitar cualquiera deja
-- pasar duplicados por el otro camino, y un duplicado infla el acta — es decir,
-- infla lo que se le paga al conductor por esa visita (etapa 8).
-- Un duplicado SE FUSIONA, no da error: el INSERT del lote va con
-- `on conflict (sesion_retiro_id, codigo_normalizado) do update`, porque hacer
-- fallar el lote entero por un bulto repetido dejaría al conductor bloqueado en
-- la bodega.
create unique index if not exists bultos_retiro_sesion_codigo_uk
  on operacion.bultos_retiro (sesion_retiro_id, codigo_normalizado);

-- "¿Está este pedido retirado, y en qué visita?" — la usa la pantalla de
-- asignación y la trazabilidad pedido↔dinero. Parcial: los no resueltos no tienen
-- nada que buscar por pedido.
create index if not exists idx_bultos_retiro_tenant_pedido
  on operacion.bultos_retiro (tenant_id, pedido_id)
  where pedido_id is not null;

-- La BANDEJA DE EXCEPCIONES del retiro: "qué quedó sin casar en esta visita".
-- Parcial e invertida respecto de la anterior; entre las dos cubren la tabla sin
-- duplicar el índice completo.
create index if not exists idx_bultos_retiro_sin_resolver
  on operacion.bultos_retiro (tenant_id, sesion_retiro_id)
  where pedido_id is null;


-- =============================================================================
-- 4. Trigger de consistencia — calcado de cierres_conductor, con el hueco tapado
-- =============================================================================
-- Molde: operacion.cierres_conductor_validar_denormalizados (20260623000001:115-158).
--
-- ⚠️ LA DIFERENCIA CON EL MOLDE, Y ES LA IMPORTANTE: aquel trigger valida que el
-- seller y el conductor denormalizados coincidan con los del pedido, pero NUNCA
-- COMPARA `pedidos.tenant_id` CONTRA `new.tenant_id`. O sea, no impide colgar la
-- fila de un pedido de OTRO courier: bastaría que el seller coincidiera. Aquí eso
-- sería peor que un descuadre, porque `resolver_bulto_retiro` y
-- `cerrar_sesion_retiro` ESCRIBEN sobre operacion.pedidos con service_role —
-- marcar `retirado` un pedido ajeno lo mete en la bandeja de asignación del
-- courier equivocado, y de ahí sale un cobro por una entrega que no es suya.
-- Por eso el chequeo de tenant va primero y explícito.
create or replace function operacion.bultos_retiro_validar_denormalizados()
returns trigger
language plpgsql
as $$
declare
  v_estado_sesion   operacion.estado_sesion_retiro;
  v_tenant_pedido   uuid;
  v_seller_pedido   uuid;
begin
  -- 4.1 Solo en INSERT: un escaneo que entra a una visita YA CERRADA tiene que
  --     declararlo. No se rechaza el escaneo (eso lo perdería); se exige que
  --     venga marcado, para que el acta congelada no quede desmentida en silencio
  --     por filas que nadie contó.
  if tg_op = 'INSERT' then
    select s.estado into v_estado_sesion
      from operacion.sesiones_retiro s
     where s.id = new.sesion_retiro_id;

    if v_estado_sesion is null then
      raise exception
        'bultos_retiro: la sesión de retiro % no existe', new.sesion_retiro_id
        using errcode = '23503';
    end if;

    if v_estado_sesion = 'cerrada' and new.posterior_al_cierre = false then
      raise exception
        'bultos_retiro: la sesión % ya está cerrada; un escaneo tardío debe entrar con posterior_al_cierre = true (no se rechaza, pero no altera el acta)',
        new.sesion_retiro_id
        using errcode = '23514';
    end if;
  end if;

  -- 4.2 Si el bulto está casado con un pedido, ese pedido tiene que existir, ser
  --     DE ESTE TENANT y traer el seller que la fila dice traer.
  if new.pedido_id is not null then
    select p.tenant_id, p.seller_id
      into v_tenant_pedido, v_seller_pedido
    from operacion.pedidos p
    where p.id = new.pedido_id;

    if v_tenant_pedido is null then
      raise exception
        'bultos_retiro: pedido_id % no existe', new.pedido_id
        using errcode = '23503';
    end if;

    -- EL CHEQUEO QUE LE FALTA AL MOLDE. Va por trigger y no por FK porque
    -- operacion.pedidos no tiene unique (tenant_id, id) y no se le agrega: sería
    -- un índice permanente sobre la tabla más caliente por una sola constraint.
    if v_tenant_pedido is distinct from new.tenant_id then
      raise exception
        'bultos_retiro: el pedido % es del tenant % y el bulto del tenant % — un bulto no puede colgar de un pedido de otro courier',
        new.pedido_id, v_tenant_pedido, new.tenant_id
        using errcode = '23514';
    end if;

    if new.seller_id is distinct from v_seller_pedido then
      raise exception
        'bultos_retiro: seller_id (%) no coincide con pedidos.seller_id (%)',
        new.seller_id, v_seller_pedido
        using errcode = '23514';
    end if;
  end if;

  new.actualizado_en := now();
  return new;
end;
$$;

comment on function operacion.bultos_retiro_validar_denormalizados() is
  'Consistencia del bulto contra su visita y su pedido. (1) En INSERT, un escaneo
   a una sesión cerrada debe venir con posterior_al_cierre = true. (2) Si hay
   pedido_id: el pedido existe (23503), es DEL MISMO TENANT (23514 — el chequeo
   que le falta al molde cierres_conductor) y su seller coincide (23514).
   (3) Refresca actualizado_en. Va por trigger y no por FK porque
   operacion.pedidos no tiene unique (tenant_id, id) y no se le agrega.';

drop trigger if exists trg_bultos_retiro_validar_denormalizados on operacion.bultos_retiro;
create trigger trg_bultos_retiro_validar_denormalizados
  before insert or update on operacion.bultos_retiro
  for each row execute function operacion.bultos_retiro_validar_denormalizados();


-- =============================================================================
-- 5. operacion.bultos_retiro_qr — la credencial, 1:1, DENY-ALL
-- =============================================================================
-- El payload real de la etiqueta Flex es
--   {"id":"<shipment_id>","sender_id":<ml_user_id>,"hash_code":"<32B base64>","security_digit":"0"}
-- `hash_code` es una firma de ML que NO SE PUEDE CALCULAR, y una vez retirado el
-- bulto ML tampoco reimprime la etiqueta (GET /shipment_labels exige
-- ready_to_ship/ready_to_print). Si no se captura al escanear, ese QR se pierde
-- para siempre. No trae datos personales, pero es CREDENCIAL-SÍMIL.
--
-- Tabla aparte y no columna: ver el razonamiento completo en la cabecera.
create table if not exists operacion.bultos_retiro_qr (
  -- PK = bulto_id: relación 1:1 estricta impuesta por el esquema, no por
  -- disciplina. No hay "dos QR de un bulto".
  bulto_id        uuid primary key,

  tenant_id       uuid not null,

  -- Qué se guardó. 'flex_hash' = solo hash_code + security_digit (el id y el
  -- sender_id ya viven en operacion.pedidos, alcance §1.5: se guarda lo mínimo
  -- que no se puede reconstruir). 'codigo_crudo' = el string tal cual, para los
  -- formatos que Rutax no supo interpretar.
  -- text + CHECK y no enum: es un detalle de serialización del adaptador de
  -- secretos, no un eje de negocio, y no queremos un tipo en `operacion` que
  -- obligue a migrar cada vez que cambie el formato de una etiqueta.
  tipo_payload    text not null check (tipo_payload in ('flex_hash', 'codigo_crudo')),

  -- AES-256-GCM (`src/modules/integraciones/secretos/cifrado.ts`). bytea y no
  -- text: no hay ninguna razón para que este valor sea legible en un `select`
  -- accidental de una consola, ni para que se copie a un log por ser string.
  payload_cifrado bytea not null,

  -- Versión de la CLAVE con la que se cifró. Sin esto, rotar la clave vuelve
  -- indescifrable todo lo anterior. Mismo contrato que
  -- integraciones/secretos/cifrado.ts (metadata.kid, KID_ACTIVO = 'v1').
  kid             text not null default 'v1',

  -- Versión de la RECETA del AAD (los datos adicionales autenticados que atan el
  -- criptograma a su fila). Se versiona por separado del kid porque son dos cosas
  -- que rotan por motivos distintos: la clave por higiene, la receta si cambia el
  -- modelo. Sin esta columna, cambiar la receta rompería el descifrado de todo lo
  -- guardado antes, en silencio y sin manera de saber cuál era la vieja.
  aad_esquema     text not null default 'v1',

  -- Cuándo puede purgarse. El QR muere al llegar el pedido a estado terminal
  -- (entregado, devuelto, cancelado, no procesado) con 24-48 h de gracia. NULL =
  -- todavía vivo. La purga es de la etapa 10; aquí solo se declara el campo y su
  -- índice, para que el job no obligue a re-migrar.
  vence_en        timestamptz,

  creado_en       timestamptz not null default now(),

  -- FK COMPUESTA, no simple: ata el QR a su bulto Y a su tenant de una vez, así
  -- que ni siquiera un service_role con un bug puede colgar el QR de un bulto de
  -- otro courier. `on delete cascade` porque el QR no tiene vida propia — si el
  -- bulto desaparece, su credencial no debe quedar huérfana en la base.
  constraint bultos_retiro_qr_bulto_pertenece_al_tenant
    foreign key (tenant_id, bulto_id)
    references operacion.bultos_retiro (tenant_id, id)
    on delete cascade
);

comment on table operacion.bultos_retiro_qr is
  'El string del QR del bulto, CIFRADO (AES-256-GCM). 1:1 con bultos_retiro
   (PK = bulto_id). DENY-ALL: RLS enable+force SIN NINGUNA POLÍTICA, `revoke all`
   a authenticated/anon/public y SIN vista espejo en `public` — molde de acceso de
   identidad.secretos_cifrados (20260101000003:100-105), del que se copia la FORMA
   pero no el almacenamiento (aquella es para O(tenants) filas de larga vida, no
   para ~400 al día). En v1 NINGÚN rol de cliente lee esta tabla: solo
   service_role, vía el adaptador de secretos. Existe porque hash_code es una
   firma de ML que no se puede recalcular y la etiqueta no se reimprime una vez
   retirado el bulto. NUNCA en logs ni en URLs (CLAVES_PROHIBIDAS + el CHECK de
   bitacora_auditoria, §7).';

comment on column operacion.bultos_retiro_qr.tipo_payload is
  'flex_hash = hash_code + security_digit (el resto del QR ya está en pedidos;
   se guarda solo lo irrecuperable) · codigo_crudo = el string tal cual, para
   códigos que Rutax no supo interpretar.';

comment on column operacion.bultos_retiro_qr.kid is
  'Versión de la clave de cifrado (contrato de integraciones/secretos/cifrado.ts).
   Sin ella, rotar la clave dejaría indescifrable todo lo anterior.';

comment on column operacion.bultos_retiro_qr.aad_esquema is
  'Versión de la receta del AAD que ata el criptograma a su fila. Se versiona
   aparte del kid porque rotan por motivos distintos. La receta concreta la define
   backend (`integraciones/secretos`); ojo: NO puede depender de pedido_id, que en
   un bulto sin resolver es NULL — el par estable es (tenant_id, bulto_id).';

comment on column operacion.bultos_retiro_qr.vence_en is
  'Momento a partir del cual la fila puede purgarse (estado terminal del pedido
   + 24-48 h de gracia). NULL = vivo. El job de purga es de la etapa 10; el índice
   parcial ya está para que no haya que re-migrar.';

-- Índice del job de purga (etapa 10). Parcial: solo entran las filas ya
-- condenadas, así que es diminuto frente a la tabla.
create index if not exists idx_bultos_retiro_qr_vence
  on operacion.bultos_retiro_qr (vence_en)
  where vence_en is not null;


-- =============================================================================
-- 6. Las dos funciones que escriben situacion_retiro
-- =============================================================================
-- ⚠️ ESTAS DOS SON LOS ÚNICOS ESCRITORES DE operacion.pedidos.situacion_retiro,
-- que 20260812000002 dejó instalado pero INERTE (no había ningún camino que
-- llevara un pedido a `retirado`).
--
-- POR QUÉ SON FUNCIONES Y NO UNA SECUENCIA DE LLAMADAS DESDE backend:
-- supabase-js NO tiene transacciones. Un cierre a medias —acta cerrada, pedidos
-- sin marcar— dejaría la visita "lista" y sus bultos fuera de la bandeja de
-- asignación, sin ningún error visible. Precedentes del patrón en el repo:
-- operacion.pruebas_entrega_del_seller() (20260613000009:221) e
-- infra.rate_limit / public.rate_limit_consumir (20260612000001:75).
--
-- SECURITY DEFINER con search_path fijo (patrón seguro contra search-path
-- hijacking). El definer es `postgres`, que tiene BYPASSRLS: esa es exactamente
-- la intención — este es el único camino de escritura, y el EXECUTE está
-- revocado a todos los roles de cliente.

-- -----------------------------------------------------------------------------
-- 6.1 cerrar_sesion_retiro — congela el acta y marca los pedidos como retirados
-- -----------------------------------------------------------------------------
-- Los nombres de salida llevan sufijo/prefijo distinto al de las columnas
-- (sesion_estado, total_bultos, cerrada_ts…) a propósito: en plpgsql los
-- parámetros OUT de un `returns table` son variables en ámbito y chocarían con
-- las columnas homónimas dentro del cuerpo.
create or replace function operacion.cerrar_sesion_retiro(
  p_tenant_id    uuid,
  p_sesion_id    uuid,
  p_conductor_id uuid
)
returns table (
  sesion_id          uuid,
  sesion_estado      operacion.estado_sesion_retiro,
  total_bultos       integer,
  total_resueltos    integer,
  total_sin_resolver integer,
  cerrada_ts         timestamptz,
  ya_estaba_cerrada  boolean,
  pedidos_marcados   integer
)
language plpgsql
security definer
set search_path = operacion, identidad, pg_temp
as $$
declare
  v_sesion       operacion.sesiones_retiro%rowtype;
  v_total        integer;
  v_resueltos    integer;
  v_sin_resolver integer;
  v_pedidos      integer := 0;
begin
  if p_tenant_id is null or p_sesion_id is null or p_conductor_id is null then
    raise exception
      'cerrar_sesion_retiro: p_tenant_id, p_sesion_id y p_conductor_id son obligatorios'
      using errcode = '22023';
  end if;

  -- (1) Bloqueo por (id, tenant_id). El `for update` serializa dos cierres
  --     simultáneos —el botón "cerrar visita" pulsado dos veces, o el reintento
  --     de la cola— para que el acta se calcule una sola vez.
  select * into v_sesion
    from operacion.sesiones_retiro s
   where s.id = p_sesion_id
     and s.tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception
      'cerrar_sesion_retiro: la sesión % no existe en el tenant %', p_sesion_id, p_tenant_id
      using errcode = 'P0002';  -- no_data_found
  end if;

  -- El tenant ya quedó filtrado arriba; esto es el alcance P3: un conductor no
  -- cierra la visita de un colega. Es 42501 y no "0 filas" a propósito.
  if v_sesion.conductor_id <> p_conductor_id then
    raise exception
      'cerrar_sesion_retiro: la sesión % la abrió el conductor %, no el conductor %',
      p_sesion_id, v_sesion.conductor_id, p_conductor_id
      using errcode = '42501';
  end if;

  -- (2) CIERRE IDEMPOTENTE: si ya estaba cerrada devuelve el acta CONGELADA tal
  --     cual, sin tocar nada y SIN ERROR. Recalcularla movería una cifra que ya
  --     respalda un pago; lanzar error obligaría al cliente a distinguir "falló"
  --     de "ya estaba hecho", que es justo lo que una cola de reintentos no puede
  --     hacer bien.
  if v_sesion.estado = 'cerrada' then
    return query
      select v_sesion.id,
             v_sesion.estado,
             v_sesion.bultos_total,
             v_sesion.bultos_resueltos,
             v_sesion.bultos_sin_resolver,
             v_sesion.cerrada_en,
             true,
             0;
    return;
  end if;

  -- (3) El acta. Solo cuentan los bultos que entraron ANTES del cierre; los
  --     tardíos (posterior_al_cierre) quedan fuera por definición.
  --     "Resuelto" = casado con un pedido. Los `desconocido` caen solos en el
  --     otro cubo: el CHECK bultos_retiro_desconocido_sin_vinculo les prohíbe
  --     tener pedido_id.
  select count(*)::int,
         count(*) filter (where b.pedido_id is not null)::int
    into v_total, v_resueltos
    from operacion.bultos_retiro b
   where b.sesion_retiro_id = p_sesion_id
     and b.tenant_id        = p_tenant_id
     and b.posterior_al_cierre = false;

  v_sin_resolver := v_total - v_resueltos;

  -- (4) LA COMPUERTA DE LA ASIGNACIÓN. Los pedidos de los bultos escaneados
  --     pasan a `retirado`: es lo que los hace visibles en la bandeja del
  --     coordinador (20260812000002 §4).
  --
  --     · NO toca `estado`, `origen` ni ninguna otra columna. `situacion_retiro`
  --       es un eje ORTOGONAL y meter la mano en la máquina de estados desde aquí
  --       chocaría con el polling y el webhook de ML.
  --     · NO excluye cancelados ni entregados, a propósito: un bulto cancelado en
  --       ML que ya va arriba de la van SIGUE estando en poder del courier, y
  --       alguien tiene que devolverlo. Esconderlo no lo saca de la van.
  --     · `situacion_retiro <> 'retirado'` evita reescribir filas ya marcadas y,
  --       con el coalesce, conserva el PRIMER retirado_en (un traspaso entre
  --       conductores no debe reescribir la hora del retiro original).
  --     · Se incluyen TODOS los bultos de la visita con pedido, también los
  --       posterior_al_cierre. Son cero en el momento del cierre (el trigger solo
  --       los admite con la sesión ya cerrada), pero si alguna vez hubiera uno,
  --       dejarlo fuera significaría un bulto en la van que nunca llega a la
  --       bandeja de asignación — el fallo que este UPDATE existe para impedir.
  update operacion.pedidos p
     set situacion_retiro = 'retirado',
         retirado_en      = coalesce(p.retirado_en, now())
   where p.tenant_id = p_tenant_id
     and p.situacion_retiro <> 'retirado'
     and p.id in (
       select b.pedido_id
         from operacion.bultos_retiro b
        where b.sesion_retiro_id = p_sesion_id
          and b.tenant_id        = p_tenant_id
          and b.pedido_id is not null
     );

  get diagnostics v_pedidos = row_count;

  -- (5) El cierre. El CHECK sesiones_retiro_cierre_coherente valida de una vez
  --     que los tres contadores estén y que cuadren.
  update operacion.sesiones_retiro s
     set estado              = 'cerrada',
         cerrada_en          = now(),
         bultos_total        = v_total,
         bultos_resueltos    = v_resueltos,
         bultos_sin_resolver = v_sin_resolver
   where s.id = p_sesion_id
     and s.tenant_id = p_tenant_id
  returning s.cerrada_en into v_sesion.cerrada_en;

  return query
    select p_sesion_id,
           'cerrada'::operacion.estado_sesion_retiro,
           v_total,
           v_resueltos,
           v_sin_resolver,
           v_sesion.cerrada_en,
           false,
           v_pedidos;
end;
$$;

comment on function operacion.cerrar_sesion_retiro(uuid, uuid, uuid) is
  'Cierra la visita a una bodega EN UNA SOLA TRANSACCIÓN: congela el acta (los
   tres contadores, solo sobre bultos no posteriores al cierre) y marca como
   `retirado` los pedidos de los bultos escaneados, que es lo que los hace
   aparecer en la bandeja de asignación. Idempotente: si la sesión ya está cerrada
   devuelve el acta congelada tal cual, sin tocar nada y sin error. 42501 si el
   conductor no es el de la visita. Es función y no una secuencia de llamadas
   porque supabase-js no tiene transacciones y un cierre a medias dejaría bultos
   en la van fuera de la bandeja, sin error visible. SECURITY DEFINER, EXECUTE
   solo para service_role.';

-- -----------------------------------------------------------------------------
-- 6.2 resolver_bulto_retiro — casa un bulto con su pedido, tarde o temprano
-- -----------------------------------------------------------------------------
create or replace function operacion.resolver_bulto_retiro(
  p_tenant_id uuid,
  p_bulto_id  uuid,
  p_pedido_id uuid
)
returns table (
  bulto_resuelto_id       uuid,
  pedido_resuelto_id      uuid,
  seller_resuelto_id      uuid,
  resuelto_ts             timestamptz,
  sesion_estaba_cerrada   boolean,
  pedido_marcado_retirado boolean
)
language plpgsql
security definer
set search_path = operacion, identidad, pg_temp
as $$
declare
  v_bulto           operacion.bultos_retiro%rowtype;
  v_seller_pedido   uuid;
  v_tenant_pedido   uuid;
  v_estado_sesion   operacion.estado_sesion_retiro;
  v_resuelto_en     timestamptz;
  v_marcados        integer := 0;
begin
  if p_tenant_id is null or p_bulto_id is null or p_pedido_id is null then
    raise exception
      'resolver_bulto_retiro: p_tenant_id, p_bulto_id y p_pedido_id son obligatorios'
      using errcode = '22023';
  end if;

  select * into v_bulto
    from operacion.bultos_retiro b
   where b.id = p_bulto_id
     and b.tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception
      'resolver_bulto_retiro: el bulto % no existe en el tenant %', p_bulto_id, p_tenant_id
      using errcode = 'P0002';
  end if;

  -- Un código ilegible no se "resuelve" a un pedido: el CHECK
  -- bultos_retiro_desconocido_sin_vinculo lo prohíbe. Se atrapa aquí para dar un
  -- mensaje que explique QUÉ hacer (reclasificar el formato) en vez de un
  -- 23514 crudo de constraint.
  if v_bulto.codigo_formato = 'desconocido' then
    raise exception
      'resolver_bulto_retiro: el bulto % tiene codigo_formato = desconocido; primero hay que reclasificar el código, un ilegible no puede quedar casado con un pedido',
      p_bulto_id
      using errcode = '23514';
  end if;

  select p.tenant_id, p.seller_id
    into v_tenant_pedido, v_seller_pedido
  from operacion.pedidos p
  where p.id = p_pedido_id;

  if v_tenant_pedido is null then
    raise exception
      'resolver_bulto_retiro: el pedido % no existe', p_pedido_id
      using errcode = '23503';
  end if;

  if v_tenant_pedido is distinct from p_tenant_id then
    raise exception
      'resolver_bulto_retiro: el pedido % es del tenant %, no del tenant % — un bulto no se casa con un pedido de otro courier',
      p_pedido_id, v_tenant_pedido, p_tenant_id
      using errcode = '23514';
  end if;

  -- El trigger vuelve a verificar tenant y seller: esto no lo sustituye, lo
  -- adelanta para poder escribir seller_id con el valor correcto.
  update operacion.bultos_retiro b
     set pedido_id   = p_pedido_id,
         seller_id   = v_seller_pedido,
         resuelto_en = coalesce(b.resuelto_en, now())
   where b.id = p_bulto_id
     and b.tenant_id = p_tenant_id
  returning b.resuelto_en into v_resuelto_en;

  select s.estado into v_estado_sesion
    from operacion.sesiones_retiro s
   where s.id = v_bulto.sesion_retiro_id
     and s.tenant_id = p_tenant_id;

  -- ⚠️ EL PASO QUE SE DESCUBRE EN PRODUCCIÓN SI FALTA. Un escaneo que se resuelve
  -- 20 minutos DESPUÉS del cierre (lo normal: la cola sin conexión drena al
  -- recuperar señal, o un humano casa a mano un código que la ingesta no
  -- reconoció) no pasa por cerrar_sesion_retiro y su pedido se quedaría en
  -- `pendiente` para siempre — es decir, NUNCA entraría a la bandeja de
  -- asignación, con el bulto físicamente arriba de la van.
  --
  -- Los contadores del acta NO se recalculan: el acta ya está firmada.
  if v_estado_sesion = 'cerrada' then
    update operacion.pedidos p
       set situacion_retiro = 'retirado',
           retirado_en      = coalesce(p.retirado_en, now())
     where p.id = p_pedido_id
       and p.tenant_id = p_tenant_id
       and p.situacion_retiro <> 'retirado';

    get diagnostics v_marcados = row_count;
  end if;

  return query
    select p_bulto_id,
           p_pedido_id,
           v_seller_pedido,
           v_resuelto_en,
           coalesce(v_estado_sesion = 'cerrada', false),
           v_marcados > 0;
end;
$$;

comment on function operacion.resolver_bulto_retiro(uuid, uuid, uuid) is
  'Casa un bulto escaneado con su pedido: fija pedido_id, seller_id (tomado del
   pedido) y resuelto_en, y —SI LA VISITA YA ESTABA CERRADA— aplica también el
   paso a situacion_retiro = retirado. Sin ese segundo paso, un escaneo resuelto
   después del cierre nunca entraría a la bandeja de asignación aunque el bulto
   esté arriba de la van, y eso se descubre en producción. Los contadores del acta
   NO se recalculan (el acta está firmada). SECURITY DEFINER, EXECUTE solo para
   service_role.';

-- Privilegios de ejecución: NINGÚN rol de cliente. Son los únicos escritores de
-- situacion_retiro y escriben sobre operacion.pedidos con BYPASSRLS.
revoke all on function operacion.cerrar_sesion_retiro(uuid, uuid, uuid)   from public, anon, authenticated;
revoke all on function operacion.resolver_bulto_retiro(uuid, uuid, uuid)  from public, anon, authenticated;
grant execute on function operacion.cerrar_sesion_retiro(uuid, uuid, uuid)  to service_role;
grant execute on function operacion.resolver_bulto_retiro(uuid, uuid, uuid) to service_role;


-- =============================================================================
-- 7. RLS, vistas y grants
-- =============================================================================
grant usage on schema operacion to authenticated, anon;
grant usage on schema operacion to service_role;

-- -----------------------------------------------------------------------------
-- 7.1 sesiones_retiro y bultos_retiro — P1 tenant + interno, o P3 conductor
-- -----------------------------------------------------------------------------
alter table operacion.sesiones_retiro enable row level security;
alter table operacion.sesiones_retiro force row level security;

alter table operacion.bultos_retiro   enable row level security;
alter table operacion.bultos_retiro   force row level security;

-- ⚠️ LA FORMA ENUMERADA NO ES ESTILO. Escribir esto como
-- `claim_tipo_usuario() <> 'seller' or ...` ya se coló DOS VECES en este repo
-- (20260101000002:132-140 y 20260101000004:236-241) y aquí dejaría pasar
-- cualquier tipo_usuario futuro que no sea literalmente 'seller'. Se enumeran los
-- dos casos permitidos y todo lo demás queda fuera por construcción.
--
-- EL SELLER VE CERO FILAS, y es una decisión: el retiro es logística interna del
-- courier. La visita de un conductor lleva bultos de VARIOS sellers (el mismo
-- viaje puede tocar tres bodegas), así que abrirle una rama P2 al seller le
-- mostraría el ritmo, la carga y los faltantes de la operación completa del
-- courier — y, por el seller_id del bulto, de sus competidores en la misma van.
-- Lo que el seller sí ve es su propio pedido pasando a `retirado`
-- (operacion.pedidos, P2), que es la información que legítimamente le importa.
drop policy if exists sesiones_retiro_select on operacion.sesiones_retiro;
create policy sesiones_retiro_select
  on operacion.sesiones_retiro
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (
        identidad.claim_tipo_usuario() = 'conductor'
        and conductor_id = identidad.claim_driver_id()
      )
    )
  );

drop policy if exists bultos_retiro_select on operacion.bultos_retiro;
create policy bultos_retiro_select
  on operacion.bultos_retiro
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (
        identidad.claim_tipo_usuario() = 'conductor'
        and conductor_id = identidad.claim_driver_id()
      )
    )
  );

-- SIN políticas de escritura: escribe solo service_role (BYPASSRLS), y el
-- privilegio está revocado abajo. NO hace falta el guard `solo_interno_edita`
-- que sí llevan las bodegas: ahí el seller CONSERVA el privilegio de UPDATE
-- (puede editar otras tablas) y su UPDATE caería en "0 filas" silencioso. Aquí
-- ningún rol de cliente tiene el privilegio, así que Postgres responde 42501
-- explícito por sí solo — mismo razonamiento por el que cierres_conductor
-- tampoco lo tiene (20260623000001:195).

-- Vistas espejo. `select *` está bien AQUÍ, y esta vez sin asterisco de riesgo:
-- el dato credencial-símil (el string del QR) vive en OTRA TABLA, deny-all y sin
-- vista. No hay ninguna columna que la vista deba esconder, así que no se
-- reproduce el patrón "vista restringida + grant ancho" que ya filtró dos veces
-- en este repo.
create or replace view public.sesiones_retiro
  with (security_invoker = true)
  as select * from operacion.sesiones_retiro;

comment on view public.sesiones_retiro is
  'Espejo de operacion.sesiones_retiro para PostgREST. RLS heredada
   (security_invoker = true): interno de su tenant, o el conductor con SUS
   visitas. El seller ve 0 filas. Escritura exclusiva de service_role.';

create or replace view public.bultos_retiro
  with (security_invoker = true)
  as select * from operacion.bultos_retiro;

comment on view public.bultos_retiro is
  'Espejo de operacion.bultos_retiro para PostgREST. RLS heredada
   (security_invoker = true): interno de su tenant, o el conductor con SUS
   bultos. El seller ve 0 filas. El string del QR NO está aquí (vive en
   operacion.bultos_retiro_qr, deny-all y sin vista). Escritura solo service_role.';

revoke insert, update, delete on operacion.sesiones_retiro from authenticated, anon, public;
revoke insert, update, delete on public.sesiones_retiro    from authenticated, anon, public;
revoke insert, update, delete on operacion.bultos_retiro   from authenticated, anon, public;
revoke insert, update, delete on public.bultos_retiro      from authenticated, anon, public;

-- `anon` no tiene nada que hacer aquí: ninguna política lo alcanza (todas son
-- `to authenticated`), pero se le retira también el SELECT que las default
-- privileges de Supabase le regalan en `public`.
revoke select on operacion.sesiones_retiro from anon;
revoke select on public.sesiones_retiro    from anon;
revoke select on operacion.bultos_retiro   from anon;
revoke select on public.bultos_retiro      from anon;

grant select on operacion.sesiones_retiro to authenticated;
grant select on public.sesiones_retiro    to authenticated;
grant select on operacion.bultos_retiro   to authenticated;
grant select on public.bultos_retiro      to authenticated;

grant select, insert, update, delete on operacion.sesiones_retiro to service_role;
grant select, insert, update, delete on public.sesiones_retiro    to service_role;
grant select, insert, update, delete on operacion.bultos_retiro   to service_role;
grant select, insert, update, delete on public.bultos_retiro      to service_role;

-- -----------------------------------------------------------------------------
-- 7.2 bultos_retiro_qr — DENY-ALL (molde identidad.secretos_cifrados)
-- -----------------------------------------------------------------------------
-- RLS activa igual (defensa en profundidad) pero SIN NINGUNA POLÍTICA: con FORCE
-- RLS y cero políticas, ningún rol de cliente ve una sola fila. Y encima el
-- privilegio revocado, que es la barrera que de verdad importa porque `operacion`
-- está expuesto a PostgREST (config.toml:36) y sin el revoke la tabla sería
-- alcanzable con `Accept-Profile: operacion`.
alter table operacion.bultos_retiro_qr enable row level security;
alter table operacion.bultos_retiro_qr force row level security;

revoke all on operacion.bultos_retiro_qr from authenticated, anon, public;

-- NO SE CREA VISTA EN `public`, a propósito. La aserción del §8 aborta la
-- migración si alguna vez aparece una.
grant select, insert, update, delete on operacion.bultos_retiro_qr to service_role;


-- =============================================================================
-- 7bis. bitacora_auditoria: cinco llaves prohibidas más
-- =============================================================================
-- Alcance §1.5: agregar `hash_code`, `qr_payload` y `qr` al CHECK. Se suman
-- también `security_digit` (la otra mitad del payload de Flex) y `codigo_crudo`
-- (el nombre del tipo_payload de la tabla del QR, que es como se llamaría el
-- campo si alguien lo volcara al detalle de un asiento).
--
-- ⚠️ LA LISTA SE REPONE ENTERA Y SE COPIÓ DE LA BASE, no de otra migración. Es la
-- trampa documentada en CLAUDE.md §Invariantes: el 2026-08-12 una migración copió
-- la lista de una versión vieja y BORRÓ un valor sin que nada fallara al migrar
-- (falló en ejecución, semanas después, tumbando el job de dinero). Lo vigente se
-- verificó con:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'bitacora_auditoria_detalle_sin_secretos';
-- → token, access_token, refresh_token, password, secret, certificado,
--   valor_cifrado  (7 llaves, las de 20260101000004:312-320, sin cambios desde
--   entonces). Las 7 se reponen tal cual y se agregan 5 → 12.
--
-- Es CHECK y no confianza en la aplicación porque el escritor de la bitácora es
-- service_role y un `detalle` mal armado por un job nuevo no tiene otra barrera.
do $$
begin
  alter table identidad.bitacora_auditoria
    drop constraint if exists bitacora_auditoria_detalle_sin_secretos;

  alter table identidad.bitacora_auditoria
    add constraint bitacora_auditoria_detalle_sin_secretos check (
      -- Las 7 vigentes (copiadas de pg_get_constraintdef, no de otra migración).
      not (detalle ? 'token')
      and not (detalle ? 'access_token')
      and not (detalle ? 'refresh_token')
      and not (detalle ? 'password')
      and not (detalle ? 'secret')
      and not (detalle ? 'certificado')
      and not (detalle ? 'valor_cifrado')
      -- Las 5 nuevas del retiro (alcance §1.5).
      and not (detalle ? 'hash_code')
      and not (detalle ? 'qr_payload')
      and not (detalle ? 'qr')
      and not (detalle ? 'security_digit')
      and not (detalle ? 'codigo_crudo')
    );
end $$;

comment on constraint bitacora_auditoria_detalle_sin_secretos on identidad.bitacora_auditoria is
  'Defensa en profundidad: el detalle jsonb de un asiento NUNCA lleva secretos.
   12 llaves prohibidas — 7 originales (token, access_token, refresh_token,
   password, secret, certificado, valor_cifrado) + 5 del retiro en bodega
   (hash_code, qr_payload, qr, security_digit, codigo_crudo). AL AGREGAR UNA
   LLAVE SE REPONE LA LISTA ENTERA, copiada de pg_get_constraintdef sobre la BASE
   y nunca de otra migración: copiarla de una versión vieja borra valores sin que
   nada falle al migrar (pasó el 2026-08-12).';


-- =============================================================================
-- 8. Aserción defensiva — la migración ABORTA si alguna barrera no quedó puesta
-- =============================================================================
-- No altera nada: inspecciona el catálogo y falla ruidosamente. Mismo patrón que
-- 20260813000002 §4 y 20260812000003 §3. Existe porque todas las piezas de abajo
-- fallan EN SILENCIO cuando faltan: una tabla sin `force` se lee normal desde el
-- rol dueño, un `revoke all` que no tomó deja la credencial servida por
-- PostgREST, y una unique faltante solo se nota en la etapa 8, cuando ya hay que
-- re-migrar.
do $$
declare
  tabla   text;
  priv    text;
begin
  -- 8.1 RLS enable + force en LAS TRES. `force` es la que cubre también al dueño:
  --     sin ella, cualquier conexión con el rol propietario lee todos los tenants.
  foreach tabla in array array['sesiones_retiro', 'bultos_retiro', 'bultos_retiro_qr']
  loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'operacion' and c.relname = tabla
        and c.relrowsecurity and c.relforcerowsecurity
    ) then
      raise exception
        'operacion.% no quedó con RLS enable + force. Sin RLS forzada no hay aislamiento entre couriers en esta tabla.', tabla;
    end if;
  end loop;

  -- 8.2 La tabla del QR es DENY-ALL de verdad. Se comprueba con
  --     has_table_privilege y NO contando grants: un `revoke` que no tomó efecto
  --     (o un default ACL de supabase_admin que regaló ALL al crear la tabla) deja
  --     la credencial servible por PostgREST con `Accept-Profile: operacion`, y
  --     eso no se ve por ninguna parte hasta que alguien la pide.
  foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  loop
    if has_table_privilege('authenticated', 'operacion.bultos_retiro_qr', priv) then
      raise exception
        'authenticated conserva el privilegio % sobre operacion.bultos_retiro_qr. Esa tabla es DENY-ALL: guarda el string del QR, que es credencial-símil e irrecuperable.', priv;
    end if;
    if has_table_privilege('anon', 'operacion.bultos_retiro_qr', priv) then
      raise exception
        'anon conserva el privilegio % sobre operacion.bultos_retiro_qr. Esa tabla es DENY-ALL.', priv;
    end if;
  end loop;

  -- 8.3 NO puede existir una vista espejo del QR en `public`. Si alguien la crea
  --     "para depurar", la credencial queda a un GRANT de distancia de PostgREST.
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'bultos_retiro_qr'
  ) then
    raise exception
      'Existe public.bultos_retiro_qr. La tabla del QR NO lleva vista espejo: el molde deny-all de identidad.secretos_cifrados es sin vista, y una vista la pone al alcance de PostgREST.';
  end if;

  -- 8.4 Las DOS uniques de la sesión. Se comprueban por COLUMNAS y no por nombre:
  --     lo que importa es que la garantía exista.
  --     · (tenant_id, id)               → FK compuestas de las etapas siguientes.
  --     · (tenant_id, id, conductor_id) → la etapa 8 la usa para que la línea de
  --       retiro no pueda emitirse a nombre de un conductor que no hizo la visita.
  if not exists (
    select 1
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'operacion' and c.relname = 'sesiones_retiro'
       and con.contype = 'u'
       and (
         select array_agg(a.attname::text order by a.attname)
           from unnest(con.conkey) as k(attnum)
           join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
       ) = array['id', 'tenant_id']
  ) then
    raise exception
      'Falta unique (tenant_id, id) en operacion.sesiones_retiro: sin ella las etapas siguientes no pueden declarar su FK compuesta.';
  end if;

  if not exists (
    select 1
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'operacion' and c.relname = 'sesiones_retiro'
       and con.contype = 'u'
       and (
         select array_agg(a.attname::text order by a.attname)
           from unnest(con.conkey) as k(attnum)
           join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
       ) = array['conductor_id', 'id', 'tenant_id']
  ) then
    raise exception
      'Falta unique (tenant_id, id, conductor_id) en operacion.sesiones_retiro: es la que impide, en la etapa 8, emitir la línea de retiro a nombre de un conductor que no hizo la visita.';
  end if;

  -- 8.5 La unique (id, seller_id) del §0, sin la cual la FK que hace honesto al
  --     seller denormalizado de la sesión no existiría.
  if not exists (
    select 1
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'identidad' and c.relname = 'seller_bodegas'
       and con.contype = 'u'
       and (
         select array_agg(a.attname::text order by a.attname)
           from unnest(con.conkey) as k(attnum)
           join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
       ) = array['id', 'seller_id']
  ) then
    raise exception
      'Falta unique (id, seller_id) en identidad.seller_bodegas: sin ella el seller_id denormalizado de sesiones_retiro no está amarrado por FK al dueño real de la bodega.';
  end if;

  -- 8.6 Las dos vistas espejo con security_invoker. Sin esa opción las evalúa su
  --     dueño (postgres, BYPASSRLS) y la vista se vuelve un agujero que expone
  --     todos los tenants por PostgREST.
  foreach tabla in array array['sesiones_retiro', 'bultos_retiro']
  loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = tabla and c.relkind = 'v'
        and c.reloptions @> array['security_invoker=true']
    ) then
      raise exception
        'La vista public.% no tiene security_invoker = true. Sin ella la RLS se evalúa como el dueño de la vista y expone todos los tenants.', tabla;
    end if;
  end loop;

  -- 8.7 Las dos idempotencias de bultos_retiro. Hacen cosas DISTINTAS y quitar
  --     cualquiera deja pasar duplicados por el otro camino — y un duplicado
  --     infla el acta, que es lo que se le paga al conductor por la visita.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'operacion' and tablename = 'bultos_retiro'
       and indexname = 'bultos_retiro_escaneo_uk'
  ) then
    raise exception
      'Falta bultos_retiro_escaneo_uk (tenant_id, escaneo_id): es la idempotencia del REINTENTO DE LOTE.';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'operacion' and tablename = 'bultos_retiro'
       and indexname = 'bultos_retiro_sesion_codigo_uk'
  ) then
    raise exception
      'Falta bultos_retiro_sesion_codigo_uk (sesion_retiro_id, codigo_normalizado): es la idempotencia del DOBLE ESCANEO FÍSICO, que la otra unique NO cubre (cada disparo de cámara trae un escaneo_id nuevo).';
  end if;

  -- 8.8 El índice único de sesión abierta DEBE incluir fecha_operacion. Sin ella,
  --     una sesión que quedó abierta ayer se reutiliza hoy y los bultos de hoy
  --     caen en el acta —y en la plata— de ayer.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'operacion' and tablename = 'sesiones_retiro'
       and indexname = 'sesiones_retiro_abierta_uk'
       and indexdef like '%fecha_operacion%'
       and indexdef like '%estado%'
  ) then
    raise exception
      'sesiones_retiro_abierta_uk no existe o no incluye fecha_operacion: una sesión abierta ayer se reutilizaría hoy y sus bultos caerían en el acta de ayer.';
  end if;

  -- 8.9 Las cinco llaves nuevas del CHECK de la bitácora Y las siete originales.
  --     Se verifica el conjunto EXACTO, nunca un conteo (CLAUDE.md §Invariantes:
  --     16 antes y 16 después, distinta lista).
  foreach priv in array array[
    'token', 'access_token', 'refresh_token', 'password', 'secret', 'certificado',
    'valor_cifrado', 'hash_code', 'qr_payload', 'qr', 'security_digit', 'codigo_crudo'
  ]
  loop
    if position(('''' || priv || '''') in (
      select pg_get_constraintdef(oid) from pg_constraint
       where conname = 'bitacora_auditoria_detalle_sin_secretos'
    )) = 0 then
      raise exception
        'El CHECK bitacora_auditoria_detalle_sin_secretos perdió la llave "%". La lista se repone ENTERA desde pg_get_constraintdef sobre la base, nunca desde otra migración.', priv;
    end if;
  end loop;

  -- 8.10 Las dos funciones no son ejecutables por ningún rol de cliente: escriben
  --      situacion_retiro sobre operacion.pedidos con BYPASSRLS.
  if has_function_privilege('authenticated', 'operacion.cerrar_sesion_retiro(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'operacion.cerrar_sesion_retiro(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception
      'operacion.cerrar_sesion_retiro sigue siendo ejecutable por un rol de cliente. Es SECURITY DEFINER y escribe operacion.pedidos saltándose RLS.';
  end if;

  if has_function_privilege('authenticated', 'operacion.resolver_bulto_retiro(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'operacion.resolver_bulto_retiro(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception
      'operacion.resolver_bulto_retiro sigue siendo ejecutable por un rol de cliente. Es SECURITY DEFINER y escribe operacion.pedidos saltándose RLS.';
  end if;
end $$;


-- =============================================================================
-- 9. Handoff (NO se implementa aquí — solo se documenta)
--
--    `backend` (etapa 3, endpoints del retiro)
--      · Abrir visita: INSERT con `on conflict` sobre sesiones_retiro_abierta_uk
--        → reutiliza la sesión abierta del día. NO buscar-y-luego-insertar: dos
--        POST simultáneos desde la app abrirían dos visitas.
--      · Lote de escaneos (hasta 50): INSERT con
--        `on conflict (sesion_retiro_id, codigo_normalizado) do update` — el
--        duplicado SE FUSIONA, no da error. Un lote que falla entero por un bulto
--        repetido deja al conductor bloqueado en la bodega.
--      · ⚠️ El upsert de PostgREST escribe TODAS las columnas del payload también
--        en el UPDATE (lección de ejecutar-backfill.ts, CLAUDE.md). En el UPDATE
--        de fusión NUNCA deben viajar `escaneo_id`, `escaneado_en`, `recibido_en`
--        ni `posterior_al_cierre`: son del PRIMER escaneo.
--      · Cerrar visita: SOLO por operacion.cerrar_sesion_retiro(). No replicar el
--        UPDATE a mano — es la única transacción que ata acta y situacion_retiro.
--      · Resolver un código a mano: SOLO por operacion.resolver_bulto_retiro().
--      · El string del QR se cifra con integraciones/secretos/cifrado.ts y se
--        guarda en bultos_retiro_qr con service_role. La receta del AAD del
--        `aad_esquema = 'v1'` NO puede depender de pedido_id (es NULL en un bulto
--        sin resolver): el par estable es (tenant_id, bulto_id).
--      · Las 10 rutas Bearer del conductor SALTAN RLS (crearClienteServiceRole).
--        El aislamiento de las nuevas descansa en el filtro por tenant del código,
--        y hoy NINGUNA de las 10 existentes tiene prueba de rechazo cruzado. Cada
--        endpoint nuevo del retiro necesita su Vitest de cruce entre couriers.
--      · ⚠️ PENDIENTE QUE ESTA MIGRACIÓN NO PUEDE CERRAR (vive en src/, y el
--        alcance §1.5 lo pide junto con el CHECK): `CLAVES_PROHIBIDAS` en
--        src/modules/identidad/auditoria.ts:50-63 NO tiene las cinco llaves
--        nuevas. Hoy las dos mitades divergen: la BD RECHAZA con 23514 un
--        `detalle` que traiga `hash_code`, mientras `sanearDetalle` lo deja
--        pasar en vez de removerlo. Falla ruidoso (mejor que filtrar), pero
--        tumba el asiento —y con él la acción financiera que lo precede— en vez
--        de sanearlo. Agregar allí: hash_code, qr_payload, qr, security_digit,
--        codigo_crudo. No hay ninguna prueba que ate las dos mitades.
--
--    `backend` (etapa 8, el dinero del retiro)
--      · La línea de liquidación del retiro cuelga de (tenant_id, sesion_id,
--        conductor_id) contra sesiones_retiro_tenant_id_conductor_uk. Esa FK es
--        lo que impide pagarle la visita a quien no la hizo.
--      · Los contadores del acta NO se recalculan nunca. Si hace falta reabrir una
--        visita, es una decisión nueva con bitácora y actorUsuarioId, no un UPDATE.
--
--    `qa`
--      · Prueba de aislamiento: supabase/tests/database/rls_aislamiento_retiro.test.sql
--      · operacion.bultos_retiro_qr quedó en la lista nominal del Test 3 de
--        rls_cobertura_meta.test.sql.
--
--    `frontend` / `copywriter`
--      · La "resolución" de un bulto se DERIVA, no se lee de una columna:
--        desconocido ⇒ ilegible · pedido_id null ⇒ no procesado · resto ⇒ resuelto.
--      · Contadores NULL = "visita en curso, todavía no hay acta". No mostrar 0.
-- =============================================================================
