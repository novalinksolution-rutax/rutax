-- =============================================================================
-- Cobranza Fintoc — nonce de un solo uso para el webhook `link.created`
-- =============================================================================
--
-- POR QUÉ EXISTE (esto no es una tabla de conveniencia: tapa un hueco real)
-- -----------------------------------------------------------------------------
-- Para leer los movimientos bancarios del courier (producto "movements" de
-- Fintoc) hace falta el `link_token`. Y el `link_token` NO se puede obtener de
-- ninguna de las dos formas que uno intentaría primero:
--
--   1. NO llega en el callback `onSuccess` del widget. El widget devuelve
--      `{id, link: {id}}` y nada más.
--   2. NO se puede pedir después. Cita literal de la doc de Fintoc
--      (docs.fintoc.com/reference/link-object): «This attribute will only be
--      returned when creating a Link. After that, this field will always be
--      null», y «the Link Token is not saved by Fintoc, and can never be
--      retrieved again».
--
-- El ÚNICO canal por el que el token llega es la notificación que Fintoc
-- dispara al `webhookUrl` que se le pasa a `Fintoc.create(...)`, en el instante
-- exacto en que se crea el Link.
--
-- -----------------------------------------------------------------------------
-- 🔴 Y ESE WEBHOOK LLEGA SIN FIRMA. VERIFICADO EN PRODUCCIÓN.
-- -----------------------------------------------------------------------------
-- Vercel Logs de rutax.io (deployment dpl_DrLej3PYjtotMeTpBkv7gLeggvKv):
-- Fintoc SÍ llama a `POST /api/webhooks/fintoc/{tenantId}` (User-Agent: Ruby)
-- al completar el widget, pero SIN header `Fintoc-Signature`. La función hacía
-- el rate-limit y respondía 401 (`firma_ausente`) sin llegar a escribir nada.
--
-- No es un error de configuración nuestro: según docs.fintoc.com/docs/webhooks-
-- validating, la firma existe solo para los «Webhook Endpoints» REGISTRADOS,
-- que son los que tienen un secreto generado al registrarlos. El `webhookUrl`
-- que se le pasa al widget es un canal ad-hoc que Fintoc no firma. No hay
-- forma de pedirle que lo firme.
--
-- Consecuencia: el patrón habitual —«validar la firma antes de creerle al
-- payload»— no está disponible justo para la notificación que trae el secreto
-- más valioso del flujo. Sin nada más, la superficie de ataque es: adivinar (o
-- ver en un log, o recibir en un correo reenviado) un `tenant_id` y hacer un
-- POST con un `link_token` propio, pisando la conexión bancaria real del
-- courier y redirigiendo su cobranza a la cuenta del atacante.
--
-- -----------------------------------------------------------------------------
-- LO QUE HACE ESTA TABLA: mover el secreto del payload a la URL, y hacerlo
-- de un solo uso
-- -----------------------------------------------------------------------------
-- NUESTRO servidor genera una fila ANTES de abrir el widget, y le pasa a Fintoc
-- `webhookUrl = /api/webhooks/fintoc/{tenantId}?flow={nonce}`. El webhook solo
-- acepta el `link.created` si existe una fila `pendiente`, no vencida, cuyo
-- `nonce` Y cuyo `tenant_id` calzan con lo recibido — y la marca `consumido` en
-- la misma operación.
--
-- Es decir: la autorización no viene de creerle al payload, sino de que el
-- remitente conoce un valor que solo nosotros generamos, para ese tenant, hace
-- menos de 15 minutos, y que deja de servir en cuanto se usa.
--
-- ⚠️ EL NONCE NO ES UN SECRETO DURADERO, Y NO SE DEBE TRATAR COMO TAL. Viaja
-- en una URL (querystring), así que puede terminar en logs de intermediarios.
-- Lo que lo hace seguro es exactamente lo que esta tabla impone: UN solo uso y
-- VIDA CORTA. Por eso no está cifrado ni vive en `secretos_cifrados`: no es una
-- credencial, es un ticket. El `link_token` que llega SÍ es secreto y sigue su
-- camino normal — cifrado en `identidad.secretos_cifrados`, referenciado por
-- `identidad.courier_config_cobranza.link_token_ref`. Aquí no se guarda jamás.
--
-- -----------------------------------------------------------------------------
-- UNA SOLA FILA `pendiente` POR COURIER, IMPUESTA POR LA BASE
-- -----------------------------------------------------------------------------
-- El índice único parcial `(tenant_id) where estado = 'pendiente'` está para que
-- abrir el widget dos veces no acumule tickets vivos. Importa por dos razones
-- distintas:
--   (a) Seguridad: N nonces vivos son N llaves vigentes a la vez. Uno.
--   (b) Corrección: si hubiera dos pendientes, el webhook tendría que decidir
--       cuál consumir, y esa decisión no existe — el widget que quedó abierto en
--       la otra pestaña no va a volver.
-- El código de aplicación reemplaza la anterior (la marca `expirado` o la borra)
-- antes de insertar; el índice es lo que convierte ese descuido en un 23505 en
-- vez de un estado ambiguo.
--
-- -----------------------------------------------------------------------------
-- DENY-ALL (esta tabla no la toca ninguna sesión de usuario)
-- -----------------------------------------------------------------------------
-- La escriben y la leen SOLO la Server Action que abre el widget y el webhook,
-- ambos con cliente `service_role` —igual que ya ocurre con
-- `courier_config_cobranza` en el camino del webhook—. Un usuario autenticado
-- no tiene nada que hacer acá: el nonce ya le llegó por la URL que su propia
-- Server Action le devolvió, y poder LEER la tabla sería poder leer el ticket
-- vivo de otro flujo. RLS enable + force SIN políticas, sin vista espejo en
-- `public`, y revoke explícito: PostgREST no tiene por dónde entrar.
--
-- Nótese que el `tenant_id` sigue siendo obligatorio aunque nadie la lea por
-- RLS: el aislamiento acá lo usa el propio webhook, que exige que el nonce
-- pertenezca al tenant de la URL. Un nonce válido de otro courier no sirve.
--
-- -----------------------------------------------------------------------------
-- SIN JOB DE LIMPIEZA, A PROPÓSITO (por ahora)
-- -----------------------------------------------------------------------------
-- No hace falta para que la protección sea correcta: la validación es
-- `estado = 'pendiente' and expira_en > now()`, así que una fila vencida y sin
-- barrer ya no autoriza nada. El barrido es higiene de tabla, no seguridad, y
-- se agrega cuando haga ruido. ⚠️ No caer en la tentación de validar solo por
-- `estado`: sin el `expira_en > now()` un ticket olvidado sería eterno.
--
-- Idempotente: `create table if not exists`, índices con `if not exists`,
-- trigger con `drop ... if exists`. Re-aplicable sobre base ya migrada.
-- =============================================================================

create table if not exists identidad.cobranza_conexiones_pendientes (
  id                uuid primary key default gen_random_uuid(),

  -- Toda tabla de negocio lleva tenant_id (regla no-negociable del proyecto).
  -- `on delete cascade` como `courier_config_cobranza`: si el courier se va, sus
  -- tickets a medio usar no tienen ningún valor que conservar (a diferencia de
  -- un hecho financiero, que se retiene con `restrict`).
  tenant_id         uuid not null
    references identidad.tenants (id) on delete cascade,

  -- El valor que viaja en la URL del webhook (`?flow=<nonce>`). UNIQUE global,
  -- no por tenant: el webhook busca por nonce y después comprueba que el
  -- tenant calce, y un nonce que pudiera repetirse entre couriers volvería esa
  -- comprobación en la única barrera. Que sea globalmente único hace que el
  -- cruce de tenants sea imposible por construcción, no por una condición que
  -- alguien pueda olvidar en un WHERE.
  nonce             uuid not null default gen_random_uuid()
    constraint cobranza_conexiones_pendientes_nonce_uk unique,

  estado            text not null default 'pendiente'
    constraint cobranza_conexiones_pendientes_estado_valido
      check (estado in ('pendiente', 'consumido', 'expirado')),

  creado_en         timestamptz not null default now(),

  -- Vida corta. 15 minutos es holgado para conectar un banco en el widget y
  -- corto para que un nonce filtrado en un log no sirva de nada mañana.
  -- El default está acá y no solo en el código para que una inserción que se
  -- olvide de calcularlo nazca con vencimiento, no eterna (fail-closed).
  expira_en         timestamptz not null default (now() + interval '15 minutes'),

  consumido_en      timestamptz,

  -- Quién abrió el widget. Va a la bitácora cuando el webhook aterriza: sin
  -- esto, conectar la cuenta bancaria del courier sería un hecho anónimo, y es
  -- una acción de acceso a datos financieros. Nullable porque el webhook puede
  -- llegar de un flujo iniciado por un proceso de sistema, y porque el usuario
  -- puede darse de baja después; sin FK, igual que el resto de referencias a
  -- actores que deben sobrevivir a la baja de la cuenta.
  actor_usuario_id  uuid,

  constraint cobranza_conexiones_pendientes_expira_despues_de_creado
    check (expira_en > creado_en),

  -- Coherencia de estado: `consumido` exige su marca de tiempo, y un ticket que
  -- todavía está `pendiente` no puede tenerla. Evita el estado imposible que
  -- haría dudar de la bitácora.
  constraint cobranza_conexiones_pendientes_consumido_coherente
    check (
      (estado = 'pendiente' and consumido_en is null)
      or (estado = 'consumido' and consumido_en is not null)
      or estado = 'expirado'
    )
);

comment on table identidad.cobranza_conexiones_pendientes is
  'Nonce de un solo uso y vida corta que autoriza el webhook `link.created` de
   Fintoc. Existe porque ese webhook llega SIN `Fintoc-Signature` (verificado en
   producción; el `webhookUrl` del widget es un canal ad-hoc que Fintoc no
   firma) y es el único sitio por el que el `link_token` llega jamás. El nonce
   viaja en la URL (`?flow=...`), así que NO es un secreto duradero: lo que lo
   hace seguro es el uso único + el vencimiento. Deny-all: solo service_role
   (Server Action que abre el widget + webhook). Nunca guarda el link_token.';

comment on column identidad.cobranza_conexiones_pendientes.nonce is
  'Valor que se pasa en webhookUrl=/api/webhooks/fintoc/{tenantId}?flow={nonce}.
   Efectivamente público (viaja en una URL y puede quedar en logs de terceros),
   de un solo uso y vencido en 15 minutos. UNIQUE global a propósito: hace
   imposible por construcción que un nonce sirva para otro tenant.';

comment on column identidad.cobranza_conexiones_pendientes.expira_en is
  'Vencimiento del ticket. La validación del webhook es
   `estado = ''pendiente'' and expira_en > now()`: las DOS mitades. Validar solo
   por estado convierte un ticket olvidado en una llave eterna.';

comment on column identidad.cobranza_conexiones_pendientes.actor_usuario_id is
  'Usuario que abrió el widget, para la bitácora del momento en que el webhook
   aterriza. Sin FK: el registro debe sobrevivir a la baja de la cuenta.';

-- -----------------------------------------------------------------------------
-- UN solo ticket vivo por courier — impuesto por la base, no por el código
-- -----------------------------------------------------------------------------
-- Las filas `consumido`/`expirado` no entran al índice, así que un courier puede
-- acumular todo el histórico que quiera sin chocar: lo único que no puede tener
-- es dos llaves vigentes a la vez.
create unique index if not exists idx_cobranza_conexiones_pendientes_un_pendiente
  on identidad.cobranza_conexiones_pendientes (tenant_id)
  where estado = 'pendiente';

-- Búsqueda del webhook: por nonce. (El UNIQUE de `nonce` ya provee el índice;
-- este de tenant es para el barrido/limpieza y para la Server Action que
-- invalida el pendiente anterior antes de crear uno nuevo.)
create index if not exists idx_cobranza_conexiones_pendientes_tenant
  on identidad.cobranza_conexiones_pendientes (tenant_id, creado_en desc);

-- Cola del futuro barrido de vencidos (y del marcado a `expirado`).
create index if not exists idx_cobranza_conexiones_pendientes_vencidos
  on identidad.cobranza_conexiones_pendientes (expira_en)
  where estado = 'pendiente';

-- -----------------------------------------------------------------------------
-- RLS: deny-all. Ninguna sesión de usuario toca esta tabla.
-- -----------------------------------------------------------------------------
-- Sin políticas y sin vista espejo en `public`. `force` para que la ausencia de
-- políticas alcance también al owner en consultas normales; `service_role`
-- (BYPASSRLS) sigue pasando por encima, que es como entran la Server Action y
-- el webhook.
alter table identidad.cobranza_conexiones_pendientes enable row level security;
alter table identidad.cobranza_conexiones_pendientes force row level security;

grant select, insert, update, delete
  on identidad.cobranza_conexiones_pendientes to service_role;

-- Defensa en profundidad: RLS ya niega, pero el privilegio también se quita.
-- ⚠️ Esto importa más de lo que parece — con RLS sin políticas, un SELECT de
-- `authenticated` devolvería CERO FILAS (silencio); sin el privilegio devuelve
-- 42501 (ruido). El pgTAP de esta migración prueba el 42501, no el conteo.
revoke all on identidad.cobranza_conexiones_pendientes from authenticated, anon;
