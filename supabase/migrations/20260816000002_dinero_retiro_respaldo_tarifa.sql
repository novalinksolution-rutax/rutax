-- =============================================================================
-- El monto por visita gana un nivel de RESPALDO: la tarifa de entrega
--
-- Migración SOLO DE COMENTARIOS. No cambia una sola estructura — pero el
-- comentario que había quedó FALSO al agregar el respaldo, y este proyecto ya
-- pagó caro un comentario desactualizado: el de `dinero_base.sql` decía que el
-- motor usaba `ON CONFLICT (pedido_id) DO NOTHING`, y toda la planificación de
-- la etapa 8 arrastró ese error hasta que se leyó el código. Un comentario que
-- miente en la base es peor que no tenerlo, porque se le cree.
--
-- QUÉ CAMBIÓ (decisión del usuario, 2026-08-16)
-- La ausencia de `courier_config_retiro` ya NO significa "las visitas no se
-- pagan". El job C8 ahora cae, en este orden:
--
--   bodega (`seller_bodegas.monto_visita_clp`)
--     → tenant (`courier_config_retiro.monto_visita_bodega_clp`)
--       → lo que se le paga por una ENTREGA (`tarifas.monto_conductor_clp`)
--         → sin configurar ⇒ excepción bloqueante, nunca $0
--
-- ⚠️ EL RESPALDO EXIGE `monto_conductor_clp > 0`, y esa guarda es el punto
-- entero. Esa columna nació con `default 0` y ningún formulario la escribía
-- hasta el 2026-08-15, así que las tarifas que YA existen en producción siguen
-- en 0. Tratar ese cero como "tarifa" habría revivido el bug que la etapa 8
-- viene a impedir: liquidar $0 en silencio. Un 0 ahí no es una tarifa de cero,
-- es una tarifa sin configurar.
-- =============================================================================

comment on table identidad.courier_config_retiro is
  'Configuración del retiro en bodega del courier (1:1 con tenants). Solo roles
   internos la ven; sellers y conductores no acceden jamás. Si NO hay fila, el
   job C8 cae a identidad.tarifas.monto_conductor_clp (solo si es > 0) y, si eso
   tampoco sirve, levanta excepción bloqueante en vez de escribir una línea de
   $0.';

comment on column identidad.courier_config_retiro.monto_visita_bodega_clp is
  'CLP que el courier le paga al conductor por CADA visita cerrada a una bodega '
  'de seller. Es el valor por defecto del tenant; seller_bodegas.monto_visita_clp '
  'lo sobrescribe por bodega, y si no hay ninguno de los dos se usa lo que se le '
  'paga por una ENTREGA (tarifas.monto_conductor_clp, solo si > 0). > 0 '
  'obligatorio. OJO: no confundir con courier_config_payout.minimo_retiro_clp, '
  'que es retiro de FONDOS.';
