# Bitácora de drills de restauración

Registro honesto de cada ejecución real (no simulada) del procedimiento de
`docs/ops/restauracion.md`. Cada entrada dice qué se probó, qué falló en el
camino (y cómo se resolvió) y qué **no** se pudo validar todavía.

---

## Drill 1 — 2026-07-06/07 (stack local Docker)

**Entorno:** stack local Docker vía Supabase CLI (`supabase status` →
`API_URL=http://127.0.0.1:54321`, `DB_URL` en `127.0.0.1:54322`), migraciones
aplicadas, seed de demo cargado (tenant único "Despachos del Centro SpA").
No existe todavía proyecto Supabase Cloud — este drill **no** pudo validar
PITR real ni restauración contra un proyecto Cloud (ver §"Qué NO se validó").

**Duración real:** inicio `2026-07-07T02:42:40Z` → fin `2026-07-07T02:52:20Z`
→ **9 min 40 s** (incluye troubleshooting de primera vez de la restauración de
esquema — ver "Problemas encontrados"; con los scripts ya corregidos
(`scripts/restaurar-drill-local.sh`), un drill repetido debería tomar una
fracción de esto). **Muy por debajo del RTO interino documentado (≤ 4 horas).**

### Preparación (fixtures del drill, sintéticos, no datos reales)

Para que la verificación fuera real (no un no-op con un solo tenant), se
agregaron ANTES del respaldo:

- Tenant sintético `aaaaaaaa-0000-0000-0000-000000000099` ("QA Drill
  Restauracion SpA", RUT `99999999-9`), además del tenant demo existente
  `10000000-0000-0000-0000-000000000001`.
- Dos filas de prueba en `identidad.secretos_cifrados` (una por tenant, IDs
  `bbbbbbbb-...-0001` y `bbbbbbbb-...-0099`), cifradas con el mecanismo REAL
  del proyecto (`cifrarPaquete` de `cifrado-primitivas.ts`) usando la clave
  activa de `.env.local` — valores en claro sintéticos, nunca reales, nunca
  impresos.
- Un objeto de prueba subido a `pod-evidencias` bajo el path del tenant
  sintético (`aaaaaaaa-.../drill/test.txt`), sumado al objeto real ya
  existente en el bucket (`10000000-.../60000000-.../evidencias/*.jpg`).

Todos estos fixtures se **eliminaron del entorno de desarrollo activo al
finalizar el drill** (ver "Limpieza"), dejándolo exactamente como estaba
antes.

### Respaldo ejecutado

```
npx supabase db dump --local -f schema.sql                                    (245.084 bytes)
npx supabase db dump --local --data-only \
  --schema identidad,operacion,dinero,integraciones,public -f data.sql         (73.267 bytes)
npx supabase storage cp -r ss:///pod-evidencias <destino> --local --experimental
```

Advertencia de `pg_dump` observada (informativa, no bloqueante en este
dataset): *"there are circular foreign-key constraints on this table:
dinero.documentos_dte"* — el propio dump envuelve la carga de datos en
`SET session_replication_role = replica;` / `RESET`, lo que evitó cualquier
problema real de orden de FKs en la restauración. Documentado en el runbook
por si un dataset real con ciclos genuinos se comporta distinto.

### Problemas encontrados durante la restauración (y su fix — ya incorporados a `scripts/restaurar-drill-local.sh`)

Restaurar `schema.sql` contra una base de datos Postgres recién creada
(`CREATE DATABASE`, sin pasar por `supabase start`) falló varias veces en
cascada, cada vez revelando un supuesto de plataforma distinto que
`supabase db dump` da por sentado que el destino ya tiene:

1. `ERROR: schema "extensions" does not exist` → el dump asume que el destino
   ya tiene el schema `extensions` (para las `CREATE EXTENSION ... WITH
   SCHEMA "extensions"`).
2. `ERROR: schema "vault" does not exist` → ídem, para `supabase_vault`.
3. `ERROR: schema "auth" does not exist` → varias FK de negocio
   (`bitacora_auditoria`, `usuarios_perfil`, `asignaciones_pedido`,
   `incidencias`, `manifiestos`, `evidencias_incidencia`) referencian
   `auth.users(id)`; las políticas RLS de `usuarios_perfil` llaman
   `auth.uid()`.
4. `ERROR: publication "supabase_realtime" does not exist` → una
   `ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres"` al final del
   dump no está cubierta por los filtros `sed` de la CLI (que sí cubren
   `ALTER PUBLICATION "supabase_realtime_..."` con guión bajo, pero no el
   nombre exacto sin sufijo).

**Conclusión importante para el runbook:** ninguno de estos 4 parches hace
falta contra un proyecto Supabase real (Cloud o `supabase start` recién
levantado) — ahí `extensions`/`vault`/`auth`/la publicación de realtime YA
existen, provistos por la plataforma. Son un atajo válido **solo** para
"reconstruir desde cero" dentro de una base pelada del mismo clúster, que es
lo único disponible hoy sin gastar un proyecto Cloud real. Quedaron
encapsulados en `scripts/restaurar-drill-local.sh` para que el próximo drill
no tenga que redescubrirlos.

Con esos 4 stubs aplicados, `schema.sql` restauró completo sin errores
(`ALTER DEFAULT PRIVILEGES` como último statement, exit 0), y `data.sql`
restauró completo sin errores (exit 0, 24 `INSERT` statements + 1 `setval`).

### Restauración de Storage

Bucket temporal aislado `pod-evidencias-restore-drill` creado vía
`insert into storage.buckets` (mismo patrón que la migración de
`pod-evidencias`). Los 2 objetos del respaldo se subieron ahí (uno requirió
forzar `--content-type image/png` porque el bucket replica la restricción de
`allowed_mime_types` de `pod-evidencias` y el archivo de prueba es texto
plano).

### Verificación (los 4 puntos pedidos)

| Verificación | Resultado |
|---|---|
| **(a) Conteos por tabla** — 42 tablas de negocio (`identidad`/`operacion`/`dinero`/`integraciones`), original vs. restaurado | **Idénticos**, sin diferencias (`diff` vacío) |
| **(b) Aislamiento por tenant** — comparación exacta de pares `(id, tenant_id)` en `identidad.secretos_cifrados` y `identidad.tenants` (no solo conteos agregados, para detectar un swap real) | **Idénticos** — el tenant demo mantuvo su 1 secreto, el tenant QA drill mantuvo el suyo, sin cruce |
| **(c) Round-trip de descifrado** — `descifrarPaquete` real del proyecto contra los 2 secretos restaurados, con la clave de `.env.local` | **Secreto tenant demo: OK** / **Secreto tenant QA drill: OK** (solo se imprimió "OK"/"FALLO", nunca el valor) |

> Nota: en este primer drill, la verificación (c) se hizo con un script ad-hoc
> no versionado. Después de la revisión de `seguridad-cumplimiento`, se
> versionó `scripts/verificar-descifrado-secreto.sh` (+ `.mjs`) — la misma
> lógica, reproducible, para que el próximo drill no tenga que reinventarla.
| **(d) Integridad de Storage** — SHA-256 de los 2 objetos restaurados vs. los originales | **Idénticos** en ambos objetos (`c55857db…` para el JPG del POD, `5c29dbbe…` para el archivo de prueba) |

### Qué NO se validó (honestidad explícita, no simulado)

- **PITR real de Supabase Cloud** — no existe proyecto Cloud; solo se
  documentaron los pasos exactos del Dashboard (§3.1 del runbook).
- **Restauración contra un proyecto Cloud real** (con `--linked` en vez de
  `--local`) — mismo motivo.
- **Continuidad de `auth.users`/sesiones** — el script interino excluye
  `auth`/`storage` del dump de datos a propósito (ver runbook §4, hallazgo de
  seguridad: el dump sin `--schema` restringido incluye tokens de sesión).
  No se ejercitó restaurar cuentas de usuario reales.
- **Los buckets `liquidaciones` y `documentos-dte`** — no existen
  provisionados en este entorno (hallazgo del runbook §2.2), así que no hay
  nada que respaldar/restaurar de ellos todavía.
- **Volumen real de producción** — el dataset de demo es pequeño (~40
  pedidos, 2 tenants); el RTO interino demostrado (9m40s) no necesariamente
  escala linealmente a un dataset de producción con miles de pedidos/objetos
  de Storage. Repetir el drill periódicamente a medida que crezca el dataset.

### Limpieza (entorno de desarrollo restaurado a su estado previo)

- Base de datos temporal `restore_drill_20260707024803` (o equivalente,
  timestamp exacto de la sesión) → `DROP DATABASE`.
- Bucket temporal `pod-evidencias-restore-drill` y sus 2 objetos → eliminados
  vía Storage API.
- Fixtures del drill en el entorno de desarrollo activo → eliminados
  (`DELETE` de los 2 `secretos_cifrados` de prueba, `DELETE` del tenant
  sintético — cascada; `DELETE` del objeto de prueba en `pod-evidencias`).
- Verificado después de la limpieza: `identidad.tenants` → 1 fila (el tenant
  demo), `identidad.secretos_cifrados` → 0 filas, `pod-evidencias` → 1 objeto
  (el original) — **exactamente el estado previo al drill**.
- Los archivos del respaldo (`backups/20260707-024240/`) se dejaron en disco
  localmente como evidencia (no se versionan — `.gitignore` ya excluye
  `/backups/`); se pueden borrar en cualquier momento sin afectar nada.

### Próximo drill

Repetir con cadencia trimestral mínimo (o antes del primer lanzamiento a
producción real), y en cuanto exista un proyecto Supabase Cloud, repetir
contra ese proyecto con `--linked` para validar PITR real — actualizar esta
bitácora con una entrada nueva, no sobrescribir esta.
