-- =============================================================================
-- Qué partes del producto tiene encendidas cada courier
-- =============================================================================
--
-- POR QUÉ EXISTE
-- -----------------------------------------------------------------------------
-- El módulo de dinero todavía no es productivo y el primer courier real ya
-- empieza a operar. Rutax necesita poder decir «esta parte no está lista» por
-- courier, y que eso alcance a TODOS sus usuarios —los de hoy y los que cree
-- mañana— sin tocar roles ni invitar a nadie de nuevo.
--
-- -----------------------------------------------------------------------------
-- 🔴 LA FILA SIGNIFICA «ENCENDIDA». LA AUSENCIA ES «APAGADA».
-- -----------------------------------------------------------------------------
-- Es al revés de lo que se escribe por reflejo (una tabla de «deshabilitadas»),
-- y es deliberado: **así el default de un courier nuevo es apagado sin que nadie
-- tenga que acordarse de nada**. Un tenant recién creado no tiene filas, y por
-- lo tanto no tiene nada encendido. Una tabla de deshabilitadas haría lo
-- contrario — el courier que se dé de alta un domingo nacería con el módulo de
-- dinero abierto hasta que alguien lo cerrara.
--
-- Decisión del usuario (2026-08-28): apagado por defecto, se va abriendo.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ SON ÁREAS Y NO CAPACIDADES SUELTAS
-- -----------------------------------------------------------------------------
-- El catálogo de RBAC tiene ~27 capacidades y varias se necesitan en pareja para
-- que una pantalla exista (la reportería pide dos a la vez). Un panel con 27
-- casillas deja apagar media pantalla y dejarla rota, y además obliga a Rutax a
-- razonar en el vocabulario del código. Lo que de verdad se decide es «esta
-- parte del producto no está lista», que son cinco cosas con nombre de negocio.
--
-- El mapa área → capacidades vive en `src/modules/identidad/areas-producto.ts`,
-- no acá: es lógica de producto y cambia con el catálogo de RBAC, que también
-- vive en TypeScript. Esta tabla solo guarda QUÉ está encendido.
--
-- -----------------------------------------------------------------------------
-- DENY-ALL, COMO TODO `plataforma`
-- -----------------------------------------------------------------------------
-- Sin políticas para `authenticated` y sin vista en `public`: un courier no lee
-- esta tabla ni sabe que existe. La app la consulta con `service_role` a través
-- de la superficie courier-safe (`superficie-courier.ts`), igual que ya hace con
-- el plan. Que el courier no pueda leerla importa: es la lista de lo que NO
-- tiene, y es información del backstage.
-- =============================================================================

create table if not exists plataforma.areas_habilitadas (
  tenant_id       uuid not null references identidad.tenants (id) on delete cascade,

  -- ⚠️ Esta lista y la de `areas-producto.ts` son la MISMA lista en dos sitios.
  -- Si se agrega un área acá sin agregarla allá, la fila se guarda y no gobierna
  -- nada; al revés, la Server Action falla con un 23514 al intentar encenderla.
  -- La prueba `areas-producto-sql.test.ts` ata las dos mitades.
  area            text not null
    constraint areas_habilitadas_area_valida
      check (area in (
        'emision_facturas',
        'folios_caf',
        'pago_conductores',
        'conciliacion_cobranza',
        'suscripcion_rutax'
      )),

  habilitada_en   timestamptz not null default now(),

  -- Quién la encendió. Es un `super_admin` de Rutax, no un usuario del courier;
  -- sin FK a propósito, igual que el resto de referencias a actores en
  -- `plataforma` (el admin puede darse de baja y el registro tiene que quedar).
  habilitada_por  uuid,

  /** Por qué se encendió, en palabras. Se muestra en el backstage. */
  nota            text,

  primary key (tenant_id, area)
);

comment on table plataforma.areas_habilitadas is
  'Qué áreas del producto tiene ENCENDIDAS cada courier. La fila significa
   habilitada; la AUSENCIA de fila es "apagada", que es lo que hace que un
   courier nuevo nazca sin nada abierto sin depender de que alguien lo
   configure. Deny-all: la lee la app con service_role vía superficie-courier.';

comment on column plataforma.areas_habilitadas.area is
  'Área de producto. Misma lista que AREAS_PRODUCTO en
   src/modules/identidad/areas-producto.ts — cambiar una exige cambiar la otra.';

create index if not exists idx_areas_habilitadas_tenant
  on plataforma.areas_habilitadas (tenant_id);

-- -----------------------------------------------------------------------------
-- RLS: deny-all, como el resto de `plataforma`
-- -----------------------------------------------------------------------------
-- Sin políticas para `authenticated` y sin vista espejo en `public`. Un courier
-- autenticado NUNCA lee esta tabla directo: solo ve el efecto (la opción no
-- está). `force` para que la ausencia de políticas también aplique al owner en
-- consultas normales; `service_role` sigue pasando por encima de RLS.
alter table plataforma.areas_habilitadas enable row level security;
alter table plataforma.areas_habilitadas force row level security;

grant select, insert, update, delete on plataforma.areas_habilitadas to service_role;

-- Defensa en profundidad: aunque RLS ya niega, se revoca cualquier grant
-- heredado. `all tables in schema` alcanza también a esta tabla nueva.
revoke all on plataforma.areas_habilitadas from authenticated, anon;
revoke all on all tables in schema plataforma from authenticated, anon;

-- =============================================================================
-- Sembrado de una sola vez: los couriers que YA existen nacen ENCENDIDOS
-- =============================================================================
--
-- Decisión del usuario (2026-08-28). El primer courier real ya está operando y
-- apagarle cinco áreas el día del despliegue sería un cambio visible que él no
-- pidió y que nadie le avisó. Se le encienden todas, y Rutax las va apagando
-- desde el backstage cuando decida — que es lo contrario de un default, es una
-- acción con fecha y con autor.
--
-- ⚠️ Esto NO cambia el default. Alcanza solo a las filas que existen en el
-- instante de migrar: un courier dado de alta un minuto después no tiene filas y
-- por lo tanto nace apagado, que es el fail-closed que gobierna de aquí en
-- adelante. Son dos cosas distintas y conviene no confundirlas — el sembrado es
-- histórico, el default es permanente.
--
-- `habilitada_por` queda NULL a propósito: no lo encendió ningún super-admin,
-- lo trajo la migración. La nota lo dice para que el backstage no muestre un
-- hueco sin explicación.
--
-- Idempotente: `on conflict do nothing`. Re-aplicar la migración no pisa lo que
-- Rutax haya apagado a mano después.
-- =============================================================================
insert into plataforma.areas_habilitadas (tenant_id, area, habilitada_por, nota)
select t.id, a.area, null, 'Encendida por la migración: el courier ya operaba antes de que existiera el interruptor.'
  from identidad.tenants t
 cross join (values
   ('emision_facturas'),
   ('folios_caf'),
   ('pago_conductores'),
   ('conciliacion_cobranza'),
   ('suscripcion_rutax')
 ) as a(area)
on conflict (tenant_id, area) do nothing;
