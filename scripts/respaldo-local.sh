#!/usr/bin/env bash
# =============================================================================
# Respaldo lógico reproducible — stack local/staging de Supabase.
# Ver runbook completo: docs/ops/restauracion.md
# =============================================================================
#
# Qué hace:
#   1. Vuelca el ESQUEMA de los schemas de negocio (identidad, operacion,
#      dinero, integraciones, plataforma, contexto, public) — vía
#      `supabase db dump`.
#   2. Vuelca los DATOS de esos mismos schemas (deliberadamente excluye
#      `auth`/`storage`: el dump de datos SIN --schema explícito de la CLI de
#      Supabase SÍ incluye auth.users/sessions/refresh_tokens — material de
#      credenciales — ver §"Qué NO cubre este script" en el runbook).
#   3. Exporta los objetos reales de los buckets privados `pod-evidencias`
#      (fotos/firmas del POD same-day), `liquidaciones` (PDF del conductor) y
#      `documentos-dte` (PDF de facturas) — la Storage API guarda los BYTES
#      fuera de Postgres; el dump de datos solo captura la fila de metadata
#      (storage.objects), y los respaldos diarios de Cloud tampoco los cubren.
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
# `plataforma` y `contexto` se suman aquí: el script se escribió en la fase C,
# cuando esos dos schemas todavía no existían, y quedaron fuera por omisión, no
# por decisión. `plataforma` guarda la trastienda de Rutax (suscripciones,
# planes, pagos, super_admins, comunicaciones) y `contexto.marcas_operativas`
# son marcas que escribe el courier a mano — nada de eso se recalcula solo.
npx supabase db dump "$MODO" --data-only \
  --schema identidad,operacion,dinero,integraciones,plataforma,contexto,public \
  -f "$DIR/data.sql"

echo "-- [3/3] Storage: buckets con objetos propios"
# Los tres van: los respaldos diarios de Supabase Cloud NO incluyen objetos de
# Storage (solo la metadata en storage.objects), así que si estos bytes no se
# copian acá no se copian en ninguna parte.
mkdir -p "$DIR/storage"
npx supabase storage cp -r "ss:///pod-evidencias"  "$DIR/storage" "$MODO" --experimental
npx supabase storage cp -r "ss:///liquidaciones"   "$DIR/storage" "$MODO" --experimental
npx supabase storage cp -r "ss:///documentos-dte"  "$DIR/storage" "$MODO" --experimental

# `contexto-mapas` se omite a propósito: es cartografía pública reproducible con
# el pipeline de `scripts/mapa/README.md`, pesa ~19 MB y no contiene un solo dato
# de courier, seller, conductor ni destinatario.

echo "== Respaldo completo: $DIR =="
echo "Recuerda: estos archivos NO se versionan (backups/ está en .gitignore)."
