-- =============================================================================
-- Fijar la periodicidad de facturación del courier, en una transacción
-- =============================================================================
--
-- 🔴 QUÉ ESTABA ROTO
-- -----------------------------------------------------------------------------
-- `dinero.config_periodos` existe desde la migración base (20260601000006) y la
-- LEE el motor de dinero en dos sitios de `src/modules/dinero/periodos.ts`
-- (períodos de cobro al seller y liquidaciones al conductor). Pero **nadie la
-- escribía**: el único insert de todo el repositorio estaba en los seeds de
-- demo. En producción la lectura caía siempre al respaldo del código:
--
--     (configRows?.[0]?.tipo_periodo) ?? 'mensual'
--
-- O sea: **todo courier facturaba mensual, quisiera o no, y no tenía dónde
-- cambiarlo.** No fallaba nada ni se veía en ninguna parte — el período salía
-- del mes calendario y se cerraba solo. Un courier que factura quincenal
-- descubría el problema al emitir su primera factura, con las líneas ya
-- repartidas en el período equivocado.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ UNA FUNCIÓN Y NO DOS ESCRITURAS DESDE LA APP
-- -----------------------------------------------------------------------------
-- La tabla es un HISTORIAL, no una fila mutable: no tiene `actualizado_en`, y
-- lleva un índice único parcial `(tenant_id, seller_id) where activa = true`.
-- Cambiar la periodicidad son por tanto DOS escrituras —desactivar la vigente,
-- insertar la nueva— y el orden lo impone el índice: si la vieja sigue activa,
-- el insert choca.
--
-- El cliente de Supabase no abre transacciones. Sueltas, si el insert falla
-- después del update, el tenant se queda **sin ninguna fila activa** — y eso
-- no falla ruidosamente en ningún lado: la lectura vuelve a caer en 'mensual'
-- por el respaldo del código, en silencio, que es exactamente el bug que esta
-- migración viene a cerrar. Acá las dos van en un solo cuerpo.
--
-- -----------------------------------------------------------------------------
-- 🔴 EL CANDADO: NO SE PARTE UN PERÍODO QUE YA TIENE LÍNEAS
-- -----------------------------------------------------------------------------
-- `calcularRangoPeriodo` es una función pura de (fecha, tipo). Cambiar el tipo a
-- mitad de un período abierto NO reescribe las líneas que ya se guardaron: las
-- viejas siguen apuntando al período mensual y las nuevas crean un período
-- quincenal cuyo rango **se solapa** con aquél. El seller termina recibiendo dos
-- facturas por rangos que se pisan, y ninguna de las dos miente lo suficiente
-- como para que salte una alarma.
--
-- Por eso la función se niega mientras exista un período abierto CON LÍNEAS, y
-- lo dice con el número. Para un courier recién dado de alta —el caso real, que
-- es configurar esto al entrar— no hay ninguno y el cambio pasa siempre.
--
-- ⚠️ **El candado mira las líneas, no `periodos_cobro.total_lineas`.** Esa
-- columna se rellena AL CERRAR (ver `cerrarPeriodoManualmente`): durante todo el
-- período vale 0, así que confiarle el candado lo dejaría abierto justo cuando
-- tiene que cerrarse.
--
-- -----------------------------------------------------------------------------
-- ⚠️ `dia_cierre` SE ESCRIBE NULL A PROPÓSITO
-- -----------------------------------------------------------------------------
-- La columna existe desde 20260601000006 y **`calcularRangoPeriodo` no la lee**:
-- quincenal está clavado en 1-15 / 16-fin y semanal en lunes-domingo. Ofrecerla
-- en la pantalla sería un campo que la persona rellena y que no cambia nada —
-- el molde exacto del formulario que promete y cuya escritura no cumple. Se deja
-- NULL hasta que el motor la respete; ese día son las dos mitades a la vez.
--
-- -----------------------------------------------------------------------------
-- CONTRATO
-- -----------------------------------------------------------------------------
-- · `security invoker` (el default), no `definer`: la llama `service_role`, que
--   ya pasa por encima de RLS. Una `definer` acá sería privilegio que nadie
--   necesita. Mismo criterio que `identidad.guardar_zona_con_comunas`.
-- · **No escribe bitácora.** La escribe la aplicación, y DESPUÉS de que esto
--   devuelva `aplicado = true`: la función puede negarse legítimamente por el
--   candado, y anotar antes dejaría en la auditoría un cambio que no ocurrió.
-- · Devuelve jsonb en vez de lanzar cuando se niega: el candado es un resultado
--   esperable del negocio, no un fallo, y la Server Action necesita el número de
--   períodos para poder explicarlo. Las excepciones quedan para lo que de verdad
--   está mal (tipo inválido, tenant nulo).
--
-- IDEMPOTENTE: create or replace function.
-- =============================================================================

create or replace function dinero.fijar_periodicidad_facturacion(
  p_tenant_id    uuid,
  p_tipo_periodo text
)
returns jsonb
language plpgsql
set search_path = dinero, pg_temp
as $fn$
declare
  v_config_id   uuid;
  v_actual      text;
  v_bloqueantes integer;
  v_nueva_id    uuid;
begin
  if p_tenant_id is null then
    raise exception 'p_tenant_id es obligatorio' using errcode = '22004';
  end if;

  -- Misma lista que el CHECK `config_periodos_tipo_periodo_valido`. Se valida
  -- acá además del CHECK para fallar con un mensaje que se entienda.
  if p_tipo_periodo is null or p_tipo_periodo not in ('semanal', 'quincenal', 'mensual') then
    raise exception 'Periodicidad no válida: %', coalesce(p_tipo_periodo, '(nula)')
      using errcode = '23514';
  end if;

  -- La configuración vigente del TENANT. `seller_id is null` = el default del
  -- courier; las filas con seller son overrides y esta función no los toca.
  select c.id, c.tipo_periodo
    into v_config_id, v_actual
    from dinero.config_periodos c
   where c.tenant_id = p_tenant_id
     and c.seller_id is null
     and c.activa
   limit 1;

  -- Sin cambio: se sale ANTES del candado. Reafirmar lo que ya está no puede
  -- partir ningún período, así que negarlo sería negar algo inofensivo — y
  -- dejaría una fila de historial por cada vez que alguien pulsa Guardar.
  if v_config_id is not null and v_actual = p_tipo_periodo then
    return jsonb_build_object(
      'aplicado', false,
      'motivo', 'sin_cambio',
      'tipo_anterior', v_actual,
      'tipo_nuevo', p_tipo_periodo,
      'periodos_bloqueantes', 0
    );
  end if;

  select count(*)
    into v_bloqueantes
    from dinero.periodos_cobro p
   where p.tenant_id = p_tenant_id
     and p.estado = 'abierto'
     and exists (
       select 1
         from dinero.lineas_cobro l
        where l.tenant_id = p_tenant_id
          and l.periodo_cobro_id = p.id
     );

  if v_bloqueantes > 0 then
    return jsonb_build_object(
      'aplicado', false,
      'motivo', 'periodos_abiertos_con_lineas',
      -- `coalesce` porque sin fila vigente el tipo efectivo es el respaldo del
      -- motor, no "ninguno": la pantalla tiene que poder nombrarlo.
      'tipo_anterior', coalesce(v_actual, 'mensual'),
      'tipo_nuevo', p_tipo_periodo,
      'periodos_bloqueantes', v_bloqueantes
    );
  end if;

  -- Desactivar y reponer, en este orden: el índice único parcial
  -- `config_periodos_tenant_seller_activa_uk` rechaza la nueva mientras la
  -- vigente siga activa. Las dos comparten transacción — si el insert falla, el
  -- update se deshace y el tenant conserva la que tenía.
  if v_config_id is not null then
    update dinero.config_periodos
       set activa = false
     where id = v_config_id;
  end if;

  insert into dinero.config_periodos (tenant_id, seller_id, tipo_periodo, dia_cierre, activa)
  values (p_tenant_id, null, p_tipo_periodo, null, true)
  returning id into v_nueva_id;

  return jsonb_build_object(
    'aplicado', true,
    'motivo', 'aplicado',
    'config_id', v_nueva_id,
    'tipo_anterior', coalesce(v_actual, 'mensual'),
    'tipo_nuevo', p_tipo_periodo,
    'periodos_bloqueantes', 0
  );
end;
$fn$;

comment on function dinero.fijar_periodicidad_facturacion(uuid, text) is
  'Fija la periodicidad de facturación del courier (dinero.config_periodos, '
  'fila de tenant con seller_id null) desactivando la vigente e insertando la '
  'nueva en una sola transacción. Se niega mientras haya un período abierto con '
  'líneas: cambiar el tipo a mitad de período crea rangos solapados y dos '
  'facturas que se pisan. Devuelve jsonb {aplicado, motivo, tipo_anterior, '
  'tipo_nuevo, periodos_bloqueantes}. La bitácora la escribe la aplicación '
  'DESPUES de un aplicado = true.';

-- Solo `service_role`: la llaman las Server Actions, nunca el navegador.
revoke all on function dinero.fijar_periodicidad_facturacion(uuid, text) from public;
revoke all on function dinero.fijar_periodicidad_facturacion(uuid, text) from authenticated;
revoke all on function dinero.fijar_periodicidad_facturacion(uuid, text) from anon;
grant execute on function dinero.fijar_periodicidad_facturacion(uuid, text) to service_role;
