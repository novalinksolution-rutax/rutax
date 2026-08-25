-- =============================================================================
-- ⏸️ EN PAUSA — ESTE ARCHIVO NO SE APLICA
-- =============================================================================
-- Vive fuera de `supabase/migrations/` a propósito: el CLI no lo ve, así que ni
-- `db push` ni `db reset` lo toman. Decisión del usuario (25-ago-2026): el
-- diagnóstico de abajo se hizo contra la base local y no se ha reproducido en
-- producción. Ver `supabase/migraciones-en-pausa/README.md`.
-- =============================================================================

-- =============================================================================
-- Los claims de uuid toleran el «null» que entrega Realtime
-- =============================================================================
--
-- 🔴 EL FALLO, Y POR QUÉ ERA INVISIBLE
-- -----------------------------------------------------------------------------
-- Realtime no entregaba un solo evento a nadie, mientras el indicador de las
-- pantallas decía «En vivo». En el log del contenedor:
--
--     PoolingReplicationError: invalid input syntax for type uuid: "null"
--       en realtime.apply_rls(jsonb, integer) → walrus_rls_stmt
--
-- La cadena `"null"` sale de los claims que Realtime guarda en
-- `realtime.subscription.claims`. **Nuestro hook los produce bien** —se comprobó
-- llamándolo: `jsonb_build_object('seller_id', perfil.seller_id)` con un NULL da
-- un `null` de JSON—, pero Realtime lo convierte en el **texto** `"null"` al
-- persistirlo. Después `->>` devuelve esa cadena y el casteo a uuid revienta.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ NO SE NOTABA EN NINGUNA OTRA PARTE
-- -----------------------------------------------------------------------------
-- La política de `operacion.pedidos` es, en corto:
--
--     tenant_id = claim_tenant_id()
--     AND ( tipo = 'interno'
--           OR (tipo = 'seller'   AND seller_id = claim_seller_id())
--           OR (tipo = 'conductor' AND driver_id = claim_driver_id()) )
--
-- En una consulta normal de un usuario interno, la primera rama del `OR` es
-- verdadera y **Postgres nunca evalúa** `claim_seller_id()`. Todo funciona.
--
-- `walrus` evalúa la expresión completa contra la fila, sin ese cortocircuito.
-- De ahí que fallara **solo** el tiempo real, que es justo donde nadie mira un
-- log.
--
-- ⚠️ **Y no fallaba una suscripción: fallaba el LOTE.** `apply_rls` procesa los
-- cambios de todos los suscriptores juntos, así que la excepción de uno los deja
-- a todos sin eventos — con el canal suscrito y el indicador en verde.
--
-- -----------------------------------------------------------------------------
-- QUÉ CAMBIA
-- -----------------------------------------------------------------------------
-- Las tres funciones de claim que devuelven uuid tratan `'null'` igual que la
-- cadena vacía: ausencia. Es la misma defensa que ya tenían para `''`, extendida
-- al valor que de verdad llega.
--
-- **No relaja ninguna barrera de seguridad**: antes el resultado esperado era
-- NULL y ahora también lo es. Lo único que cambia es que se obtiene sin lanzar.
-- Un `tenant_id` nulo sigue sin dar acceso a nada, porque `tenant_id = NULL` es
-- falso.
--
-- Se agrega `'undefined'` por el mismo motivo por el que se agrega `'null'`: si
-- una interpolación de JavaScript llega hasta acá, que no tumbe la replicación.
-- =============================================================================

create or replace function identidad.claim_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(nullif(nullif(auth.jwt() ->> 'tenant_id', ''), 'null'), 'undefined')::uuid
$$;

create or replace function identidad.claim_seller_id()
returns uuid
language sql
stable
as $$
  select nullif(nullif(nullif(auth.jwt() ->> 'seller_id', ''), 'null'), 'undefined')::uuid
$$;

create or replace function identidad.claim_driver_id()
returns uuid
language sql
stable
as $$
  select nullif(nullif(nullif(auth.jwt() ->> 'driver_id', ''), 'null'), 'undefined')::uuid
$$;

comment on function identidad.claim_tenant_id() is
  'Tenant del JWT. Trata '''', ''null'' y ''undefined'' como ausencia: Realtime '
  'persiste los claims nulos como el TEXTO ''null'', y el casteo directo tumbaba '
  'apply_rls y con él la replicación de todos los suscriptores. Ver la migración '
  '20260824000001.';

comment on function identidad.claim_seller_id() is
  'Seller del JWT. Misma defensa que claim_tenant_id: ver 20260824000001.';

comment on function identidad.claim_driver_id() is
  'Conductor del JWT. Misma defensa que claim_tenant_id: ver 20260824000001.';

-- ⚠️ `create or replace` NO restablece la ACL de una función que ya existía, así
-- que los GRANT previos siguen vigentes y no hay que reponerlos. Se deja dicho
-- porque lo contrario —creer que se resetean— ya costó una revisión en falso.
