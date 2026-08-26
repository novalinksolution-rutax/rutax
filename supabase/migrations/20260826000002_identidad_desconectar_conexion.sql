-- =============================================================================
-- Desconectar una cuenta de venta: quién lo hizo, y qué pasa con el tope
-- =============================================================================
--
-- Hasta hoy un seller podía CONECTAR su cuenta de Mercado Libre o su tienda
-- Shopify, reconectarla y sincronizarla — pero no había forma de desconectarla.
-- Ni en el portal del seller ni en el panel del courier. Reportado por el
-- usuario el 26-08-2026.
--
-- -----------------------------------------------------------------------------
-- QUÉ SIGNIFICA «DESCONECTAR» ACÁ, Y QUÉ NO
-- -----------------------------------------------------------------------------
-- Decisión del usuario (26-08-2026): desconectar significa **dejar de traer
-- pedidos a Rutax**, y nada más. NO se le revoca a Rutax el permiso sobre la
-- cuenta de Mercado Libre — eso solo se puede hacer desde la propia cuenta del
-- seller en ML, que además no documenta endpoint de revocación.
--
-- El apagado ya existía y no hace falta plomería nueva: la ingesta filtra
-- `estado_salud <> 'desvinculada'` (`ingesta-pedidos-ml.ts`, `polling-estados.ts`
-- y su equivalente de Shopify). Poner ese estado corta el flujo.
--
-- -----------------------------------------------------------------------------
-- 🔴 POR QUÉ HACE FALTA UNA COLUMNA Y NO BASTA `desvinculada`
-- -----------------------------------------------------------------------------
-- `estado_salud = 'desvinculada'` es donde terminan TRES causas distintas: el
-- token venció, ML lo revocó, o falló el descifrado. Si desconectar a propósito
-- cayera en el mismo saco, al seller que apagó su cuenta la pantalla le diría
-- «tu cuenta se desconectó, reconéctala» — o sea, le reportaría como avería lo
-- que acaba de hacer a propósito.
--
-- `desconectada_por_usuario_id` distingue las dos cosas **y trae el quién**, que
-- es lo que la regla de auditoría pide de toda acción con consecuencia.
--
-- Se prefiere una columna a un valor de enum nuevo a propósito: agregar
-- `desconectada` al enum obligaría a repasar cada filtro de ingesta, cada
-- traducción y cada mapa de distintivos — y bastaría con olvidar uno para que
-- una cuenta apagada siguiera ingiriendo. Acá el filtro no cambia.
--
-- -----------------------------------------------------------------------------
-- 🔴 Y POR QUÉ SE TOCA EL TOPE DE CUENTAS ML
-- -----------------------------------------------------------------------------
-- `conexiones_seller_ml_imponer_tope` contaba **filas**, sin mirar el estado:
--
--     select count(*) from identidad.conexiones_seller_ml where seller_id = …
--
-- Con el borrado blando que introduce esta migración, eso se vuelve una trampa:
-- un seller que conecte y desconecte diez cuentas **queda bloqueado para
-- siempre** para conectar una undécima, y el mensaje le diría que ya llegó al
-- máximo. El tope pasa a contar las CONECTADAS, que es lo que la pantalla
-- promete cuando dice «hasta 10 cuentas».
--
-- ⚠️ Reconectar la MISMA cuenta nunca pasó por acá y sigue sin pasar: el trigger
-- es `before insert` y la reconexión es un `update` de la fila que ya existe.
-- =============================================================================

-- ── 1 · Quién la desconectó ─────────────────────────────────────────────────

alter table identidad.conexiones_seller_ml
  add column if not exists desconectada_por_usuario_id uuid references auth.users (id);

alter table identidad.conexiones_seller_shopify
  add column if not exists desconectada_por_usuario_id uuid references auth.users (id);

comment on column identidad.conexiones_seller_ml.desconectada_por_usuario_id is
  'Quién apagó la ingesta de esta cuenta, a propósito. NULL = nadie la apagó; si además está desvinculada, es que se cayó sola. Distingue la avería de la decisión.';

comment on column identidad.conexiones_seller_shopify.desconectada_por_usuario_id is
  'Quién apagó la ingesta de esta tienda, a propósito. Ver el comentario gemelo en conexiones_seller_ml.';

-- ⚠️ **NO se agregan a las vistas de `public`.** Esto es un id de usuario y no
-- tiene por qué viajar al cliente: la pantalla necesita saber SI está
-- desconectada, no por quién. Lo segundo se deriva en el servidor, leyendo el
-- esquema `identidad` con `service_role`.
--
-- 🔴 **Y no se exponen solas, pero por una razón frágil que conviene saber.**
-- `public.conexiones_seller_ml` está definida como `select * from …`: Postgres
-- **expande y CONGELA** esa lista al crear la vista, así que una columna
-- agregada después no aparece. Es un accidente afortunado, no una barrera. El
-- día que alguien re-emita ese `create or replace view … select *` —por
-- cualquier motivo— el id de usuario entra a `public` en silencio y queda
-- legible para `authenticated`. La aserción de más abajo cubre ESTA migración;
-- si vas a tocar esas vistas, repítela ahí.

-- ── 2 · El tope cuenta las conectadas, no las filas ─────────────────────────

create or replace function identidad.conexiones_seller_ml_imponer_tope()
  returns trigger
  language plpgsql
as $function$
declare
  n_actual int;
  tope     int := identidad.conexiones_seller_ml_tope_por_seller();
begin
  -- Serializa inserciones concurrentes del mismo seller dentro de la tx.
  perform pg_advisory_xact_lock(hashtext(new.seller_id::text));

  -- 🔴 Solo las que NO apagó una persona. Contar también las apagadas deja al
  -- seller encerrado tras diez altas y bajas, con un error que le dice que ya
  -- tiene el máximo — teniendo cero conectadas.
  select count(*) into n_actual
  from identidad.conexiones_seller_ml
  where seller_id = new.seller_id
    and desconectada_por_usuario_id is null;

  if n_actual >= tope then
    raise exception
      'el seller % ya tiene el máximo de % conexiones ML permitidas',
      new.seller_id, tope
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

-- ── 3 · Aserciones ──────────────────────────────────────────────────────────
--
-- Fallan acá, al migrar, y no en la primera pantalla que intente escribirlas.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'identidad' and table_name = 'conexiones_seller_ml'
      and column_name = 'desconectada_por_usuario_id'
  ) then
    raise exception 'falta identidad.conexiones_seller_ml.desconectada_por_usuario_id';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'identidad' and table_name = 'conexiones_seller_shopify'
      and column_name = 'desconectada_por_usuario_id'
  ) then
    raise exception 'falta identidad.conexiones_seller_shopify.desconectada_por_usuario_id';
  end if;

  -- Contraprueba de la decisión de arriba: que NO se hayan colado a las vistas.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('conexiones_seller_ml', 'conexiones_seller_shopify')
      and column_name = 'desconectada_por_usuario_id'
  ) then
    raise exception
      'desconectada_por_usuario_id quedó expuesta en public.*: es un id de usuario y las vistas deben seguir enumerando sus columnas';
  end if;

  -- Y que el tope de verdad mira la columna nueva: si alguien repone la función
  -- vieja desde otra migración, esto lo delata al migrar.
  if position('desconectada_por_usuario_id is null' in
       pg_get_functiondef('identidad.conexiones_seller_ml_imponer_tope()'::regprocedure)) = 0 then
    raise exception
      'conexiones_seller_ml_imponer_tope volvió a contar TODAS las filas: un seller que conecte y desconecte 10 cuentas quedaría encerrado';
  end if;
end $$;
