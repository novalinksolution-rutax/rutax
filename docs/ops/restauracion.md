# Respaldo y restauración — runbook (§4.6 de la auditoría de arquitectura)

> Alcance: motor entrega→dinero (cobros a sellers, liquidaciones a conductores,
> DTE) + operación (pedidos, manifiestos, POD same-day) + secretos cifrados
> (certificados, tokens ML, credenciales DTE). Léelo junto a `CLAUDE.md` (§
> invariantes) y a la skill `multitenant-rls`.
>
> **Estado real del proyecto (jul 2026):** fase pre-lanzamiento. NO existe
> todavía un proyecto Supabase Cloud provisionado ni un deploy en Vercel. El
> único entorno real y ejecutable es el stack local Docker vía Supabase CLI
> (ver `docs/PRUEBA.md`). Este runbook documenta la estrategia OBJETIVO (para
> cuando exista un proyecto Cloud) y la estrategia INTERINA (la que aplica
> hoy, y que ya fue ejercitada en un drill real — ver
> `docs/ops/bitacora-restauracion.md`).

---

## 1. RPO / RTO

**RPO (Recovery Point Objective — cuánto dato es aceptable perder) y RTO
(Recovery Time Objective — cuánto tiempo hasta restaurar el servicio):**

| Escenario | RPO | RTO |
|---|---|---|
| **Objetivo, con Supabase Cloud Pro + PITR activo** (aplica cuando exista el proyecto real) | ≤ 5 minutos (granularidad de PITR de Supabase sobre Postgres) | ≤ 4 horas (base de datos vía PITR: minutos–decenas de minutos; sumamos margen para Storage, verificación de aislamiento tenant, y cutover de Vercel/DNS) |
| **Interino, hoy (pre-Cloud, respaldo lógico manual/cron)** | ≤ 24 horas (cadencia diaria del script de respaldo) | ≤ 4 horas (demostrado por el drill real: reconstrucción completa en ~10 min incluyendo troubleshooting de primera vez — ver bitácora) |

**Por qué estos números (y no otros), dado que es un motor financiero:**

- **Las liquidaciones y facturas se procesan por período** (semanal/quincenal/
  mensual — no en tiempo real, ver `dinero.periodos_cobro`), y la **emisión de
  DTE es un gate manual** (`emitirFacturaPeriodo`, nunca automática — ver
  invariante "Compuerta de aprobación de facturación" en `CLAUDE.md`). Esto da
  más margen de RPO que un procesador de pagos en tiempo real: perder unas
  horas de datos operativos (pedidos, manifiestos) es recuperable re-
  ingiriendo desde la fuente (ML/Flex) o re-capturando POD same-day dentro de
  la ventana de trabajo del día; perder DTEs **ya emitidos** es lo que NO se
  puede tolerar, porque son irreversibles ante el SII — por eso el RPO
  objetivo de 5 min con PITR está pensado para ESE dato, no para el flujo
  operativo general.
- **El POD same-day capturado en Rutax es la evidencia autoritativa** (a
  diferencia de Flex, donde la app de Mercado Envíos es la fuente de verdad —
  ver "Restricción dura" en `CLAUDE.md`). Perder `operacion.evidencias_entrega`
  o los objetos del bucket `pod-evidencias` significa perder la prueba de
  entrega de un pedido same-day disputado — de ahí que el respaldo de Storage
  no sea opcional ni secundario al de la base de datos.
- **RTO de 4 horas (no menos) es realista para una operación de un solo
  fundador** (RNF del proyecto: opera solo, sin equipo SRE 24/7) — exigir un
  RTO de minutos implicaría guardias/on-call que hoy no existen. 4 horas es
  además coherente con el hecho de que la operación de couriers corre en
  ventanas de trabajo diurnas (Santiago, `America/Santiago`), no 24/7.
- **Gate de lanzamiento:** estos RPO/RTO INTERINOS son aceptables solo
  mientras no haya dinero real ni clientes en producción. **Antes de lanzar a
  producción real, activar PITR (Cloud Pro) es una condición de salida**, no
  una mejora opcional — un courier con cobros/liquidaciones reales no puede
  operar con un RPO de 24 horas sobre su motor de dinero.

---

## 2. Qué se respalda (alcance verificado, no asumido)

Investigado en el código antes de escribir este runbook (`supabase/migrations/`,
`src/modules/integraciones/secretos/`, `src/modules/dinero/`):

### 2.1 Base de datos (Postgres)

Schemas de negocio con `tenant_id` + RLS enable/force: `identidad`, `operacion`,
`dinero`, `integraciones`, más las vistas de `public`. Incluye, entre otras,
`identidad.secretos_cifrados` (certificados, tokens OAuth ML, credenciales DTE
— **cifrados**, ver §2.3) y toda la cadena de dinero (`lineas_cobro`,
`lineas_liquidacion`, `documentos_dte`, `liquidaciones`, `pagos_recibidos`,
`payouts_conductor`, `eventos_conciliacion`).

**NO se respaldan por defecto** (ver §5 y §7): los schemas
`auth`/`storage`/`realtime`/`vault`/`extensions` — son **manejados por la
plataforma** (Supabase). Un proyecto Supabase real (Cloud o `supabase start`
recién iniciado) ya los provisiona; no se recrean vía migraciones propias.

### 2.2 Storage (objetos binarios — fuera de Postgres)

Un solo bucket confirmado hoy, `pod-evidencias` (privado, declarado en
`supabase/config.toml` y creado también por migración SQL en
`supabase/migrations/20260613000008_operacion_pod_tracking.sql`): fotos/firmas
del POD same-day. Convención de path:
`{tenant_id}/{pedido_id}/{pod_id}/{foto|firma}.<ext>`.

**Hallazgo (no asumido, verificado con `grep`):** el código YA referencia dos
buckets más que **no están provisionados** (ni en `config.toml` ni en ninguna
migración `insert into storage.buckets`):

- `liquidaciones` — usado por
  `src/modules/dinero/jobs/generar-liquidacion-conductor.ts` para subir el PDF
  de liquidación del conductor (`.storage.from('liquidaciones').upload(...)`).
  El job captura el error de subida y continúa sin PDF (`pdfRef = null`) —
  no rompe el job, pero **hoy, en un ambiente donde alguien no haya creado el
  bucket manualmente por Studio, ningún PDF de liquidación se persiste
  jamás**, silenciosamente.
- `documentos-dte` — usado por `src/app/portal/cobros/actions.ts` para generar
  la signed URL de descarga del PDF de factura al seller. Como el adaptador
  DTE corre en sandbox (`resultadoDte.pdfUrl` es `null` — ver
  `src/modules/integraciones/dte/adaptadores/simplefactura.ts`), hoy no hay
  nada que subir a este bucket; el gap se vuelve real recién cuando se
  conecte el proveedor DTE real (Openfactura, ver
  `docs/arquitectura/validacion-dte-openfactura.md`).

**Acción pendiente (no es de este runbook, es de `base-datos-rls`/`backend`):**
crear ambos buckets con el mismo patrón que `pod-evidencias` (migración +
`config.toml`) antes de depender de ellos en producción. Mientras tanto, el
script de respaldo (`scripts/respaldo-local.sh`) solo exporta `pod-evidencias`
— el único que existe — con comentarios listos para sumar los otros dos en
cuanto se creen.

### 2.3 Secretos (clave de cifrado — NUNCA en el mismo respaldo que los datos)

`identidad.secretos_cifrados.valor_cifrado` guarda AES-256-GCM
(`src/modules/integraciones/secretos/cifrado-primitivas.ts`, formato
`version(1) || nonce(12) || tag(16) || ciphertext`). La clave maestra
(`SECRETOS_CLAVE_CIFRADO_B64`, 32 bytes base64, con rotación vía
`SECRETOS_CLAVE_CIFRADO_B64_<kid>` + `SECRETOS_CIFRADO_KID`) vive **solo** en
variables de entorno del gestor de secretos del despliegue (hoy: `.env.local`
fuera de git; a futuro: el secret manager de Vercel/Supabase) — **nunca en la
base de datos, nunca en el repo, nunca en un dump**.

Esto es deliberado: el dump de BD (aunque se filtrara) es **inútil sin la
clave**, porque viven en canales de recuperación completamente separados. Al
restaurar (§6), la clave se recupera del secret manager del despliegue — este
documento nunca contiene, ni contendrá, un valor real de clave o secreto.

---

## 3. Estrategia objetivo — con proyecto Supabase Cloud (cuando exista)

**PITR (Point-in-Time Recovery)** requiere plan **Pro o superior**. Cubre
**Postgres únicamente** — no Storage (ver limitación explícita abajo).

### 3.1 Habilitar PITR (pasos exactos, Dashboard)

1. Supabase Dashboard → proyecto → **Settings → Database → Backups**.
2. Confirmar el plan del proyecto es **Pro** o superior (PITR no está
   disponible en el plan Free).
3. En la sección **Point in Time Recovery**, activar el toggle y elegir la
   ventana de retención (7/14/28 días según el add-on contratado).
4. Supabase empieza a archivar WAL continuamente desde ese momento — el
   punto de restauración más antiguo disponible es el momento de activación,
   no antes. **Actívalo el mismo día que se cree el proyecto real**, no
   después.
5. Para restaurar: **Settings → Database → Backups → Point in Time Recovery**
   → elegir fecha/hora exacta (zona horaria del Dashboard es UTC — convertir
   desde `America/Santiago`: Santiago está en UTC−4 o UTC−3 según horario de
   verano/invierno chileno — **verificar el offset vigente antes de elegir la
   hora**, un error de huso horario aquí puede hacer perder o duplicar horas
   de datos) → confirmar. Supabase crea un **proyecto nuevo** con los datos
   restaurados a ese instante (no sobrescribe el proyecto original in-place).
6. Repuntar `NEXT_PUBLIC_SUPABASE_URL`/claves en Vercel hacia el proyecto
   restaurado, o migrar los datos de vuelta — decisión operativa según el
   caso (ver §6).

### 3.2 Limitación explícita: PITR NO cubre Storage

Los archivos en buckets (`pod-evidencias`, y los que se sumen) NO están
incluidos en el PITR de Postgres — solo la fila de metadata en
`storage.objects` (qué archivo existe, en qué bucket, con qué path) vive en
Postgres; **los bytes del archivo viven en el backend de Storage** (disco
local en self-hosted, S3 en Supabase Cloud).

**Mecanismo recomendado para Storage** (usa lo que ya existe — `config.toml`
ya tiene `[storage.s3_protocol] enabled = true`, confirmado en este repo):

- **Opción A (recomendada, sin infraestructura nueva):**
  `npx supabase storage cp -r "ss:///pod-evidencias" <destino> --linked
  --experimental` contra el proyecto Cloud, con cadencia cron hacia un
  volumen fuera de Supabase (ver §4 para la cadencia).
- **Opción B (para una copia externa al proveedor — principio 3-2-1):**
  `rclone` contra el endpoint S3-compatible de Supabase Storage
  (`storage.s3_protocol`, credenciales en el Dashboard → Settings → Storage)
  replicando hacia un bucket S3-compatible externo (Cloudflare R2, Backblaze
  B2, AWS S3). Esto NO es "infraestructura nueva no trivial" en el sentido de
  la restricción del proyecto (no es un microservicio ni una cola propia) —
  es un comando de sincronización programado, igual de simple que el cron de
  `pg_dump`.

---

## 4. Estrategia interina — hoy (pre-Cloud, stack local/staging)

**Ya implementada y ejercitada en un drill real** (ver
`docs/ops/bitacora-restauracion.md`).

- **Herramienta:** `scripts/respaldo-local.sh` — envuelve `supabase db dump`
  (esquema + datos de los schemas de negocio) y `supabase storage cp -r`
  (bucket `pod-evidencias`). Ver el script para el detalle exacto; usa
  `--local` contra el stack Docker o `--linked` contra un proyecto Cloud ya
  vinculado (`npx supabase link`).
- **Destino:** `${RESPALDOS_DIR_LOCAL:-./backups}/<timestamp-UTC>/` (ver
  `.env.example`). **Nunca versionado** (`.gitignore` ya excluye `/backups/`).
- **Cadencia sugerida:**
  - Hoy (pre-lanzamiento, sin datos reales de clientes): **antes de cada
    sesión de trabajo relevante sobre datos de demo/QA**, y como mínimo
    **1 vez por semana** mientras el proyecto siga en esta fase.
  - Al conectar el primer courier/seller real (aunque siga siendo
    "self-hosted"/interino): pasar a **diario** (cron, hora de baja actividad
    en Chile — sugerido 03:00 `America/Santiago`, fuera de la ventana
    habitual de despacho/cierre de período) — y tratar la falta de PITR real
    como bloqueante para aceptar dinero de producción de verdad (ver §1, gate
    de lanzamiento).

### Qué NO cubre este script (a propósito)

`supabase db dump --data-only` **sin** restringir `--schema` incluye, además
de los datos de negocio, **`auth.users`, `auth.sessions`,
`auth.refresh_tokens` (tokens de sesión activos) y `storage.buckets` /
`storage.objects`** — verificado ejecutando el comando en este drill. Un
archivo con eso adentro es, en la práctica, material de credenciales (no solo
datos de negocio). `scripts/respaldo-local.sh` restringe deliberadamente
`--schema identidad,operacion,dinero,integraciones,public` para NO capturar
`auth`/`storage` en un archivo plano sin protección adicional. La continuidad
de cuentas/sesiones de Auth queda, por ahora, a cargo del mecanismo nativo de
la plataforma (PITR de Cloud cubre el clúster completo, incluido `auth`) — ver
§8 (pendientes).

---

## 5. Pasos de restauración

### 5.1 Base de datos

1. **Destino de restauración: siempre un proyecto Supabase** (Cloud, o un
   stack local recién levantado con `npx supabase start` + `npx supabase db
   push` para aplicar las migraciones vacías) — **nunca una base Postgres
   pelada**. `supabase db dump` (esquema) excluye a propósito los schemas
   `auth`/`storage`/`realtime`/`vault`/`extensions` porque asume que el
   destino YA los tiene (los provisiona la plataforma al crear el proyecto).
   Restaurar contra una base sin esos schemas falla (lo confirmamos en el
   drill — ver bitácora) y requiere parches manuales que **no aplican a un
   proyecto real**.
2. Aplicar `schema.sql` primero, luego `data.sql`:
   ```bash
   # Contra un proyecto Cloud (con DATABASE_URL o --linked):
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f data.sql
   ```
3. **Nota sobre `dinero.documentos_dte`:** `pg_dump` avisa de una FK circular
   en esta tabla (probablemente factura↔nota de crédito relacionada). El dump
   de datos ya envuelve la carga en `SET session_replication_role = replica;`
   (se ve en el propio archivo generado), lo que evita el problema de orden
   de FKs en la práctica — confirmado en el drill. Si algún día falla contra
   un dataset real con ciclos genuinos, restaurar con
   `psql -c "SET session_replication_role = replica;" ...` explícito o
   `pg_restore --disable-triggers`.
4. **Para un drill de práctica contra el stack LOCAL** (sin gastar un
   proyecto Cloud real): usar `scripts/restaurar-drill-local.sh
   <carpeta-del-respaldo>` — crea una base de datos temporal AISLADA dentro
   del mismo clúster Docker, con el andamiaje mínimo de plataforma que un
   proyecto real ya trae de fábrica (ver comentarios del script). **Nunca
   restaurar sobre la base de desarrollo activa** sin necesidad real.

### 5.2 Storage

```bash
# Restaurar hacia el bucket real (mismo nombre, proyecto ya con el bucket creado):
npx supabase storage cp -r <carpeta-respaldo>/storage/pod-evidencias \
  "ss:///pod-evidencias" --linked --experimental   # o --local para el stack local
```

Para un drill aislado: subir a un bucket temporal distinto (no al bucket real
en uso) y comparar hashes antes de tocar el bucket de producción — así lo
hicimos en el drill (ver bitácora).

### 5.3 Clave de cifrado de secretos (`SECRETOS_CLAVE_CIFRADO_B64`)

**Nunca viaja con el respaldo de datos.** Se recupera de:

- **Hoy:** `.env.local` del desarrollador (fuera de git) o donde el equipo
  guarde credenciales locales (p. ej. un gestor de contraseñas compartido —
  decisión pendiente, no técnica).
- **A futuro (producción real):** el secret manager del despliegue (Vercel
  Environment Variables para la app; si se usa Supabase Vault en algún punto,
  su propio mecanismo — ver decisión documentada en
  `src/modules/integraciones/secretos/cifrado.ts`).

Sin esta clave, `identidad.secretos_cifrados` restaurado es **ciphertext
opaco e irrecuperable** — por diseño (AEAD: ni siquiera un atacante con la
BD puede leerlo). Esto significa que **la clave debe respaldarse
independientemente** de la base de datos (p. ej. como parte del proceso de
onboarding/offboarding de acceso al secret manager), con un procedimiento de
custodia propio — fuera del alcance técnico de este runbook, pero su ausencia
bloquea toda restauración útil de secretos.

**Prueba de round-trip:** tras restaurar, verificar que al menos un secreto
descifra correctamente usando la clave del secret manager (nunca imprimir el
valor — solo confirmar OK/FALLÓ). Herramienta reproducible:
`scripts/verificar-descifrado-secreto.sh <db_name> <referencia_externa_id>`
(consulta el paquete cifrado vía `psql` y delega a
`scripts/verificar-descifrado-secreto.mjs`, que reimplementa el mismo formato
de paquete y la misma resolución de clave que
`src/modules/integraciones/secretos/cifrado{-primitivas,}.ts` — si esos
módulos cambian de formato/algoritmo, actualízalo). Ver el resultado real del
primer drill en `docs/ops/bitacora-restauracion.md`.

---

## 6. Procedimiento ante corrupción de datos detectada

**Cómo se detecta:**

- **Ya construido:** el detective de conciliación de tres fuentes
  (`src/modules/dinero/jobs/conciliar-tres-fuentes.ts`, job C7) escribe
  discrepancias en `dinero.eventos_conciliacion`, y
  `src/lib/avisos/obtener-avisos.ts` las expone como aviso "importante" a
  dueño/administración (no queda silencioso — audit §2.7/QW6). Es la primera
  señal de que algo en la cadena pedido→cobro→liquidación no cuadra —
  corrupción de datos es una de las causas posibles (otras: bug de negocio,
  reintento duplicado).
- **Meta-prueba de cobertura RLS** (`supabase/tests/database/
  rls_cobertura_meta.test.sql`): corrida regular (`npx supabase test db`)
  detecta si una tabla de negocio pierde RLS enable/force — un síntoma de
  corrupción de *esquema*, no solo de datos.
- **Sentry** (`src/instrumentation.ts`, `src/lib/observabilidad/`): errores no
  manejados en jobs Inngest o en la app — una fuente de corrupción sería un
  job que falla a mitad de una escritura multi-tabla sin transacción.
- Manual: reporte de un seller/conductor de un monto que no cuadra con su
  factura/liquidación.

**Cómo se aísla:**

1. **NO seguir corriendo jobs de dinero** sobre el tenant afectado mientras se
   investiga — en particular, no cerrar más períodos (`cerrarPeriodo`) ni
   emitir DTEs (`emitirFacturaPeriodo`) para ese tenant hasta confirmar el
   alcance.
2. Usar `bitacora_auditoria` (append-only, se escribe ANTES de cualquier
   efecto externo — invariante del proyecto) para reconstruir la secuencia
   exacta de acciones financieras alrededor del momento sospechoso, con su
   `actorUsuarioId`.
3. Delimitar el `tenant_id` y el rango de `periodo_cobro`/fecha afectado —
   nunca actuar sobre todos los tenants a la vez (aislamiento RLS es también
   una ayuda operativa aquí: el blast radius de un bug de datos debería,
   por diseño, estar acotado a un tenant).

**Cómo se restaura sin duplicar/perder líneas financieras:**

1. Restaurar la BD (§5.1) a un punto anterior a la corrupción, en un entorno
   AISLADO (nunca sobre producción directamente).
2. Comparar, para el tenant y rango afectado, las tablas de la cadena de
   dinero (`lineas_cobro`, `lineas_liquidacion`, `documentos_dte`,
   `liquidaciones`, `pagos_recibidos`) fila por fila (`id`, no solo conteos)
   entre el estado corrupto y el restaurado.
3. **Nunca hacer un `INSERT` masivo de "las filas que faltan" a ciegas** —
   los DTEs ya emitidos ante el SII son irreversibles; si el restaurado
   muestra un DTE que el corrupto no tiene (o viceversa), la reconciliación
   es manual y consulta la fuente de verdad externa (el proveedor DTE/SII
   tiene su propia copia del documento emitido).
4. Aplicar el fix de datos como una migración/script auditado y reversible,
   nunca como un `UPDATE` directo en el Dashboard de producción sin registro
   en `bitacora_auditoria`.

---

## 7. Continuidad si cae el proveedor Cloud (Supabase / Vercel)

**Qué queda degradado:**

- Sin Supabase disponible: la app completa deja de funcionar (Postgres/Auth/
  Storage son todos Supabase) — no hay modo degradado parcial, es un
  monolito sobre un solo backend de datos.
- Sin Vercel disponible: el frontend/API routes de Next.js no sirven, aunque
  Supabase siga arriba — los jobs Inngest programados seguirían corriendo si
  Inngest está sano y solo depende de Supabase (los handlers viven en Next.js
  vía `/api/inngest`, así que si Vercel cae, los jobs tampoco pueden
  ejecutar su código, aunque Inngest los encole).

**Qué NO se hace en ese estado (no improvisar):**

- **No se emite ningún DTE "manualmente" por fuera del flujo** (ni por
  Studio, ni por un script ad-hoc) mientras el proveedor esté caído — la
  compuerta de aprobación (`emitirFacturaPeriodo`) y su bitácora de auditoría
  son el único camino válido; saltárselas rompe la trazabilidad ante el SII.
- **No se ejecutan pagos/payouts a conductores "a mano"** fuera del flujo de
  `dinero.payouts_conductor` — un pago duplicado por fuera del sistema no se
  concilia después.
- **No se restaura sobre producción "para probar"** — cualquier restauración
  en medio de una caída del proveedor se hace en un entorno aislado primero
  (§5), igual que en un drill normal.

**Cómo se comunica:**

- Aviso a sellers/conductores vía el canal que exista en ese momento (hoy,
  pre-lanzamiento: no aplica; a futuro: email/WhatsApp — fuera del alcance de
  este runbook, ver `copywriter` para la plantilla de comunicación de
  incidente).
- Estado público de Supabase (`status.supabase.com`) y de Vercel
  (`vercel-status.com`) como primera fuente para diferenciar "es un problema
  del proveedor" de "es nuestro".
- Registrar el incidente (inicio, causa, duración, acciones tomadas) — mismo
  espíritu que `docs/ops/bitacora-restauracion.md`, en un archivo de
  incidentes separado si esto llega a ocurrir en producción real.

---

## 8. Pendiente para cuando exista un proyecto Supabase Cloud real

- Activar PITR (§3.1) el mismo día que se cree el proyecto — **no
  ejercitado en este drill** porque no existe el proyecto (honesto: no se
  simuló, se documentó el paso a paso exacto para cuando corresponda).
- Decidir custodia de `SECRETOS_CLAVE_CIFRADO_B64` en el secret manager real
  (Vercel Environment Variables) — hoy vive en `.env.local` de cada
  desarrollador.
- Crear los buckets `liquidaciones` y `documentos-dte` (hallazgo §2.2) antes
  de que su ausencia sea un problema silencioso en producción.
- Decidir si, al conectar el proveedor DTE real, el XML/PDF se descarga y
  persiste en `documentos-dte` (recomendado — el emisor debe conservar sus
  propios ejemplares ante el SII) o se confía solo en el hosting del
  proveedor.
- Sumar `auth`/`storage` a la estrategia de respaldo de datos (hoy
  excluidos a propósito del script interino, ver §4) una vez que haya un
  mecanismo de manejo seguro para ese archivo (cifrado en reposo aparte, o
  delegado enteramente al PITR de Cloud).
- Repetir este mismo drill contra un proyecto Cloud real (o un `supabase
  start` fresco) una vez posible, sin necesitar los parches de
  `scripts/restaurar-drill-local.sh` (que son un atajo válido solo para una
  base pelada del mismo clúster).

---

## Referencias

- Resultado del primer drill (real, ejecutado): `docs/ops/bitacora-restauracion.md`
- Scripts: `scripts/respaldo-local.sh`, `scripts/restaurar-drill-local.sh`,
  `scripts/verificar-descifrado-secreto.sh` (+ `.mjs`)
- `docs/PRUEBA.md` — arranque del stack local/staging
- `CLAUDE.md` — invariantes de aislamiento multi-tenant y secretos
