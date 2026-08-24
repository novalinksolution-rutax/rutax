-- =============================================================================
-- Dispositivos del conductor — el destino de las notificaciones push
-- =============================================================================
--
-- La app del conductor no tenía forma de recibir un aviso. Las tres del tablero
-- —«tu ruta está lista», «te traspasaron bultos», «tienes un retiro nuevo»—
-- necesitan una dirección a la que mandarlas, y esa dirección es el token que
-- Expo le entrega a cada instalación.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ ES UNA TABLA Y NO UNA COLUMNA EN `conductores`
-- -----------------------------------------------------------------------------
-- Un conductor puede tener la app en más de un teléfono —el suyo y el de la
-- empresa, o el nuevo mientras migra del viejo— y **el token cambia solo**:
-- Expo lo rota cuando el sistema operativo se lo pide, al reinstalar y a veces
-- al actualizar. Con una columna, cada instalación pisaría a la anterior y el
-- aviso llegaría a un solo aparato, casi siempre al equivocado.
--
-- -----------------------------------------------------------------------------
-- ES TABLA DE NEGOCIO: LLEVA `tenant_id`
-- -----------------------------------------------------------------------------
-- Dar de alta un courier agrega filas acá en cuanto sus conductores abran la
-- app, así que por el test mecánico del proyecto es de negocio, sin discusión.
-- RLS con la política de siempre y sin vista en `public`: la app llega por ruta
-- Bearer con `service_role`, igual que el resto de sus superficies.
--
-- -----------------------------------------------------------------------------
-- EL TOKEN NO ES UN SECRETO, PERO TAMPOCO ES PÚBLICO
-- -----------------------------------------------------------------------------
-- Con el token de alguien se le puede mandar una notificación falsa. No abre su
-- cuenta ni lee sus datos, así que no va cifrado como los de OAuth, pero **no
-- se expone a sesiones de usuario** y nunca se escribe en un log.

create table if not exists identidad.dispositivos_conductor (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identidad.tenants (id) on delete cascade,
  conductor_id    uuid not null references identidad.conductores (id) on delete cascade,

  -- El token de Expo (`ExponentPushToken[...]`). Se valida en la app antes de
  -- llegar acá; el CHECK es la última red.
  token           text not null,
  plataforma      text not null check (plataforma in ('ios', 'android')),

  -- Cuándo se vio por última vez. Un token que lleva meses sin renovarse casi
  -- siempre es una app desinstalada, y Expo responde `DeviceNotRegistered`.
  visto_en        timestamptz not null default now(),
  creado_en       timestamptz not null default now(),

  constraint dispositivos_conductor_token_formato
    check (token ~ '^Expo(nent)?PushToken\[[^\]]+\]$')
);

-- El mismo token no puede pertenecer a dos conductores: si un teléfono cambia
-- de dueño, la fila se reasigna, no se duplica. Sin esto, el conductor anterior
-- seguiría recibiendo las paradas del nuevo.
create unique index if not exists dispositivos_conductor_token_uk
  on identidad.dispositivos_conductor (token);

create index if not exists dispositivos_conductor_lookup
  on identidad.dispositivos_conductor (tenant_id, conductor_id);

comment on table identidad.dispositivos_conductor is
  'Tokens de notificación push por instalación de la app del conductor. Un
   conductor puede tener varias; el token lo rota Expo solo. Deny-all para
   sesiones de usuario: se lee y escribe con service_role desde las rutas
   Bearer de la app.';

alter table identidad.dispositivos_conductor enable row level security;
alter table identidad.dispositivos_conductor force row level security;

revoke all on identidad.dispositivos_conductor from public, anon, authenticated;
grant select, insert, update, delete on identidad.dispositivos_conductor to service_role;
