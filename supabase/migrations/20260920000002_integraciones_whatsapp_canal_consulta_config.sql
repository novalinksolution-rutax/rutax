-- =============================================================================
-- WhatsApp — configuración del CANAL DE CONSULTA, administrada por RUTAX
-- =============================================================================
-- Alcance: `docs/arquitectura/conversacion-whatsapp.md` (§3, §6.1, §9).
-- Hermana de `20260920000001_integraciones_whatsapp_mensajes_entrantes.sql`.
--
-- -----------------------------------------------------------------------------
-- LO MÁS IMPORTANTE DE ESTA MIGRACIÓN: EL CANAL NACE APAGADO
-- -----------------------------------------------------------------------------
-- La feature de consulta por WhatsApp YA ESTÁ DESPLEGADA y el copy de las
-- respuestas todavía NO pasó por `copywriter`. Así que el interruptor tiene que
-- ser un interruptor de verdad, y eso son DOS cosas, no una:
--
--   (a) `canal_activo boolean not null default false` — el courier que SÍ tiene
--       fila nace apagado.
--   (b) LA AUSENCIA DE FILA ES "APAGADO". Es el mismo patrón de
--       `plataforma.areas_habilitadas`: el courier nuevo nace sin nada abierto
--       sin depender de que alguien se acuerde de configurarlo.
--
-- ⚠️ (b) NO SE SOSTIENE SOLA: un `select canal_activo ... where tenant_id = ?`
-- devuelve CERO FILAS, no `false`, y en TypeScript cero filas con
-- `.maybeSingle()` es `data === null` — que un `if (config?.canal_activo)`
-- resuelve bien y un `if (config.canal_activo !== false)` resuelve MAL. Por eso
-- la lectura NO se hace con un select crudo: se hace con
-- `public.whatsapp_canal_consulta_config(p_tenant_id)`, definida más abajo, que
-- SIEMPRE devuelve exactamente una fila y falla cerrado cuando no hay
-- configuración. El pgTAP lo prueba sobre un tenant sin fila.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ NO HAY FILA GLOBAL CON `tenant_id` NULO
-- -----------------------------------------------------------------------------
-- Decisión del usuario (2026-09-20). En la tabla de ENTRANTES el nulo se ganó su
-- lugar con un argumento concreto: el mensaje entra ANTES de saber de qué tenant
-- es. Acá no existe ese momento — la configuración siempre se edita sabiendo a
-- qué courier apunta. Un nulo "global" traería un orden de precedencia
-- (¿gana la fila del tenant o la global? ¿y si la global está apagada?) que es
-- justo el tipo de lógica implícita que después nadie recuerda. `tenant_id` es
-- NOT NULL y es la PK: una fila por courier, sin herencia.
--
-- -----------------------------------------------------------------------------
-- LOS TOPES VIVEN ACÁ Y DEJAN DE VIVIR EN CÓDIGO
-- -----------------------------------------------------------------------------
-- Hoy son constantes en `src/modules/conversacion/abuso.ts`
-- (`TOPE_CONSULTAS_POR_HORA = 20`, `UMBRAL_INTENTOS_SIN_MATCH = 5`). Esta tabla
-- las REEMPLAZA, no las duplica: dos fuentes para el mismo número es la trampa
-- que ya mordió con el tope de cuentas ML (SQL y TypeScript, sin prueba que las
-- atara). El backend debe borrar las constantes y leer de acá.
--
-- Los DEFAULT de las columnas son exactamente esos dos valores, para que el
-- comportamiento del courier configurado no cambie el día del corte.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La tabla
-- -----------------------------------------------------------------------------
create table if not exists integraciones.whatsapp_canal_consulta_config (
  -- PK y FK a la vez: una fila por courier, sin fila global. Se va con el
  -- tenant; una configuración huérfana no significa nada.
  tenant_id uuid primary key
            references identidad.tenants (id) on delete cascade,

  -- ⚠️ El interruptor. Ver el encabezado: `false` a propósito.
  canal_activo boolean not null default false,

  -- §9. No es por costo (el entrante es gratis y abre la ventana de servicio):
  -- es para que un teléfono comprometido no sirva para barrer códigos.
  -- El rango tiene tope por arriba porque un número "generoso" puesto de apuro
  -- desde el backstage apaga la protección sin apagar nada visible.
  tope_consultas_hora integer not null default 20
    constraint whatsapp_canal_tope_consultas_rango
      check (tope_consultas_hora between 1 and 200),

  -- §6.1. El corte por BARRIDO: N intentos `flex_manual` sin match en una hora.
  -- Se cuenta aparte del tope general a propósito — un match fallido y uno
  -- exitoso no pesan igual.
  tope_intentos_sin_match_hora integer not null default 5
    constraint whatsapp_canal_tope_sin_match_rango
      check (tope_intentos_sin_match_hora between 1 and 100),

  -- Un sondeo sin match ES una consulta: se cuenta en los dos contadores. Si el
  -- corte por barrido fuera más alto que el tope general, el tope general
  -- cortaría primero SIEMPRE y el corte por barrido no se ejecutaría jamás —
  -- una protección muerta que el backstage muestra como viva.
  constraint whatsapp_canal_sin_match_no_supera_el_tope
    check (tope_intentos_sin_match_hora <= tope_consultas_hora),

  -- ---------------------------------------------------------------------------
  -- AUDITORÍA MÍNIMA — quién y cuándo
  -- ---------------------------------------------------------------------------
  -- Lo edita un `super_admin` de Rutax desde /admin/whatsapp, NO un usuario del
  -- courier. SIN FK a propósito, igual que `plataforma.areas_habilitadas`: el
  -- admin puede darse de baja y el registro tiene que quedar igual.
  -- Esto es el "quién" de conveniencia para la pantalla; NO reemplaza
  -- `bitacora_auditoria`, que sigue siendo el registro con historia (acá solo
  -- sobrevive el ÚLTIMO cambio).
  actualizado_por uuid,
  actualizado_en  timestamptz not null default now(),

  -- Por qué se encendió o se apagó, en palabras. Se muestra en el backstage.
  nota text check (nota is null or length(nota) <= 500),

  creado_en timestamptz not null default now()
);

-- Re-ejecutable sobre una tabla que ya existe: los CHECK del `create table` no
-- se aplican si la tabla ya estaba. Se reponen ENTEROS (nunca copiados de otra
-- migración: se copian de acá arriba, que es la vigente).
alter table integraciones.whatsapp_canal_consulta_config
  drop constraint if exists whatsapp_canal_tope_consultas_rango;
alter table integraciones.whatsapp_canal_consulta_config
  add constraint whatsapp_canal_tope_consultas_rango
  check (tope_consultas_hora between 1 and 200);

alter table integraciones.whatsapp_canal_consulta_config
  drop constraint if exists whatsapp_canal_tope_sin_match_rango;
alter table integraciones.whatsapp_canal_consulta_config
  add constraint whatsapp_canal_tope_sin_match_rango
  check (tope_intentos_sin_match_hora between 1 and 100);

alter table integraciones.whatsapp_canal_consulta_config
  drop constraint if exists whatsapp_canal_sin_match_no_supera_el_tope;
alter table integraciones.whatsapp_canal_consulta_config
  add constraint whatsapp_canal_sin_match_no_supera_el_tope
  check (tope_intentos_sin_match_hora <= tope_consultas_hora);

-- Idempotente también para el default, que es el corazón de la migración: si la
-- tabla ya existía con otro default, esto lo devuelve a `false`.
alter table integraciones.whatsapp_canal_consulta_config
  alter column canal_activo set default false;

-- El contador «N couriers con el canal encendido» de /admin/whatsapp.
create index if not exists idx_whatsapp_canal_consulta_activos
  on integraciones.whatsapp_canal_consulta_config (tenant_id)
  where canal_activo;

-- -----------------------------------------------------------------------------
-- 2. Comentarios
-- -----------------------------------------------------------------------------
comment on table integraciones.whatsapp_canal_consulta_config is
  'Configuracion del canal de CONSULTA por WhatsApp, una fila por courier. La
   administra RUTAX desde /admin/whatsapp (super_admin), NO el courier: la tabla
   es deny-all y no tiene vista espejo en public. La AUSENCIA de fila equivale a
   canal apagado — no se consulta con un select crudo sino con
   public.whatsapp_canal_consulta_config(uuid), que falla cerrado.';

comment on column integraciones.whatsapp_canal_consulta_config.canal_activo is
  'Interruptor del canal. Default FALSE a proposito: la feature ya esta
   desplegada y el copy de las respuestas todavia no paso por copywriter. Un
   courier sin fila se comporta igual que uno con la fila en false.';

comment on column integraciones.whatsapp_canal_consulta_config.tope_consultas_hora is
  'Tope de consultas por contacto y por hora (§9). REEMPLAZA la constante
   TOPE_CONSULTAS_POR_HORA de src/modules/conversacion/abuso.ts — no la duplica.';

comment on column integraciones.whatsapp_canal_consulta_config.tope_intentos_sin_match_hora is
  'Corte por BARRIDO (§6.1): intentos flex_manual SIN match en una hora.
   REEMPLAZA la constante UMBRAL_INTENTOS_SIN_MATCH de abuso.ts. No puede
   superar al tope general, o nunca llegaria a dispararse.';

comment on column integraciones.whatsapp_canal_consulta_config.actualizado_por is
  'super_admin de Rutax que hizo el ultimo cambio. Sin FK a proposito (el admin
   puede darse de baja). Conveniencia para la pantalla: la historia vive en
   bitacora_auditoria.';

-- -----------------------------------------------------------------------------
-- 3. La lectura que FALLA CERRADO
-- -----------------------------------------------------------------------------
-- Devuelve SIEMPRE una fila. Sin configuración: canal apagado y los topes por
-- defecto, para que el llamador no tenga que inventarse un fallback (que es
-- donde se cuela el `true`).
--
-- `security definer` porque la tabla es deny-all; el EXECUTE queda solo en
-- `service_role`, así que no abre nada que el grant no abriera ya.
create or replace function public.whatsapp_canal_consulta_config(
  p_tenant_id uuid
) returns table (
  canal_activo                 boolean,
  tope_consultas_hora          integer,
  tope_intentos_sin_match_hora integer,
  configurado                  boolean
)
language sql
stable
security definer
set search_path = public, integraciones, pg_temp
as $$
  select
    coalesce(c.canal_activo, false),
    coalesce(c.tope_consultas_hora, 20),
    coalesce(c.tope_intentos_sin_match_hora, 5),
    (c.tenant_id is not null)
  from (select p_tenant_id as tenant_id) base
  left join integraciones.whatsapp_canal_consulta_config c
    on c.tenant_id = base.tenant_id;
$$;

comment on function public.whatsapp_canal_consulta_config(uuid) is
  'Lectura fail-closed de la configuracion del canal de consulta. SIEMPRE
   devuelve una fila: sin configuracion, canal_activo=false y configurado=false.
   Existe para que "cero filas" nunca se interprete como "encendido".';

-- `create or replace function` NO resetea la ACL: si la función ya existía con
-- un grant viejo, este revoke es lo único que lo quita. Gotcha conocido del repo.
revoke all on function public.whatsapp_canal_consulta_config(uuid)
  from public, anon, authenticated;
grant execute on function public.whatsapp_canal_consulta_config(uuid)
  to service_role;

-- =============================================================================
-- 4. RLS y GRANT — DENY-ALL
-- =============================================================================
-- Mismo criterio que la tabla de entrantes y que el resto de WhatsApp, que
-- administra Rutax: RLS forzada SIN políticas, sin vista espejo en `public`
-- (PostgREST entra por ahí salvo que el cliente pida el esquema explícito) y
-- GRANT por columna solo a `service_role`.
--
-- Se prueba con 42501 explícito y no con "0 filas": si el revoke se perdiera y
-- solo quedara RLS sin políticas, un select devolvería 0 filas y una prueba por
-- conteo pasaría en verde sin proteger nada.
alter table integraciones.whatsapp_canal_consulta_config enable row level security;
alter table integraciones.whatsapp_canal_consulta_config force row level security;

drop view if exists public.whatsapp_canal_consulta_config;
revoke all on integraciones.whatsapp_canal_consulta_config
  from public, anon, authenticated;

-- GRANT POR COLUMNA aunque hoy el único destinatario sea `service_role`: un
-- grant de tabla completa filtra cualquier columna que se agregue mañana, y ese
-- patrón ya mordió dos veces en este repo (el snapshot de reglas de dinero y el
-- token de invitación), las dos porque la columna sensible nació DESPUÉS del
-- grant. La lista enumerada es lo que alguien va a copiar el día que exista una
-- pantalla, y por eso tiene que ser explícita.
grant select (tenant_id, canal_activo, tope_consultas_hora,
              tope_intentos_sin_match_hora, actualizado_por, actualizado_en,
              nota, creado_en)
  on integraciones.whatsapp_canal_consulta_config to service_role;

grant insert (tenant_id, canal_activo, tope_consultas_hora,
              tope_intentos_sin_match_hora, actualizado_por, actualizado_en,
              nota)
  on integraciones.whatsapp_canal_consulta_config to service_role;

-- `tenant_id` y `creado_en` quedan FUERA del UPDATE: mover la configuración de
-- un courier a otro con un update sería cambiar de tenant a la fila equivocada
-- sin que nada se queje. Se borra y se crea.
grant update (canal_activo, tope_consultas_hora, tope_intentos_sin_match_hora,
              actualizado_por, actualizado_en, nota)
  on integraciones.whatsapp_canal_consulta_config to service_role;

grant delete on integraciones.whatsapp_canal_consulta_config to service_role;
