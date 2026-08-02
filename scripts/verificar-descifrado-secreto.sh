#!/usr/bin/env bash
# =============================================================================
# Wrapper de verificación de round-trip de descifrado para un drill de
# restauración. Consulta el paquete cifrado vía psql (nunca lo imprime) y
# delega la verificación real a scripts/verificar-descifrado-secreto.mjs, que
# solo imprime "OK"/"FALLO". Ver runbook: docs/ops/restauracion.md §5.3
#
# Uso:
#   bash scripts/verificar-descifrado-secreto.sh <db_name> <referencia_externa_id>
#   # p.ej.: bash scripts/verificar-descifrado-secreto.sh restore_drill_20260707024803 <uuid>
#
# Requiere: el contenedor `supabase_db_<project_id>` corriendo (docker ps),
# y SECRETOS_CLAVE_CIFRADO_B64 (o su variante _<kid>) en el entorno actual —
# nunca se lee de un archivo dentro del respaldo.
# =============================================================================
set -euo pipefail

DBNAME="${1:?Uso: verificar-descifrado-secreto.sh <db_name> <referencia_externa_id>}"
REFERENCIA="${2:?Uso: verificar-descifrado-secreto.sh <db_name> <referencia_externa_id>}"
CONTENEDOR_DB="${SUPABASE_DB_CONTAINER:-supabase_db_SaaS_Courier_Again}"

FILA=$(docker exec "$CONTENEDOR_DB" psql -U postgres -d "$DBNAME" -tAc "
  select encode(valor_cifrado, 'hex') || '|' || coalesce(metadata->>'kid', 'v1')
  from identidad.secretos_cifrados
  where referencia_externa_id = '${REFERENCIA}';
")

if [[ -z "$FILA" ]]; then
  echo "FALLO (no se encontró referencia_externa_id=$REFERENCIA en $DBNAME)"
  exit 1
fi

HEX="${FILA%%|*}"
KID="${FILA##*|}"

node "$(dirname "$0")/verificar-descifrado-secreto.mjs" "$HEX" "$KID"
