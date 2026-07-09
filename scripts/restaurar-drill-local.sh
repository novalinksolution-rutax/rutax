#!/usr/bin/env bash
# =============================================================================
# Drill de restauración — reconstruye un respaldo en una base de datos AISLADA
# dentro del mismo clúster Postgres local (nunca sobre el stack de desarrollo
# activo). Ver runbook completo: docs/ops/restauracion.md
# =============================================================================
#
# Qué hace:
#   1. Crea una base de datos temporal nueva (`restore_drill_<timestamp>`).
#   2. Le agrega el andamiaje MÍNIMO que un proyecto Supabase real (Cloud o
#      `supabase start` recién provisionado) YA trae de fábrica y que
#      `supabase db dump` deliberadamente NO incluye por ser "manejado por la
#      plataforma": schema `extensions`, schema `vault`, un `auth.users` +
#      `auth.uid()` mínimos (solo lo que las FK/políticas RLS de negocio
#      referencian) y la publicación `supabase_realtime`.
#      ⚠️ Esto es un ATAJO válido solo para este drill contra una base "pelada"
#      del mismo clúster. Contra un proyecto Supabase real (Cloud o local
#      recién iniciado) estos pasos NO son necesarios — el proyecto ya los
#      tiene.
#   3. Aplica schema.sql y data.sql del respaldo indicado.
#   4. Deja la base de datos lista para correr las verificaciones del runbook
#      (conteos por tabla, aislamiento por tenant, round-trip de secretos,
#      integridad de Storage) — este script NO las corre por ti, son
#      específicas de cada drill (ver docs/ops/bitacora-restauracion.md para
#      el detalle exacto usado en el primer drill).
#
# Uso:
#   bash scripts/restaurar-drill-local.sh <carpeta-del-respaldo>
#   # p.ej.: bash scripts/restaurar-drill-local.sh backups/20260707-024240
#
# Requiere: el contenedor `supabase_db_<project_id>` corriendo (docker ps).
# =============================================================================
set -euo pipefail

BACKUP_DIR="${1:?Uso: restaurar-drill-local.sh <carpeta-del-respaldo>}"
CONTENEDOR_DB="${SUPABASE_DB_CONTAINER:-supabase_db_SaaS_Courier_Again}"
TS=$(date -u +"%Y%m%d%H%M%S")
DBNAME="restore_drill_${TS}"

echo "== Restaurando '$BACKUP_DIR' en base aislada '$DBNAME' =="

docker exec "$CONTENEDOR_DB" psql -U postgres -d postgres -c "CREATE DATABASE ${DBNAME};"

docker exec "$CONTENEDOR_DB" psql -U postgres -d "$DBNAME" -c "
create schema if not exists extensions;
create schema if not exists vault;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as \$\$ select null::uuid \$\$;
create publication supabase_realtime;
"

echo "-- Aplicando schema.sql"
docker exec -i "$CONTENEDOR_DB" psql -U postgres -d "$DBNAME" -v ON_ERROR_STOP=1 < "$BACKUP_DIR/schema.sql"

echo "-- Aplicando data.sql"
docker exec -i "$CONTENEDOR_DB" psql -U postgres -d "$DBNAME" -v ON_ERROR_STOP=1 < "$BACKUP_DIR/data.sql"

echo "== Restauración completa. Base de datos de prueba: $DBNAME =="
echo "Verifica con las consultas de docs/ops/restauracion.md §Verificación,"
echo "y al terminar, límpiala con:"
echo "  docker exec $CONTENEDOR_DB psql -U postgres -d postgres -c \"DROP DATABASE $DBNAME;\""
