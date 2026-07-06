-- =============================================================================
-- Migración 0016 · Defensa en profundidad: el guard `solo_interno_edita` debe
--                  cubrir DELETE en las tablas internas cuya política RLS
--                  YA admite DELETE (conductor_zonas, zona_comunas).
-- =============================================================================
-- Hallazgo (pgTAP `rls_aislamiento_conductor_zonas.test.sql`): el trigger guardián
-- `trg_conductor_zonas_solo_interno_edita` se creó `BEFORE UPDATE` solamente, pero
-- la política RLS de `conductor_zonas` SÍ incluye DELETE (patrón reasignar
-- borrando+insertando). Resultado: un seller/conductor que intentaba DELETE no
-- recibía 42501 — su DELETE caía en "DELETE 0" silencioso (inofensivo para los
-- datos, porque P1 no le hace visible ninguna fila, pero incoherente con el resto
-- de tablas internas y con la propia política de DELETE).
--
-- Por qué solo faltaba DELETE (no INSERT): en INSERT, una `WITH CHECK` que no se
-- cumple SÍ lanza error 42501 por sí sola; en UPDATE/DELETE, una `USING` que no
-- matchea solo reduce el conjunto de filas afectadas a cero, sin error. El guard
-- por-sentencia es justamente lo que convierte ese "0 filas" en un 42501 explícito
-- y auditable. El trigger ya cubría UPDATE; faltaba DELETE.
--
-- La función `identidad.solo_interno_edita()` (migración 0002) es POR SENTENCIA,
-- retorna null y NO referencia NEW ni OLD — solo evalúa `auth.role()` y
-- `claim_tipo_usuario()`. Por tanto maneja DELETE correctamente sin cambios; basta
-- extender la lista de eventos del trigger a INSERT OR UPDATE OR DELETE.
-- (Se incluye INSERT por coherencia y robustez: aunque la WITH CHECK ya bloquea el
--  INSERT del no-interno, tener el guard cubriendo las tres operaciones de
--  escritura deja el patrón uniforme y a prueba de futuros cambios de política.)
--
-- Tablas tocadas (política RLS con DELETE + guard solo BEFORE UPDATE = mismo hueco):
--   · identidad.conductor_zonas  (migración 0015) — política DELETE presente. CORREGIDA.
--   · identidad.zona_comunas     (migración 0014) — política DELETE presente. CORREGIDA.
--
-- NO se toca `identidad.ventanas_corte`: su RLS NO incluye política de DELETE (solo
-- select/insert/update), así que no existe el hueco — su guard BEFORE UPDATE es la
-- cobertura correcta y completa. Dejarla intacta es lo coherente.
--
-- Idempotente: `drop trigger if exists` + `create trigger` (patrón del repo).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- conductor_zonas — recrear el guard cubriendo INSERT/UPDATE/DELETE.
-- -----------------------------------------------------------------------------
drop trigger if exists trg_conductor_zonas_solo_interno_edita on identidad.conductor_zonas;
create trigger trg_conductor_zonas_solo_interno_edita
  before insert or update or delete on identidad.conductor_zonas
  for each statement execute function identidad.solo_interno_edita();

-- -----------------------------------------------------------------------------
-- zona_comunas — mismo hueco (política DELETE presente, guard solo BEFORE UPDATE).
-- -----------------------------------------------------------------------------
drop trigger if exists trg_zona_comunas_solo_interno_edita on identidad.zona_comunas;
create trigger trg_zona_comunas_solo_interno_edita
  before insert or update or delete on identidad.zona_comunas
  for each statement execute function identidad.solo_interno_edita();
