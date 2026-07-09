#!/usr/bin/env bash
# =============================================================================
# Respaldo lógico reproducible — stack local/staging de Supabase.
# Ver runbook completo: docs/ops/restauracion.md
# =============================================================================
#
# Qué hace:
#   1. Vuelca el ESQUEMA de los schemas de negocio (identidad, operacion,
#      dinero, integraciones, public) — vía `supabase db dump`.
#   2. Vuelca los DATOS de esos mismos schemas (deliberadamente excluye
#      `auth`/`storage`: el dump de datos SIN --schema explícito de la CLI de
#      Supabase SÍ incluye auth.users/sessions/refresh_tokens — material de
#      credenciales — ver §"Qué NO cubre este script" en el runbook).
#   3. Exporta los objetos reales del bucket `pod-evidencias` (fotos/firmas
#      del POD same-day) — la Storage API guarda los BYTES fuera de Postgres;
#      el dump de datos solo captura la fila de metadata (storage.objects).
#
# Uso:
#   bash scripts/respaldo-local.sh              # respalda el stack LOCAL
#   bash scripts/respaldo-local.sh --linked      # respalda el proyecto Cloud
#                                                 # ya vinculado (`supabase link`)
#
# Requiere: Supabase CLI (npx supabase), Docker Desktop corriendo (modo local).
# Variable de entorno opcional: RESPALDOS_DIR_LOCAL (ver .env.example).
# =============================================================================
set -euo pipefail

MODO="--local"
if [[ "${1:-}" == "--linked" ]]; then
  MODO="--linked"
fi

DESTINO="${RESPALDOS_DIR_LOCAL:-./backups}"
TS=$(date -u +"%Y%m%d-%H%M%S")
DIR="$DESTINO/$TS"
mkdir -p "$DIR"

echo "== Respaldo $MODO → $DIR =="

echo "-- [1/3] Esquema (schemas de negocio)"
npx supabase db dump "$MODO" -f "$DIR/schema.sql"

echo "-- [2/3] Datos (schemas de negocio — auth/storage excluidos a propósito)"
npx supabase db dump "$MODO" --data-only \
  --schema identidad,operacion,dinero,integraciones,public \
  -f "$DIR/data.sql"

echo "-- [3/3] Storage: bucket pod-evidencias"
mkdir -p "$DIR/storage"
npx supabase storage cp -r "ss:///pod-evidencias" "$DIR/storage" "$MODO" --experimental

# Si en el futuro se provisionan los buckets `liquidaciones` / `documentos-dte`
# (hoy referenciados por el código pero SIN migración que los cree — ver
# runbook §"Hallazgo: buckets no provisionados"), agrega aquí una línea más:
#   npx supabase storage cp -r "ss:///liquidaciones"   "$DIR/storage" "$MODO" --experimental
#   npx supabase storage cp -r "ss:///documentos-dte"  "$DIR/storage" "$MODO" --experimental

echo "== Respaldo completo: $DIR =="
echo "Recuerda: estos archivos NO se versionan (backups/ está en .gitignore)."
