-- =============================================================================
-- Migración · Torre de control v2 — retiro de fuentes, PASO 1 de 2 (SIN DROP)
-- =============================================================================
-- El rediseño v2 de la Torre (docs/torre-de-control/alcance-v2.md) retira el
-- puntaje de riesgo 0–100 y, con él, las fuentes que lo alimentaban: clima, aire,
-- eventos de ciudad y señales de prensa. Siete tablas del schema `contexto` se
-- quedan sin escritor y sin lector.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ ESTA MIGRACIÓN NO BORRA NADA
-- -----------------------------------------------------------------------------
-- Retirar siete tablas no tiene vuelta atrás sin restaurar un respaldo. El corte
-- va en DOS pasos a propósito:
--
--   · **Paso 1 (esta migración):** el código deja de leerlas y de escribirlas, y
--     acá se marca cada tabla como retirada. Todo sigue en disco. Si la v2
--     resulta estar mal, se revierte el commit de código y las tablas siguen
--     ahí con su contenido.
--   · **Paso 2 (migración posterior):** el `drop table`, recién cuando la v2 esté
--     verificada en vivo.
--
-- El commit extra es barato; el respaldo restaurado, no.
--
-- -----------------------------------------------------------------------------
-- QUÉ SÍ CAMBIA ACÁ
-- -----------------------------------------------------------------------------
-- `contexto.fuentes_estado` se re-siembra. Tenía cinco filas —clima, aire,
-- transito, eventos, senales— y las cinco corresponden a fuentes retiradas o
-- nunca construidas. Dos de ellas (`senales` y `transito`) estaban declaradas
-- caídas de forma PERMANENTE, y ese era el motivo real de que la Torre abriera
-- siempre en estado `degradado`: por dos fuentes que se decidió no construir.
--
-- Queda una sola fila, `calendario`, que es la única fuente externa que le queda
-- al módulo y la que alimenta las olas comerciales.
--
-- Idempotente: delete + insert con `on conflict do nothing`, y `comment on` es
-- siempre re-aplicable.
--
-- NO toca: RLS, políticas, grants ni el carve-out deny-all. Las siete tablas
-- siguen siendo inalcanzables para `authenticated` exactamente igual que antes,
-- así que las pruebas pgTAP de aislamiento siguen valiendo tal cual — se recortan
-- en el paso 2, cuando las tablas dejen de existir.
-- =============================================================================

-- =============================================================================
-- 1. Re-siembra de `contexto.fuentes_estado`
-- =============================================================================
-- El `id` tiene un CHECK que enumera las fuentes válidas, y las cinco que
-- enumeraba son justamente las que se retiran. Hay que reemplazarlo ANTES de
-- insertar la fila del calendario, o el insert rebota con 23514.
--
-- Se conserva la forma de lista blanca en vez de abrirlo a texto libre: es la que
-- impide que un job escriba una fuente con el nombre mal puesto y la pantalla
-- muestre una fila fantasma que nadie actualiza nunca.
alter table contexto.fuentes_estado
  drop constraint if exists fuentes_estado_id_check;

delete from contexto.fuentes_estado
where id in ('clima', 'aire', 'transito', 'eventos', 'senales');

alter table contexto.fuentes_estado
  add constraint fuentes_estado_id_check check (id in ('calendario'));

insert into contexto.fuentes_estado (id, nombre, actualizado_en, cadencia_minutos, estado, motivo)
values (
  'calendario',
  'Calendario y feriados',
  null,
  -- Una vez al mes: son feriados publicados por ley, no un feed en vivo.
  43200,
  'caida',
  'Todavía no se ejecuta la primera sincronización.'
)
on conflict (id) do nothing;

-- =============================================================================
-- 2. Marcado de las siete tablas retiradas
-- =============================================================================
-- El comentario es la señal para quien lea el schema antes que el código: estas
-- tablas están vivas en disco pero muertas en el producto. Sin esto, el próximo
-- que abra el esquema asume que `riesgo_zona` se sigue llenando.

comment on table contexto.clima_horario is
  'RETIRADA (2026-08-03) — pendiente de DROP en el paso 2. Sin escritor ni lector:
   el clima salió del producto con el rediseño v2 de la Torre. El job
   contexto/clima.refrescar y el adaptador de OpenWeather ya no existen.
   Ver docs/torre-de-control/alcance-v2.md §3 y §5.1.';

comment on table contexto.aire_horario is
  'RETIRADA (2026-08-03) — pendiente de DROP en el paso 2. Sin escritor ni lector:
   la calidad del aire salió del producto con el rediseño v2 de la Torre, igual
   que el clima. Ver docs/torre-de-control/alcance-v2.md §3 y §5.1.';

comment on table contexto.eventos_ciudad is
  'RETIRADA (2026-08-03) — pendiente de DROP en el paso 2. Nunca tuvo escritor y
   quedó en 0 filas: su fuente dependía del pipeline de prensa, que no se pudo
   construir. Ver docs/torre-de-control/alcance-v2.md §3.';

comment on table contexto.senales is
  'RETIRADA (2026-08-03) — pendiente de DROP en el paso 2. Pipeline de prensa
   muerto: Google News RSS prohíbe el uso comercial, GDELT no cubre Chile y
   SENAPRED solo publica desastres naturales. 0 filas y ningún escritor.';

comment on table contexto.senales_tenant is
  'RETIRADA (2026-08-03) — pendiente de DROP en el paso 2. Era la mitad por tenant
   del desdoblamiento de senales (el hecho público en una tabla, las cifras del
   courier en otra, para no filtrarlas entre tenants). Cae con senales.';

comment on table contexto.marcas_operativas is
  'RETIRADA (2026-08-03) — pendiente de DROP en el paso 2. 0 filas pese a estar
   construida entera, y además es una ESCRITURA: incompatible con una Torre que
   en la v2 es de solo lectura. Ver docs/torre-de-control/alcance-v2.md §3.';

comment on table contexto.riesgo_zona is
  'RETIRADA (2026-08-03) — pendiente de DROP en el paso 2. Persistía el puntaje
   de riesgo 0–100 por zona y franja que calculaba el cron cada 15 minutos. La v2
   retiró el puntaje entero y lee la carga en vivo desde operacion: no queda nada
   que persistir. Ver docs/torre-de-control/alcance-v2.md §3 y §5.2.';

-- =============================================================================
-- 3. Las cuatro que se conservan, con su rol actualizado
-- =============================================================================

comment on table contexto.calendario is
  'VIGENTE. Feriados y fechas cívicas de Chile. La escribe el cron
   contexto/calendario.sincronizar. Alimenta las olas entrantes (F9) de la Torre.';

comment on table contexto.eventos_comerciales is
  'VIGENTE. Catálogo comercial chileno (CyberDay, Black Friday, Navidad…) con su
   arquetipo y su curva de rezago. La mantiene una migración, no un job: son tres
   fechas al año que se anuncian con pocas semanas de anticipación, y un scraper
   para eso se cae solo. Alimenta las olas entrantes (F9).';

comment on table contexto.fuentes_estado is
  'VIGENTE, REDUCIDA a una fila (calendario). Salud del único puerto externo que
   le queda al módulo. Ojo: la FRESCURA que muestra la Torre v2 (F6) NO sale de
   acá — sale del último cierre que un conductor subió por la app de Rutax
   (operacion.cierres_conductor / operacion.pruebas_entrega), que es dato por
   tenant y esta tabla es global.';

comment on table contexto.restriccion_vehicular is
  'VIGENTE pero SIN CONSUMIDOR en la v2. La sigue escribiendo el job de
   calendario (cálculo determinístico GEC, no una API). Se conserva porque es
   barata y es un hecho de flota que puede volver a hacer falta; la Torre v2
   dejó de mostrarla. Su destino definitivo se decide junto con el DROP del
   paso 2.';
