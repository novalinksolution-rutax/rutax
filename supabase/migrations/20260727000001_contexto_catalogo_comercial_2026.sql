-- =============================================================================
-- Catálogo comercial chileno 2026 — semilla de contexto.eventos_comerciales
-- =============================================================================
--
-- QUÉ ES
-- Las fechas comerciales que generan olas de entregas, con el multiplicador de
-- volumen que cada una empuja y la CURVA DE REZAGO que reparte esa ola entre los
-- días vecinos al evento. Es el insumo del horizonte «Olas» de la Torre.
--
-- POR QUÉ VA EN UNA MIGRACIÓN Y NO EN UN JOB
-- Las fechas Cyber las fija la Cámara de Comercio cada año y se anuncian con
-- pocas semanas de anticipación: son tres fechas al año. Montar un scraper para
-- eso sería una pieza de infraestructura que se cae sola y que nadie mira hasta
-- que falla. El diseño (§12.2) lo dice explícitamente: se mantiene a mano en el
-- repo y se revisa cada temporada. `contexto.eventos_comerciales` es tabla
-- GLOBAL del carve-out — sin tenant_id, deny-all, solo service_role escribe —
-- así que una semilla versionada es exactamente su forma de mantenimiento.
--
-- LO QUE HACE LA CURVA, Y POR QUÉ SON DOS ARQUETIPOS OPUESTOS
-- Un courier no entrega el día del CyberDay: entrega la ola que ese CyberDay
-- generó. Las claves de `curva_rezago` son el desplazamiento en días respecto
-- del evento y los valores la proporción del volumen extra que cae ese día:
--
--   · arquetipo 'venta'  → claves POSITIVAS (D+1…D+5). La compra ocurre en una
--     ventana corta y las entregas llegan DESPUÉS, con peak en D+2.
--   · arquetipo 'regalo' → claves NEGATIVAS (D−6…D−1). El regalo tiene que
--     llegar ANTES y el plazo es duro: el día de la fecha el volumen colapsa.
--
-- Los valores salen del contrato congelado del handoff
-- (`docs/torre-de-control/datos-dummy.ts`, CALENDARIO_COMERCIAL_2026), que es la
-- única fuente con multiplicadores y curvas verificadas. La tabla de §12.2 lista
-- además Día de la Madre, del Padre, del Amor y las rebajas estacionales: NO se
-- siembran todavía porque no tienen multiplicador ni curva verificados, y
-- inventarles uno produciría una proyección con aire de dato. Se agregan cuando
-- se midan — o antes, con el histórico del propio courier (§12.5, F3).
--
-- IDEMPOTENCIA: `on conflict (id) do update`. Correrla dos veces deja el mismo
-- estado, y re-ejecutarla es la forma prevista de CORREGIR una fecha cuando la
-- CCS anuncia la suya.
-- =============================================================================

insert into contexto.eventos_comerciales
  (id, nombre, arquetipo, organizador, inicio, fin, multiplicador_base, curva_rezago)
values
  -- ---- Eventos de VENTA: la ola llega después ------------------------------
  ('cyberday-2026', 'CyberDay', 'venta', 'Cámara de Comercio de Santiago',
   '2026-06-01', '2026-06-03', 2.40,
   '{"1":0.20,"2":0.30,"3":0.25,"4":0.15,"5":0.10}'::jsonb),

  ('cybermonday-2026', 'CyberMonday', 'venta', 'Cámara de Comercio de Santiago',
   '2026-10-05', '2026-10-07', 2.20,
   '{"1":0.20,"2":0.30,"3":0.25,"4":0.15,"5":0.10}'::jsonb),

  ('black-friday-2026', 'Black Friday', 'venta', 'Wide Latam',
   '2026-11-27', '2026-11-30', 2.00,
   '{"1":0.22,"2":0.28,"3":0.24,"4":0.16,"5":0.10}'::jsonb),

  -- Las fechas dobles de Mercado Libre son doce eventos chicos al año. Su valor
  -- no es el volumen que mueven sino que CALIBRAN el modelo doce veces al año en
  -- vez de tres (§12.5). Se siembra la del 8.8 por ser la próxima verificada.
  ('fecha-doble-08-08', 'Fecha doble 8.8 (Mercado Libre)', 'venta', 'Mercado Libre',
   '2026-08-08', '2026-08-08', 1.30,
   '{"1":0.40,"2":0.35,"3":0.25}'::jsonb),

  -- ---- Fechas REGALO: la ola llega antes y el plazo es duro ----------------
  ('dia-del-nino-2026', 'Día del Niño', 'regalo', null,
   '2026-08-09', '2026-08-09', 1.38,
   '{"-6":0.05,"-5":0.12,"-4":0.20,"-3":0.30,"-2":0.25,"-1":0.08}'::jsonb),

  ('fiestas-patrias-2026', 'Fiestas Patrias', 'regalo', null,
   '2026-09-18', '2026-09-19', 1.60,
   '{"-6":0.08,"-5":0.14,"-4":0.20,"-3":0.26,"-2":0.22,"-1":0.10}'::jsonb),

  ('halloween-2026', 'Halloween', 'regalo', null,
   '2026-10-31', '2026-10-31', 1.20,
   '{"-5":0.10,"-4":0.18,"-3":0.28,"-2":0.28,"-1":0.16}'::jsonb),

  -- Navidad es la ola más larga del año: su curva arranca en D−10, no en D−6.
  ('navidad-2026', 'Navidad', 'regalo', null,
   '2026-12-25', '2026-12-25', 2.60,
   '{"-10":0.06,"-8":0.10,"-6":0.16,"-4":0.22,"-3":0.24,"-2":0.16,"-1":0.06}'::jsonb)

on conflict (id) do update set
  nombre             = excluded.nombre,
  arquetipo          = excluded.arquetipo,
  organizador        = excluded.organizador,
  inicio             = excluded.inicio,
  fin                = excluded.fin,
  multiplicador_base = excluded.multiplicador_base,
  curva_rezago       = excluded.curva_rezago,
  actualizado_en     = now();
